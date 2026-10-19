// 生词本页面逻辑：分组标签、词条操作、导入导出、迁移说明。
// 数据来自服务器（见 vocab-store），这里只负责界面。

import * as store from './vocab-store';
import { speak } from './speech';
import { askText, choose, confirmDelete, notify, showDialog } from './dialog';
import { escapeHtml as esc } from './reader/html';

export function initVocabularyPage(): void {
  const listEl = document.getElementById('vocab-list');
  const tabsEl = document.getElementById('group-tabs');
  const totalEl = document.getElementById('vocab-total');
  const msgEl = document.getElementById('vocab-msg');
  const searchEl = document.getElementById('search') as HTMLInputElement | null;
  const hideMasteredEl = document.getElementById('hide-mastered') as HTMLInputElement | null;
  if (!listEl || !tabsEl || !totalEl || !msgEl || !searchEl || !hideMasteredEl) return;

  const articleTitles = JSON.parse(
    (document.getElementById('vocab-article-titles') as HTMLScriptElement | null)?.textContent || '{}'
  ) as Record<string, string>;

  /** 当前选中的分组：'all' | 'article:<id>' | 'tag:<id>' */
  let activeKey = 'all';

  function message(text: string, kind: 'ok' | 'error' = 'ok'): void {
    msgEl!.innerHTML = `<div class="alert alert-${kind}">${esc(text)}</div>`;
    if (kind === 'ok') setTimeout(() => (msgEl!.innerHTML = ''), 4000);
  }

  function allGroups() {
    return store.listAllGroups({ includeEmptyTags: true, articleTitles });
  }

  /* ── 渲染 ── */

  function renderTabs(): void {
    const groups = allGroups();
    const total = store.count();
    if (activeKey !== 'all' && !groups.some((g) => g.key === activeKey)) activeKey = 'all';

    const tab = (key: string, label: string, count: number, kind: 'all' | 'article' | 'tag') =>
      `<button type="button" role="tab" class="group-tab group-tab-${kind} ${activeKey === key ? 'active' : ''}" data-key="${esc(key)}" data-kind="${kind}" aria-selected="${activeKey === key}">
         <span class="group-tab-name">${esc(label)}</span>
         <span class="group-tab-count">${count}</span>
       </button>`;

    const articles = groups.filter((g) => g.kind === 'article');
    const tags = groups.filter((g) => g.kind === 'tag');
    tabsEl!.innerHTML = [
      tab('all', '全部', total, 'all'),
      ...articles.map((g) => tab(g.key, g.title, g.words.length, 'article')),
      ...tags.map((g) => tab(g.key, g.title, g.words.length, 'tag')),
    ].join('');
  }

  function currentEntries(): store.VocabEntry[] {
    if (activeKey === 'all') return store.loadAll();
    const g = allGroups().find((x) => x.key === activeKey);
    return g ? g.words : [];
  }

  function currentGroupKind(): 'all' | 'article' | 'tag' {
    if (activeKey.startsWith('article:')) return 'article';
    if (activeKey.startsWith('tag:')) return 'tag';
    return 'all';
  }

  function renderItem(e: store.VocabEntry): string {
    return `
      <div class="vocab-item ${e.mastered ? 'done' : ''}" data-id="${esc(e.id)}" data-word="${esc(e.word)}">
        <div style="flex:1; min-width:0">
          <div class="row" style="gap:8px">
            <span class="vocab-word">${esc(e.word)}</span>
            ${e.phonetic ? `<span class="muted small">${esc(e.phonetic)}</span>` : ''}
            ${e.source === 'none' ? '<span class="badge" style="background:#fdecec;color:#a12b2b">未收录</span>' : ''}
            ${e.tag ? '<span class="badge">自建分组</span>' : ''}
          </div>
          <div class="vocab-zh">${esc(e.translation || '（无释义）')}</div>
          ${e.example ? `<div class="vocab-example">${esc(e.example)}</div>` : ''}
          <div class="meta" style="margin-top:4px">
            ${e.articleId ? `<span>来自：${esc(e.articleTitle || '未命名文章')}</span>` : ''}
          </div>
        </div>
        <div class="row" style="gap:4px; flex:none">
          <button class="btn btn-sm btn-ghost" data-act="speak" title="发音">🔊</button>
          <button class="btn btn-sm" data-act="master">${e.mastered ? '取消掌握' : '已掌握'}</button>
          <button class="btn btn-sm btn-ghost" data-act="move" title="移到其他分组">移动</button>
          <button class="btn btn-sm btn-danger" data-act="delete" title="删除">删除</button>
        </div>
      </div>`;
  }

  function matches(e: store.VocabEntry, q: string, hide: boolean): boolean {
    if (hide && e.mastered) return false;
    if (!q) return true;
    return e.word.includes(q) || e.translation.toLowerCase().includes(q);
  }

  function renderList(): void {
    const q = searchEl!.value.trim().toLowerCase();
    const hide = hideMasteredEl!.checked;
    const all = currentEntries();
    const filtered = all.filter((e) => matches(e, q, hide));

    if (filtered.length === 0) {
      const emptyAll = store.count() === 0;
      const kind = currentGroupKind();
      listEl!.innerHTML = `<div class="card empty">
        <p>${emptyAll ? '生词本还是空的。' : all.length === 0 ? '这个分组里还没有生词。' : '没有符合条件的词。'}</p>
        <p class="small">${
          emptyAll
            ? '去阅读页点几个单词，它们会自动进入对应文章的分组。'
            : all.length === 0
              ? kind === 'tag'
                ? '在阅读页点词时，点浮层里的分组标签即可把词加进来；或用每张卡片的「移动」按钮。'
                : '去这篇文章里点几个单词即可。'
              : '换个关键词或取消「隐藏已掌握」试试。'
        }</p>
        ${emptyAll ? '<a class="btn btn-primary" href="/">去阅读</a>' : ''}
      </div>`;
      return;
    }

    const kind = currentGroupKind();
    const head = (title: string, extra = '') =>
      `<div class="row" style="justify-content:space-between; margin-bottom:6px">
         <strong style="overflow-wrap:anywhere">${esc(title)}</strong>
         <span class="row" style="gap:8px; flex:none">
           <span class="muted small">${extra}</span>
           ${
             kind === 'tag'
               ? `<button class="btn btn-sm btn-ghost" data-group-act="rename" title="重命名分组">改名</button>
                  <button class="btn btn-sm btn-danger" data-group-act="delete" title="删除分组">删除分组</button>`
               : ''
           }
         </span>
       </div>`;

    const groups = allGroups();
    if (activeKey === 'all') {
      // 全部视图：按分组分段展示，避免不同文章的单词混在一起
      listEl!.innerHTML = groups
        .filter((g) => g.words.length > 0)
        .map(
          (g) => `<section class="card">
            ${head(g.title, `${g.words.length} 词`)}
            ${g.words.filter((e) => matches(e, q, hide)).map(renderItem).join('')}
            ${g.kind === 'article' ? `<div><a class="small" href="/read/${encodeURIComponent(g.id)}">打开文章 →</a></div>` : ''}
          </section>`
        )
        .join('');
      return;
    }

    const g = groups.find((x) => x.key === activeKey)!;
    listEl!.innerHTML = `<section class="card">
      ${head(g.title, `${filtered.length} / ${all.length} 词`)}
      ${filtered.map(renderItem).join('')}
      ${g.kind === 'article' ? `<div style="margin-top:8px"><a class="small" href="/read/${encodeURIComponent(g.id)}">打开文章 →</a></div>` : ''}
    </section>`;
  }

  function render(): void {
    renderTabs();
    renderList();
    totalEl!.textContent = store.count()
      ? `共 ${store.count()} 个词条，${allGroups().filter((g) => g.words.length).length} 个有词的分组。`
      : '';
  }

  /* ── 分组标签切换 ── */
  tabsEl.addEventListener('click', (event) => {
    const tab = (event.target as HTMLElement).closest<HTMLElement>('.group-tab');
    if (!tab?.dataset.key) return;
    activeKey = tab.dataset.key;
    render();
  });

  /* ── 词条与分组操作 ── */
  listEl.addEventListener('click', (event) => {
    const t = event.target as HTMLElement;

    const groupBtn = t.closest<HTMLElement>('[data-group-act]');
    if (groupBtn && activeKey.startsWith('tag:')) {
      void handleGroupAction(activeKey.slice(5), groupBtn.dataset.groupAct || '');
      return;
    }

    const btn = t.closest<HTMLElement>('[data-act]');
    const item = t.closest<HTMLElement>('.vocab-item');
    if (!btn || !item) return;
    const id = item.dataset.id || '';
    const word = item.dataset.word || '';
    const act = btn.dataset.act;

    if (act === 'speak') speak(word, 'en-US');
    if (act === 'master') {
      store.toggleMastered(id);
      render();
    }
    if (act === 'delete') {
      void (async () => {
        const ok = await confirmDelete('删除生词', `确定删除「${word}」？`, '删除');
        if (!ok) return;
        store.removeEntry(id);
        message(`已删除 ${word}`);
        render();
      })();
    }
    if (act === 'move') void moveEntry(id);
  });

  async function handleGroupAction(groupId: string, action: string): Promise<void> {
    if (action === 'rename') {
      const name = await askText('重命名分组', store.groupInfo(groupId)?.name || '', '', '新的分组名称');
      if (name && store.renameGroup(groupId, name)) {
        message('分组已重命名');
        render();
      }
      return;
    }
    if (action === 'delete') {
      const words = store.wordsOfGroup(groupId).length;
      const ok = await confirmDelete('删除这个分组？', `组内 ${words} 个生词会一起删除，且不可恢复。`, '删除分组');
      if (ok) {
        store.deleteGroup(groupId);
        activeKey = 'all';
        message('分组已删除');
        render();
      }
    }
  }

  /** 把词条移动到另一个分组（下拉选择 + 可选新建） */
  async function moveEntry(id: string): Promise<void> {
    const entry = store.loadAll().find((e) => e.id === id);
    if (!entry) return;
    const currentKey = entry.tag ? `tag:${entry.tag}` : `article:${entry.articleId}`;
    const targets = allGroups().filter((g) => g.key !== currentKey);
    const picked = await choose(
      '移动到哪个分组？',
      `「${entry.word}」当前在「${entry.tag ? store.groupInfo(entry.tag)?.name : entry.articleTitle || '文章'}」。`,
      [
        ...targets.map((g) => ({
          value: g.key,
          label: `${g.kind === 'tag' ? '自建分组' : '文章'}：${g.title}（${g.words.length} 词）`,
        })),
        { value: '__new__', label: '＋ 新建分组并移动…' },
      ],
      '移动'
    );
    if (!picked) return;

    let target = targets.find((g) => g.key === picked);
    if (picked === '__new__') {
      const name = await askText('新建分组', '', '移动后会从原分组移除', '例如：雅思核心、生僻词');
      if (!name) return;
      const created = store.createGroup(name);
      if (!created) {
        await notify('无法创建分组', '分组名称重复或为空。');
        return;
      }
      target = { key: `tag:${created.id}`, kind: 'tag', id: created.id, title: created.name, words: [], createdAt: created.createdAt };
    }
    if (!target) return;

    const snapshot = { ...entry };
    store.removeEntry(id);
    store.add({
      word: snapshot.word,
      translation: snapshot.translation,
      phonetic: snapshot.phonetic,
      definition: snapshot.definition,
      source: snapshot.source,
      example: snapshot.example,
      ...(target.kind === 'tag' ? { tag: target.id } : { articleId: target.id, articleTitle: target.title }),
    });
    message(`已移动到「${target.title}」`);
    render();
  }

  /* ── 新建分组 ── */
  document.getElementById('new-group-btn')?.addEventListener('click', () => {
    void (async () => {
      const name = await askText(
        '新建分组',
        '',
        '在阅读页点词时，浮层里会直接出现这个分组，点一下即可加入。',
        '例如：雅思核心、生僻词、工作邮件'
      );
      if (!name) return;
      const g = store.createGroup(name);
      if (!g) {
        await notify('创建失败', '分组名称重复或为空。');
        return;
      }
      activeKey = `tag:${g.id}`;
      message(`已创建分组「${g.name}」，在阅读页点词时即可加入`);
      render();
    })();
  });

  searchEl.addEventListener('input', render);
  hideMasteredEl.addEventListener('change', render);

  /* ── 导出 / 导入 ── */
  function doExport(): void {
    if (store.count() === 0) {
      message('生词本是空的，没有可导出的内容。', 'error');
      return;
    }
    store.downloadExport();
    message(`已导出 ${store.count()} 个词条（含 ${store.listGroups().length} 个自建分组）。`);
  }

  const fileInput = document.getElementById('import-file') as HTMLInputElement | null;
  document.getElementById('export-btn')?.addEventListener('click', doExport);
  document.getElementById('export-btn-2')?.addEventListener('click', doExport);
  document.getElementById('import-btn')?.addEventListener('click', () => fileInput?.click());
  document.getElementById('import-btn-2')?.addEventListener('click', () => fileInput?.click());

  fileInput?.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      const mode = await choose(
        '如何导入？',
        `文件：${f.name}\n当前生词本已有 ${store.count()} 个词条。\n\n合并：保留现有生词，只补新词（推荐）\n替换：先清空当前账号的生词再导入`,
        [
          { value: 'merge', label: '合并导入（保留现有生词）' },
          { value: 'replace', label: '替换（先清空现有生词）' },
        ],
        '开始导入'
      );
      if (!mode) return;
      if (mode === 'replace') {
        store.replaceAll(JSON.parse(text));
        message('已替换为文件中的生词。');
      } else {
        const result = await store.importJson(text);
        message(`导入完成：新增 ${result.added} 个，跳过重复 ${result.skipped} 个。`);
      }
      render();
    } catch (err) {
      message(`导入失败：${(err as Error).message}`, 'error');
    } finally {
      fileInput.value = '';
    }
  });

  document.getElementById('clear-btn')?.addEventListener('click', () => {
    void (async () => {
      const ok = await showDialog({
        kind: 'confirm',
        title: '清空全部生词？',
        message: `将删除 ${store.count()} 个词条。自建分组本身会保留，但组内单词会被删除，且不可恢复。建议先导出 JSON 备份。`,
        okText: '清空',
        danger: true,
      });
      if (!ok.ok) return;
      store.clearAll();
      activeKey = 'all';
      message('已清空全部生词。');
      render();
    })();
  });

  // 启动：先同步服务器数据，再渲染
  void (async () => {
    listEl.innerHTML = '<div class="card empty">正在同步你的生词本…</div>';
    await store.ensureLoaded();
    if (!store.isServerAvailable()) {
      message('暂时无法同步生词本，修改可能不会保存到账号。请检查网络后刷新。', 'error');
    }
    render();
  })();
}
