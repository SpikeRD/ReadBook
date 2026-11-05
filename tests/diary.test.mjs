// 日记存储测试：增删改、日期排序与校验、正文截断、跨账号隔离、并发、上限、损坏文件兜底。

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 用临时目录，绝不碰项目里的 data/
const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'readbook-diary-'));
process.env.DATA_DIR = tmpDir;

const { addEntry, listEntries, getEntry, updateEntry, deleteEntry, normalizeDate } = await import(
  '../src/lib/diary.ts'
);
const { siteConfig } = await import('../src/config/site.ts');

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('没有日记时返回空数组', async () => {
  assert.deepEqual(await listEntries('d-none'), []);
});

test('新增后能读回，按日期倒序排列，同一天后写的在前', async () => {
  const first = await addEntry('d1', { date: '2026-11-01', title: '月初', body: '第一篇' });
  assert.equal(first.ok, true);
  assert.ok(first.entry.id);

  await new Promise((r) => setTimeout(r, 5));
  const later = await addEntry('d1', { date: '2026-11-03', body: '后面那天的' });
  await new Promise((r) => setTimeout(r, 5));
  const sameDay = await addEntry('d1', { date: '2026-11-03', body: '同一天更晚写的' });

  const list = await listEntries('d1');
  assert.deepEqual(
    list.map((e) => e.body),
    ['同一天更晚写的', '后面那天的', '第一篇']
  );
  assert.equal(list[0].id, sameDay.entry.id);
  assert.equal(list[1].id, later.entry.id);
  // 标题可留空
  assert.equal(list[1].title, '');
});

test('空正文与非法日期被拒绝', async () => {
  const empty = await addEntry('d2', { date: '2026-11-05', body: '   ' });
  assert.equal(empty.ok, false);
  assert.match(empty.error, /不能为空/);

  for (const bad of ['', '2026-13-01', '2026-02-30', '2026/11/05', '26-11-05', '2026-11-5']) {
    const r = await addEntry('d2', { date: bad, body: '有内容' });
    assert.equal(r.ok, false, `日期 ${bad} 应被拒绝`);
    assert.match(r.error, /日期格式不正确/);
  }

  assert.deepEqual(await listEntries('d2'), []);
});

test('日期校验认得真实日期（闰年 2 月 29 日可写，平年不行）', async () => {
  assert.equal(normalizeDate('2024-02-29'), '2024-02-29');
  assert.equal(normalizeDate('2026-02-29'), null);
  assert.equal(normalizeDate(' 2026-11-05 '), '2026-11-05');
});

test('正文超长按上限截断，换行统一为 \\n，标题也截断', async () => {
  const maxBody = siteConfig.diary.maxEntryChars;
  const maxTitle = siteConfig.diary.maxTitleChars;
  const r = await addEntry('d3', {
    date: '2026-11-05',
    title: 'T'.repeat(maxTitle + 20),
    body: `第一行\r\n第二行\r\n${'a'.repeat(maxBody + 50)}`,
  });
  assert.equal(r.ok, true);
  assert.equal(r.entry.body.length, maxBody);
  assert.ok(r.entry.body.startsWith('第一行\n第二行\n'));
  assert.ok(!r.entry.body.includes('\r'));
  assert.equal(r.entry.title.length, maxTitle);
});

test('修改只改传入的字段，其余保持原样且更新时间会变', async () => {
  const created = await addEntry('d4', { date: '2026-11-02', title: '原标题', body: '原正文' });
  await new Promise((r) => setTimeout(r, 5));

  const onlyBody = await updateEntry('d4', created.entry.id, { body: '只改正文' });
  assert.equal(onlyBody.ok, true);
  assert.equal(onlyBody.entry.body, '只改正文');
  assert.equal(onlyBody.entry.title, '原标题');
  assert.equal(onlyBody.entry.date, '2026-11-02');
  assert.notEqual(onlyBody.entry.updatedAt, created.entry.updatedAt);

  const moved = await updateEntry('d4', created.entry.id, { date: '2026-10-31', title: '' });
  assert.equal(moved.ok, true);
  assert.equal(moved.entry.date, '2026-10-31');
  assert.equal(moved.entry.title, '');
  assert.equal(moved.entry.body, '只改正文');

  const badDate = await updateEntry('d4', created.entry.id, { date: '2026-02-30' });
  assert.equal(badDate.ok, false);
  assert.match(badDate.error, /日期格式不正确/);

  const badBody = await updateEntry('d4', created.entry.id, { body: '  ' });
  assert.equal(badBody.ok, false);
  assert.match(badBody.error, /不能为空/);

  const missing = await updateEntry('d4', 'not-exist', { body: '随便' });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /不存在/);
});

test('按 id 取单篇；删除后取不到，重复删除返回 false', async () => {
  const created = await addEntry('d5', { date: '2026-11-05', body: '待删除' });
  const found = await getEntry('d5', created.entry.id);
  assert.equal(found.body, '待删除');

  assert.equal(await deleteEntry('d5', created.entry.id), true);
  assert.equal(await deleteEntry('d5', created.entry.id), false);
  assert.equal(await getEntry('d5', created.entry.id), null);
  assert.deepEqual(await listEntries('d5'), []);
});

test('不同账号的日记互不可见', async () => {
  const mine = await addEntry('d6', { date: '2026-11-05', body: '我的日记' });
  assert.deepEqual(await listEntries('d7'), []);
  assert.equal(await getEntry('d7', mine.entry.id), null);
  assert.equal(await deleteEntry('d7', mine.entry.id), false);
});

test('并发新增不会互相覆盖', async () => {
  await Promise.all(
    Array.from({ length: 8 }, (_, i) => addEntry('d8', { date: `2026-11-0${(i % 8) + 1}`, body: `第 ${i} 条` }))
  );
  assert.equal((await listEntries('d8')).length, 8);
});

test('篇数达上限后拒绝新增，提示先删旧的', async () => {
  const original = siteConfig.diary.maxEntries;
  // 只放宽这一个字段，测完还原，避免为了测上限写 1000 次
  Object.assign(siteConfig.diary, { maxEntries: 2 });
  try {
    assert.equal((await addEntry('d9', { date: '2026-11-01', body: '第一篇' })).ok, true);
    assert.equal((await addEntry('d9', { date: '2026-11-02', body: '第二篇' })).ok, true);
    const third = await addEntry('d9', { date: '2026-11-03', body: '第三篇' });
    assert.equal(third.ok, false);
    assert.match(third.error, /上限/);
    assert.equal((await listEntries('d9')).length, 2);
  } finally {
    Object.assign(siteConfig.diary, { maxEntries: original });
  }
});

test('日记文件损坏时按「没有日记」处理，下次写入能重建', async () => {
  const dir = path.join(tmpDir, 'users', 'd10');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'diary.json'), '{ not json', 'utf8');
  assert.deepEqual(await listEntries('d10'), []);

  const r = await addEntry('d10', { date: '2026-11-05', body: '重建后的第一篇' });
  assert.equal(r.ok, true);
  assert.equal((await listEntries('d10')).length, 1);
});

test('文件里混入坏条目时只丢弃坏的那条，不影响其它日记', async () => {
  const dir = path.join(tmpDir, 'users', 'd11');
  await fs.mkdir(dir, { recursive: true });
  const good = { id: 'ok1', date: '2026-11-04', title: '', body: '正常', createdAt: '2026-11-04T10:00:00.000Z', updatedAt: '2026-11-04T10:00:00.000Z' };
  const bad = { id: 'bad1', date: '2026-02-30', body: '日期不存在' };
  await fs.writeFile(path.join(dir, 'diary.json'), JSON.stringify({ version: 1, entries: [good, bad] }), 'utf8');

  const list = await listEntries('d11');
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'ok1');
});
