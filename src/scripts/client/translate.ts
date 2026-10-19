// 阅读页全文翻译：按「本页」请求 /api/translate，译文增量保存到账号。
//
// 四种显示方式（选择记忆在本机）：
//   columns —— 两栏对照：左栏原文、右栏译文，字号自动略小
//   both    —— 上下对照：每段英文下紧跟中文
//   zh      —— 只看译文
//   en      —— 只看原文
//
// 译文在服务端已缓存的部分会随页面一起渲染出来，刷新 / 翻页不会消失。

interface TranslateResponse {
  ok: boolean;
  provider?: string;
  providerLabel?: string;
  cached?: boolean;
  failed?: number;
  message?: string;
  error?: string;
  units?: { index: number; target: string; error?: string }[];
}

interface ReaderMetaForTranslate {
  articleId: string;
  currentPage: number;
  totalPages: number;
  hasCachedTranslation?: boolean;
  /** 本页原文（服务端直出） */
  pageUnits?: { index: number; text: string }[];
  translation: { enabled: boolean; label: string; disclaimer: string; compareFontScale?: number };
}

type Mode = 'columns' | 'both' | 'zh' | 'en';
const MODE_KEY = 'readbook.reader.translateMode.v2';
const VALID_MODES: Mode[] = ['columns', 'both', 'zh', 'en'];

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

export function initTranslate(): void {
  const metaEl = byId<HTMLScriptElement>('reader-meta');
  if (!metaEl) return;
  const meta = JSON.parse(metaEl.textContent || '{}') as ReaderMetaForTranslate;
  if (!meta.translation?.enabled) return;

  const btn = byId<HTMLButtonElement>('translate-btn');
  const bar = byId<HTMLElement>('translate-bar');
  const statusBox = byId<HTMLElement>('translate-status');
  const retryBtn = byId<HTMLButtonElement>('translate-retry');
  const reader = byId<HTMLElement>('reader');
  if (!btn || !bar || !statusBox || !reader) return;
  const statusEl: HTMLElement = statusBox;

  btn.hidden = false;
  const blocks = Array.from(reader.querySelectorAll<HTMLElement>('.reader-block'));
  let busy = false;
  const stored = localStorage.getItem(MODE_KEY) as Mode | null;
  let mode: Mode = stored && VALID_MODES.includes(stored) ? stored : 'columns';
  // 首屏是否已经有译文（服务端渲染进来了）
  let translated = blocks.some((b) => b.querySelector<HTMLElement>('.zh-block')?.dataset.hasCache === '1');

  function setStatus(text: string, tone: 'muted' | 'ok' | 'error' = 'muted'): void {
    statusEl.textContent = text;
    statusEl.style.color = tone === 'error' ? '#a12b2b' : tone === 'ok' ? '#1f6b42' : '';
  }

  /** 把译文写进每个块的 .zh-block */
  function fill(units: { index: number; target: string; error?: string }[]): { ok: number; failed: number } {
    const map = new Map(units.map((u) => [u.index, u]));
    let ok = 0;
    let failed = 0;
    for (const block of blocks) {
      const index = Number(block.dataset.block);
      const zh = block.querySelector<HTMLElement>('.zh-block');
      if (!zh) continue;
      const item = map.get(index);
      if (item?.target) {
        zh.textContent = item.target;
        zh.dataset.hasCache = '1';
        zh.classList.remove('is-empty', 'zh-error');
        ok++;
      } else if (item?.error) {
        zh.textContent = `（本段翻译失败：${item.error}）`;
        zh.dataset.hasCache = '0';
        zh.classList.add('zh-error');
        failed++;
      }
    }
    return { ok, failed };
  }

  /** 按当前模式排布 DOM：两栏 / 上下 / 单语 */
  function applyMode(next: Mode): void {
    mode = next;
    localStorage.setItem(MODE_KEY, mode);
    for (const b of bar!.querySelectorAll<HTMLButtonElement>('.seg-btn')) {
      b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    }

    const article = reader!;
    const showZh = translated && mode !== 'en';
    const showEn = mode !== 'zh';

    // 两栏：用克隆节点重建左（英）右（中）两列，原始块隐藏
    if (mode === 'columns' && translated) {
      const left = document.createElement('div');
      left.className = 'col col-en';
      const right = document.createElement('div');
      right.className = 'col col-zh';
      for (const block of blocks) {
        const en = block.querySelector<HTMLElement>('p, h2');
        const zh = block.querySelector<HTMLElement>('.zh-block');
        if (en) {
          const clone = en.cloneNode(true) as HTMLElement;
          clone.classList.add('col-block');
          clone.hidden = false;
          left.appendChild(clone);
        }
        if (zh) {
          const text = (zh.textContent || '').trim();
          const clone = document.createElement('div');
          clone.className = `col-block zh-block${block.dataset.type === 'heading' ? ' zh-heading' : ''}${text ? '' : ' is-empty'}`;
          clone.textContent = text;
          right.appendChild(clone);
        }
      }
      const wrap = document.createElement('div');
      wrap.className = 'reader-columns';
      wrap.append(left, right);
      article.replaceChildren(wrap);
      article.classList.add('mode-columns');
      article.classList.remove('mode-both');
      // 原始块移出 DOM 后，点词高亮等仍以它们为准，这里只隐藏不可见
      return;
    }

    // 其他模式：恢复原始块
    article.classList.remove('mode-columns');
    article.classList.toggle('mode-both', mode === 'both');
    if (article.querySelector('.reader-columns')) article.replaceChildren(...blocks);
    for (const block of blocks) {
      block.hidden = false;
      const en = block.querySelector<HTMLElement>('p, h2');
      const zh = block.querySelector<HTMLElement>('.zh-block');
      if (en) en.hidden = !showEn;
      if (zh) {
        const hasText = (zh.textContent || '').trim().length > 0;
        zh.hidden = !showZh || !hasText;
        zh.classList.toggle('is-empty', !hasText);
      }
    }
    if (mode === 'zh' && !translated) {
      setStatus('本页还没有译文，点「' + meta.translation.label + '」开始翻译。');
    }
  }

  async function request(refresh: boolean): Promise<void> {
    if (busy) return;
    busy = true;
    btn!.disabled = true;
    if (retryBtn) retryBtn.disabled = true;
    setStatus(refresh ? '正在重新翻译本页…' : '正在翻译本页（已翻译的段落会直接复用）…');
    const started = Date.now();
    try {
      // 原文直接来自服务端渲染的 meta，保证与数据库中的文本完全一致
      const unitsToSend =
        meta.pageUnits && meta.pageUnits.length
          ? meta.pageUnits
          : blocks.map((b) => {
              const en = b.querySelector<HTMLElement>('p, h2');
              const raw = en ? en.innerText || '' : '';
              return { index: Number(b.dataset.block), text: raw.replace(/\s+/g, ' ').trim() };
            });
      const payload = {
        id: meta.articleId,
        page: meta.currentPage,
        totalPages: meta.totalPages,
        refresh,
        blocks: unitsToSend,
      };
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as TranslateResponse;
      if (!res.ok || data.error) {
        setStatus(data.error || `翻译失败（HTTP ${res.status}）`, 'error');
        if (retryBtn) retryBtn.hidden = false;
        return;
      }
      const { ok, failed } = fill(data.units || []);
      translated = ok > 0;
      applyMode(mode);
      const provider = data.providerLabel || '';
      if (failed > 0) {
        setStatus(data.message || `${failed} 段未能翻译`, 'error');
        if (retryBtn) retryBtn.hidden = false;
      } else {
        setStatus(
          `${provider} · 本页 ${ok} 段${data.cached ? '（来自缓存）' : '翻译完成'} · 已保存到账号，翻页/刷新不会丢`,
          'ok'
        );
        if (retryBtn) retryBtn.hidden = false;
      }
      console.info(`[translate] ${Date.now() - started}ms`, data.provider, data.cached ? 'cached' : 'fresh');
    } catch {
      setStatus('网络错误，翻译失败。请检查网络后重试。', 'error');
      if (retryBtn) retryBtn.hidden = false;
    } finally {
      busy = false;
      btn!.disabled = false;
      if (retryBtn) retryBtn.disabled = false;
    }
  }

  btn.addEventListener('click', () => {
    bar!.hidden = false;
    if (translated) {
      // 已有译文：按钮在「译文 ↔ 原文」之间切换
      applyMode(mode === 'en' ? 'columns' : 'en');
      return;
    }
    void request(false);
  });

  retryBtn?.addEventListener('click', () => {
    void request(true);
  });

  bar.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>('.seg-btn');
    if (!target?.dataset.mode) return;
    applyMode(target.dataset.mode as Mode);
  });

  // 首屏：服务端已带出译文就直接显示（默认两栏对照）
  if (translated) {
    bar.hidden = false;
    setStatus('本页译文已从账号中载入（翻页/刷新不会丢）', 'ok');
    if (retryBtn) retryBtn.hidden = false;
    applyMode(mode);
  } else {
    applyMode('en');
  }
}
