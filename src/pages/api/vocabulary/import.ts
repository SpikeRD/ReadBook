// 生词本导入（合并）：把浏览器旧数据或导出的 JSON 合并进当前账号。
//   POST /api/vocabulary/import

import type { APIRoute } from 'astro';
import '../../../lib/load-env';
import { requireUser } from '../../../lib/auth-guard';
import { importLocal } from '../../../lib/vocab-server';

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
