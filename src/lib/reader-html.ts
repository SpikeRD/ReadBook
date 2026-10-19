// 阅读页渲染用的切词工具：把段落拆成「纯文本 / 可点击单词」片段。
// 用 Astro 的 set:html 输出，单词包在 <span class="word" data-w="..."> 中，
// 这样点击逻辑完全在客户端脚本里，不需要整页 JSX。

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const WORD_RE = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g;

export function tokenizeParagraph(text: string): string {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(WORD_RE)) {
    const start = m.index ?? 0;
    if (start > last) out += esc(text.slice(last, start));
    const raw = m[0];
    let key = raw
      .toLowerCase()
      .replace(/’/g, "'")
      .replace(/^[-']+|[-']+$/g, '');
    if (key) out += `<span class="word" data-w="${esc(key)}">${esc(raw)}</span>`;
    else out += esc(raw);
    last = start + raw.length;
  }
  if (last < text.length) out += esc(text.slice(last));
  return out;
}

export function escapeText(text: string): string {
  return esc(text);
}
