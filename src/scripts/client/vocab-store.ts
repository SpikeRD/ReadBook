// 生词本数据层：数据存在服务器（按账号隔离），浏览器只做内存缓存。
//
// 数据模型（v2）：每个「词条」属于一个分组，分组之间互不干扰。
//   - 文章分组：articleId = 文章 id
//   - 自建分组：articleId 为 null，tag = 自建分组 id
// 同一个单词可以同时出现在多篇文章和多个自建分组里，各存各的释义 / 例句 / 掌握状态。
//
// 同步策略：
//   1. 页面启动调用 ensureLoaded()：拉取 /api/vocabulary
//   2. 若浏览器里还有旧版本地数据（v1/v2），先提交到 /api/vocabulary/import 合并，再清掉本地键
//   3. 之后每次修改写入内存缓存并异步 PUT 回服务器（串行队列，避免乱序覆盖）
//
// 换设备登录同一账号，看到的就是同一份数据。

export interface VocabEntry {
  id: string;
  word: string;
  translation: string;
  phonetic: string;
  definition?: string;
  source?: string;
  articleId: string | null;
  articleTitle: string;
  tag: string | null;
  example: string;
  createdAt: number;
  mastered: boolean;
  reviewedAt?: number;
}

export interface VocabGroup {
  id: string;
  name: string;
  createdAt: number;
}

export interface VocabExport {
  version: 2;
  exportedAt: string;
  app: string;
  groups: VocabGroup[];
  entries: VocabEntry[];
}

export interface GroupInfo {
  key: string;
  kind: 'article' | 'tag';
  id: string;
  title: string;
  words: VocabEntry[];
  createdAt: number;
}

const LOCAL_V2 = 'readbook.vocabulary.v2';
const LOCAL_GROUPS_V2 = 'readbook.vocab.groups.v2';
const LOCAL_V1 = 'readbook.vocabulary.v1';
const LARGE_WARN = 5000;

let entries: VocabEntry[] = [];
let groups: VocabGroup[] = [];
let loaded = false;
let loading: Promise<void> | null = null;
let saveQueue: Promise<void> = Promise.resolve();
let serverError = false;

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeEntry(raw: any): VocabEntry | null {
  if (!raw || typeof raw !== 'object' || typeof raw.word !== 'string' || !raw.word) return null;
  const articleId = raw.articleId === null || raw.articleId === undefined ? null : String(raw.articleId);
  const tag = raw.tag === null || raw.tag === undefined ? null : String(raw.tag);
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : uid(),
    word: String(raw.word).toLowerCase(),
    translation: String(raw.translation ?? ''),
    phonetic: String(raw.phonetic ?? ''),
    definition: String(raw.definition ?? ''),
    source: raw.source ? String(raw.source) : 'local',
    articleId,
    articleTitle: String(raw.articleTitle ?? (articleId ? '未命名文章' : '')),
    tag,
    example: String(raw.example ?? ''),
    createdAt: Number(raw.createdAt) || Date.now(),
    mastered: Boolean(raw.mastered),
    reviewedAt: raw.reviewedAt ? Number(raw.reviewedAt) : undefined,
  };
}

/* ───────────── 与服务器同步 ───────────── */

async function loadFromServer(): Promise<{ groups: VocabGroup[]; entries: VocabEntry[] }> {
  const res = await fetch('/api/vocabulary', { headers: { accept: 'application/json' } });
  if (res.status === 401) throw new Error('登录已过期，请重新登录');
  if (!res.ok) throw new Error(`读取生词本失败（HTTP ${res.status}）`);
  const data = (await res.json()) as { groups?: unknown[]; entries?: unknown[] };
  return {
    groups: Array.isArray(data.groups)
      ? (data.groups as any[])
          .filter((g) => g && typeof g.id === 'string' && typeof g.name === 'string')
          .map((g) => ({ id: String(g.id), name: String(g.name), createdAt: Number(g.createdAt) || Date.now() }))
      : [],
    entries: (Array.isArray(data.entries) ? data.entries : []).map(normalizeEntry).filter(Boolean) as VocabEntry[],
  };
}

function readLocalLegacy(): unknown | null {
  try {
    const v2 = localStorage.getItem(LOCAL_V2);
    if (v2) {
      const parsed = JSON.parse(v2);
      const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.entries) ? parsed.entries : [];
      const rawGroups = localStorage.getItem(LOCAL_GROUPS_V2);
      let localGroups: VocabGroup[] = [];
      try {
        localGroups = rawGroups ? JSON.parse(rawGroups) : [];
      } catch {
        localGroups = [];
      }
      return { version: 2, groups: localGroups, entries: list };
    }
    const v1 = localStorage.getItem(LOCAL_V1);
    if (v1) {
      const parsed = JSON.parse(v1);
      const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.entries) ? parsed.entries : [];
      // 旧版没有分组：有文章的进文章分组，没有的进「未整理的旧生词」
      const orphanId = uid();
      let orphanUsed = false;
      const migrated = list.map((item: any) => {
        const hasArticle = item && item.articleId && item.articleId !== 'unknown';
        if (!hasArticle) orphanUsed = true;
        return { ...item, articleId: hasArticle ? item.articleId : null, tag: hasArticle ? null : orphanId };
      });
      return {
        version: 2,
        groups: orphanUsed ? [{ id: orphanId, name: '未整理的旧生词', createdAt: Date.now() }] : [],
        entries: migrated,
      };
    }
  } catch {
    return null;
  }
  return null;
}

function clearLocalLegacy(): void {
  try {
    localStorage.removeItem(LOCAL_V2);
    localStorage.removeItem(LOCAL_GROUPS_V2);
    localStorage.removeItem(LOCAL_V1);
  } catch {
    /* 忽略 */
  }
}

/**
 * 首次加载：拉服务器数据 → 迁移浏览器旧数据 → 再拉一次最新结果。
 * 多次调用只会真正请求一次。
 */
export function ensureLoaded(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (loading) return loading;
  loading = (async () => {
    try {
      const fromServer = await loadFromServer();
      groups = fromServer.groups;
      entries = fromServer.entries;

      const legacy = readLocalLegacy();
      const legacyCount =
        legacy && typeof legacy === 'object' && Array.isArray((legacy as any).entries) ? (legacy as any).entries.length : 0;
      if (legacyCount > 0) {
        const res = await fetch('/api/vocabulary/import', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(legacy),
        });
        if (res.ok) {
          clearLocalLegacy();
          const merged = await loadFromServer();
          groups = merged.groups;
          entries = merged.entries;
        }
      }
      serverError = false;
    } catch (err) {
      serverError = true;
      console.warn('[vocab] 载入失败', err);
      // 载入失败时仍允许页面运行（至少展示本会话已有的内容）
    } finally {
      loaded = true;
      loading = null;
    }
  })();
  return loading;
}

export function isServerAvailable(): boolean {
  return !serverError;
}

function scheduleSave(): void {
  const payload = { version: 2, groups, entries };
  saveQueue = saveQueue.then(async () => {
    try {
      const res = await fetch('/api/vocabulary', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      serverError = !res.ok;
      if (entries.length > LARGE_WARN) console.info('[vocab] 词条数较多：', entries.length);
    } catch (err) {
      serverError = true;
      console.warn('[vocab] 保存失败', err);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('readbook:storage-error', {
            detail: { message: '生词本同步到服务器失败，请检查网络后重试（本地修改仍在内存中）。' },
          })
        );
      }
    }
  });
  return void saveQueue;
}

/* ───────────── 读 ───────────── */

export function loadAll(): VocabEntry[] {
  return entries;
}

export function count(): number {
  return entries.length;
}

export function wordsOfArticle(articleId: string): VocabEntry[] {
  return entries.filter((e) => e.articleId === articleId);
}

export function wordsOfGroup(tagId: string): VocabEntry[] {
  return entries.filter((e) => e.tag === tagId);
}

export function hasInArticle(articleId: string, word: string): boolean {
  const w = word.toLowerCase();
  return entries.some((e) => e.articleId === articleId && e.word === w);
}

export function groupsContaining(word: string): VocabGroup[] {
  const w = word.toLowerCase();
  const tags = new Set(entries.filter((e) => e.word === w && e.tag).map((e) => e.tag!));
  return groups.filter((g) => tags.has(g.id));
}

export function articlesContaining(word: string): { id: string; title: string }[] {
  const w = word.toLowerCase();
  const map = new Map<string, string>();
  for (const e of entries) if (e.word === w && e.articleId) map.set(e.articleId, e.articleTitle || '未命名文章');
  return [...map.entries()].map(([id, title]) => ({ id, title }));
}

export function listGroups(): VocabGroup[] {
  return [...groups].sort((a, b) => a.createdAt - b.createdAt);
}

export function groupInfo(id: string): VocabGroup | undefined {
  return groups.find((g) => g.id === id);
}

/* ───────────── 写 ───────────── */

export interface AddInput {
  word: string;
  translation: string;
  phonetic?: string;
  definition?: string;
  source?: string;
  articleId?: string | null;
  articleTitle?: string;
  tag?: string | null;
  example?: string;
}

/** 加入某个分组；该分组已有同名词则只补充空字段 */
export function add(input: AddInput): VocabEntry {
  const w = input.word.toLowerCase();
  const articleId = input.articleId ?? null;
  const tag = input.tag ?? null;
  const existing = entries.find((e) => e.word === w && e.articleId === articleId && e.tag === tag);
  if (existing) {
    let changed = false;
    if (input.example && !existing.example) {
      existing.example = input.example;
      changed = true;
    }
    if (input.translation && !existing.translation) {
      existing.translation = input.translation;
      changed = true;
    }
    if (input.phonetic && !existing.phonetic) {
      existing.phonetic = input.phonetic;
      changed = true;
    }
    if (changed) scheduleSave();
    return existing;
  }
  const entry: VocabEntry = {
    id: uid(),
    word: w,
    translation: input.translation,
    phonetic: input.phonetic || '',
    definition: input.definition || '',
    source: input.source || 'local',
    articleId,
    articleTitle: articleId ? input.articleTitle || '未命名文章' : '',
    tag,
    example: input.example || '',
    createdAt: Date.now(),
    mastered: false,
  };
  entries.push(entry);
  scheduleSave();
  return entry;
}

export function removeEntry(id: string): void {
  entries = entries.filter((e) => e.id !== id);
  scheduleSave();
}

export function removeFromArticle(articleId: string, word: string): void {
  const w = word.toLowerCase();
  entries = entries.filter((e) => !(e.articleId === articleId && e.word === w));
  scheduleSave();
}

export function removeFromGroup(tagId: string, word: string): void {
  const w = word.toLowerCase();
  entries = entries.filter((e) => !(e.tag === tagId && e.word === w));
  scheduleSave();
}

export function toggleMastered(id: string): boolean {
  const entry = entries.find((e) => e.id === id);
  if (!entry) return false;
  entry.mastered = !entry.mastered;
  entry.reviewedAt = Date.now();
  scheduleSave();
  return entry.mastered;
}

export function createGroup(name: string): VocabGroup | null {
  const trimmed = name.trim().slice(0, 60);
  if (!trimmed) return null;
  if (groups.some((g) => g.name === trimmed)) return null;
  const group: VocabGroup = { id: uid(), name: trimmed, createdAt: Date.now() };
  groups.push(group);
  scheduleSave();
  return group;
}

export function renameGroup(id: string, name: string): boolean {
  const trimmed = name.trim().slice(0, 60);
  if (!trimmed) return false;
  const group = groups.find((g) => g.id === id);
  if (!group) return false;
  group.name = trimmed;
  scheduleSave();
  return true;
}

export function deleteGroup(id: string): void {
  groups = groups.filter((g) => g.id !== id);
  entries = entries.filter((e) => e.tag !== id);
  scheduleSave();
}

export function clearAll(): void {
  entries = [];
  scheduleSave();
}

/* ───────────── 分组视图 ───────────── */

export interface GroupOptions {
  includeEmptyTags?: boolean;
  articleTitles?: Record<string, string>;
}

export function listAllGroups(options: GroupOptions = {}): GroupInfo[] {
  const articles = new Map<string, GroupInfo>();
  for (const e of entries) {
    if (!e.articleId) continue;
    if (!articles.has(e.articleId)) {
      articles.set(e.articleId, {
        key: `article:${e.articleId}`,
        kind: 'article',
        id: e.articleId,
        title: options.articleTitles?.[e.articleId] || e.articleTitle || '未命名文章',
        words: [],
        createdAt: Number.MAX_SAFE_INTEGER,
      });
    }
    articles.get(e.articleId)!.words.push(e);
  }

  const tags: GroupInfo[] = listGroups().map((g) => ({
    key: `tag:${g.id}`,
    kind: 'tag' as const,
    id: g.id,
    title: g.name,
    words: entries.filter((e) => e.tag === g.id),
    createdAt: g.createdAt,
  }));

  const articleList = [...articles.values()].map((g) => ({
    ...g,
    words: g.words.sort((a, b) => b.createdAt - a.createdAt),
    createdAt: Math.max(...g.words.map((w) => w.createdAt)),
  }));
  articleList.sort((a, b) => b.createdAt - a.createdAt);

  const tagList = (options.includeEmptyTags ? tags : tags.filter((t) => t.words.length > 0)).sort(
    (a, b) => a.createdAt - b.createdAt
  );
  return [...articleList, ...tagList];
}

/* ───────────── 导入 / 导出 ───────────── */

export function exportJson(): VocabExport {
  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    app: 'readbook',
    groups: listGroups(),
    entries,
  };
}

/** 整体替换（导入"替换"模式用）：覆盖当前账号的数据 */
export function replaceAll(input: unknown): void {
  const doc = input as any;
  const list: unknown[] = Array.isArray(doc) ? doc : Array.isArray(doc?.entries) ? doc.entries : [];
  const normalized = list.map(normalizeEntry).filter(Boolean) as VocabEntry[];
  const incomingGroups: VocabGroup[] = Array.isArray(doc?.groups)
    ? doc.groups
        .filter((g: any) => g && typeof g.id === 'string' && typeof g.name === 'string')
        .map((g: any) => ({ id: String(g.id), name: String(g.name), createdAt: Number(g.createdAt) || Date.now() }))
    : [];
  groups = incomingGroups;
  entries = normalized.map((e) => {
    if (e.tag && !groups.some((g) => g.id === e.tag)) {
      const fallback = groups.find((g) => g.name === '导入的单词') || { id: uid(), name: '导入的单词', createdAt: Date.now() };
      if (!groups.some((g) => g.id === fallback.id)) groups.push(fallback);
      e.tag = fallback.id;
    }
    if (!e.articleId && !e.tag) {
      let fallback = groups.find((g) => g.name === '导入的单词');
      if (!fallback) {
        fallback = { id: uid(), name: '导入的单词', createdAt: Date.now() };
        groups.push(fallback);
      }
      e.tag = fallback.id;
    }
    return e;
  });
  scheduleSave();
}

/** 合并导入：交给服务器做去重合并，然后刷新缓存 */
export async function importJson(text: string): Promise<{ added: number; skipped: number }> {
  const payload = JSON.parse(text);
  const res = await fetch('/api/vocabulary/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; added?: number; skipped?: number; error?: string };
  if (!res.ok || !data.ok) throw new Error(data.error || `导入失败（HTTP ${res.status}）`);
  const fresh = await loadFromServer();
  groups = fresh.groups;
  entries = fresh.entries;
  return { added: data.added ?? 0, skipped: data.skipped ?? 0 };
}

export function downloadExport(): void {
  const data = exportJson();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `readbook-vocabulary-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
