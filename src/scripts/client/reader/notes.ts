// 阅读页笔记：段落锚点按钮 + 面板里的编辑 / 删除。
//
// 保存成功后整页刷新并滚回原段落——笔记面板和段落标记都由服务端直出，
// 前端不重复一份渲染逻辑（和译文缓存的处理方式一致），也避免两处状态不同步。
// 多行输入框复用 .dlg-* 的样式，但不改动 dialog.ts（那边只有单行 prompt）。

import { confirmDelete, notify } from '../dialog';

export interface NotesMeta {
  articleId: string;
  enabled: boolean;
  maxNoteChars: number;
}

interface EditorOptions {
  title: string;
  message?: string;
  value?: string;
  maxChars: number;
}

let editorRoot: HTMLElement | null = null;
let editorResolve: ((value: string | null) => void) | null = null;

function finishEditor(value: string | null): void {
  if (!editorRoot) return;
  editorRoot.hidden = true;
  const resolve = editorResolve;
  editorResolve = null;
  resolve?.(value);
}

function ensureEditor(): HTMLElement {
  if (editorRoot && document.body.contains(editorRoot)) return editorRoot;
  const el = document.createElement('div');
  el.className = 'dlg-backdrop';
  el.hidden = true;
  el.innerHTML = `
    <div class="dlg" role="dialog" aria-modal="true" aria-labelledby="note-dlg-title">
      <h3 class="dlg-title" id="note-dlg-title"></h3>
      <p class="dlg-message"></p>
      <textarea class="dlg-input note-editor-input" rows="5"></textarea>
      <p class="note-editor-count"></p>
      <p class="dlg-error" role="alert"></p>
      <div class="dlg-actions">
        <button type="button" class="btn dlg-cancel">取消</button>
        <button type="button" class="btn btn-primary dlg-ok">保存</button>
      </div>
    </div>`;
  document.body.appendChild(el);

  const textarea = el.querySelector<HTMLTextAreaElement>('textarea')!;
  const error = el.querySelector<HTMLElement>('.dlg-error')!;
  const count = el.querySelector<HTMLElement>('.note-editor-count')!;

  const updateCount = () => {
    const max = Number(textarea.dataset.max || '0');
    count.textContent = max ? `${textarea.value.length} / ${max}` : `${textarea.value.length}`;
    count.classList.toggle('is-over', !!max && textarea.value.length > max);
  };

  el.querySelector('.dlg-cancel')!.addEventListener('click', () => finishEditor(null));
  el.querySelector('.dlg-ok')!.addEventListener('click', () => {
    const value = textarea.value.trim();
    const max = Number(textarea.dataset.max || '0');
    if (!value) {
      error.textContent = '笔记不能为空';
      textarea.focus();
      return;
    }
    if (max && value.length > max) {
      error.textContent = `最多 ${max} 个字符，请删掉一些`;
      textarea.focus();
      return;
    }
    error.textContent = '';
    finishEditor(value);
  });
  el.addEventListener('click', (event) => {
    if (event.target === el) finishEditor(null);
  });
  textarea.addEventListener('input', () => {
    error.textContent = '';
    updateCount();
  });
  textarea.addEventListener('keydown', (event) => {
    // Ctrl / Cmd + Enter 直接保存；单独 Enter 保留换行
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      el.querySelector<HTMLButtonElement>('.dlg-ok')!.click();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && el && !el.hidden) {
      event.preventDefault();
      finishEditor(null);
    }
  });

  editorRoot = el;
  return el;
}

function openEditor(options: EditorOptions): Promise<string | null> {
  const el = ensureEditor();
  if (editorResolve) editorResolve(null); // 关掉上一个，避免互相等待

  el.querySelector('.dlg-title')!.textContent = options.title;
  const message = el.querySelector<HTMLElement>('.dlg-message')!;
  message.textContent = options.message || '';
  message.hidden = !options.message;

  const textarea = el.querySelector<HTMLTextAreaElement>('textarea')!;
  textarea.value = options.value || '';
  textarea.dataset.max = String(options.maxChars || 0);
  textarea.placeholder = '写点什么：这一段的想法、生词用法、疑问……（Ctrl + Enter 保存）';
  el.querySelector<HTMLElement>('.dlg-error')!.textContent = '';
  const count = el.querySelector<HTMLElement>('.note-editor-count')!;
  count.textContent = `${textarea.value.length} / ${options.maxChars || 0}`;
  count.classList.remove('is-over');

  el.hidden = false;
  return new Promise<string | null>((resolve) => {
    editorResolve = resolve;
    setTimeout(() => textarea.focus(), 20);
  });
}

/* ───────────── 请求与刷新 ───────────── */

async function send(url: string, method: string, body?: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || data.ok === false) return { ok: false, error: data.error || '保存失败，请稍后再试。' };
    return { ok: true };
  } catch {
    return { ok: false, error: '网络异常，请稍后再试。' };
  }
}

/** 刷新页面并滚回被操作的那一段（笔记面板与段落标记由服务端渲染） */
function reloadAt(blockIndex?: number): void {
  if (blockIndex !== undefined && Number.isFinite(blockIndex) && blockIndex >= 0) {
    history.replaceState(null, '', `#block-${blockIndex}`);
  }
  location.reload();
}

/** 取某一段的原文开头，作为笔记锚点的校验片段 */
function quoteOf(blockIndex: number): string {
  const block = document.getElementById(`block-${blockIndex}`);
  const textEl = block?.querySelector('p, h2');
  return (textEl?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

/* ───────────── 交互 ───────────── */

export function initNotes(meta: NotesMeta): void {
  if (!meta.enabled || !meta.articleId) return;
  const maxChars = meta.maxNoteChars || 2000;

  async function createNote(blockIndex: number): Promise<void> {
    const quote = quoteOf(blockIndex);
    const body = await openEditor({
      title: '为这一段记笔记',
      message: quote ? `「${quote}」` : '',
      maxChars,
    });
    if (!body) return;
    const result = await send('/api/notes', 'POST', {
      articleId: meta.articleId,
      blockIndex,
      quote,
      body,
    });
    if (!result.ok) {
      await notify('保存失败', result.error || '请稍后再试。');
      return;
    }
    reloadAt(blockIndex);
  }

  async function editNote(button: HTMLElement): Promise<void> {
    const noteId = button.dataset.noteEdit || '';
    const blockIndex = Number(button.dataset.noteBlock ?? '-1');
    const item = button.closest('.note-item');
    const current = item?.querySelector('.note-body')?.textContent || '';
    const body = await openEditor({ title: '编辑笔记', value: current, maxChars });
    if (!body || body === current) return;
    const result = await send('/api/notes', 'PATCH', { articleId: meta.articleId, noteId, body });
    if (!result.ok) {
      await notify('保存失败', result.error || '请稍后再试。');
      return;
    }
    reloadAt(blockIndex);
  }

  async function removeNote(button: HTMLElement): Promise<void> {
    const noteId = button.dataset.noteDelete || '';
    const ok = await confirmDelete('删除这条笔记？', '删除后无法恢复。', '删除笔记');
    if (!ok) return;
    const result = await send(
      `/api/notes?articleId=${encodeURIComponent(meta.articleId)}&noteId=${encodeURIComponent(noteId)}`,
      'DELETE'
    );
    if (!result.ok) {
      await notify('删除失败', result.error || '请稍后再试。');
      return;
    }
    reloadAt();
  }

  // 段落锚点按钮：事件委托，正文里每段都有一个
  document.getElementById('reader')?.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-note-add]');
    if (!button) return;
    event.preventDefault();
    void createNote(Number(button.dataset.noteAdd));
  });

  // 面板里的编辑 / 删除
  document.getElementById('note-panel')?.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const edit = target.closest<HTMLElement>('[data-note-edit]');
    if (edit) {
      event.preventDefault();
      void editNote(edit);
      return;
    }
    const remove = target.closest<HTMLElement>('[data-note-delete]');
    if (remove) {
      event.preventDefault();
      void removeNote(remove);
    }
  });
}
