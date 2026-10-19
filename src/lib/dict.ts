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

async function onlineLookup(word: string): Promise<LookupResult | null> {
  const template = readEnv().onlineDictUrl;
  if (!template) return null;
  const url = template.replace('{word}', encodeURIComponent(word));
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    // 兼容常见返回形状：{ translation, phonetic, definition } 或 { data: {...} }
    const raw = (data.data && typeof data.data === 'object' ? data.data : data) as Record<string, unknown>;
    const translation = String(raw.translation ?? raw.zh ?? raw.def ?? '');
    if (!translation) return null;
    return {
      word,
      matched: word,
      phonetic: String(raw.phonetic ?? ''),
      translation,
      definition: String(raw.definition ?? ''),
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

  if (memo.size > MEMO_LIMIT) memo.clear();
  memo.set(key, final);
  return final;
}

/** 批量预热（可选，服务端启动时不做全量加载） */
export function clearLookupCache(): void {
  memo.clear();
}
