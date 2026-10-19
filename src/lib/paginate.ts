// 长文分页：把文章切成分页单元（page units），供阅读页与翻译使用。
//
// 设计要点：
//   - 以「块」为边界切页（块 = 标题或段落），不会把一段文字劈成两半；
//   - 超长段落（超过单页字符上限）会在句子边界拆成多个块，保证一本书也不会出现单页过长；
//   - 每个单元的 index 是全局块序号，翻译与点词都按它对齐，因此分页前后行为一致。

import type { Paragraph } from './text.ts';

export interface PageUnit extends Paragraph {
  /** 全局块序号（分页后仍连续） */
  index: number;
  /** 单元字符数 */
  chars: number;
}

export interface PaginationOptions {
  /** 每页目标字符数（英文按字符估算，中文排版下每页约等于这个量） */
  charsPerPage: number;
  /** 单个块允许超过目标值的最大倍率，超过则在句子边界再拆 */
  maxBlockRatio?: number;
}

export interface Page {
  /** 页码，从 1 开始 */
  page: number;
  units: PageUnit[];
  chars: number;
}

const DEFAULT_MAX_RATIO = 1.6;

/** 中文字符或中文标点：与中文相邻时不应插入空格 */
const CJK_EDGE = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]$/;

/** 智能拼接：中文之间不加空格，其余用空格分隔 */
function joinSmart(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  if (CJK_EDGE.test(a) || CJK_EDGE.test(b)) return a + b;
  return `${a} ${b}`;
}

/** 中文/英文混排按字符计；按句号、问号、感叹号、分号切句，尽量不切在句中 */
export function splitLongBlock(text: string, limit: number): string[] {
  const clean = text.trim();
  if (clean.length <= limit) return [clean];

  const sentences = clean.match(/[^.!?。！？;；]+[.!?。！？;；]*\s*|[^.!?。！？;；]+$/g) ?? [clean];
  const parts: string[] = [];
  let current = '';

  const push = () => {
    if (current.trim()) parts.push(current.trim());
    current = '';
  };

  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    const merged = joinSmart(current, s);
    if (merged.length <= limit) {
      current = merged;
      continue;
    }
    push();
    if (s.length <= limit) {
      current = s;
      continue;
    }
    // 单句仍超长：按逗号硬切；没有逗号时按词/字硬切
    const pieces = s.match(/[^,，、]+[,，、]?\s*|[^,，、]+$/g) ?? [s];
    for (const piece of pieces) {
      const p = piece.trim();
      if (!p) continue;
      const joined = joinSmart(current, p);
      if (joined.length <= limit) {
        current = joined;
      } else {
        if (current) push();
        if (p.length <= limit) {
          current = p;
        } else {
          // 极长的无标点片段：按 limit 硬切
          for (let i = 0; i < p.length; i += limit) parts.push(p.slice(i, i + limit));
          current = '';
        }
      }
    }
  }
  push();
  return parts.length ? parts : [clean];
}

/** 把 blocks 展开成可分页单元（超长段落拆成多段） */
export function toPageUnits(blocks: Paragraph[], charsPerPage: number): PageUnit[] {
  const ratio = DEFAULT_MAX_RATIO;
  const limit = Math.max(200, Math.round(charsPerPage * ratio));
  const units: PageUnit[] = [];
  for (const block of blocks) {
    const pieces = block.type === 'paragraph' ? splitLongBlock(block.text, limit) : [block.text];
    for (const piece of pieces) {
      units.push({ type: block.type, text: piece, index: units.length, chars: piece.length });
    }
  }
  return units;
}

/** 分页：按目标字符数装箱，标题尽量与后文同页 */
export function paginate(blocks: Paragraph[], options: PaginationOptions): Page[] {
  const charsPerPage = Math.max(200, options.charsPerPage);
  const units = toPageUnits(blocks, charsPerPage);
  const pages: Page[] = [];
  let current: PageUnit[] = [];
  let currentChars = 0;

  const flush = () => {
    if (current.length) pages.push({ page: pages.length + 1, units: current, chars: currentChars });
    current = [];
    currentChars = 0;
  };

  for (let i = 0; i < units.length; i++) {
    const unit = units[i];
    const isLast = i === units.length - 1;
    // 标题后紧跟的段落：若当前页已有内容、且标题会落在页尾，则先换页
    const next = units[i + 1];

    if (currentChars > 0 && currentChars + unit.chars > charsPerPage * 1.05) {
      flush();
    }
    current.push(unit);
    currentChars += unit.chars;

    // 页末是标题且后面还有内容 → 把标题带到下一页
    if (unit.type === 'heading' && next && current.length > 1 && currentChars >= charsPerPage * 0.6) {
      current.pop();
      currentChars -= unit.chars;
      flush();
      current.push(unit);
      currentChars = unit.chars;
    }

    if (currentChars >= charsPerPage || isLast) flush();
  }
  flush();
  return pages.length ? pages : [{ page: 1, units: units, chars: units.reduce((s, u) => s + u.chars, 0) }];
}

/** 根据当前页所有块的内容哈希生成稳定的翻译缓存键 */
export function pageSignature(units: PageUnit[]): string {
  return units.map((u) => `${u.index}:${u.chars}`).join(',');
}
