// 笔记存储：每个用户一个 data/users/<userId>/notes.json。
//
//   {
//     "version": 1,
//     "notes": {
//       "<文章id>": [
//         { "id": "...", "blockIndex": 12, "quote": "段落开头的原文",
//           "body": "笔记正文", "createdAt": "...", "updatedAt": "..." }
//       ]
//     }
//   }
//
// 锚点用「全局块序号」（paginate 里 PageUnit.index），不是页码：
// 翻页、改 pagination.charsPerPage 都不影响它，页码在渲染时反查。
// 只有正文本身变化（重新导入同一篇）才可能漂移，所以每条笔记额外存 quote
// （段落开头的一段原文），渲染时用它校验锚点是否还挂在原来那段上。
//
// 文件不存在就视为「没有笔记」，老账号无需迁移；
// 读-改-写按 userId 串行，避免两个标签页同时写时互相覆盖。

import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { userDir, safeId } from './paths.ts';
import { siteConfig } from '../config/site.ts';

export interface Note {
  id: string;
  /** 锚点：分页单元的全局块序号（与页码无关） */
  blockIndex: number;
  /** 记录笔记时该段落的开头原文，用于校验锚点是否还对得上 */
  quote: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface NoteResult {
  ok: boolean;
  note?: Note;
  error?: string;
}

interface NotesFile {
  version: 1;
  notes: Record<string, Note[]>;
}

/** 锚点原文最多存多少字符（只用于校验与预览，不存整段） */
const QUOTE_MAX = 80;

/** 每个用户的写入队列：读-改-写串行，后一次一定看到前一次的结果 */
const queues = new Map<string, Promise<void>>();

function notesFile(userId: string): string {
  return path.join(userDir(userId), 'notes.json');
}

function emptyFile(): NotesFile {
  return { version: 1, notes: {} };
}

function newId(): string {
  return `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
}

/** 统一换行、去首尾空白并截断（body 可能来自多行输入框） */
function clampText(value: unknown, max: number): string {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, max);
}

function normalizeNote(raw: unknown): Note | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const blockIndex = Number(r.blockIndex);
  if (!Number.isInteger(blockIndex) || blockIndex < 0) return null;
  const body = typeof r.body === 'string' ? r.body : '';
  if (!body.trim()) return null;
  return {
    id: typeof r.id === 'string' && r.id ? r.id : newId(),
    blockIndex,
    quote: typeof r.quote === 'string' ? r.quote : '',
    body,
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date().toISOString(),
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : new Date().toISOString(),
  };
}

async function load(userId: string): Promise<NotesFile> {
  const file = notesFile(userId);
  if (!existsSync(file)) return emptyFile();
  try {
    const raw = JSON.parse(await fs.readFile(file, 'utf8')) as Partial<NotesFile>;
    const source = raw && typeof raw.notes === 'object' && raw.notes ? raw.notes : {};
    const notes: Record<string, Note[]> = {};
    for (const [articleId, list] of Object.entries(source as Record<string, unknown>)) {
      const id = safeId(articleId);
      if (!id || !Array.isArray(list)) continue;
      const items = list.map(normalizeNote).filter((n): n is Note => n !== null);
      if (items.length) notes[id] = items;
    }
    return { version: 1, notes };
  } catch {
    // 文件损坏当作没有笔记，下次写入会重建，不影响阅读
    return emptyFile();
  }
}

/** 串行执行「读 → 改 → 写」；changed 为 false 表示没有变化，跳过落盘 */
async function mutate<T>(
  userId: string,
  fn: (data: NotesFile) => { changed: boolean; value: T }
): Promise<T> {
  const prev = queues.get(userId) ?? Promise.resolve();
  let value!: T;
  const run = prev.then(async () => {
    const data = await load(userId);
    const outcome = fn(data);
    value = outcome.value;
    if (!outcome.changed) return;
    const file = notesFile(userId);
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

/** 某篇文章的全部笔记，按块序号（正文顺序）排列 */
export async function listArticleNotes(userId: string, articleId: string): Promise<Note[]> {
  const id = safeId(articleId);
  if (!id) return [];
  const data = await load(userId);
  const list = data.notes[id] ?? [];
  return [...list].sort((a, b) => a.blockIndex - b.blockIndex || a.createdAt.localeCompare(b.createdAt));
}

/** 该账号每篇文章的笔记条数（列表页显示「N 条笔记」用），只读一次文件 */
export async function readNoteCounts(userId: string): Promise<Record<string, number>> {
  const data = await load(userId);
  const counts: Record<string, number> = {};
  for (const [articleId, list] of Object.entries(data.notes)) {
    if (list.length) counts[articleId] = list.length;
  }
  return counts;
}

/** 新增一条笔记（锚定到某个段落） */
export async function addNote(
  userId: string,
  articleId: string,
  input: { blockIndex: number; quote?: string; body: string }
): Promise<NoteResult> {
  const id = safeId(articleId);
  if (!id) return { ok: false, error: '文章不存在。' };

  const body = clampText(input.body, siteConfig.limits.maxNoteChars);
  if (!body) return { ok: false, error: '笔记内容不能为空。' };

  const blockIndex = Number(input.blockIndex);
  if (!Number.isInteger(blockIndex) || blockIndex < 0) {
    return { ok: false, error: '笔记锚点无效，请刷新页面后重试。' };
  }
  const quote = clampText(input.quote, QUOTE_MAX);
  const limit = siteConfig.limits.maxNotesPerArticle;

  return mutate(userId, (data) => {
    const list = data.notes[id] ?? [];
    if (list.length >= limit) {
      return {
        changed: false,
        value: { ok: false, error: `单篇文章的笔记已达上限 ${limit} 条，请先删掉一些。` } as NoteResult,
      };
    }
    const now = new Date().toISOString();
    const note: Note = { id: newId(), blockIndex, quote, body, createdAt: now, updatedAt: now };
    data.notes[id] = [...list, note];
    return { changed: true, value: { ok: true, note } as NoteResult };
  });
}

/** 改笔记正文（锚点不变） */
export async function updateNote(
  userId: string,
  articleId: string,
  noteId: string,
  body: string
): Promise<NoteResult> {
  const id = safeId(articleId);
  if (!id) return { ok: false, error: '文章不存在。' };
  const target = safeId(noteId);
  if (!target) return { ok: false, error: '笔记不存在。' };

  const next = clampText(body, siteConfig.limits.maxNoteChars);
  if (!next) return { ok: false, error: '笔记内容不能为空。' };

  return mutate(userId, (data) => {
    const list = data.notes[id];
    const index = list ? list.findIndex((n) => n.id === target) : -1;
    if (!list || index < 0) return { changed: false, value: { ok: false, error: '笔记不存在。' } as NoteResult };
    const note: Note = { ...list[index], body: next, updatedAt: new Date().toISOString() };
    const copy = [...list];
    copy[index] = note;
    data.notes[id] = copy;
    return { changed: true, value: { ok: true, note } as NoteResult };
  });
}

/** 删除一条笔记 */
export async function deleteNote(userId: string, articleId: string, noteId: string): Promise<boolean> {
  const id = safeId(articleId);
  const target = safeId(noteId);
  if (!id || !target) return false;
  return mutate(userId, (data) => {
    const list = data.notes[id];
    if (!list) return { changed: false, value: false };
    const next = list.filter((n) => n.id !== target);
    if (next.length === list.length) return { changed: false, value: false };
    if (next.length) data.notes[id] = next;
    else delete data.notes[id];
    return { changed: true, value: true };
  });
}

/** 删除文章时清掉它的全部笔记 */
export async function clearArticleNotes(userId: string, articleId: string): Promise<void> {
  const id = safeId(articleId);
  if (!id) return;
  await mutate(userId, (data) => {
    if (!data.notes[id]) return { changed: false, value: undefined };
    delete data.notes[id];
    return { changed: true, value: undefined };
  });
}
