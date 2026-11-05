// 日记页交互：新增 / 编辑 / 删除。
//
// 列表本身由服务端渲染，写成功后整页刷新——数量、排序、星期都以服务端为准，
// 不在客户端再实现一套渲染逻辑（那样两处逻辑迟早会不一致）。
// 编辑复用顶部表单：点「编辑」把内容填回去，按钮变成「保存修改」，再点「取消编辑」还原。

import { confirmDelete } from './dialog';

interface EntryDraft {
  id: string;
  date: string;
  title: string;
  body: string;
}

/** 浏览器本地日期（YYYY-MM-DD）；服务端渲染的日期只作无 JS 时的兜底 */
function localToday(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function setupDiaryPage(): void {
  const form = document.getElementById('diary-form') as HTMLFormElement | null;
  if (!form) return;

  const dateInput = document.getElementById('diary-date') as HTMLInputElement;
  const titleInput = document.getElementById('diary-title') as HTMLInputElement;
  const bodyInput = document.getElementById('diary-body') as HTMLTextAreaElement;
  const counter = document.getElementById('diary-counter') as HTMLElement;
  const msg = document.getElementById('diary-msg') as HTMLElement;
  const submitBtn = document.getElementById('diary-submit') as HTMLButtonElement;
  const cancelBtn = document.getElementById('diary-cancel') as HTMLButtonElement;
  const list = document.getElementById('diary-list');

  const maxChars = Number(bodyInput.dataset.max || '0');
  /** 当前正在编辑哪一篇；null 表示「写新的一篇」 */
  let editingId: string | null = null;

  function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  }

  function showError(text: string): void {
    msg.innerHTML = `<div class="alert alert-error">${escapeHtml(text)}</div>`;
  }

  function updateCounter(): void {
    const len = bodyInput.value.length;
    counter.textContent = maxChars ? `${len} / ${maxChars}` : String(len);
    counter.classList.toggle('is-over', !!maxChars && len > maxChars);
  }

  /** 切换「写新的」与「改已有的」两种状态 */
  function setMode(entry: EntryDraft | null): void {
    editingId = entry ? entry.id : null;
    submitBtn.textContent = entry ? '保存修改' : '保存';
    cancelBtn.hidden = !entry;
    msg.innerHTML = '';
    if (entry) {
      dateInput.value = entry.date;
      titleInput.value = entry.title;
      bodyInput.value = entry.body;
    } else {
      dateInput.value = localToday();
      titleInput.value = '';
      bodyInput.value = '';
    }
    updateCounter();
  }

  bodyInput.addEventListener('input', updateCounter);

  // 正文里回车要换行，所以保存用 Ctrl / Cmd + Enter
  bodyInput.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  cancelBtn.addEventListener('click', () => setMode(null));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    msg.innerHTML = '';

    const body = bodyInput.value.trim();
    if (!body) {
      showError('日记内容不能为空。');
      bodyInput.focus();
      return;
    }
    if (!dateInput.value) {
      showError('请选择日期。');
      dateInput.focus();
      return;
    }
    if (maxChars && body.length > maxChars) {
      showError(`正文超过 ${maxChars} 字上限，请删减后再保存。`);
      bodyInput.focus();
      return;
    }

    const label = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = '保存中…';
    try {
      const payload = { date: dateInput.value, title: titleInput.value.trim(), body };
      const res = await fetch('/api/diary', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(editingId ? { id: editingId, ...payload } : payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        showError(data.error || '保存失败，请稍后再试。');
        return;
      }
      // 写成功后交给服务端重新渲染，数量与排序都不会和真实数据脱节
      location.reload();
    } catch {
      showError('网络错误，保存失败。');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = label ?? '保存';
    }
  });

  list?.addEventListener('click', async (event) => {
    const button = (event.target as HTMLElement).closest('button[data-action]') as HTMLButtonElement | null;
    if (!button) return;
    const card = button.closest('.diary-entry') as HTMLElement | null;
    const id = card?.dataset.id || '';
    if (!card || !id) return;

    if (button.dataset.action === 'edit') {
      setMode({
        id,
        date: card.querySelector<HTMLTimeElement>('.diary-entry-date')?.getAttribute('datetime') || localToday(),
        title: card.querySelector<HTMLElement>('.diary-entry-title')?.textContent?.trim() || '',
        body: card.querySelector<HTMLElement>('.diary-entry-body')?.textContent || '',
      });
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      bodyInput.focus();
      return;
    }

    if (button.dataset.action === 'delete') {
      const ok = await confirmDelete('删除这篇日记？', '删除后无法恢复。');
      if (!ok) return;
      button.disabled = true;
      try {
        const res = await fetch(`/api/diary?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          showError(data.error || '删除失败，请稍后再试。');
          button.disabled = false;
          return;
        }
        location.reload();
      } catch {
        showError('网络错误，删除失败。');
        button.disabled = false;
      }
    }
  });

  // 进页面就把日期对齐到浏览器本地时间（服务端可能是 UTC）
  setMode(null);
}
