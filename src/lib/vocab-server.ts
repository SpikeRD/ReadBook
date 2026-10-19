// 生词本服务端存储：每个用户一个 data/users/<userId>/vocabulary.json。
// 数据模型与前端一致（分组化），登录后跨设备同步。
//
//   {
//     version: 2,
//     groups: [{ id, name, createdAt }],          自建分组
//     entries: [{ id, word, translation, ..., articleId | tag, ... }]
//   }

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { userDir } from './paths.ts';

export interface VocabEntry {
  id: string;
  word: string;
  translation: string;
  phonetic: string;
  definition?: string;
  source?: string;
  articleId: string | null;
  articleTitle: string;
  tag: string | null;
  example: string;
  createdAt: number;
  mastered: boolean;
  reviewedAt?: number;
}

export interface VocabGroup {
  id: string;
  name: string;
  createdAt: number;
}

export interface VocabDoc {
  version: 2;
  updatedAt: string;
  groups: VocabGroup[];
  entries: VocabEntry[];
}

const EMPTY: VocabDoc = { version: 2, updatedAt: new Date(0).toISOString(), groups: [], entries: [] };

function file(userId: string): string {
  return path.join(userDir(userId), 'vocabulary.json');
}

export function newId(): string {
  return `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
}

function normalizeEntry(raw: unknown): VocabEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.word !== 'string' || !r.word) return null;
  return {
    id: typeof r.id === 'string' && r.id ? r.id : newId(),
    word: r.word.toLowerCase(),
    translation: String(r.translation ?? ''),
    phonetic: String(r.phonetic ?? ''),
    definition: String(r.definition ?? ''),
    source: r.source ? String(r.source) : 'local',
    articleId: r.articleId == null ? null : String(r.articleId),
    articleTitle: String(r.articleTitle ?? ''),
    tag: r.tag == null ? null : String(r.tag),
    example: String(r.example ?? ''),
    createdAt: Number(r.createdAt) || Date.now(),
    mastered: Boolean(r.mastered),
    reviewedAt: r.reviewedAt ? Number(r.reviewedAt) : undefined,
  };
}

export function normalizeDoc(raw: unknown): VocabDoc {
  if (!raw || typeof raw !== 'object') return { ...EMPTY };
  const r = raw as Record<string, unknown>;
  const groupsRaw = Array.isArray(r.groups) ? r.groups : [];
  const entriesRaw = Array.isArray(r.entries) ? r.entries : [];
  const groups: VocabGroup[] = groupsRaw
    .filter((g): g is Record<string, unknown> => !!g && typeof g === 'object')
    .filter((g) => typeof g.id === 'string' && typeof g.name === 'string')
    .map((g) => ({ id: String(g.id), name: String(g.name).slice(0, 60), createdAt: Number(g.createdAt) || Date.now() }));
  const entries = entriesRaw.map(normalizeEntry).filter(Boolean) as VocabEntry[];
  return {
    version: 2,
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : new Date().toISOString(),
    groups,
    entries,
  };
}

const cache = new Map<string, VocabDoc>();
const queues = new Map<string, Promise<void>>();

export async function getVocabulary(userId: string): Promise<VocabDoc> {
  const hit = cache.get(userId);
  if (hit) return hit;
  try {
    const raw = JSON.parse(await fs.readFile(file(userId), 'utf8'));
    const doc = normalizeDoc(raw);
    cache.set(userId, doc);
    return doc;
  } catch {
    const doc = { ...EMPTY, updatedAt: new Date().toISOString() };
    cache.set(userId, doc);
    return doc;
  }
}

export async function saveVocabulary(userId: string, input: unknown): Promise<VocabDoc> {
  const doc = normalizeDoc(input);
  doc.updatedAt = new Date().toISOString();
  cache.set(userId, doc);
  const prev = queues.get(userId) ?? Promise.resolve();
  const next = prev.then(async () => {
    const target = file(userId);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(doc), 'utf8');
    await fs.rename(tmp, target);
  });
  queues.set(userId, next);
  await next;
  return doc;
}

/** 把旧版浏览器 localStorage 数据合并进服务端；同分组同单词去重 */
export async function importLocal(userId: string, input: unknown): Promise<{ added: number; skipped: number }> {
  const doc = await getVocabulary(userId);
  const incoming = normalizeDoc(input);
  const seen = new Set(doc.entries.map((e) => `${e.articleId ?? ''}|${e.tag ?? ''}|${e.word}`));
  const groupIds = new Set(doc.groups.map((g) => g.id));

  for (const g of incoming.groups) {
    if (!groupIds.has(g.id)) {
      doc.groups.push(g);
      groupIds.add(g.id);
    }
  }

  let added = 0;
  let skipped = 0;
  for (const e of incoming.entries) {
    // 本地数据里可能出现未知分组：文章分组照收，自建分组若不存在则放入「导入的单词」
    if (e.tag && !groupIds.has(e.tag)) {
      let fallback = doc.groups.find((g) => g.name === '导入的单词');
      if (!fallback) {
        fallback = { id: newId(), name: '导入的单词', createdAt: Date.now() };
        doc.groups.push(fallback);
        groupIds.add(fallback.id);
      }
      e.tag = fallback.id;
    }
    const key = `${e.articleId ?? ''}|${e.tag ?? ''}|${e.word}`;
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    doc.entries.push({ ...e, id: newId() });
    added++;
  }
  await saveVocabulary(userId, doc);
  return { added, skipped };
}

export function clearCache(userId?: string): void {
  if (userId) cache.delete(userId);
  else cache.clear();
}
