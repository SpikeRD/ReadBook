// 统一路径工具：所有运行时数据都挂在 data/ 下，按用户分目录。
//
//   data/users.json                 账号表
//   data/legacy/                    旧版单用户数据（首次被认领后）
//   data/users/<userId>/articles/   该用户的文章
//   data/users/<userId>/index.json  该用户的文章索引
//   data/users/<userId>/translations/ 该用户的翻译缓存
//   data/users/<userId>/vocabulary.json 该用户的生词本

import path from 'node:path';
import { readEnv } from './env.ts';

/** 合法的用户/文章 id：只允许字母数字与 -_，杜绝路径穿越 */
export function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '');
}

export function dataRoot(): string {
  const env = readEnv();
  return path.isAbsolute(env.dataDir) ? env.dataDir : path.resolve(process.cwd(), env.dataDir);
}

export function userDir(userId: string): string {
  return path.join(dataRoot(), 'users', safeId(userId));
}

export function legacyDir(): string {
  return path.join(dataRoot(), 'legacy');
}

export function dictPath(): string {
  return path.join(dataRoot(), 'dict.db');
}
