// 阅读进度：按账号记住每篇文章读到第几页。
//
// 存储：data/users/<userId>/progress.json
//   { "version": 1, "articles": { "<文章id>": { "page": 3, "totalPages": 12, "updatedAt": "..." } } }
//
// 与文章、生词本、翻译缓存同一套按账号隔离的方式；文件不存在就视为「没有进度」，
// 老账号无需迁移。读-改-写整体按 userId 串行，避免两个标签页同时翻页时互相覆盖。

import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { userDir, safeId } from './paths.ts';

export interface ProgressEntry {
  /** 读到第几页（从 1 开始） */
  page: number;
  /** 记录时的总页数，用于列表页显示百分比 */
  totalPages: number;
  /** 最后阅读时间（ISO 字符串） */
  updatedAt: string;
}

interface ProgressFile {
  version: 1;
  articles: Record<string, ProgressEntry>;
}

/** 每个用户的写入队列：读-改-写串行，后一次一定看到前一次的结果 */
const queues = new Map<string, Promise<void>>();

function progressFile(userId: string): string {
  return path.join(userDir(userId), 'progress.json');
}

function emptyFile(): ProgressFile {
  return { version: 1, articles: {} };
}

async function load(userId: string): Promise<ProgressFile> {
  const file = progressFile(userId);
  if (!existsSync(file)) return emptyFile();
  try {
    const raw = JSON.parse(await fs.readFile(file, 'utf8')) as Partial<ProgressFile>;
    const articles = raw && typeof raw.articles === 'object' && raw.articles ? raw.articles : {};
    return { version: 1, articles: articles as Record<string, ProgressEntry> };
  } catch {
    // 文件损坏当作没有进度，下次写入会重建，不影响阅读
    return emptyFile();
  }
}

/** 串行执行「读 → 改 → 写」；fn 返回 false 表示没有变化，跳过落盘 */
async function mutate(userId: string, fn: (data: ProgressFile) => boolean): Promise<void> {
  const prev = queues.get(userId) ?? Promise.resolve();
  const next = prev
    .then(async () => {
      const data = await load(userId);
      if (!fn(data)) return;
      const file = progressFile(userId);
      const tmp = `${file}.tmp`;
      await fs.mkdir(userDir(userId), { recursive: true });
      await fs.writeFile(tmp, JSON.stringify(data), 'utf8');
      await fs.rename(tmp, file);
    })
    .catch(() => {
      // 进度是辅助信息，写失败不影响阅读；下一次翻页会再写一遍
    });
  queues.set(userId, next);
  return next;
}

/** 取某篇文章的进度（没有则 null） */
export async function getArticleProgress(userId: string, articleId: string): Promise<ProgressEntry | null> {
  const id = safeId(articleId);
  if (!id) return null;
  const data = await load(userId);
  const entry = data.articles[id];
  if (!entry || !Number.isFinite(entry.page) || entry.page < 1) return null;
  return {
    page: Math.floor(entry.page),
    totalPages: Number.isFinite(entry.totalPages) && entry.totalPages >= entry.page ? Math.floor(entry.totalPages) : Math.floor(entry.page),
    updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : '',
  };
}

/** 取该账号全部文章的进度，供列表页显示「读到第 N/M 页」 */
export async function readProgressMap(userId: string): Promise<Record<string, ProgressEntry>> {
  const data = await load(userId);
  const out: Record<string, ProgressEntry> = {};
  for (const [id, entry] of Object.entries(data.articles)) {
    if (!entry || !Number.isFinite(entry.page) || entry.page < 1) continue;
    out[id] = {
      page: Math.floor(entry.page),
      totalPages: Number.isFinite(entry.totalPages) && entry.totalPages >= entry.page ? Math.floor(entry.totalPages) : Math.floor(entry.page),
      updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : '',
    };
  }
  return out;
}

/** 记录「读到第几页」；同一页重复渲染不重复落盘 */
export async function saveArticleProgress(
  userId: string,
  articleId: string,
  page: number,
  totalPages: number
): Promise<void> {
  const id = safeId(articleId);
  if (!id) return;
  const p = Math.max(1, Math.floor(page) || 1);
  const total = Math.max(p, Math.floor(totalPages) || p);
  await mutate(userId, (data) => {
    const prev = data.articles[id];
    if (prev && prev.page === p && prev.totalPages === total) return false;
    data.articles[id] = { page: p, totalPages: total, updatedAt: new Date().toISOString() };
    return true;
  });
}

/** 删除文章时清掉它的进度记录 */
export async function clearArticleProgress(userId: string, articleId: string): Promise<void> {
  const id = safeId(articleId);
  if (!id) return;
  await mutate(userId, (data) => {
    if (!data.articles[id]) return false;
    delete data.articles[id];
    return true;
  });
}
