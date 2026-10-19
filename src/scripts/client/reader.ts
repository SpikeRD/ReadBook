// 阅读页入口：组合「查词 / 浮层 / 高亮侧栏」三个模块，只负责事件绑定与业务流程。

import * as vocab from './vocab-store';
import { speak } from './speech';
import { askText, notify } from './dialog';
import { lookup, getCached, type LookupResponse } from './reader/lookup';
import { WordPopover } from './reader/popover';
import { ArticleVocabPanel } from './reader/panel';

interface ReaderMeta {
  articleId: string;
  articleTitle: string;
  speechLang: string;
  autoAdd: boolean;
  highlightLimit: number;
}

const meta = JSON.parse(document.getElementById('reader-meta')!.textContent || '{}') as ReaderMeta;
const container = document.getElementById('reader') as HTMLElement;
const popoverEl = document.getElementById('word-popover') as HTMLElement;
const vocabBox = document.getElementById('article-vocab') as HTMLElement;
const statEl = document.getElementById('vocab-stat');

let activeEl: HTMLElement | null = null;
let requestSeq = 0;

const popover = new WordPopover({
  el: popoverEl,
  articleId: meta.articleId,
  onClose: () => {
    activeEl?.classList.remove('active');
    activeEl = null;
  },
});

const panel = new ArticleVocabPanel({
  container,
  articleId: meta.articleId,
  highlightLimit: meta.highlightLimit,
  statEl,
  sidebarEl: vocabBox,
});

function refreshKnown(fresh?: Record<string, boolean>): void {
  panel.refresh(fresh);
}

/** 取当前正文中该词所在段落作为例句 */
function findExampleFor(word: string): string {
  for (const p of container.querySelectorAll('p')) {
    const words = (p.textContent || '').match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || [];
    if (words.some((w) => w.toLowerCase() === word)) return (p.textContent || '').trim().slice(0, 220);
  }
  return '';
}

function addToArticle(word: string): void {
  const data = getCached(word);
  vocab.add({
    word,
    translation: data?.translation || '（未收录）',
    phonetic: data?.phonetic || '',
    definition: data?.definition || '',
    source: data?.source,
    articleId: meta.articleId,
    articleTitle: meta.articleTitle,
    example: findExampleFor(word),
  });
  refreshKnown({ [word]: true });
}

function renderFor(word: string): void {
  const data = getCached(word);
  if (!data || !activeEl) return;
  popover.render(activeEl, {
    word,
    phonetic: data.phonetic || '',
    translation: data.translation || '',
    found: !!data.found,
    source: data.source,
    externalUrl: data.externalUrl,
  });
}

/* ───────────── 点词 ───────────── */

async function onWordClick(el: HTMLElement): Promise<void> {
  const word = (el.dataset.w || '').toLowerCase();
  if (!word) return;
  if (activeEl === el && popover.isOpen) {
    popover.close();
    return;
  }
  popover.close();
  activeEl = el;
  el.classList.add('active');
  popover.showLoading(el);

  const seq = ++requestSeq;
  const data: LookupResponse = await lookup(word);
  if (seq !== requestSeq || activeEl !== el) return; // 用户已点别的词

  // 文档要求：点过的词自动进入（当前文章的）生词分组
  if (meta.autoAdd && data.found && !vocab.hasInArticle(meta.articleId, word)) {
    addToArticle(word);
  }
  renderFor(word);
}

/* ───────────── 浮层交互 ───────────── */

popoverEl.addEventListener('click', (event) => {
  const t = event.target as HTMLElement;
  const btn = t.closest('button');
  if (!btn) return;

  if (btn.dataset.close !== undefined) {
    popover.close();
    return;
  }

  if (btn.dataset.speak) {
    const r = speak(btn.dataset.speak, meta.speechLang);
    if (!r.ok) {
      popover.flash(r.message || '');
      if (!popoverEl.querySelector('[data-msg]')) void notify('无法发音', r.message || '当前浏览器不支持语音合成。');
    }
    return;
  }

  if (btn.dataset.add) {
    addToArticle(btn.dataset.add);
    renderFor(btn.dataset.add);
    return;
  }

  if (btn.dataset.remove) {
    vocab.removeFromArticle(meta.articleId, btn.dataset.remove);
    refreshKnown();
    renderFor(btn.dataset.remove);
    return;
  }

  const toggle = btn.dataset.togglegroup;
  if (toggle) {
    const word = btn.dataset.word || '';
    const already = vocab.groupsContaining(word).some((g) => g.id === toggle);
    if (already) {
      vocab.removeFromGroup(toggle, word);
      popover.flash(`已从「${vocab.groupInfo(toggle)?.name || '分组'}」移出`);
    } else {
      const data = getCached(word);
      vocab.add({
        word,
        translation: data?.translation || '（未收录）',
        phonetic: data?.phonetic || '',
        source: data?.source,
        tag: toggle,
        example: findExampleFor(word),
      });
      popover.flash(`已加入「${vocab.groupInfo(toggle)?.name || '分组'}」`);
    }
    renderFor(word);
    return;
  }

  const newGroupWord = btn.dataset.newgroup;
  if (newGroupWord) {
    void createGroupAndAdd(newGroupWord);
  }
});

async function createGroupAndAdd(word: string): Promise<void> {
  const name = await askText(
    '新建分组',
    '',
    `把「${word}」加进这个分组；以后点词时也能直接加入。`,
    '例如：雅思核心、生僻词、工作邮件'
  );
  if (!name) return;
  let group = vocab.createGroup(name);
  if (!group) {
    group = vocab.listGroups().find((g) => g.name === name) ?? null;
    if (!group) {
      popover.flash('创建失败：名称为空或重复');
      return;
    }
  }
  const data = getCached(word);
  vocab.add({
    word,
    translation: data?.translation || '（未收录）',
    phonetic: data?.phonetic || '',
    source: data?.source,
    tag: group.id,
    example: findExampleFor(word),
  });
  popover.flash(`已加入分组「${group.name}」`);
  renderFor(word);
}

/* ───────────── 正文与侧栏 ───────────── */

container.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('.word');
  if (target) {
    event.preventDefault();
    void onWordClick(target);
  }
});

vocabBox.addEventListener('click', (event) => {
  const t = event.target as HTMLElement;
  const speakBtn = t.closest<HTMLElement>('[data-speak]');
  if (speakBtn?.dataset.speak) {
    speak(speakBtn.dataset.speak, meta.speechLang);
    return;
  }
  const focus = t.closest<HTMLElement>('[data-focus]');
  if (focus?.dataset.focus) {
    event.preventDefault();
    const el = panel.findWordElement(focus.dataset.focus);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      void onWordClick(el);
    }
  }
});

document.addEventListener('click', (event) => {
  const t = event.target as HTMLElement;
  if (!popover.isOpen) return;
  if (popoverEl.contains(t) || t.closest('.word')) return;
  popover.close();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') popover.close();
});

window.addEventListener('resize', () => {
  if (activeEl && popover.isOpen) popover.position(activeEl);
});

// 阅读页启动：先从服务器同步当前账号的生词本（含旧本地数据迁移），再渲染
void (async () => {
  vocabBox.innerHTML = '<div class="muted small">正在同步生词本…</div>';
  await vocab.ensureLoaded();
  refreshKnown();
})();
