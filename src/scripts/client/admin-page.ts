// 管理员页面：新建账号、重置密码、删除账号。
// 成功时刷新页面，让统计与列表同步。

import { askText, confirmDelete, notify, showDialog } from './dialog';

async function call(path: string, method: string, body?: unknown): Promise<{ ok: boolean; data: any }> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && data.ok !== false, data };
}

async function showPassword(title: string, username: string, password: string): Promise<void> {
  await showDialog({
    kind: 'alert',
    title,
    message: `用户名：${username}\n新密码：${password}\n\n请复制后转告对方；关闭后不会再显示。`,
    okText: '我已记下',
  });
}

export function initAdminPage(): void {
  const msg = document.getElementById('admin-msg');

  function flash(text: string, kind: 'ok' | 'error' = 'ok'): void {
    if (!msg) return;
    msg.innerHTML = `<div class="alert alert-${kind}">${text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)}</div>`;
  }

  document.getElementById('create-account')?.addEventListener('click', () => {
    void (async () => {
      const username = await askText('新建账号', '', '密码留空会自动生成一个随机密码。', '用户名');
      if (!username) return;
      const password = await askText('设置密码', '', '留空则自动生成随机密码。', '密码（可留空）', {
        secret: true,
        allowEmpty: true,
      });
      if (password === null) return; // 取消
      const result = await call('/api/admin/accounts', 'POST', { username, password });
      if (!result.ok) {
        flash(result.data.error || '创建失败', 'error');
        return;
      }
      await showPassword(
        `已创建账号「${result.data.account.username}」`,
        result.data.account.username,
        result.data.password
      );
      location.reload();
    })();
  });

  document.getElementById('account-rows')?.addEventListener('click', (event) => {
    const btn = (event.target as HTMLElement).closest<HTMLElement>('[data-act]');
    const row = (event.target as HTMLElement).closest<HTMLElement>('tr[data-id]');
    if (!btn || !row) return;
    const id = row.dataset.id || '';
    const username = row.dataset.username || '';

    if (btn.dataset.act === 'reset') {
      void (async () => {
        const password = await askText('重置密码', '', `为「${username}」生成新密码；留空自动生成。`, '新密码（可留空）', {
          secret: true,
          allowEmpty: true,
        });
        if (password === null) return;
        const result = await call(`/api/admin/accounts?id=${encodeURIComponent(id)}`, 'PATCH', {
          password,
        });
        if (!result.ok) {
          flash(result.data.error || '重置失败', 'error');
          return;
        }
        await showPassword(`已重置「${username}」的密码`, username, result.data.password);
      })();
      return;
    }

    if (btn.dataset.act === 'delete') {
      void (async () => {
        const ok = await confirmDelete(
          `删除账号「${username}」？`,
          '该用户的全部文章、生词本与翻译缓存会一起删除，且不可恢复。',
          '删除账号'
        );
        if (!ok) return;
        const result = await call(`/api/admin/accounts?id=${encodeURIComponent(id)}`, 'DELETE');
        if (!result.ok) {
          flash(result.data.error || '删除失败', 'error');
          return;
        }
        await notify('已删除', `账号「${username}」及其数据已删除。`);
        location.reload();
      })();
    }
  });
}
