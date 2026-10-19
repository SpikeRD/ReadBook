// 阅读页侧栏：本文生词高亮与列表。

import * as vocab from '../vocab-store';
import { escapeHtml, shortZh } from './html';

export interface HighlighterOptions {
  container: HTMLElement;
  articleId: string;
  highlightLimit: number;
  statEl: HTMLElement | null;
  sidebarEl: HTMLElement;
}

export class ArticleVocabPanel {
  private opts: HighlighterOptions;

  constructor(opts: HighlighterOptions) {
    this.opts = opts;
  }

  wordElements(): HTMLElement[] {
    return Array.from(this.opts.container.querySelectorAll<HTMLElement>('.word'));
  }

  findWordElement(word: string): HTMLElement | undefined {
    const w = word.toLowerCase();
    return this.wordElements().find((x) => (x.dataset.w || '').toLowerCase() === w);
  }

  /** 重新计算高亮、统计与侧栏；fresh 中的单词会短暂闪烁提示 */
  refresh(fresh?: Record<string, boolean>): void {
    const { articleId, highlightLimit, statEl } = this.opts;
    const entries = vocab.wordsOfArticle(articleId);
    const known = new Set(entries.map((e) => e.word.toLowerCase()));
    // 生词过多时只高亮最近添加的若干个，避免超长文章卡顿
    const limitWords = new Set(entries.slice(-highlightLimit).map((e) => e.word.toLowerCase()));
    for (const el of this.wordElements()) {
      const w = (el.dataset.w || '').toLowerCase();
      el.classList.toggle('known', known.has(w) && limitWords.has(w));
    }
    if (statEl) {
      const mastered = entries.filter((e) => e.mastered).length;
      statEl.textContent = entries.length
        ? `本文生词 ${entries.length} 个${mastered ? `（已掌握 ${mastered}）` : ''}`
        : '本文还没有生词，点任意单词试试';
    }
    if (fresh) {
      for (const [w, v] of Object.entries(fresh)) {
        if (!v) continue;
        const el = this.findWordElement(w);
        if (el) {
          el.classList.add('new-now');
          setTimeout(() => el.classList.remove('new-now'), 1400);
        }
      }
    }
    this.renderSidebar();
  }

  renderSidebar(): void {
    const all = vocab.wordsOfArticle(this.opts.articleId).sort((a, b) => b.createdAt - a.createdAt);
    const box = this.opts.sidebarEl;
    if (all.length === 0) {
      box.innerHTML = '<div class="muted small">还没有生词。点正文里的单词即可查词并记录。</div>';
      return;
    }
    // 分页阅读：本页出现的词优先展示，其余放在折叠区，避免每页都刷出整本书的生词
    const onPage = new Set(this.wordElements().map((el) => (el.dataset.w || '').toLowerCase()));
    const local = all.filter((e) => onPage.has(e.word.toLowerCase()));
    const others = all.filter((e) => !onPage.has(e.word.toLowerCase()));

    const row = (e: (typeof all)[number]) => `
      <div class="row small" style="justify-content:space-between; gap:6px; padding:3px 0">
        <a href="#" data-focus="${escapeHtml(e.word)}" style="font-weight:600">${escapeHtml(e.word)}</a>
        <span class="muted" style="flex:1; min-width:0; overflow-wrap:anywhere">${escapeHtml(shortZh(e.translation))}</span>
        <button class="btn btn-ghost btn-sm" data-speak="${escapeHtml(e.word)}" title="发音">🔊</button>
      </div>`;

    box.innerHTML = [
      local.length
        ? `<div class="hint" style="margin-bottom:2px">本页生词（${local.length}）</div>${local.map(row).join('')}`
        : '<div class="muted small">本页还没有生词。</div>',
      others.length
        ? `<details style="margin-top:6px"><summary class="hint">本篇其他生词（${others.length}）</summary>${others
            .slice(0, 200)
            .map(row)
            .join('')}</details>`
        : '',
    ].join('');
  }
}
