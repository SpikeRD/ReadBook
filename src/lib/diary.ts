// 日记存储：每个用户一个 data/users/<userId>/diary.json。
//
//   {
//     "version": 1,
//     "entries": [
//       { "id": "...", "date": "2026-11-05", "title": "", "body": "正文",
//         "createdAt": "...", "updatedAt": "..." }
//     ]
//   }
//
// 与文章、生词本、笔记同一套按账号隔离的方式；文件不存在就视为「没有日记」，
// 老账号无需迁移。读-改-写按 userId 串行，避免两个标签页同时写时互相覆盖。
//
// date 存的是「写日记那天的本地日期」（YYYY-MM-DD），由浏览器按本地时区生成，
// 服务端只做格式与真实日期校验——否则容器跑在 UTC 时，晚上 8 点后写的日记会落到前一天。

import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { userDir, safeId } from './paths.ts';
import { siteConfig } from '../config/site.ts';

export interface DiaryEntry {
  id: string;
  /** 本地日期 YYYY-MM-DD */
  date: string;
  /** 标题，可为空 */
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface DiaryResult {
  ok: boolean;
  entry?: DiaryEntry;
  error?: string;
}

interface DiaryFile {
  version: 1;
  entries: DiaryEntry[];
}

/** 每个用户的写入队列：读-改-写串行，后一次一定看到前一次的结果 */
const queues = new Map<string, Promise<void>>();

function diaryFile(userId: string): string {
  return path.join(userDir(userId), 'diary.json');
}

function emptyFile(): DiaryFile {
  return { version: 1, entries: [] };
}

function newId(): string {
  return `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
}

/** 统一换行、去首尾空白并截断（正文可能来自多行输入框） */
function clampText(value: unknown, max: number): string {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, max);
}

/**
 * 校验 YYYY-MM-DD：既要格式对，也要是真实存在的日期
 * （2026-02-30 这类能被 Date 静默滚到 3 月，必须回查年月日）。
 */
export function normalizeDate(value: unknown): string | null {
  const text = String(value ?? '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1900 || year > 2999) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return text;
}

function normalizeEntry(raw: unknown): DiaryEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const date = normalizeDate(r.date);
  if (!date) return null;
  const body = typeof r.body === 'string' ? r.body : '';
  if (!body.trim()) return null;
  const now = new Date().toISOString();
  return {
    id: typeof r.id === 'string' && r.id ? r.id : newId(),
    date,
    title: typeof r.title === 'string' ? r.title : '',
    body,
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : now,
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : now,
  };
}

/** 日期倒序；同一天写多篇时后写的排在前面 */
function sortEntries(list: DiaryEntry[]): DiaryEntry[] {
  return [...list].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

async function load(userId: string): Promise<DiaryFile> {
  const file = diaryFile(userId);
  if (!existsSync(file)) return emptyFile();
  try {
    const raw = JSON.parse(await fs.readFile(file, 'utf8')) as Partial<DiaryFile>;
    const source = raw && Array.isArray(raw.entries) ? raw.entries : [];
    const entries = source.map(normalizeEntry).filter((e): e is DiaryEntry => e !== null);
    return { version: 1, entries };
  } catch {
    // 文件损坏当作没有日记，下次写入会重建，不影响其它功能
    return emptyFile();
  }
}

/** 串行执行「读 → 改 → 写」；changed 为 false 表示没有变化，跳过落盘 */
async function mutate<T>(
  userId: string,
  fn: (data: DiaryFile) => { changed: boolean; value: T }
): Promise<T> {
  const prev = queues.get(userId) ?? Promise.resolve();
  let value!: T;
  const run = prev.then(async () => {
    const data = await load(userId);
    const outcome = fn(data);
    value = outcome.value;
    if (!outcome.changed) return;
    const file = diaryFile(userId);
    const tmp = `${file}.tmp`;
    await fs.mkdir(userDir(userId), { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(data), 'utf8');
    await fs.rename(tmp, file);
  });
  // 队列本身不能被一次失败卡死，但错误仍抛给调用方
  queues.set(
    userId,
    run.then(
      () => undefined,
      () => undefined
    )
  );
  await run;
  return value;
}

/** 该账号的全部日记（日期倒序） */
export async function listEntries(userId: string): Promise<DiaryEntry[]> {
  const data = await load(userId);
  return sortEntries(data.entries);
}

/** 按 id 取一篇（找不到返回 null） */
export async function getEntry(userId: string, entryId: string): Promise<DiaryEntry | null> {
  const id = safeId(entryId);
  if (!id) return null;
  const data = await load(userId);
  return data.entries.find((e) => e.id === id) ?? null;
}

/** 新增一篇日记 */
export async function addEntry(
  userId: string,
  input: { date?: unknown; title?: unknown; body?: unknown }
): Promise<DiaryResult> {
  const date = normalizeDate(input.date);
  if (!date) return { ok: false, error: '日期格式不正确，请选择 YYYY-MM-DD 格式的日期。' };

  const body = clampText(input.body, siteConfig.diary.maxEntryChars);
  if (!body) return { ok: false, error: '日记内容不能为空。' };
  const title = clampText(input.title, siteConfig.diary.maxTitleChars);
  const limit = siteConfig.diary.maxEntries;

  return mutate(userId, (data) => {
    if (data.entries.length >= limit) {
      return {
        changed: false,
        value: { ok: false, error: `日记已达上限 ${limit} 篇，请先删掉一些再写。` } as DiaryResult,
      };
    }
    const now = new Date().toISOString();
    const entry: DiaryEntry = { id: newId(), date, title, body, createdAt: now, updatedAt: now };
    data.entries = [...data.entries, entry];
    return { changed: true, value: { ok: true, entry } as DiaryResult };
  });
}

/**
 * 修改一篇日记：只改传进来的字段，没传的保持原样
 * （前端编辑时日期、标题、正文都会带上，但接口允许只改正文）。
 */
export async function updateEntry(
  userId: string,
  entryId: string,
  patch: { date?: unknown; title?: unknown; body?: unknown }
): Promise<DiaryResult> {
  const id = safeId(entryId);
  if (!id) return { ok: false, error: '日记不存在。' };

  let date: string | undefined;
  if (patch.date !== undefined) {
    const d = normalizeDate(patch.date);
    if (!d) return { ok: false, error: '日期格式不正确，请选择 YYYY-MM-DD 格式的日期。' };
    date = d;
  }

  let body: string | undefined;
  if (patch.body !== undefined) {
    body = clampText(patch.body, siteConfig.diary.maxEntryChars);
    if (!body) return { ok: false, error: '日记内容不能为空。' };
  }

  const title =
    patch.title !== undefined ? clampText(patch.title, siteConfig.diary.maxTitleChars) : undefined;

  return mutate(userId, (data) => {
    const index = data.entries.findIndex((e) => e.id === id);
    if (index < 0) return { changed: false, value: { ok: false, error: '日记不存在。' } as DiaryResult };
    const prev = data.entries[index];
    const entry: DiaryEntry = {
      ...prev,
      date: date ?? prev.date,
      title: title ?? prev.title,
      body: body ?? prev.body,
      updatedAt: new Date().toISOString(),
    };
    const copy = [...data.entries];
    copy[index] = entry;
    data.entries = copy;
    return { changed: true, value: { ok: true, entry } as DiaryResult };
  });
}

/** 删除一篇日记 */
export async function deleteEntry(userId: string, entryId: string): Promise<boolean> {
  const id = safeId(entryId);
  if (!id) return false;
  return mutate(userId, (data) => {
    const next = data.entries.filter((e) => e.id !== id);
    if (next.length === data.entries.length) return { changed: false, value: false };
    data.entries = next;
    return { changed: true, value: true };
  });
}
