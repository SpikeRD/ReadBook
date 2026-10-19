// 分页纯函数测试

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paginate, toPageUnits, splitLongBlock } from '../src/lib/paginate.ts';
import { toBlocks } from '../src/lib/text.ts';

const para = (text) => ({ type: 'paragraph', text });
const head = (text) => ({ type: 'heading', text });

test('短文章只有一页', () => {
  const blocks = toBlocks('# Title\n\nShort paragraph.');
  const pages = paginate(blocks, { charsPerPage: 1200 });
  assert.equal(pages.length, 1);
  assert.equal(pages[0].units.length, 2);
});

test('长文章分成多页，且每页字符数不超过阈值太多', () => {
  const text = Array.from({ length: 60 }, (_, i) => `Paragraph ${i + 1}. ${'word '.repeat(80)}`).join('\n\n');
  const blocks = toBlocks(text);
  const pages = paginate(blocks, { charsPerPage: 1200 });
  assert.ok(pages.length > 1, '应分成多页');
  for (const p of pages) {
    assert.ok(p.chars <= 1200 * 1.7, `第 ${p.page} 页过长：${p.chars}`);
  }
  // 不丢内容：所有块的文字拼起来应与原文单词数一致
  const joined = pages.flatMap((p) => p.units.map((u) => u.text)).join(' ');
  assert.equal(joined.split(/\s+/).length, blocks.map((b) => b.text).join(' ').split(/\s+/).length);
});

test('超长单段会被拆成多个块', () => {
  const long = Array.from({ length: 400 }, (_, i) => `Sentence ${i} has some words.`).join(' ');
  const units = toPageUnits([para(long)], 1200);
  assert.ok(units.length > 1, '应拆成多段');
  for (const u of units) assert.ok(u.chars <= 1200 * 1.6 + 50, `块过长：${u.chars}`);
  // 拆分的块重新拼接后句子数量不变
  assert.equal(units.map((u) => u.text).join(' ').match(/\./g).length, long.match(/\./g).length);
});

test('分页保持块序号连续，便于翻译对齐', () => {
  const blocks = [head('Chapter 1'), ...Array.from({ length: 20 }, (_, i) => para(`Para ${i}. ` + 'x'.repeat(150)))];
  const pages = paginate(blocks, { charsPerPage: 600 });
  const indexes = pages.flatMap((p) => p.units.map((u) => u.index));
  assert.deepEqual(indexes, indexes.map((_, i) => i));
});

test('页码从 1 开始且连续', () => {
  const blocks = Array.from({ length: 30 }, (_, i) => para(`P${i}. ` + 'y'.repeat(200)));
  const pages = paginate(blocks, { charsPerPage: 500 });
  assert.deepEqual(pages.map((p) => p.page), pages.map((_, i) => i + 1));
});

test('中英混排不会把中文按空格误切', () => {
  const zh = '这是一段中文。'.repeat(100);
  const pieces = splitLongBlock(zh, 200);
  assert.ok(pieces.length > 1);
  assert.equal(pieces.join(''), zh);
});

test('空文章分页返回一页（空）', () => {
  const pages = paginate([], { charsPerPage: 1200 });
  assert.equal(pages.length, 1);
  assert.equal(pages[0].units.length, 0);
});
