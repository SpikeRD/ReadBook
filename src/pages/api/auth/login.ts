// POST /api/auth/login  body: { username, password }
// 成功后写入签名 Cookie（默认 30 天），同一账号换设备登录即可同步全部数据。

import type { APIRoute } from 'astro';
import '../../../lib/load-env';
import { authenticate, findUserById } from '../../../lib/auth';
import { startSession } from '../../../lib/auth-guard';

export const POST: APIRoute = async ({ request, cookies }) => {
  const body = (await request.json().catch(() => ({}))) as { username?: string; password?: string };
  const username = String(body.username ?? '').trim();
  const password = String(body.password ?? '');
  if (!username || !password) return json({ ok: false, error: '请输入用户名和密码' }, 400);

  const result = await authenticate(username, password);
  if (!result.ok || !result.user) return json({ ok: false, error: result.error || '登录失败' }, 401);

  const record = await findUserById(result.user.id);
  await startSession({ cookies }, result.user, record?.sessionVersion ?? 1);
  return json({ ok: true, user: result.user });
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
