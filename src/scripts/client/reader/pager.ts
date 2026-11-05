// 阅读页键盘翻页：← 上一页、→ 下一页。
// 输入框、弹窗、浮层内不触发；只在有多页时生效。

export interface PagerInfo {
  currentPage: number;
  totalPages: number;
  articleId: string;
}

export function initKeyboardPaging(info: PagerInfo): void {
  if (info.totalPages <= 1) return;

  // 页码一律带 ?page=：第 1 页也带上，否则回到无参数地址会被「自动续读」弹回上次页
  const href = (n: number) => `/read/${info.articleId}?page=${n}`;

  document.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, .dlg-backdrop, .popover, [contenteditable="true"]')) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;

    if (event.key === 'ArrowLeft' && info.currentPage > 1) {
      event.preventDefault();
      location.href = href(info.currentPage - 1);
    } else if (event.key === 'ArrowRight' && info.currentPage < info.totalPages) {
      event.preventDefault();
      location.href = href(info.currentPage + 1);
    }
  });
}
