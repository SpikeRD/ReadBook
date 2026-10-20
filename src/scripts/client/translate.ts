// 阅读页全文翻译：按「当前页 + 后续 4 页」批量翻译，读到第 3 页时自动续翻后面 5 页。
//
// 四种显示方式（选择记忆在本机，翻页不重置）：
//   columns —— 两栏对照：左原文右译文，字号自动略小（默认）
//   both    —— 上下对照
//   zh      —— 只看译文
//   en      —— 只看原文
//
// 译文在服务端按「段」增量缓存：已翻译的段落随页面渲染出来，刷新 / 翻页都不会丢。
// 失败自动重试（指数退避）在服务端完成；前端只显示结果。

interface TranslateResponse {
  ok: boolean;
  provider?: string;
  providerLabel?: string;
  cached?: boolean;
  failed?: number;
  message?: string;
  error?: string;
  units?: { index: number; target: string; error?: string }[];
  prefetched?: { page: number; units: number; failed: number }[];
}

interface PageUnit {
  index: number;
  text: string;
}

interface ReaderMetaForTranslate {
  articleId: string;
  currentPage: number;
  totalPages: number;
  hasCachedTranslation?: boolean;
  pageUnits?: PageUnit[];
  allPageUnits?: { page: number; units: PageUnit[] }[];
  prefetchPages?: number;
  prefetchTriggerPage?: number;
  translation: { enabled: boolean; label: string; disclaimer: string };
}

type Mode = 'columns' | 'both' | 'zh' | 'en';
const MODE_KEY = 'readbook.reader.translateMode.v2';
const ACTIVE_KEY = 'readbook.reader.translateActive';
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
  const originalBlocks = [...blocks];
  let busy = false;

  // 所有页的原文（服务端直出），用于预翻译
  const allPages = new Map<number, PageUnit[]>(
    (meta.allPageUnits || []).map((p) => [p.page, p.units])
  );
  const totalPages = meta.totalPages;
  const batchSize = Math.max(1, meta.prefetchPages || 5);
  const triggerPage = Math.max(2, meta.prefetchTriggerPage || 3);

  // 已翻译页集合：从服务端渲染结果 + 本会话请求结果累积
  const translatedPages = new Set<number>();
  if (meta.hasCachedTranslation) translatedPages.add(meta.currentPage);
  // 有缓存的其它页无法从本页 DOM 得知，交给服务端（翻译时按段命中缓存，成本极低）

  const stored = localStorage.getItem(MODE_KEY) as Mode | null;
  let mode: Mode = stored && VALID_MODES.includes(stored) ? stored : 'columns';
  let translated = translatedPages.size > 0;

  function setStatus(text: string, tone: 'muted' | 'ok' | 'error' = 'muted'): void {
    statusEl.textContent = text;
    statusEl.style.color = tone === 'error' ? '#a12b2b' : tone === 'ok' ? '#1f6b42' : '';
  }

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

  /** 按当前模式排布 DOM */
  function applyMode(next: Mode, persist = true): void {
    mode = next;
    if (persist) localStorage.setItem(MODE_KEY, mode);
    for (const b of bar!.querySelectorAll<HTMLButtonElement>('.seg-btn')) {
      b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    }

    const article = reader!;
    const showZh = translated && mode !== 'en';
    const showEn = mode !== 'zh';

    // 两栏：每段生成一个「行带」（英文格 + 中文格）。
    // 由 .reader-columns 的两列网格保证：同一段英文与中文的首行在同一条水平线上，末行也齐平。
    if (mode === 'columns' && translated) {
      const wrap = document.createElement('div');
      wrap.className = 'reader-columns';
      for (const block of blocks) {
        const en = block.querySelector<HTMLElement>('p, h2');
        if (!en) continue;
        const zh = block.querySelector<HTMLElement>('.zh-block');
        const row = document.createElement('div');
        row.className = 'rc-row';
        row.dataset.type = block.dataset.type || 'paragraph';

        const enCell = document.createElement('div');
        enCell.className = 'rc-cell rc-en';
        const enClone = en.cloneNode(true) as HTMLElement;
        enClone.classList.add('col-block');
        enClone.hidden = false;
        enCell.appendChild(enClone);

        const zhCell = document.createElement('div');
        zhCell.className = 'rc-cell rc-zh';
        const zhClone = document.createElement('div');
        zhClone.className = `col-block zh-block${block.dataset.type === 'heading' ? ' zh-heading' : ''}`;
        zhClone.textContent = (zh?.textContent || '').trim();
        zhCell.appendChild(zhClone);

        row.append(enCell, zhCell);
        wrap.appendChild(row);
      }
      article.replaceChildren(wrap);
      article.classList.add('mode-columns');
      article.classList.remove('mode-both');
      return;
    }

    // 其他模式：恢复原始块
    article.classList.remove('mode-columns');
    article.classList.toggle('mode-both', mode === 'both');
    if (article.querySelector('.reader-columns')) article.replaceChildren(...originalBlocks);
    for (const block of originalBlocks) {
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
  }

  /** 组装某页的翻译请求块 */
  function unitsForPage(page: number): { page: number; units: PageUnit[] } | null {
    const units = allPages.get(page);
    if (!units || units.length === 0) return null;
    return { page, units };
  }

  /** 翻译「从 fromPage 开始的 batchSize 页」；返回是否发起了请求 */
  async function translateBatch(fromPage: number, refresh = false): Promise<boolean> {
    if (busy) return false;
    const pagesToFetch: { page: number; units: PageUnit[] }[] = [];
    for (let p = fromPage; p <= totalPages && pagesToFetch.length < batchSize; p++) {
      const unit = unitsForPage(p);
      if (unit && !translatedPages.has(p)) pagesToFetch.push(unit);
    }
    if (pagesToFetch.length === 0) return false;

    busy = true;
    btn!.disabled = true;
    if (retryBtn) retryBtn.disabled = true;
    const isCurrent = pagesToFetch[0].page === meta.currentPage;
    setStatus(
      pagesToFetch.length > 1
        ? `正在翻译第 ${pagesToFetch[0].page}–${pagesToFetch[pagesToFetch.length - 1].page} 页（共 ${pagesToFetch.length} 页）…`
        : '正在翻译本页…'
    );

    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: meta.articleId,
          page: pagesToFetch[0].page,
          totalPages,
          refresh,
          blocks: pagesToFetch[0].units,
          prefetch: pagesToFetch.slice(1).map((p) => ({ page: p.page, blocks: p.units })),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as TranslateResponse;
      if (!res.ok || data.error) {
        setStatus(data.error || `翻译失败（HTTP ${res.status}）`, 'error');
        if (retryBtn) retryBtn.hidden = false;
        return true;
      }

      pagesToFetch.forEach((p) => translatedPages.add(p.page));
      translated = true;

      // 当前页有译文就写进 DOM 并应用当前模式
      if (pagesToFetch[0].page === meta.currentPage) fill(data.units || []);
      applyMode(mode === 'en' && translated ? 'columns' : mode, false);
      localStorage.setItem(MODE_KEY, mode);

      const pre = data.prefetched || [];
      const preOk = pre.reduce((s, p) => s + p.units, 0);
      const preFail = pre.reduce((s, p) => s + p.failed, 0);
      if ((data.failed ?? 0) > 0) {
        setStatus(data.message || `${data.failed} 段未能翻译`, 'error');
        if (retryBtn) retryBtn.hidden = false;
      } else if (isCurrent) {
        setStatus(
          `${data.providerLabel || ''} · 本页 ${data.units?.length ?? 0} 段${data.cached ? '（缓存）' : ''} + 后续 ${preOk} 段已就绪${
            preFail ? `（${preFail} 段待重试）` : ''
          } · 已保存到账号`,
          'ok'
        );
      } else {
        setStatus(`后台已翻译第 ${pagesToFetch[0].page}–${pagesToFetch[pagesToFetch.length - 1].page} 页`, 'ok');
      }
      return true;
    } catch {
      setStatus('网络错误，翻译失败。请检查网络后重试。', 'error');
      if (retryBtn) retryBtn.hidden = false;
      return true;
    } finally {
      busy = false;
      btn!.disabled = false;
      if (retryBtn) retryBtn.disabled = false;
    }
  }

  /**
   * 预取调度：
   *   - 已开启翻译（会话内）时，若当前页已处于「已翻译区间」的第 triggerPage 页，
   *     自动续翻后面 batchSize 页；
   *   - 若当前页完全没翻译过但翻译已激活，也会自动翻译。
   */
  function maybePrefetch(): void {
    if (!sessionStorage.getItem(ACTIVE_KEY)) return;
    if (busy) return;
    if (translatedPages.has(meta.currentPage)) {
      // 找已翻译的最大连续区间端点
      let end = meta.currentPage;
      while (translatedPages.has(end + 1)) end++;
      if (meta.currentPage >= end - (triggerPage - 1)) {
        void translateBatch(end + 1);
      }
    } else {
      void translateBatch(meta.currentPage);
    }
  }

  btn.addEventListener('click', () => {
    bar!.hidden = false;
    sessionStorage.setItem(ACTIVE_KEY, '1');
    if (translated) {
      // 已有译文：按钮在「译文 ↔ 原文」之间切换
      applyMode(mode === 'en' ? 'columns' : 'en');
      return;
    }
    sessionStorage.setItem(ACTIVE_KEY, '1');
    void translateBatch(meta.currentPage);
  });

  retryBtn?.addEventListener('click', () => {
    void translateBatch(meta.currentPage, true);
  });

  bar.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>('.seg-btn');
    if (!target?.dataset.mode) return;
    applyMode(target.dataset.mode as Mode);
  });

  // 首屏：
  //   1. 应用用户上次选择的显示方式（不写入，等用户操作再持久化）
  //   2. 本页已有缓存译文 → 直接展示
  //   3. 若翻译已激活（本会话点过「全文翻译」）→ 自动翻译本页起 batchSize 页，
  //      并在读到第 triggerPage 页时自动续翻后面一批（见 maybePrefetch）
  applyMode(mode, false);
  if (translated) {
    bar.hidden = false;
    setStatus('本页译文已从账号中载入（翻页/刷新不会丢）', 'ok');
    if (retryBtn) retryBtn.hidden = false;
  }
  if (sessionStorage.getItem(ACTIVE_KEY)) {
    bar.hidden = false;
    void maybePrefetch();
  }
}
