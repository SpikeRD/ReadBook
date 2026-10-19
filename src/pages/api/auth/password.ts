// 修改密码：POST /api/auth/password  body: { oldPassword, newPassword }
// 修改成功后当前设备换新会话，其他设备的旧会话立即失效。

import type { APIRoute } from 'astro';
import '../../../lib/load-env';
import { changePassword, findUserById } from '../../../lib/auth';
import { requireUser, startSession } from '../../../lib/auth-guard';

export const POST: APIRoute = async (ctx) => {
  const auth = await requireUser(ctx);
  if ('response' in auth) return auth.response;
  const body = (await ctx.request.json().catch(() => ({}))) as { oldPassword?: string; newPassword?: string };
  const result = await changePassword(auth.user.id, String(body.oldPassword ?? ''), String(body.newPassword ?? ''));
  if (!result.ok) return json({ ok: false, error: result.error }, 400);
  const record = await findUserById(auth.user.id);
  await startSession(ctx, auth.user, record?.sessionVersion ?? 1);
  return json({ ok: true, sessionVersion: record?.sessionVersion });
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
