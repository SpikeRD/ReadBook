// 管理员账号总览：聚合 users.json 与每个用户目录下的文章/生词统计。
// 只给 /admin 页面与 /api/admin 接口使用，调用方必须先通过 requireAdmin。

import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { listUsers, type PublicUser } from './auth.ts';
import { dataRoot, userDir } from './paths.ts';

export interface AccountRow extends PublicUser {
  lastLoginAt?: string;
  articleCount: number;
  articleBytes: number;
  vocabCount: number;
  groupCount: number;
  /** 是否配置了欢迎文章等基础数据 */
  hasData: boolean;
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    if (!existsSync(file)) return fallback;
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

async function statsFor(userId: string): Promise<Omit<AccountRow, keyof PublicUser | 'lastLoginAt'>> {
  const dir = userDir(userId);
  const index = await readJson<{ bytes?: number }[]>(path.join(dir, 'index.json'), []);
  const vocab = await readJson<{ entries?: unknown[]; groups?: unknown[] }>(path.join(dir, 'vocabulary.json'), {});
  return {
    articleCount: index.length,
    articleBytes: index.reduce((sum, a) => sum + (Number(a.bytes) || 0), 0),
    vocabCount: Array.isArray(vocab.entries) ? vocab.entries.length : 0,
    groupCount: Array.isArray(vocab.groups) ? vocab.groups.length : 0,
    hasData: index.length > 0 || (Array.isArray(vocab.entries) && vocab.entries.length > 0),
  };
}

/** 账号总览（含管理员自己） */
export async function listAccounts(): Promise<AccountRow[]> {
  const users = await listUsers();
  const rows = await Promise.all(
    users.map(async (u) => ({ ...u, ...(await statsFor(u.id)) }))
  );
  return rows.sort((a, b) => {
    if (a.role !== b.role) return a.role === 'admin' ? -1 : 1;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

/** 全站统计 */
export async function siteStats(): Promise<{
  userCount: number;
  adminCount: number;
  articleCount: number;
  articleBytes: number;
  vocabCount: number;
  dataDir: string;
}> {
  const accounts = await listAccounts();
  return {
    userCount: accounts.filter((a) => a.role !== 'admin').length,
    adminCount: accounts.filter((a) => a.role === 'admin').length,
    articleCount: accounts.reduce((s, a) => s + a.articleCount, 0),
    articleBytes: accounts.reduce((s, a) => s + a.articleBytes, 0),
    vocabCount: accounts.reduce((s, a) => s + a.vocabCount, 0),
    dataDir: dataRoot(),
  };
}
