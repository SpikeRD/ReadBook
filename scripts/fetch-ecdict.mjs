// 从 GitHub 下载 ECDICT 全量词库并生成精简词库。
// 用法：npm run dict:fetch        （或 node scripts/fetch-ecdict.mjs --limit=30000）
//
// 网络说明（本机实测）：
//   raw.githubusercontent.com / github.com/.../raw/  → 频繁 ECONNRESET 或 404
//   api.github.com/repos/{repo}/git/blobs/{sha}      → 稳定，返回整个文件（Base64）
// 因此走 GitHub API 下载并解码，结果缓存到 data/ecdict.csv，第二次运行不再下载。
// 若 API 不可用，可手动下载 ecdict.csv 放到 data/ 下，再运行 npm run dict:rebuild。

import { promises as fs, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const cacheFile = path.join(dataDir, 'ecdict.csv');
const REPO = 'skywind3000/ECDICT';
const UA = { 'user-agent': 'readbook-setup' };

const limitArg = process.argv.find((a) => a.startsWith('--limit='));
// 优先 --limit=，其次环境变量 ECDICT_LIMIT（Docker 构建用），最后默认 30000
const limit = limitArg
  ? Number(limitArg.split('=')[1])
  : Number(process.env.ECDICT_LIMIT || 0) || 30000;
const shaArg = process.argv.find((a) => a.startsWith('--sha='));
const shaOverride = shaArg ? shaArg.split('=')[1] : '';

async function fileMeta() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/ecdict.csv`, {
    headers: UA,
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`GitHub API 返回 ${res.status}`);
  const info = await res.json();
  return { sha: shaOverride || info.sha, size: Number(info.size) || 0 };
}

async function downloadViaApi(sha, expectedSize, dest) {
  const url = `https://api.github.com/repos/${REPO}/git/blobs/${sha}`;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        headers: {
          ...UA,
          accept: 'application/vnd.github+json',
          // 强制不压缩：本机走代理时 gzip 流偶尔被截断，导致 Base64 从中间错位、内容乱码
          'accept-encoding': 'identity',
        },
        signal: AbortSignal.timeout(600000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // 整体读取再解析：分块流式拆分在多字节字符边界上容易错位；63MB 对构建机内存无压力
      const json = JSON.parse(await res.text());
      if (json.encoding !== 'base64' || typeof json.content !== 'string') {
        throw new Error(`响应格式异常（encoding=${json.encoding}）`);
      }
      const bin = Buffer.from(json.content, 'base64');
      if (bin.length < 10_000_000) throw new Error(`解码结果过小：${bin.length} 字节`);
      if (expectedSize && bin.length !== expectedSize) {
        throw new Error(`字节数不符：得到 ${bin.length}，应为 ${expectedSize}`);
      }
      if (!bin.subarray(0, 40).toString('utf8').startsWith('word,phonetic,definition')) {
        throw new Error('文件头不是 ECDICT 表头（内容可能已损坏）');
      }
      const tmp = `${dest}.part`;
      await fs.writeFile(tmp, bin);
      await fs.rename(tmp, dest);
      console.log(
        `[fetch] 下载完成 ${(bin.length / 1024 / 1024).toFixed(1)} MB，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s，校验通过`
      );
      return;
    } catch (err) {
      console.warn(`[fetch] 第 ${attempt} 次失败：${err.message}`);
      await fs.rm(`${dest}.part`, { force: true }).catch(() => {});
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw new Error('ECDICT 下载失败（已重试 5 次）');
}

async function main() {
  await fs.mkdir(dataDir, { recursive: true });
  if (existsSync(cacheFile) && statSync(cacheFile).size > 10_000_000) {
    console.log(
      `[fetch] 已缓存 ${path.relative(root, cacheFile)}（${(statSync(cacheFile).size / 1024 / 1024).toFixed(1)} MB），跳过下载`
    );
  } else {
    const { sha, size } = await fileMeta();
    console.log(`[fetch] ECDICT ecdict.csv ${(size / 1024 / 1024).toFixed(1)} MB, sha=${String(sha).slice(0, 10)}`);
    await downloadViaApi(sha, size, cacheFile);
  }

  console.log(`[fetch] 生成精简词库（前 ${limit} 个常用词）…`);
  const res = spawnSync(process.execPath, [path.join(root, 'scripts', 'build-dict.mjs'), '--force'], {
    stdio: 'inherit',
    env: { ...process.env, ECDICT_CSV: cacheFile, ECDICT_LIMIT: String(limit) },
    cwd: root,
  });
  if (res.status !== 0) throw new Error('build-dict 失败');
}

main().catch((err) => {
  console.error('[fetch] 失败：', err.message);
  process.exitCode = 1;
});
