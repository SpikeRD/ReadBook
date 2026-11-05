// 章节自动识别：从「已分页的块」里认出章节标题，给出它从第几页开始，以及当前读到哪一章。
//
// 设计要点：
//   - 纯函数，只在渲染层使用：不写回文章 JSON、不修改 blocks、不参与分页，
//     因此页码、翻译缓存键（unit.index:chars）与旧书签都不受影响；
//   - 只认「显式章节标记」，不做「全大写短行即章节」这类启发式判断：
//     书籍扉页常见 `THE OLD MAN` / `THE SEA` 这种独立短行，放开会造出一堆假章节；
//   - 老文章无需迁移：blocks 已经持久化在文章 JSON 里，这里直接基于它识别。

import type { Page } from './paginate.ts';

export interface Chapter {
  /** 章节标题文字 */
  title: string;
  /** 标题所在块的全局序号（= PageUnit.index） */
  unitIndex: number;
  /** 本章从第几页开始（从 1 开始） */
  page: number;
  /** 来源：markdown 标题块 / 正文里识别出的章节行 */
  kind: 'heading' | 'detected';
}

export interface ChapterOptions {
  /** 关掉后直接返回空数组（对应 siteConfig.reader.chapters） */
  enabled?: boolean;
  /** 章节标题最大长度，超过视为正文（避免整段被当成章节） */
  maxTitleLen?: number;
}

/**
 * 英文显式章节前缀：Chapter 1 / CHAPTER IV / Part Two / Book 3 / Section 2 / Act I / Stave 5
 * 只匹配前缀，标题正文（`Chapter 1: The Boy`）不影响识别。
 */
const EN_CHAPTER_PREFIX =
  /^(chapter|part|book|volume|section|act|stave)\s+([0-9]{1,4}|[ivxlcdm]{1,8}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|hundred)\b/i;

/** 英文独立章节名：Prologue / Epilogue / Preface / Foreword / Introduction / Afterword / Appendix / Interlude */
const EN_CHAPTER_WORD = /^(prologue|epilogue|preface|foreword|introduction|afterword|appendix|interlude)\b/i;

/** 中文章节前缀：第1章 / 第十二回 / 第 3 节 / 第2卷 / 第一篇 */
const ZH_CHAPTER_PREFIX = /^第\s*[0-9零〇一二三四五六七八九十百千两]+\s*[章节回卷部篇集]/;

/** 中文独立章节名：序章 / 楔子 / 引子 / 前言 / 尾声 / 后记 / 番外 / 附录 */
const ZH_CHAPTER_WORD = /^(序章|序言|楔子|引子|前言|后记|尾声|尾聲|番外|附录|附錄)/;

/** 判断一行正文是不是章节标题（只看显式标记，宁可少认也不误认） */
export function isChapterTitle(text: string, maxTitleLen = 80): boolean {
  const t = text.trim();
  if (!t || t.length > maxTitleLen) return false;
  // 句末标点说明它是一句话，不是标题（"Chapter 1 was hard." 不能被当成章节）
  if (/[.!?。！？]$/.test(t)) return false;
  return EN_CHAPTER_PREFIX.test(t) || EN_CHAPTER_WORD.test(t) || ZH_CHAPTER_PREFIX.test(t) || ZH_CHAPTER_WORD.test(t);
}

/**
 * 从分页结果生成章节列表（按出现顺序）。
 * markdown 标题块一律算章节；正文里带显式章节标记的块也算章节。
 */
export function buildChapters(pages: Page[], options: ChapterOptions = {}): Chapter[] {
  if (options.enabled === false) return [];
  const maxTitleLen = options.maxTitleLen ?? 80;
  const chapters: Chapter[] = [];

  for (const p of pages) {
    for (const unit of p.units) {
      const isHeading = unit.type === 'heading';
      if (!isHeading && !isChapterTitle(unit.text, maxTitleLen)) continue;
      const title = unit.text.trim();
      if (!title) continue;
      chapters.push({
        title,
        unitIndex: unit.index,
        page: p.page,
        kind: isHeading ? 'heading' : 'detected',
      });
    }
  }
  return chapters;
}

/**
 * 当前页开头所在的章节：传入本页第一个块的序号，取「起始块序号 <= 它」的最后一个章节。
 * 用块序号而不是页码，是因为一章可能从某页中间开始，按页码取会把上一章误判成当前章。
 */
export function currentChapter(chapters: Chapter[], unitIndex: number): Chapter | null {
  let found: Chapter | null = null;
  for (const c of chapters) {
    if (c.unitIndex <= unitIndex) found = c;
    else break;
  }
  return found;
}

/** 章节标题所在块的序号集合，供阅读页给这些块加样式 */
export function chapterUnitIndexes(chapters: Chapter[]): Set<number> {
  return new Set(chapters.map((c) => c.unitIndex));
}
