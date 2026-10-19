// 顶栏账号菜单：下拉、修改密码。
import { askText, notify, showDialog } from './dialog';

export function setupAccountMenu(): void {
  const root = document.getElementById('account-menu');
  const toggle = document.getElementById('account-toggle');
  const dropdown = document.getElementById('account-dropdown');
  if (!root || !toggle || !dropdown) return;

  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    const open = dropdown.hidden;
    dropdown.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  });

  document.addEventListener('click', (event) => {
    if (!root.contains(event.target as Node)) {
      dropdown.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      dropdown.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
    }
  });

  document.getElementById('account-password')?.addEventListener('click', () => {
    dropdown.hidden = true;
    void changePasswordFlow();
  });
}

async function changePasswordFlow(): Promise<void> {
  const oldPassword = await askText('修改密码 · 第 1 步', '', '先输入当前密码', '当前密码');
  if (!oldPassword) return;
  const newPassword = await askText('修改密码 · 第 2 步', '', '新密码至少 6 位；修改后其他设备需要重新登录。', '新密码');
  if (!newPassword) return;

  try {
    const res = await fetch('/api/auth/password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ oldPassword, newPassword }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) {
      await showDialog({ kind: 'alert', title: '修改失败', message: data.error || `HTTP ${res.status}` });
      return;
    }
    await notify('密码已修改', '当前设备保持登录，其他设备需要用新密码重新登录。');
  } catch {
    await notify('修改失败', '网络错误，请稍后再试。');
  }
}
