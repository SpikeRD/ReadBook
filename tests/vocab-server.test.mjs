// 服务端生词本存储测试：按用户隔离、导入去重、分组规范化。

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'readbook-vocab-'));
process.env.DATA_DIR = tmp;

const store = await import('../src/lib/vocab-server.ts');

after(async () => {
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
});

const entry = (over = {}) => ({
  id: 'x',
  word: 'Read',
  translation: 'v. 读',
  phonetic: '',
  articleId: 'a1',
  articleTitle: '文章一',
  tag: null,
  example: '',
  createdAt: 1,
  mastered: false,
  ...over,
});

test('不同用户的生词本互不影响', async () => {
  await store.saveVocabulary('userA', { groups: [], entries: [entry()] });
  const a = await store.getVocabulary('userA');
  const b = await store.getVocabulary('userB');
  assert.equal(a.entries.length, 1);
  assert.equal(b.entries.length, 0, 'B 不应看到 A 的数据');
  assert.equal(a.entries[0].word, 'read', '单词统一小写');
});

test('未写入过的用户返回空结构', async () => {
  const doc = await store.getVocabulary('fresh-user');
  assert.deepEqual(doc.groups, []);
  assert.deepEqual(doc.entries, []);
  assert.equal(doc.version, 2);
});

test('导入本地数据：合并去重并保留分组', async () => {
  await store.saveVocabulary('userC', {
    groups: [{ id: 'g1', name: '我的分组', createdAt: 1 }],
    entries: [entry({ id: 'a', word: 'alpha', articleId: null, tag: 'g1' })],
  });
  const r1 = await store.importLocal('userC', {
    groups: [{ id: 'g1', name: '我的分组', createdAt: 1 }, { id: 'g2', name: '新分组', createdAt: 2 }],
    entries: [
      { word: 'alpha', translation: 'α', articleId: null, tag: 'g1' }, // 重复
      { word: 'beta', translation: 'β', articleId: 'art-2', articleTitle: '文章二' }, // 新词
    ],
  });
  assert.deepEqual(r1, { added: 1, skipped: 1 });

  const doc = await store.getVocabulary('userC');
  assert.equal(doc.entries.length, 2);
  assert.ok(doc.groups.some((g) => g.name === '新分组'));

  // 再导入一次不会重复
  const r2 = await store.importLocal('userC', { entries: [{ word: 'beta', articleId: 'art-2' }] });
  assert.deepEqual(r2, { added: 0, skipped: 1 });
});

test('导入时未知自建分组归入「导入的单词」', async () => {
  const r = await store.importLocal('userD', {
    entries: [{ word: 'gamma', tag: 'missing-tag', translation: 'γ' }],
  });
  assert.equal(r.added, 1);
  const doc = await store.getVocabulary('userD');
  const fallback = doc.groups.find((g) => g.name === '导入的单词');
  assert.ok(fallback, '应创建默认分组');
  assert.equal(doc.entries[0].tag, fallback.id);
});

test('非法输入被安全规范化（坏词条被丢弃）', async () => {
  const doc = await store.saveVocabulary('userE', {
    groups: [{ id: 1 }, { id: 'ok', name: '合法' }],
    entries: [{ translation: '没有单词' }, null, 'string', entry({ word: 'valid' })],
  });
  assert.equal(doc.entries.length, 1);
  assert.equal(doc.groups.length, 1);
});
