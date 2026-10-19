// 翻译模块测试：分段、HTML 实体清洗、配置。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitText, getProvider } from '../src/lib/translate.ts';
import { siteConfig } from '../src/config/site.ts';

test('短段落不拆分', () => {
  assert.deepEqual(splitText('Hello world.', 450), ['Hello world.']);
});

test('长段落按句号切分，且每块不超过上限', () => {
  const text = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} is here and it is fairly long.`).join(' ');
  const chunks = splitText(text, 120);
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(c.length <= 120, `超长块: ${c.length}`);
  assert.equal(chunks.join(' ').match(/\./g).length, text.match(/\./g).length);
});

test('HTML 实体被还原后再送去翻译（曾导致整段翻译失败）', () => {
  const chunks = splitText('&quot;Santiago,&quot; the boy said &amp; smiled.', 450);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0], '"Santiago," the boy said & smiled.');
});

test('纯数字/符号的块返回空数组（不需翻译，省一次请求）', () => {
  assert.deepEqual(splitText('1952', 450), []);
  assert.deepEqual(splitText('   ', 450), []);
  assert.deepEqual(splitText('***', 450), []);
});

test('中文内容也会被切分且不丢字', () => {
  const zh = '这是一段中文。'.repeat(80);
  const pieces = splitText(zh, 200);
  assert.ok(pieces.length > 1);
  assert.equal(pieces.join(''), zh);
});

test('默认服务商为腾讯翻译且能创建实例', () => {
  assert.equal(siteConfig.translation.provider, 'tencent');
  const provider = getProvider();
  assert.ok(provider);
  assert.equal(provider.id, 'tencent');
  assert.ok(provider.batchSize > 1, '腾讯接口支持批量');
});
