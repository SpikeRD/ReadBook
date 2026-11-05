// 阅读进度存储测试：按账号隔离、串行写入、同页不重复落盘、删除可清理。

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 用临时目录，绝不碰项目里的 data/
const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'readbook-progress-'));
process.env.DATA_DIR = tmpDir;

const { getArticleProgress, saveArticleProgress, readProgressMap, clearArticleProgress } = await import(
  '../src/lib/progress.ts'
);

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('没有进度时返回 null', async () => {
  assert.equal(await getArticleProgress('u-none', 'abcd1234'), null);
  assert.deepEqual(await readProgressMap('u-none'), {});
});

test('保存后能读回，页码被规范为正整数', async () => {
  await saveArticleProgress('u1', 'art00001', 3, 12);
  const entry = await getArticleProgress('u1', 'art00001');
  assert.equal(entry.page, 3);
  assert.equal(entry.totalPages, 12);
  assert.ok(entry.updatedAt);

  await saveArticleProgress('u1', 'art00002', -5, 2);
  const fixed = await getArticleProgress('u1', 'art00002');
  assert.equal(fixed.page, 1);
  assert.equal(fixed.totalPages, 2);
});

test('同一页重复保存不会改写时间戳', async () => {
  await saveArticleProgress('u2', 'art00003', 4, 10);
  const first = await getArticleProgress('u2', 'art00003');
  await saveArticleProgress('u2', 'art00003', 4, 10);
  const second = await getArticleProgress('u2', 'art00003');
  assert.equal(second.updatedAt, first.updatedAt);
});

test('并发保存多篇文章不会互相覆盖', async () => {
  await Promise.all(
    Array.from({ length: 6 }, (_, i) => saveArticleProgress('u3', `art1000${i}`, i + 1, 20))
  );
  const map = await readProgressMap('u3');
  assert.equal(Object.keys(map).length, 6);
  assert.equal(map.art10005.page, 6);
});

test('删除文章后进度可清理', async () => {
  await saveArticleProgress('u4', 'art00009', 2, 5);
  await clearArticleProgress('u4', 'art00009');
  assert.equal(await getArticleProgress('u4', 'art00009'), null);
});

test('进度文件损坏时按「没有进度」处理，不影响阅读', async () => {
  const dir = path.join(tmpDir, 'users', 'u5');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'progress.json'), '{ not json', 'utf8');
  assert.equal(await getArticleProgress('u5', 'art00010'), null);
  // 再写一次应能恢复正常
  await saveArticleProgress('u5', 'art00010', 2, 8);
  assert.equal((await getArticleProgress('u5', 'art00010')).page, 2);
});
