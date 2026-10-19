// 单词释义浮层：定位、渲染、开关。

import * as vocab from '../vocab-store';
import { escapeHtml } from './html';

export interface PopoverData {
  word: string;
  phonetic: string;
  translation: string;
  found: boolean;
  source: string;
  externalUrl?: string;
}

export interface PopoverHost {
  /** 浮层根节点 */
  el: HTMLElement;
  /** 当前文章 id（决定"本篇生词"按钮） */
  articleId: string;
  /** 关闭时通知外部清理高亮 */
  onClose?: () => void;
}

export class WordPopover {
  private el: HTMLElement;
  private articleId: string;
  private onClose?: () => void;

  constructor(host: PopoverHost) {
    this.el = host.el;
    this.articleId = host.articleId;
    this.onClose = host.onClose;
  }

  get element(): HTMLElement {
    return this.el;
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  /** 显示"查询中"占位并定位 */
  showLoading(anchor: HTMLElement): void {
    this.el.hidden = false;
    this.el.style.left = '0px';
    this.el.style.top = '0px';
    this.el.innerHTML = '<div class="muted small">查询中…</div>';
    this.position(anchor);
  }

  render(anchor: HTMLElement, data: PopoverData): void {
    const inArticle = vocab.hasInArticle(this.articleId, data.word);
    const allGroups = vocab.listGroups();
    const inTheseGroups = new Set(vocab.groupsContaining(data.word).map((g) => g.id));
    const zh = data.found ? data.translation || '（词典无释义）' : '';
    const sourceLabel =
      data.source === 'lemma'
        ? '词形还原'
        : data.source === 'online'
          ? '在线'
          : data.source === 'local'
            ? '本地词库'
            : '未收录';

    const groupChips = allGroups.length
      ? `<div class="popover-groups">
           <span class="hint">加入自建分组：</span>
           ${allGroups
             .map(
               (g) =>
                 `<button type="button" class="chip ${inTheseGroups.has(g.id) ? 'chip-on' : ''}" data-togglegroup="${escapeHtml(g.id)}" data-word="${escapeHtml(data.word)}" title="${inTheseGroups.has(g.id) ? '点击移出该分组' : '点击加入该分组'}">${inTheseGroups.has(g.id) ? '✓ ' : '+ '}${escapeHtml(g.name)}</button>`
             )
             .join('')}
           <button type="button" class="chip chip-new" data-newgroup="${escapeHtml(data.word)}">＋ 新建分组</button>
         </div>`
      : `<div class="popover-groups"><button type="button" class="chip chip-new" data-newgroup="${escapeHtml(data.word)}">＋ 新建分组并加入</button></div>`;

    this.el.innerHTML = `
      <div class="popover-head">
        <div style="min-width:0">
          <div class="popover-word">${escapeHtml(data.word)}</div>
          ${data.phonetic ? `<div class="popover-phonetic">${escapeHtml(data.phonetic)}</div>` : ''}
        </div>
        <span class="source-tag">${sourceLabel}</span>
        <button class="btn btn-ghost btn-sm" data-close title="关闭" aria-label="关闭">✕</button>
      </div>
      ${
        data.found
          ? `<div class="popover-zh">${escapeHtml(zh)}</div>
             ${inArticle ? `<div class="hint">已在本篇生词中</div>` : ''}`
          : `<div class="popover-zh muted">本地词库未收录这个词。</div>
             <div class="hint">可以到 <a href="${escapeHtml(data.externalUrl || '#')}" target="_blank" rel="noreferrer">在线词典</a> 查看，或直接记进生词本。</div>`
      }
      <div class="popover-actions">
        <button class="btn btn-sm btn-primary" data-speak="${escapeHtml(data.word)}">🔊 发音</button>
        ${
          inArticle
            ? `<button class="btn btn-sm" disabled>已加入本篇生词</button>
               <button class="btn btn-sm btn-danger" data-remove="${escapeHtml(data.word)}">从本篇移除</button>`
            : `<button class="btn btn-sm" data-add="${escapeHtml(data.word)}">加入本篇生词</button>`
        }
      </div>
      ${groupChips}
      <div class="hint" data-msg style="margin-top:6px"></div>
    `;
    this.position(anchor);
  }

  close(): void {
    this.el.hidden = true;
    this.onClose?.();
  }

  flash(text: string): void {
    const msg = this.el.querySelector<HTMLElement>('[data-msg]');
    if (msg) msg.textContent = text;
  }

  /** 让浮层贴着单词显示，并保证不超出视口 */
  position(anchor: HTMLElement): void {
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(340, document.documentElement.clientWidth - 16);
    this.el.style.width = '';
    this.el.style.maxWidth = width + 'px';
    const popH = this.el.offsetHeight;
    const popW = Math.min(this.el.offsetWidth, width);
    let left = rect.left + window.scrollX + rect.width / 2 - popW / 2;
    left = Math.max(8, Math.min(left, window.scrollX + document.documentElement.clientWidth - popW - 8));
    const below = rect.bottom + 8;
    const above = rect.top - popH - 8 + window.scrollY;
    const top = below + popH > window.innerHeight && above > window.scrollY ? above : below + window.scrollY;
    this.el.style.left = `${left}px`;
    this.el.style.top = `${Math.max(8, top)}px`;
  }
}
