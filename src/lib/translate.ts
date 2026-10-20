// 全文翻译：按「页」请求翻译，并把结果增量保存到磁盘。
//
// 服务商（siteConfig.translation.provider）：
//   'tencent'  —— 腾讯交互翻译（默认）。国内直连、免密钥、支持批量；
//   'mymemory' —— MyMemory 免费接口（单次 500 字符、有每日额度，长文容易 429）
//   'custom'   —— .env 的 ONLINE_TRANSLATE_URL
//   'none'     —— 关闭
//
// 缓存：data/users/<userId>/translations/<articleId>.json
//   { version, provider, targetLang, pages: { "<page>": { key, units: [{ index, hash, target }] } } }
//   - 以「段」为单位缓存：同一段在翻页/刷新/重新分页后都能命中；
//   - 只缓存成功的段落，失败段落下次会重试（不会再出现"部分失败后被永久缓存"）。

import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readEnv } from './env.ts';
import { userDir } from './paths.ts';
import { siteConfig } from '../config/site.ts';

export interface TranslationProvider {
  id: string;
  label: string;
  /** 单次请求允许的最大字符数 */
  maxChars: number;
  /** 单次请求最多几条文本（批量接口用） */
  batchSize: number;
  /** 批量翻译；返回与输入一一对应的数组，某项失败为 null */
  translateBatch(texts: string[], target: string): Promise<(string | null)[]>;
  /** 是否属于限流类错误（用于提示用户稍后再试） */
  isRateLimited?(error: unknown): boolean;
}

export interface TranslatedUnit {
  index: number;
  target: string;
  error?: string;
}

export interface TranslatePageResult {
  ok: boolean;
  provider: string;
  providerLabel: string;
  articleId: string;
  page: number;
  totalPages: number;
  targetLang: string;
  /** 是否全部命中缓存 */
  cached: boolean;
  units: TranslatedUnit[];
  failed: number;
  message?: string;
}

const CACHE_VERSION = 2;

/* ───────────── 服务商 ───────────── */

function tencentProvider(): TranslationProvider {
  // 腾讯交互翻译网页端使用的前端标识；接口免登录、国内可直连
  const CLIENT_KEY = 'browser-chrome-110.0.0-Mac OS-df4bd4c5-a65d-44b2-a40f-42f34f3535f2-1677486696487';
  const TARGET: Record<string, string> = { 'zh-CN': 'zh', zh: 'zh', 'en-US': 'en', en: 'en', ja: 'ja' };
  return {
    id: 'tencent',
    label: '腾讯翻译',
    maxChars: 1500,
    batchSize: 10,
    /** busy 属于限流类，可重试 */
    isRateLimited(error) {
      const s = String(error).toLowerCase();
      return s.includes('busy') || s.includes('429') || s.includes('timeout') || s.includes('aborted');
    },
    async translateBatch(texts, target) {
      if (texts.length === 0) return [];
      const body = JSON.stringify({
        header: { fn: 'auto_translation', client_key: CLIENT_KEY },
        type: 'plain',
        model_category: 'normal',
        source: { lang: siteConfig.translation.sourceLang, text_list: texts },
        target: { lang: TARGET[target] || 'zh' },
      });

      // 单批请求；busy / 网络错误由上层重试
      const res = await fetch('https://transmart.qq.com/api/imt', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
          referer: 'https://transmart.qq.com/',
          origin: 'https://transmart.qq.com',
        },
        body,
        signal: AbortSignal.timeout(siteConfig.translation.timeoutMs),
      });
      if (res.status === 429) throw new Error('busy（429 请求过于频繁）');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        header?: { ret_code?: string; ret_code_msg?: string };
        auto_translation?: (string | null)[];
      };
      const code = data.header?.ret_code;
      if (code && code !== 'succ') throw new Error(`busy（${code}）`);
      const list = data.auto_translation ?? [];
      return texts.map((src, i) => {
        const out = list[i];
        if (!out || typeof out !== 'string' || !out.trim()) return null;
        if (out.trim() === src.trim()) return null; // 原样返回视为未翻译
        return out;
      });
    },
  };
}

function myMemoryProvider(): TranslationProvider {
  return {
    id: 'mymemory',
    label: 'MyMemory',
    maxChars: 450,
    batchSize: 1,
    async translateBatch(texts, target) {
      const out: (string | null)[] = [];
      for (const text of texts) {
        try {
          const langpair = `${siteConfig.translation.sourceLang}|${target}`;
          const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(langpair)}`;
          const res = await fetch(url, { signal: AbortSignal.timeout(siteConfig.translation.timeoutMs) });
          if (res.status === 429) throw new Error('MyMemory 今日免费额度已用完（429）');
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = (await res.json()) as {
            responseStatus?: number | string;
            responseDetails?: string;
            responseData?: { translatedText?: string };
          };
          const status = Number(data.responseStatus ?? 200);
          const raw = data.responseData?.translatedText ?? '';
          if (!(status >= 200 && status < 300) || /MYMEMORY WARNING/i.test(raw)) {
            throw new Error(data.responseDetails || `翻译服务返回 ${status}`);
          }
          out.push(raw && raw.trim() !== text.trim() ? raw : null);
        } catch {
          out.push(null);
        }
      }
      return out;
    },
    isRateLimited(error) {
      return String(error).includes('429') || String(error).toLowerCase().includes('quota');
    },
  };
}

function customProvider(url: string): TranslationProvider {
  return {
    id: 'custom',
    label: '自定义接口',
    maxChars: 1500,
    batchSize: 1,
    async translateBatch(texts, target) {
      const out: (string | null)[] = [];
      for (const text of texts) {
        try {
          const targetUrl = url.replace('{q}', encodeURIComponent(text)).replace('{to}', encodeURIComponent(target));
          const res = await fetch(targetUrl, { signal: AbortSignal.timeout(siteConfig.translation.timeoutMs) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = (await res.json()) as Record<string, unknown>;
          const nested = (data.data && typeof data.data === 'object' ? data.data : {}) as Record<string, unknown>;
          const value = data.translation ?? data.translatedText ?? nested.translation ?? nested.translatedText ?? nested.dst ?? '';
          out.push(String(value || '').trim() || null);
        } catch {
          out.push(null);
        }
      }
      return out;
    },
  };
}

export function getProvider(): TranslationProvider | null {
  const env = readEnv();
  const cfg = siteConfig.translation;
  if (cfg.provider === 'none') return null;
  if (cfg.provider === 'custom') return env.translateUrl ? customProvider(env.translateUrl) : null;
  if (cfg.provider === 'mymemory') return myMemoryProvider();
  return tencentProvider();
}

/* ───────────── 分段（按服务商上限切块） ───────────── */

export function splitText(text: string, maxChars: number): string[] {
  // 清洗：还原 HTML 实体、合并空白；这类"脏"文本会让翻译服务直接返回失败
  const clean = text
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return [];
  // 纯数字/符号（如页码、分隔线）不需要翻译
  if (!/[A-Za-z\u4e00-\u9fff]/.test(clean)) return [];
  if (clean.length <= maxChars) return [clean];

  const sentences = clean.match(/[^.。!?！？]+[.。!?！？]*\s*|[^.。!?！？]+$/g) ?? [clean];
  const chunks: string[] = [];
  let current = '';
  const CJK_EDGE = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]$/;
  const join = (a: string, b: string) => (!a ? b : CJK_EDGE.test(a) || CJK_EDGE.test(b) ? a + b : `${a} ${b}`);
  const push = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };
  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    const merged = join(current, s);
    if (merged.length <= maxChars) {
      current = merged;
      continue;
    }
    push();
    if (s.length <= maxChars) {
      current = s;
      continue;
    }
    for (let i = 0; i < s.length; i += maxChars) chunks.push(s.slice(i, i + maxChars));
  }
  push();
  return chunks;
}

/* ───────────── 缓存 ───────────── */

interface CachedUnit {
  index: number;
  hash: string;
  target: string;
}

interface CacheFile {
  version: number;
  provider: string;
  targetLang: string;
  /** 以段 index 为键，跨页共享 */
  units: Record<string, CachedUnit>;
  updatedAt: string;
}

function cacheFile(userId: string, articleId: string): string {
  const safe = articleId.replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(userDir(userId), 'translations', `${safe}.json`);
}

function textHash(text: string): string {
  return createHash('sha1').update(text).digest('hex').slice(0, 12);
}

const memCache = new Map<string, CacheFile>();

async function readCache(userId: string, articleId: string, provider: string, targetLang: string): Promise<CacheFile> {
  const key = `${userId}:${articleId}`;
  const hit = memCache.get(key);
  if (hit && hit.provider === provider && hit.targetLang === targetLang) return hit;

  const file = cacheFile(userId, articleId);
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as CacheFile;
      if (parsed.version === CACHE_VERSION && parsed.provider === provider && parsed.targetLang === targetLang) {
        memCache.set(key, parsed);
        return parsed;
      }
    } catch {
      /* 坏缓存：忽略，重新翻译 */
    }
  }
  const fresh: CacheFile = { version: CACHE_VERSION, provider, targetLang, units: {}, updatedAt: new Date().toISOString() };
  memCache.set(key, fresh);
  return fresh;
}

const saveQueues = new Map<string, Promise<void>>();

async function persist(userId: string, articleId: string, file: CacheFile): Promise<void> {
  file.updatedAt = new Date().toISOString();
  const key = `${userId}:${articleId}`;
  const prev = saveQueues.get(key) ?? Promise.resolve();
  const next = prev.then(async () => {
    const target = cacheFile(userId, articleId);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(file), 'utf8');
    await fs.rename(tmp, target);
  });
  saveQueues.set(key, next);
  await next;
}

/** 读取某篇文章已翻译的段落（供页面预渲染已缓存译文） */
export async function getCachedTranslations(
  userId: string,
  articleId: string
): Promise<{ provider: string; targetLang: string; units: Record<string, CachedUnit> } | null> {
  const file = cacheFile(userId, articleId);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as CacheFile;
    if (parsed.version !== CACHE_VERSION) return null;
    return { provider: parsed.provider, targetLang: parsed.targetLang, units: parsed.units };
  } catch {
    return null;
  }
}

export async function deleteTranslation(userId: string, articleId: string): Promise<void> {
  memCache.delete(`${userId}:${articleId}`);
  await fs.rm(cacheFile(userId, articleId), { force: true });
}

/* ───────────── 主流程 ───────────── */

export interface TranslatePageOptions {
  userId: string;
  articleId: string;
  page: number;
  totalPages: number;
  units: { index: number; text: string }[];
  targetLang: string;
  /** 忽略缓存，强制重译本页 */
  refresh?: boolean;
}

/** 一次翻译多页：合并所有页的 units，结果按段写入同一份缓存 */
export interface TranslateRangeOptions {
  userId: string;
  articleId: string;
  /** 需要翻译的页及其块 */
  pages: { page: number; units: { index: number; text: string }[] }[];
  targetLang: string;
  refresh?: boolean;
}

export interface TranslateRangeResult {
  ok: boolean;
  provider: string;
  providerLabel: string;
  articleId: string;
  targetLang: string;
  /** 本页（请求发起页）的译文，用于立即显示 */
  currentPageUnits: TranslatedUnit[];
  /** 后续页的统计（译文已在缓存中，翻页时自动带出） */
  prefetched: { page: number; units: number; failed: number }[];
  cached: boolean;
  failed: number;
  message?: string;
}

/** 并发池 */
async function runPool<T>(items: T[], limit: number, worker: (item: T, i: number) => Promise<void>): Promise<void> {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        await worker(items[index], index);
      }
    })
  );
}

export async function translatePage(options: TranslatePageOptions): Promise<TranslatePageResult> {
  const provider = getProvider();
  const cfg = siteConfig.translation;
  const base: TranslatePageResult = {
    ok: false,
    provider: provider?.id ?? cfg.provider,
    providerLabel: provider?.label ?? '未启用',
    articleId: options.articleId,
    page: options.page,
    totalPages: options.totalPages,
    targetLang: options.targetLang,
    cached: false,
    units: [],
    failed: 0,
  };
  if (!provider) {
    return {
      ...base,
      message:
        cfg.provider === 'none'
          ? '全文翻译已在配置中关闭。'
          : '翻译接口未配置：请在 .env 设置 ONLINE_TRANSLATE_URL，或把 siteConfig.translation.provider 改为 "tencent"。',
    };
  }

  const file = await readCache(options.userId, options.articleId, provider.id, options.targetLang);
  const units: TranslatedUnit[] = [];
  const todo: { index: number; hash: string; text: string }[] = [];
  let hitCount = 0;

  for (const unit of options.units) {
    const hash = textHash(unit.text);
    const cached = file.units[String(unit.index)];
    if (!options.refresh && cached && cached.hash === hash) {
      units.push({ index: unit.index, target: cached.target });
      hitCount++;
    } else {
      todo.push({ index: unit.index, hash, text: unit.text });
    }
  }

  // 全部命中缓存
  if (todo.length === 0) {
    return { ...base, ok: true, cached: true, units: units.sort((a, b) => a.index - b.index) };
  }

  // 组装待翻译任务：长段先按服务商上限切块，块与块的译文再拼回去
  interface Job {
    index: number;
    hash: string;
    parts: string[];
  }
  const jobs: Job[] = todo.map((u) => ({ index: u.index, hash: u.hash, parts: splitText(u.text, provider.maxChars) }));

  // 无需翻译的块（纯数字、页码、分隔符）：原样返回，不算失败
  const skipUnits: TranslatedUnit[] = [];
  const activeJobs = jobs.filter((job) => {
    if (job.parts.length === 0) {
      skipUnits.push({ index: job.index, target: '' });
      file.units[String(job.index)] = { index: job.index, hash: job.hash, target: '' };
      return false;
    }
    return true;
  });
  jobs.length = 0;
  jobs.push(...activeJobs);
  if (skipUnits.length) await persist(options.userId, options.articleId, file);

  const flatten: { jobIndex: number; partIndex: number; text: string }[] = [];
  jobs.forEach((job, jobIndex) => job.parts.forEach((text, partIndex) => flatten.push({ jobIndex, partIndex, text })));

  // 按 provider.batchSize 分组成批；并发上限由 siteConfig.translation.concurrency 控制
  const batches: (typeof flatten)[] = [];
  for (let i = 0; i < flatten.length; i += provider.batchSize) batches.push(flatten.slice(i, i + provider.batchSize));

  const results = new Map<string, string>();
  const errors = new Map<string, string>();
  let rateLimited = false;

  /** 单批翻译，带指数退避重试（busy / 网络错误都算可重试） */
  const batchTranslate = provider.translateBatch.bind(provider);
  async function translateWithRetry(batch: (typeof flatten)): Promise<{ outs?: (string | null)[]; error?: string }> {
    const texts = batch.map((b) => b.text);
    const maxAttempts = Math.max(1, cfg.retry.maxAttempts);
    let lastError = '';
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const outs = await batchTranslate(texts, options.targetLang);
        return { outs };
      } catch (err) {
        lastError = (err as Error).message || '翻译失败';
        const rateCheck = provider?.isRateLimited?.(err) ?? false;
        const retryable = rateCheck || /busy|429|timeout|aborted|econn|socket/i.test(lastError);
        if (rateCheck) rateLimited = true;
        if (!retryable) break;
        if (attempt < maxAttempts) {
          // 指数退避 + 抖动，避免多批同时重试再次撞车
          const base = cfg.retry.baseDelayMs * Math.pow(2, attempt - 1);
          const delay = Math.min(cfg.retry.maxDelayMs, base + Math.random() * 250);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
    return { error: lastError };
  }

  await runPool(batches, Math.max(1, cfg.concurrency), async (batch) => {
    const { outs, error } = await translateWithRetry(batch);
    if (outs) {
      batch.forEach((item, i) => {
        const out = outs[i];
        const k = `${item.jobIndex}:${item.partIndex}`;
        if (out) results.set(k, out);
        else errors.set(k, '该段未翻译');
      });
    } else {
      batch.forEach((item) => errors.set(`${item.jobIndex}:${item.partIndex}`, error || '翻译失败'));
    }
  });

  // 回填：按段拼装译文并写入缓存
  let failed = 0;
  const written: TranslatedUnit[] = [];
  jobs.forEach((job, jobIndex) => {
    const parts: string[] = [];
    let partError: string | null = null;
    job.parts.forEach((_, partIndex) => {
      const k = `${jobIndex}:${partIndex}`;
      const out = results.get(k);
      if (out) parts.push(out);
      else if (!partError) partError = errors.get(k) || '翻译失败';
    });
    if (parts.length === job.parts.length && parts.length > 0) {
      const target = parts.join(' ');
      file.units[String(job.index)] = { index: job.index, hash: job.hash, target };
      written.push({ index: job.index, target });
    } else {
      failed++;
      written.push({ index: job.index, target: parts.join(' '), error: partError || '翻译失败' });
    }
  });

  if (failed < jobs.length) await persist(options.userId, options.articleId, file);

  const all = [...units, ...written, ...skipUnits].sort((a, b) => a.index - b.index);
  return {
    ...base,
    ok: failed < jobs.length || jobs.length === 0,
    cached: hitCount > 0 && failed === 0,
    units: all,
    failed,
    ...(failed > 0
      ? {
          message: rateLimited
            ? '翻译服务暂时限流，请稍后重试（已翻译的部分会自动保存）。'
            : `${failed} 段翻译失败，可点击「重试」补齐。`,
        }
      : {}),
  };
}

/**
 * 一次翻译多页（默认「当前页 + 后续 4 页」）。
 * 内部把所有页的待译段落合并成一批任务，共享并发池与重试；
 * 已缓存的段落直接跳过。返回当前页的译文 + 各后续页的统计。
 */
export async function translateRange(options: TranslateRangeOptions): Promise<TranslateRangeResult> {
  const cfg = siteConfig.translation;
  const provider = getProvider();
  const base: TranslateRangeResult = {
    ok: false,
    provider: provider?.id ?? cfg.provider,
    providerLabel: provider?.label ?? '未启用',
    articleId: options.articleId,
    targetLang: options.targetLang,
    currentPageUnits: [],
    prefetched: [],
    cached: false,
    failed: 0,
  };
  if (!provider) {
    return {
      ...base,
      message:
        cfg.provider === 'none'
          ? '全文翻译已在配置中关闭。'
          : '翻译接口未配置：请在 .env 设置 ONLINE_TRANSLATE_URL，或把 siteConfig.translation.provider 改为 "tencent"。',
    };
  }
  if (options.pages.length === 0) return { ...base, ok: true };

  const [first, ...rest] = options.pages;

  // 先处理当前页（失败也不影响后续页）
  const currentResult = await translatePage({
    userId: options.userId,
    articleId: options.articleId,
    page: first.page,
    totalPages: 1,
    units: first.units,
    targetLang: options.targetLang,
    refresh: options.refresh,
  });

  // 后续页：按顺序排队翻译（限制并发由 translatePage 内部控制）
  const prefetched: TranslateRangeResult['prefetched'] = [];
  for (const p of rest) {
    const r = await translatePage({
      userId: options.userId,
      articleId: options.articleId,
      page: p.page,
      totalPages: 1,
      units: p.units,
      targetLang: options.targetLang,
      refresh: false,
    });
    prefetched.push({ page: p.page, units: r.units.length, failed: r.failed });
    // 后续页翻译失败不阻塞，但给一点间隔，避免和当前页的重试撞车
    if (r.failed > 0) await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return {
    ok: currentResult.ok,
    provider: currentResult.provider,
    providerLabel: currentResult.providerLabel,
    articleId: options.articleId,
    targetLang: options.targetLang,
    currentPageUnits: currentResult.units,
    prefetched,
    cached: currentResult.cached,
    failed: currentResult.failed + prefetched.reduce((s, p) => s + p.failed, 0),
    message: currentResult.message,
  };
}
