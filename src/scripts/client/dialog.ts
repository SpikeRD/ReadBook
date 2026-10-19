// 应用内弹窗：替代原生 prompt / confirm / alert（原生弹窗丑、手机端可能被拦截）。
// 基于 <dialog> + 单例，一次只弹一个；支持输入框、按钮组、Esc 关闭。

type DialogKind = 'prompt' | 'confirm' | 'alert' | 'select';

export interface DialogOption {
  value: string;
  label: string;
}

export interface DialogConfig {
  title: string;
  message?: string;
  kind: DialogKind;
  /** prompt 默认值 */
  defaultValue?: string;
  placeholder?: string;
  okText?: string;
  cancelText?: string;
  /** select 选项 */
  options?: DialogOption[];
  /** 危险操作（删除等）用红色确认按钮 */
  danger?: boolean;
  /** prompt 输入框用密码遮罩 */
  secret?: boolean;
  /** prompt 空值时的提示文案（默认「内容不能为空」） */
  requiredMessage?: string;
  /** 校验：返回错误文案则不关闭 */
  validate?: (value: string) => string | null;
}

export interface DialogResult {
  /** confirm 返回是否确认；prompt/select 返回输入值，取消为 null */
  ok: boolean;
  value: string;
}

let root: HTMLElement | null = null;
let current: { resolve: (r: DialogResult) => void } | null = null;

function ensureRoot(): HTMLElement {
  if (root && document.body.contains(root)) return root;
  root = document.createElement('div');
  root.className = 'dlg-backdrop';
  root.hidden = true;
  root.innerHTML = `
    <div class="dlg" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
      <h3 class="dlg-title" id="dlg-title"></h3>
      <p class="dlg-message"></p>
      <input class="dlg-input" type="text" />
      <select class="dlg-select"></select>
      <p class="dlg-error" role="alert"></p>
      <div class="dlg-actions">
        <button type="button" class="btn dlg-cancel">取消</button>
        <button type="button" class="btn btn-primary dlg-ok">确定</button>
      </div>
    </div>`;
  document.body.appendChild(root);

  root.querySelector('.dlg-cancel')!.addEventListener('click', () => finish({ ok: false, value: '' }));
  root.querySelector('.dlg-ok')!.addEventListener('click', () => submit());
  root.addEventListener('click', (event) => {
    if (event.target === root) finish({ ok: false, value: '' });
  });
  root.querySelector('.dlg-input')!.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Enter') {
      event.preventDefault();
      submit();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && root && !root.hidden) {
      event.preventDefault();
      finish({ ok: false, value: '' });
    }
  });
  return root;
}

function finish(result: DialogResult): void {
  if (!root) return;
  root.hidden = true;
  const r = current;
  current = null;
  r?.resolve(result);
}

function submit(): void {
  if (!root) return;
  const input = root.querySelector<HTMLInputElement>('.dlg-input')!;
  const select = root.querySelector<HTMLSelectElement>('.dlg-select')!;
  const error = root.querySelector<HTMLElement>('.dlg-error')!;
  const kind = (root as HTMLElement & { __kind?: DialogKind }).__kind || 'prompt';
  const value = kind === 'select' ? select.value : input.value;
  const cfg = (root as HTMLElement & {
    __validate?: (v: string) => string | null;
    __requiredMessage?: string;
  }).__requiredMessage;
  const validate = (root as HTMLElement & { __validate?: (v: string) => string | null }).__validate;
  // prompt 默认不允许空值（例如分组名），避免建出无名分组
  if (kind === 'prompt' && !value.trim() && cfg) {
    error.textContent = cfg;
    input.focus();
    return;
  }
  const problem = validate ? validate(value) : null;
  if (problem) {
    error.textContent = problem;
    return;
  }
  error.textContent = '';
  finish({ ok: true, value });
}

export function showDialog(config: DialogConfig): Promise<DialogResult> {
  const el = ensureRoot();
  if (current) current.resolve({ ok: false, value: '' }); // 关掉上一个，避免互相等待

  el.querySelector('.dlg-title')!.textContent = config.title;
  const msg = el.querySelector<HTMLElement>('.dlg-message')!;
  msg.textContent = config.message || '';
  msg.hidden = !config.message;

  const input = el.querySelector<HTMLInputElement>('.dlg-input')!;
  const select = el.querySelector<HTMLSelectElement>('.dlg-select')!;
  const error = el.querySelector<HTMLElement>('.dlg-error')!;
  const cancel = el.querySelector<HTMLButtonElement>('.dlg-cancel')!;
  const ok = el.querySelector<HTMLButtonElement>('.dlg-ok')!;
  error.textContent = '';

  input.hidden = config.kind !== 'prompt';
  select.hidden = config.kind !== 'select';
  input.value = config.defaultValue || '';
  input.placeholder = config.placeholder || '';
  // 密码类输入用遮罩，其余普通文本
  input.type = config.secret ? 'password' : 'text';
  input.autocomplete = config.secret ? 'new-password' : 'off';

  if (config.kind === 'select') {
    select.innerHTML = (config.options || [])
      .map((o) => `<option value="${o.value.replace(/"/g, '&quot;')}">${o.label.replace(/</g, '&lt;')}</option>`)
      .join('');
  }

  ok.textContent = config.okText || (config.kind === 'alert' ? '知道了' : '确定');
  cancel.textContent = config.cancelText || '取消';
  cancel.hidden = config.kind === 'alert';
  ok.classList.toggle('btn-danger', !!config.danger);
  ok.classList.toggle('btn-primary', !config.danger);
  const holder = el as HTMLElement & {
    __validate?: (v: string) => string | null;
    __kind?: DialogKind;
    __requiredMessage?: string;
  };
  holder.__validate = config.validate;
  holder.__kind = config.kind;
  holder.__requiredMessage = config.requiredMessage ?? '内容不能为空';

  el.hidden = false;

  return new Promise<DialogResult>((resolve) => {
    current = { resolve };
    if (config.kind === 'prompt') {
      setTimeout(() => {
        input.focus();
        input.select();
      }, 20);
    } else {
      setTimeout(() => ok.focus(), 20);
    }
  });
}

/* ── 便捷函数 ── */

export async function askText(
  title: string,
  defaultValue = '',
  message = '',
  placeholder = '',
  options: { secret?: boolean; allowEmpty?: boolean } = {}
): Promise<string | null> {
  const r = await showDialog({
    title,
    kind: 'prompt',
    defaultValue,
    message,
    placeholder,
    secret: options.secret,
    requiredMessage: options.allowEmpty ? '' : '名称不能为空',
  });
  if (!r.ok) return null;
  const v = r.value.trim();
  return v || (options.allowEmpty ? '' : null);
}

export async function confirmDelete(title: string, message: string, okText = '删除'): Promise<boolean> {
  const r = await showDialog({ title, message, kind: 'confirm', okText, danger: true });
  return r.ok;
}

export async function choose(
  title: string,
  message: string,
  options: DialogOption[],
  okText = '确定'
): Promise<string | null> {
  const r = await showDialog({ title, message, kind: 'select', options, okText });
  return r.ok ? r.value : null;
}

export async function notify(title: string, message = ''): Promise<void> {
  await showDialog({ title, message, kind: 'alert' });
}

// 存储层写满时发出事件，这里统一弹窗（避免在存储模块里直接调用 UI）
if (typeof window !== 'undefined') {
  window.addEventListener('readbook:storage-error', (event) => {
    const detail = (event as CustomEvent<{ message?: string }>).detail;
    void notify('保存失败', detail?.message || '浏览器本地存储可能已满。');
  });
}
