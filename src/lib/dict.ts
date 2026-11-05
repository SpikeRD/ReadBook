// 词典：本地精简词库（SQLite 索引，按需查询）+ 未收录时的在线兜底。
//
// 构建词库：npm run dict:rebuild
//   - 有网络：从 ECDICT 下载英文词频表，截取前约 1 万词（源数据无中文释义时不可用，见 README 后续 TODO）
//   - 无网络 / 下载失败：使用内置 data/seed-dict.json（约 450 个高频词）
// 运行时只对 data/dict.db 做点查（走索引），不会把整个词库读进内存。

import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { candidateLemmas, normalizeWord } from './text.ts';
import { readEnv } from './env.ts';

export type LookupSource = 'local' | 'lemma' | 'online' | 'none';

export interface LookupResult {
  word: string;
  /** 命中的词典词形（可能是词根） */
  matched: string;
  phonetic: string;
  translation: string;
  definition: string;
  tag: string;
  source: LookupSource;
  found: boolean;
  /** 在线兜底接口给出的链接 */
  externalUrl?: string;
}

interface Row {
  word: string;
  phonetic?: string | null;
  translation: string | null;
  definition?: string | null;
  tag?: string | null;
}

let db: DatabaseSync | null = null;
let stmt: ReturnType<DatabaseSync['prepare']> | null = null;
const memo = new Map<string, LookupResult>();
const MEMO_LIMIT = 5000;

function dbPath(): string {
  const env = readEnv();
  const dir = path.isAbsolute(env.dataDir) ? env.dataDir : path.resolve(process.cwd(), env.dataDir);
  return path.join(dir, 'dict.db');
}

function normalizeRow(word: string, row: Row | undefined, source: LookupSource): LookupResult | null {
  if (!row || !row.translation) return null;
  return {
    word,
    matched: row.word,
    phonetic: row.phonetic || '',
    translation: row.translation.replace(/\\n/g, '\n'),
    definition: (row.definition || '').replace(/\\n/g, '\n'),
    tag: row.tag || '',
    source,
    found: true,
  };
}

function queryWord(word: string): LookupResult | null {
  if (!stmt) return null;
  const row = stmt.get(word) as Row | undefined;
  return normalizeRow(word, row, 'local');
}

export function dictStatus(): { ready: boolean; words: number; source: string } {
  try {
    if (!existsSync(dbPath())) return { ready: false, words: 0, source: 'missing' };
    const info = openDb();
    const meta = info.db.prepare('SELECT value FROM meta WHERE key = ?').get('source') as
      | { value: string }
      | undefined;
    return { ready: true, words: info.count, source: meta?.value || 'unknown' };
  } catch {
    return { ready: false, words: 0, source: 'error' };
  }
}

function openDb(): { db: DatabaseSync; count: number } {
  if (db && stmt) {
    const count = (db.prepare('SELECT COUNT(*) AS c FROM words').get() as { c: number }).c;
    return { db, count };
  }
  db = new DatabaseSync(dbPath(), { readOnly: true });
  stmt = db.prepare('SELECT word, phonetic, translation, definition, tag FROM words WHERE word = ?');
  const count = (db.prepare('SELECT COUNT(*) AS c FROM words').get() as { c: number }).c;
  return { db, count };
}

/**
 * 内置的在线兜底：有道词典的公开 JSON 接口（免密钥、直接给中文释义与音标）。
 * 用 {word} 占位，和自定义接口保持同一种模板写法。
 * 想关掉：.env 里设 ONLINE_DICT_URL=off。
 *
 * 选有道而不是纯翻译接口：翻译接口对单个生僻词经常给出错译
 * （实测 defenestration 被译成「排便」），词典接口有词条与词性，质量更可靠。
 */
const DEFAULT_ONLINE_DICT_URL = 'https://dict.youdao.com/jsonapi?q={word}';

/** 译文是不是「没翻出来」：原样返回、或者返回的仍是纯英文 */
function isUselessTranslation(word: string, text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (t.toLowerCase() === word.toLowerCase()) return true;
  return !/[\u4e00-\u9fff]/.test(t) && /^[A-Za-z\s'’.,-]+$/.test(t);
}

/** 有道 jsonapi：词条释义在 ec.word[0].trs[].tr[].l.i，音标在 usphone/ukphone */
function parseYoudao(word: string, data: Record<string, unknown>): string | null {
  const ec = data.ec as { word?: Array<Record<string, unknown>> } | undefined;
  const entry = ec?.word?.[0];
  const lines: string[] = [];
  const trsList = (entry?.trs as Array<{ tr?: Array<{ l?: { i?: unknown } }> }> | undefined) ?? [];
  for (const trs of trsList) {
    for (const tr of trs?.tr ?? []) {
      const i = tr?.l?.i;
      if (Array.isArray(i)) lines.push(...i.map((x) => String(x)).filter(Boolean));
      else if (typeof i === 'string' && i) lines.push(i);
    }
  }
  let translation = lines.join('\n').trim();
  if (!translation) {
    // 没有 ec 词条时退回网络释义（生僻词常见）
    const web = data.web_trans as
      | { 'web-translation'?: Array<{ trans?: Array<{ value?: string }> }> }
      | undefined;
    const value = web?.['web-translation']?.[0]?.trans?.[0]?.value;
    if (typeof value === 'string') translation = value.trim();
  }
  if (isUselessTranslation(word, translation)) return null;
  return translation;
}

function youdaoPhonetic(data: Record<string, unknown>): string {
  const ec = data.ec as { word?: Array<Record<string, unknown>> } | undefined;
  const entry = ec?.word?.[0];
  const us = entry?.usphone;
  const uk = entry?.ukphone;
  return typeof us === 'string' && us ? us : typeof uk === 'string' ? uk : '';
}

async function onlineLookup(word: string): Promise<LookupResult | null> {
  const configured = readEnv().onlineDictUrl.trim();
  if (configured.toLowerCase() === 'off') return null;
  const isDefault = configured === '';
  const template = configured || DEFAULT_ONLINE_DICT_URL;
  const url = template.replace('{word}', encodeURIComponent(word));
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; ReadBook/1.0)' },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;

    let translation = '';
    let phonetic = '';
    if (isDefault) {
      translation = parseYoudao(word, data) ?? '';
      phonetic = youdaoPhonetic(data);
    } else {
      // 自定义模板：兼容 { translation, phonetic, definition } / { data: {...} } / { responseData: {...} }
      const raw = (
        data.data && typeof data.data === 'object'
          ? data.data
          : data.responseData && typeof data.responseData === 'object'
            ? data.responseData
            : data
      ) as Record<string, unknown>;
      translation = String(raw.translatedText ?? raw.translation ?? raw.zh ?? raw.def ?? '');
      if (isUselessTranslation(word, translation)) translation = '';
      phonetic = String(raw.phonetic ?? '');
    }
    if (!translation) return null;

    return {
      word,
      matched: word,
      phonetic,
      translation,
      definition: '',
      tag: 'online',
      source: 'online',
      found: true,
      externalUrl: `https://www.iciba.com/word?w=${encodeURIComponent(word)}`,
    };
  } catch {
    return null;
  }
}

export async function lookupWord(input: string): Promise<LookupResult> {
  const word = normalizeWord(input);
  const key = word;
  const cached = memo.get(key);
  if (cached) return cached;

  let result: LookupResult | null = null;
  try {
    openDb();
    result = queryWord(word);
    if (result) result.source = 'local';
    if (!result) {
      for (const lemma of candidateLemmas(word)) {
        const r = queryWord(lemma);
        if (r) {
          const hit = { ...r, word, source: 'lemma' as LookupSource };
          result = hit;
          break;
        }
      }
    }
  } catch {
    result = null;
  }

  if (!result) result = await onlineLookup(word);

  const final: LookupResult =
    result ?? {
      word,
      matched: word,
      phonetic: '',
      translation: '',
      definition: '',
      tag: '',
      source: 'none',
      found: false,
      externalUrl: `https://www.iciba.com/word?w=${encodeURIComponent(word)}`,
    };

  // 只缓存查到的词：网络抖动导致的「未收录」不该被记住，
  // 否则这个词到进程重启前都不会再尝试在线兜底。
  if (final.found) {
    if (memo.size > MEMO_LIMIT) memo.clear();
    memo.set(key, final);
  }
  return final;
}

/** 批量预热（可选，服务端启动时不做全量加载） */
export function clearLookupCache(): void {
  memo.clear();
}
