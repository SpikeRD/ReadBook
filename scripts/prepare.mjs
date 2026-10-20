// 一键准备：保证 dev / build / start 之前所需的数据齐全。
//   node scripts/prepare.mjs          # 开发
//   node scripts/prepare.mjs --prod   # 生产启动前
//
// 做两件事（已存在的文件一律不覆盖）：
//   1. 词典 SQLite 不存在则生成（scripts/build-dict.mjs）
//   2. .env 不存在时从 .env.example 复制一份
//
// 说明：示例文章不再在启动时写入全局目录——现在数据按账号隔离，
// 每个新注册的用户会在注册时自动获得一篇欢迎文章（见 src/lib/seed.ts）。

import { spawnSync } from 'node:child_process';
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATA_DIR || path.join(root, 'data');

const log = (msg) => console.log(`[prepare] ${msg}`);

async function ensureDict() {
  const dbFile = path.join(dataDir, 'dict.db');
  if (existsSync(dbFile)) {
    log('词典已就绪 data/dict.db');
    return;
  }
  log('生成词典 data/dict.db ...');
  const res = spawnSync(process.execPath, [path.join(root, 'scripts', 'build-dict.mjs')], {
    stdio: 'inherit',
    env: process.env,
    cwd: root,
  });
  if (res.status !== 0) throw new Error('词典生成失败');
}

async function ensureEnv() {
  const envFile = path.join(root, '.env');
  const example = path.join(root, '.env.example');
  if (existsSync(envFile) || !existsSync(example)) return;
  await fs.copyFile(example, envFile);
  log('已根据 .env.example 创建 .env');
}

async function ensureDirs() {
  await fs.mkdir(dataDir, { recursive: true });
}

/**
 * 清理历史遗留的重复管理员记录（早期版本并发首次登录会写出多条同名 admin）。
 * 幂等：没有重复时什么都不做；失败只告警，不阻断启动。
 */
async function dedupeAdmins() {
  const file = path.join(dataDir, 'users.json');
  if (!existsSync(file)) return;
  try {
    // Windows 上绝对路径不能直接 import，必须转成 file:// URL
    const mod = await import(pathToFileURL(path.join(root, 'src', 'lib', 'auth.ts')).href);
    const n = await mod.dedupeAdminRecords();
    if (n > 0) log(`已清理 ${n} 条重复的管理员记录（改名为 *_dupN 并降为普通用户）`);
  } catch (err) {
    log(`跳过管理员记录检查：${err.message}`);
  }
}

try {
  await ensureDirs();
  await ensureDict();
  await ensureEnv();
  await dedupeAdmins();
  log('准备完成');
} catch (err) {
  console.error('[prepare] 失败：', err.message);
  process.exitCode = 1;
}
