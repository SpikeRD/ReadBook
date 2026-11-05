// 章节自动识别测试：只认显式章节标记，且不影响分页与块序号。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildChapters, chapterUnitIndexes, currentChapter, isChapterTitle } from '../src/lib/chapters.ts';
import { paginate } from '../src/lib/paginate.ts';

const para = (text) => ({ type: 'paragraph', text });
const head = (text) => ({ type: 'heading', text });

test('markdown 标题块一律算章节', () => {
  const pages = paginate([head('Chapter 1'), para('Body one.'), head('Chapter 2'), para('Body two.')], {
    charsPerPage: 600,
  });
  const chapters = buildChapters(pages);
  assert.deepEqual(
    chapters.map((c) => c.title),
    ['Chapter 1', 'Chapter 2']
  );
  assert.equal(chapters[0].kind, 'heading');
});

test('正文里的 Chapter 1 / 第1章 也能识别', () => {
  const pages = paginate(
    [para('CHAPTER 1'), para('It was a cold day.'), para('第十二回 风雪山神庙'), para('林冲踏着雪走了。')],
    { charsPerPage: 600 }
  );
  const chapters = buildChapters(pages);
  assert.deepEqual(
    chapters.map((c) => c.title),
    ['CHAPTER 1', '第十二回 风雪山神庙']
  );
  assert.equal(chapters[0].kind, 'detected');
});

test('章节的页码跟随分页结果', () => {
  const blocks = [head('Chapter 1'), ...Array.from({ length: 12 }, (_, i) => para(`P${i}. ` + 'x'.repeat(200)))];
  blocks.push(head('Chapter 2'));
  blocks.push(...Array.from({ length: 12 }, (_, i) => para(`Q${i}. ` + 'y'.repeat(200))));
  const pages = paginate(blocks, { charsPerPage: 500 });
  const chapters = buildChapters(pages);
  assert.equal(chapters.length, 2);
  assert.ok(chapters[1].page > chapters[0].page, '第二章应排在后面的页');
  // 章节起始页必须真的包含该块的序号
  const second = pages.find((p) => p.page === chapters[1].page);
  assert.ok(second.units.some((u) => u.index === chapters[1].unitIndex));
});

test('全大写短行与带句号的句子不算章节（避免扉页误判）', () => {
  assert.equal(isChapterTitle('THE OLD MAN'), false);
  assert.equal(isChapterTitle('THE SEA'), false);
  assert.equal(isChapterTitle('Chapter 1 was hard.'), false);
  assert.equal(isChapterTitle('第一次见到他'), false);
  assert.equal(isChapterTitle('序章'), true);
  assert.equal(isChapterTitle('Prologue'), true);
});

test('超长行不当章节', () => {
  assert.equal(isChapterTitle('Chapter 1 ' + 'x'.repeat(100)), false);
});

test('当前章节按本页第一个块定位，且能给出章节块序号集合', () => {
  const pages = paginate([head('Chapter 1'), para('a'), head('Chapter 2'), para('b')], { charsPerPage: 600 });
  const chapters = buildChapters(pages);
  // 两章在同一页时，页首属于第一章（按块序号判断，不按页码）
  assert.equal(currentChapter(chapters, 0)?.title, 'Chapter 1');
  assert.equal(currentChapter(chapters, chapters[1].unitIndex)?.title, 'Chapter 2');
  assert.deepEqual([...chapterUnitIndexes(chapters)].sort((a, b) => a - b), chapters.map((c) => c.unitIndex));
});

test('关掉开关时不识别章节', () => {
  const pages = paginate([head('Chapter 1'), para('a')], { charsPerPage: 600 });
  assert.deepEqual(buildChapters(pages, { enabled: false }), []);
});
