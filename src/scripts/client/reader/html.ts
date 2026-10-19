// 通用小工具：HTML 转义、释义截断。

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** 侧栏里显示的短释义 */
export function shortZh(zh: string): string {
  return zh.replace(/\n/g, '；').slice(0, 40);
}
