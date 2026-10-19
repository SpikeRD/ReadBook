// 英文文本处理：切词、统计字数、简单清洗。

export const WORD_RE = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g;

/** 取出文本中的英文单词（保持原顺序与大小写） */
export function extractWords(text: string): string[] {
  return text.match(WORD_RE) ?? [];
}

/** 查词统一键：小写、去掉弯引号变直引号、去掉首尾标点与空白 */
export function normalizeWord(word: string): string {
  return word
    .toLowerCase()
    .replace(/[’]/g, "'")
    .trim()
    .replace(/^[^a-z]+|[^a-z]+$/g, '');
}

/** 粗略统计英文词数 */
export function countWords(text: string): number {
  return extractWords(text).length;
}

/** 把单词还原到可能的词根形式（用于查词兜底：running -> run） */
export function candidateLemmas(word: string): string[] {
  const w = normalizeWord(word);
  const out = new Set<string>([w]);
  if (w.length > 3 && w.endsWith('ies')) out.add(w.slice(0, -3) + 'y');
  if (w.length > 4 && w.endsWith('ing')) {
    out.add(w.slice(0, -3));
    out.add(w.slice(0, -3) + 'e');
    if (/([b-df-hj-np-tv-z])\1$/.test(w.slice(0, -3))) out.add(w.slice(0, -4));
  }
  if (w.length > 3 && w.endsWith('ed')) {
    out.add(w.slice(0, -2));
    out.add(w.slice(0, -1));
    if (/([b-df-hj-np-tv-z])\1$/.test(w.slice(0, -2))) out.add(w.slice(0, -3));
  }
  if (w.length > 3 && w.endsWith('es')) out.add(w.slice(0, -2));
  if (w.length > 2 && w.endsWith('s') && !w.endsWith('ss')) out.add(w.slice(0, -1));
  if (w.length > 5 && w.endsWith('ly')) out.add(w.slice(0, -2));
  if (w.length > 5 && w.endsWith('er')) out.add(w.slice(0, -2));
  if (w.length > 6 && w.endsWith('est')) out.add(w.slice(0, -3));
  return [...out].filter((x) => x.length > 0 && x !== w);
}

export interface Paragraph {
  type: 'heading' | 'paragraph';
  text: string;
}

/**
 * 把导入的文本拆成块：
 * - `# Heading` / `## Heading` / 全大写的短行 → 标题
 * - 空行分段；连续的普通行合并为一段
 */
export function toBlocks(raw: string): Paragraph[] {
  const text = raw.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ');
  const blocks: Paragraph[] = [];
  const chunks = text.split(/\n\s*\n/);
  for (const chunk of chunks) {
    const lines = chunk.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    // 只有单独的 `# 标题` 行算标题；混在段落里的井号按普通文本处理
    if (lines.length === 1 && /^#{1,6}\s+/.test(lines[0])) {
      blocks.push({ type: 'heading', text: lines[0].replace(/^#{1,6}\s+/, '').trim() });
      continue;
    }
    const body = lines.join(' ');
    if (body) blocks.push({ type: 'paragraph', text: collapse(body) });
  }
  return blocks;
}

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** 从正文推断一个默认标题 */
export function inferTitle(text: string, fallback = ''): string {
  const blocks = toBlocks(text);
  const heading = blocks.find((b) => b.type === 'heading');
  if (heading) return heading.text.slice(0, 120);
  // 没有 Markdown 标题时，取第一行短文本（<=80 字符且无句末标点）当标题
  const firstLine = text.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
  if (firstLine && firstLine.length <= 80 && !/[.!?。！？]$/.test(firstLine)) return firstLine;
  if (fallback) return fallback;
  const firstSentence = text.replace(/\s+/g, ' ').trim();
  return firstSentence.slice(0, 32) + (firstSentence.length > 32 ? '…' : '');
}

/** 字节数（UTF-8） */
export function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

/** 把文本拆成带 ID 的句子块，供阅读页渲染与例句 */
export function toSentences(text: string): { id: number; text: string }[] {
  const parts = text
    .split(/(?<=[.!?。！？])\s+(?=[A-Z"'(“])/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.map((t, id) => ({ id, text: t }));
}

/** 找出包含某词的第一句作为例句 */
export function findExample(text: string, word: string): string | null {
  const target = normalizeWord(word);
  for (const s of toSentences(text)) {
    const words = extractWords(s.text).map(normalizeWord);
    if (words.includes(target)) return s.text.slice(0, 240);
  }
  return null;
}
