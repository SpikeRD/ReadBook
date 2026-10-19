// 查词接口
//   GET  /api/lookup?w=word
//   POST /api/lookup  body: { words: string[] }  → 批量（阅读页预取可选）
// 返回本地词库释义；未收录时返回 found:false 与外部词典链接，前端明确提示「未收录」。

import type { APIRoute } from 'astro';
import '../../lib/load-env';
import { lookupWord } from '../../lib/dict';
import { normalizeWord } from '../../lib/text';

export const GET: APIRoute = async ({ url }) => {
  const raw = (url.searchParams.get('w') || '').trim();
  if (!raw) return json({ ok: false, error: '缺少参数 w' }, 400);
  if (raw.length > 64 || !/^[A-Za-z'’-]+$/.test(raw)) {
    return json({ ok: false, error: '只支持单个英文单词' }, 400);
  }
  const result = await lookupWord(normalizeWord(raw));
  return json({ ok: true, ...result });
};

export const POST: APIRoute = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as { words?: unknown };
  const words = Array.isArray(body.words) ? body.words.slice(0, 50) : [];
  const results = [];
  for (const w of words) {
    if (typeof w !== 'string' || w.length > 64) continue;
    results.push(await lookupWord(w));
  }
  return json({ ok: true, results });
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
