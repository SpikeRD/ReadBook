// 生词本接口（按当前登录用户隔离）
//   GET  /api/vocabulary            取该用户的生词本（groups + entries）
//   PUT  /api/vocabulary            整体保存（body 与导出的 JSON 同结构）
//   POST /api/vocabulary/import     导入（合并去重）：旧版 localStorage 数据或导出的 JSON

import type { APIRoute } from 'astro';
import '../../lib/load-env';
import { requireUser } from '../../lib/auth-guard';
import { getVocabulary, saveVocabulary, importLocal } from '../../lib/vocab-server';

export const GET: APIRoute = async (ctx) => {
  const auth = await requireUser(ctx);
  if ('response' in auth) return auth.response;
  const doc = await getVocabulary(auth.user.id);
  return json({ ok: true, ...doc });
};

export const PUT: APIRoute = async (ctx) => {
  const auth = await requireUser(ctx);
  if ('response' in auth) return auth.response;
  const body = await ctx.request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ ok: false, error: '请求体不是合法 JSON' }, 400);
  const doc = await saveVocabulary(auth.user.id, body);
  return json({ ok: true, version: doc.version, updatedAt: doc.updatedAt, entries: doc.entries.length, groups: doc.groups.length });
};

export const POST: APIRoute = async (ctx) => {
  const auth = await requireUser(ctx);
  if ('response' in auth) return auth.response;
  const body = await ctx.request.json().catch(() => null);
  if (!body) return json({ ok: false, error: '请求体不是合法 JSON' }, 400);
  const result = await importLocal(auth.user.id, body);
  return json({ ok: true, ...result });
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
