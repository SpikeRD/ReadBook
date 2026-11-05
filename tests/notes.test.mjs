// 笔记存储测试：增删改、锚点与原文片段、跨文章 / 跨账号隔离、上限、删文章清理、损坏文件兜底。

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 用临时目录，绝不碰项目里的 data/
const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'readbook-notes-'));
process.env.DATA_DIR = tmpDir;

const { addNote, listArticleNotes, updateNote, deleteNote, clearArticleNotes, readNoteCounts } = await import(
  '../src/lib/notes.ts'
);
const { createArticle, deleteArticle } = await import('../src/lib/articles.ts');
const { siteConfig } = await import('../src/config/site.ts');

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('没有笔记时返回空数组', async () => {
  assert.deepEqual(await listArticleNotes('u-none', 'art00001'), []);
});

test('新增后能读回，按块序号（正文顺序）排序', async () => {
  const a = await addNote('u1', 'art00001', { blockIndex: 5, quote: '第五段', body: '先记后面这段' });
  const b = await addNote('u1', 'art00001', { blockIndex: 2, quote: '第二段', body: '再记前面这段' });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.ok(a.note.id);

  const list = await listArticleNotes('u1', 'art00001');
  assert.deepEqual(
    list.map((n) => n.blockIndex),
    [2, 5]
  );
  assert.equal(list[0].body, '再记前面这段');
  assert.equal(list[0].quote, '第二段');
});

test('空内容与非法锚点被拒绝', async () => {
  const empty = await addNote('u2', 'art00001', { blockIndex: 1, body: '   ' });
  assert.equal(empty.ok, false);
  assert.match(empty.error, /不能为空/);

  const bad = await addNote('u2', 'art00001', { blockIndex: -3, body: '有内容' });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /锚点无效/);

  assert.deepEqual(await listArticleNotes('u2', 'art00001'), []);
});

test('笔记正文超长按上限截断，换行统一为 \\n', async () => {
  const max = siteConfig.limits.maxNoteChars;
  const long = 'a'.repeat(max + 50);
  const r = await addNote('u3', 'art00001', { blockIndex: 0, body: `第一行\r\n第二行\r\n${long}` });
  assert.equal(r.ok, true);
  assert.equal(r.note.body.length, max);
  assert.ok(r.note.body.startsWith('第一行\n第二行\n'));
  assert.ok(!r.note.body.includes('\r'));
});

test('单篇笔记数量达上限后拒绝新增', async () => {
  const original = siteConfig.limits.maxNotesPerArticle;
  // 只放宽这一个字段，测完还原，避免为了测上限写 500 次
  Object.assign(siteConfig.limits, { maxNotesPerArticle: 2 });
  try {
    assert.equal((await addNote('u4', 'art00001', { blockIndex: 0, body: '第一条' })).ok, true);
    assert.equal((await addNote('u4', 'art00001', { blockIndex: 1, body: '第二条' })).ok, true);
    const third = await addNote('u4', 'art00001', { blockIndex: 2, body: '第三条' });
    assert.equal(third.ok, false);
    assert.match(third.error, /上限/);
    assert.equal((await listArticleNotes('u4', 'art00001')).length, 2);
  } finally {
    Object.assign(siteConfig.limits, { maxNotesPerArticle: original });
  }
});

test('改正文不动锚点，且更新时间会变', async () => {
  const created = await addNote('u5', 'art00001', { blockIndex: 7, quote: '第七段', body: '初稿' });
  await new Promise((r) => setTimeout(r, 5));
  const updated = await updateNote('u5', 'art00001', created.note.id, '改过的内容');
  assert.equal(updated.ok, true);
  assert.equal(updated.note.blockIndex, 7);
  assert.equal(updated.note.quote, '第七段');
  assert.equal(updated.note.body, '改过的内容');
  assert.notEqual(updated.note.updatedAt, created.note.updatedAt);

  const missing = await updateNote('u5', 'art00001', 'not-exist', '随便');
  assert.equal(missing.ok, false);
});

test('删除单条与清空整篇互不影响其它文章', async () => {
  const keep = await addNote('u6', 'artA', { blockIndex: 0, body: 'A 的笔记' });
  const drop = await addNote('u6', 'artB', { blockIndex: 0, body: 'B 的笔记' });

  assert.equal(await deleteNote('u6', 'artB', drop.note.id), true);
  assert.equal(await deleteNote('u6', 'artB', drop.note.id), false);
  assert.deepEqual(await listArticleNotes('u6', 'artB'), []);
  assert.equal((await listArticleNotes('u6', 'artA')).length, 1);
  assert.equal((await listArticleNotes('u6', 'artA'))[0].id, keep.note.id);

  await clearArticleNotes('u6', 'artA');
  assert.deepEqual(await listArticleNotes('u6', 'artA'), []);
});

test('不同账号的同名文章互不可见', async () => {
  await addNote('u7', 'art00001', { blockIndex: 0, body: '我的笔记' });
  assert.equal((await listArticleNotes('u8', 'art00001')).length, 0);
});

test('并发新增不会互相覆盖', async () => {
  await Promise.all(
    Array.from({ length: 8 }, (_, i) => addNote('u9', 'art00001', { blockIndex: i, body: `第 ${i} 条` }))
  );
  const list = await listArticleNotes('u9', 'art00001');
  assert.equal(list.length, 8);
  assert.deepEqual(
    list.map((n) => n.blockIndex),
    [0, 1, 2, 3, 4, 5, 6, 7]
  );
});

test('删除文章时笔记一并清理', async () => {
  const created = await createArticle('u10', { title: '临时文章', text: 'First paragraph.\n\nSecond paragraph.' });
  assert.equal(created.ok, true);
  const articleId = created.article.id;

  await addNote('u10', articleId, { blockIndex: 0, quote: 'First paragraph.', body: '这条应该被一起删掉' });
  assert.equal((await listArticleNotes('u10', articleId)).length, 1);

  assert.equal(await deleteArticle('u10', articleId), true);
  assert.deepEqual(await listArticleNotes('u10', articleId), []);
});

test('笔记文件损坏时按「没有笔记」处理，下次写入能重建', async () => {
  const dir = path.join(tmpDir, 'users', 'u11');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'notes.json'), '{ not json', 'utf8');
  assert.deepEqual(await listArticleNotes('u11', 'art00001'), []);

  const r = await addNote('u11', 'art00001', { blockIndex: 0, body: '重建后的第一条' });
  assert.equal(r.ok, true);
  assert.equal((await listArticleNotes('u11', 'art00001')).length, 1);
});

test('列表页的笔记条数按文章汇总，没笔记的文章不出现', async () => {
  await addNote('u13', 'artA', { blockIndex: 0, body: 'a1' });
  await addNote('u13', 'artA', { blockIndex: 1, body: 'a2' });
  await addNote('u13', 'artB', { blockIndex: 0, body: 'b1' });
  assert.deepEqual(await readNoteCounts('u13'), { artA: 2, artB: 1 });
  assert.deepEqual(await readNoteCounts('u14'), {});
});

test('文章 id 经过路径安全校验，不能穿越到别的目录', async () => {
  await addNote('u12', 'art00001', { blockIndex: 0, body: '正常' });
  assert.deepEqual(await listArticleNotes('u12', '../../users.json'), []);
});
