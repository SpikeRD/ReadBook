// 单元测试：文本处理（不依赖构建产物）。
// 会话与账号相关测试见 tests/auth.test.mjs。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countWords, extractWords, normalizeWord, toBlocks, inferTitle, candidateLemmas } from '../src/lib/text.ts';

test('extractWords 只取英文单词并保留缩写', () => {
  assert.deepEqual(extractWords("It's a well-known fact, isn't it?"), ["It's", 'a', 'well-known', 'fact', "isn't", 'it']);
  assert.equal(countWords('Hello world! 你好 world'), 3);
});

test('normalizeWord 统一大小写与弯引号', () => {
  assert.equal(normalizeWord('Don’t'), "don't");
  assert.equal(normalizeWord('—word—'), 'word');
});

test('candidateLemmas 给出常见词形还原候选', () => {
  const running = candidateLemmas('running');
  assert.ok(running.includes('run'));
  assert.ok(candidateLemmas('studies').includes('study'));
  assert.ok(candidateLemmas('walked').includes('walk'));
  assert.ok(candidateLemmas('quickly').includes('quick'));
});

test('toBlocks 识别标题并按空行分段', () => {
  const blocks = toBlocks('# Title\n\nFirst line\ncontinues here.\n\n## Sub\n\nAnother paragraph.');
  assert.deepEqual(blocks, [
    { type: 'heading', text: 'Title' },
    { type: 'paragraph', text: 'First line continues here.' },
    { type: 'heading', text: 'Sub' },
    { type: 'paragraph', text: 'Another paragraph.' },
  ]);
});

test('toBlocks 把段落中的井号当普通文本', () => {
  const blocks = toBlocks('Use # tags in text.');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'paragraph');
});

test('inferTitle 优先取标题行，其次短首行', () => {
  assert.equal(inferTitle('# Chapter One\n\nbody'), 'Chapter One');
  assert.equal(inferTitle('Short Title Line\n\nMore text.'), 'Short Title Line');
  assert.match(inferTitle('This is a long sentence that ends with a period.'), /^This is a long sentence/);
});
