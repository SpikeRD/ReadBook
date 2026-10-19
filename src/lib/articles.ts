// 文章存储：每个用户独立目录 data/users/<userId>/articles/<id>.json。
// 每个用户在内存里只缓存「元数据索引」（不含正文），正文始终从磁盘读，
// 避免把 2GB 正文常驻内存；缓存按 userId 隔离并使用 TTL，跨进程修改也能及时看到。

import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { toBlocks, countWords, byteLength, type Paragraph } from './text.ts';
import { dataRoot, userDir, legacyDir, safeId } from './paths.ts';
import { siteConfig } from '../config/site.ts';

export interface ArticleRecord {
  id: string;
  title: string;
  /** 原始文本（含 Markdown 标题行） */
  text: string;
  blocks: Paragraph[];
  wordCount: number;
  bytes: number;
  createdAt: string;
  updatedAt: string;
}

export interface ArticleSummary {
  id: string;
  title: string;
  wordCount: number;
  bytes: number;
  createdAt: string;
  excerpt: string;
}

export interface SaveResult {
  ok: boolean;
  article?: ArticleRecord;
  error?: string;
}

/** 索引缓存：userId -> { at, map } */
const CACHE_TTL_MS = 3000;
const indexCache = new Map<string, { at: number; map: Map<string, ArticleRecord> }>();

function articlesDir(userId: string): string {
  return path.join(userDir(userId), 'articles');
}

function indexFile(userId: string): string {
  return path.join(userDir(userId), 'index.json');
}

async function ensureDirs(userId: string): Promise<void> {
  await fs.mkdir(articlesDir(userId), { recursive: true });
}

async function loadIndex(userId: string, force = false): Promise<Map<string, ArticleRecord>> {
  const hit = indexCache.get(userId);
  if (!force && hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.map;

  await ensureDirs(userId);
  const map = new Map<string, ArticleRecord>();
  const file = indexFile(userId);
  if (existsSync(file)) {
    try {
      const list = JSON.parse(await fs.readFile(file, 'utf8')) as ArticleRecord[];
      for (const a of list) map.set(a.id, a);
    } catch {
      const files = await fs.readdir(articlesDir(userId));
      for (const f of files.filter((x) => x.endsWith('.json'))) {
        try {
          const rec = JSON.parse(await fs.readFile(path.join(articlesDir(userId), f), 'utf8')) as ArticleRecord;
          map.set(rec.id, rec);
        } catch {
          /* 跳过坏文件 */
        }
      }
      await persistIndex(userId, map);
    }
  }
  indexCache.set(userId, { at: Date.now(), map });
  return map;
}

const persistQueues = new Map<string, Promise<void>>();

async function persistIndex(userId: string, map: Map<string, ArticleRecord>): Promise<void> {
  indexCache.set(userId, { at: Date.now(), map });
  const prev = persistQueues.get(userId) ?? Promise.resolve();
  const next = prev.then(async () => {
    const file = indexFile(userId);
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify([...map.values()]), 'utf8');
    await fs.rename(tmp, file);
  });
  persistQueues.set(userId, next);
  return next;
}

export async function listArticles(userId: string): Promise<ArticleSummary[]> {
  const map = await loadIndex(userId);
  return [...map.values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((a) => ({
      id: a.id,
      title: a.title,
      wordCount: a.wordCount,
      bytes: a.bytes,
      createdAt: a.createdAt,
      excerpt: excerptOf(a),
    }));
}

export async function getArticle(userId: string, id: string): Promise<ArticleRecord | null> {
  const map = await loadIndex(userId);
  const rec = map.get(safeId(id));
  if (!rec) return null;
  try {
    const raw = await fs.readFile(path.join(articlesDir(userId), `${safeId(id)}.json`), 'utf8');
    return JSON.parse(raw) as ArticleRecord;
  } catch {
    return rec;
  }
}

export async function totalBytes(userId: string): Promise<number> {
  const map = await loadIndex(userId);
  let sum = 0;
  for (const a of map.values()) sum += a.bytes;
  return sum;
}

/** 全站文章总量（所有用户），用于 2GB 总量约束 */
export async function siteTotalBytes(): Promise<number> {
  const usersDir = path.join(dataRoot(), 'users');
  if (!existsSync(usersDir)) return 0;
  let sum = 0;
  for (const u of await fs.readdir(usersDir)) {
    const file = path.join(usersDir, u, 'index.json');
    try {
      const list = JSON.parse(await fs.readFile(file, 'utf8')) as ArticleRecord[];
      for (const a of list) sum += a.bytes || 0;
    } catch {
      /* 忽略 */
    }
  }
  return sum;
}

/** 磁盘剩余空间（Windows/Node 18+ 走 fs.statfs） */
export async function freeDiskBytes(): Promise<number | null> {
  try {
    const statfs = fs.statfs ? await fs.statfs(dataRoot()) : null;
    if (!statfs) return null;
    return Number(statfs.bavail) * Number(statfs.bsize);
  } catch {
    return null;
  }
}

export async function createArticle(userId: string, input: { title?: string; text: string }): Promise<SaveResult> {
  const text = input.text.replace(/\r\n?/g, '\n').trim();
  if (!text) return { ok: false, error: '内容为空，无法导入。' };

  const limits = siteConfig.limits;
  const bytes = byteLength(text);
  if (bytes > limits.maxArticleBytes) {
    return { ok: false, error: `单篇文章上限约 1MB（当前 ${formatBytes(bytes)}），请拆分后再导入。` };
  }

  const userTotal = await totalBytes(userId);
  if (userTotal + bytes > limits.maxUserBytes) {
    return {
      ok: false,
      error: `你的文章总量已达上限 ${formatBytes(limits.maxUserBytes)}（当前 ${formatBytes(userTotal)}），请先删除一些文章。`,
    };
  }
  const siteTotal = await siteTotalBytes();
  if (siteTotal + bytes > limits.maxTotalBytes) {
    return {
      ok: false,
      error: `全站文章总量已达上限 2GB（当前 ${formatBytes(siteTotal)}），请先删除一些文章。`,
    };
  }

  const free = await freeDiskBytes();
  if (free !== null && free < limits.minFreeDiskBytes) {
    return { ok: false, error: `服务器磁盘剩余空间不足（剩余 ${formatBytes(free)}），请清理后再导入。` };
  }

  const map = await loadIndex(userId, true);
  const now = new Date().toISOString();
  const title = (input.title || '').trim() || '未命名文章';
  const record: ArticleRecord = {
    id: randomUUID().slice(0, 8),
    title: title.slice(0, 160),
    text,
    blocks: toBlocks(text),
    wordCount: countWords(text),
    bytes,
    createdAt: now,
    updatedAt: now,
  };
  await fs.writeFile(path.join(articlesDir(userId), `${record.id}.json`), JSON.stringify(record), 'utf8');
  map.set(record.id, record);
  await persistIndex(userId, map);
  return { ok: true, article: record };
}

export async function renameArticle(userId: string, id: string, title: string): Promise<boolean> {
  const map = await loadIndex(userId, true);
  const rec = map.get(safeId(id));
  const name = title.trim().slice(0, 160);
  if (!rec || !name) return false;
  rec.title = name;
  rec.updatedAt = new Date().toISOString();
  await fs.writeFile(path.join(articlesDir(userId), `${rec.id}.json`), JSON.stringify(rec), 'utf8');
  await persistIndex(userId, map);
  return true;
}

export async function deleteArticle(userId: string, id: string): Promise<boolean> {
  const map = await loadIndex(userId, true);
  const key = safeId(id);
  if (!map.has(key)) return false;
  map.delete(key);
  await fs.rm(path.join(articlesDir(userId), `${key}.json`), { force: true });
  await persistIndex(userId, map);
  // 删文章时一并清理该用户的翻译缓存
  await fs.rm(path.join(userDir(userId), 'translations', `${key}.json`), { force: true });
  return true;
}

/* ───────────── 旧版单用户数据认领 ───────────── */

/** 旧版数据是否存在（data/articles 或 data/index.json） */
export function hasLegacyArticles(): boolean {
  return existsSync(path.join(dataRoot(), 'articles')) && existsSync(path.join(dataRoot(), 'index.json'));
}

/** 把旧版文章整体移交给第一个注册的用户；移动后旧目录改名为 data/legacy 防止再次认领 */
export async function claimLegacyArticles(userId: string): Promise<number> {
  if (!hasLegacyArticles()) return 0;
  const target = articlesDir(userId);
  await fs.mkdir(target, { recursive: true });
  const src = path.join(dataRoot(), 'articles');
  const files = (await fs.readdir(src)).filter((f) => f.endsWith('.json'));
  for (const f of files) {
    await fs.rename(path.join(src, f), path.join(target, f)).catch(() => {});
  }
  await fs.rename(path.join(dataRoot(), 'index.json'), indexFile(userId)).catch(() => {});
  const legacy = legacyDir();
  await fs.mkdir(legacy, { recursive: true });
  await fs.rename(src, path.join(legacy, `articles-${Date.now()}`)).catch(() => {});
  invalidateUserCache(userId);
  return files.length;
}

/** 旧版翻译缓存目录是否存在 */
export function hasLegacyTranslations(): boolean {
  return existsSync(path.join(dataRoot(), 'translations'));
}

export async function claimLegacyTranslations(userId: string): Promise<number> {
  if (!hasLegacyTranslations()) return 0;
  const src = path.join(dataRoot(), 'translations');
  const target = path.join(userDir(userId), 'translations');
  await fs.mkdir(target, { recursive: true });
  const files = (await fs.readdir(src)).filter((f) => f.endsWith('.json'));
  for (const f of files) {
    await fs.rename(path.join(src, f), path.join(target, f)).catch(() => {});
  }
  const legacy = legacyDir();
  await fs.mkdir(legacy, { recursive: true });
  await fs.rename(src, path.join(legacy, `translations-${Date.now()}`)).catch(() => {});
  return files.length;
}

export function invalidateUserCache(userId?: string): void {
  if (userId) indexCache.delete(userId);
  else indexCache.clear();
}

function excerptOf(a: ArticleRecord): string {
  const p = a.blocks.find((b) => b.type === 'paragraph');
  const s = p ? p.text : a.text;
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.slice(0, 120) + (clean.length > 120 ? '…' : '');
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
