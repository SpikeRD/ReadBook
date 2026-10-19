// 管理员接口：管理账号
//   GET    /api/admin/accounts           账号列表 + 全站统计
//   POST   /api/admin/accounts           新建账号 { username, password?, role? }（password 为空则自动生成）
//   PATCH  /api/admin/accounts?id=xxx    重置密码 { password? }（为空则自动生成）
//   DELETE /api/admin/accounts?id=xxx    删除账号及其全部数据
// 全部要求管理员身份（非管理员 403，未登录 401）。

import type { APIRoute } from 'astro';
import '../../../lib/load-env';
import {
  adminDeleteUser,
  adminResetPassword,
  generatePassword,
  registerUser,
  validatePassword,
  findUserById,
} from '../../../lib/auth';
import { requireAdmin } from '../../../lib/auth-guard';
import { listAccounts, siteStats } from '../../../lib/admin-stats';

export const GET: APIRoute = async (ctx) => {
  const auth = await requireAdmin(ctx);
  if ('response' in auth) return auth.response;
  const accounts = await listAccounts();
  return json({ ok: true, accounts, stats: await siteStats(), adminId: auth.user.id });
};

export const POST: APIRoute = async (ctx) => {
  const auth = await requireAdmin(ctx);
  if ('response' in auth) return auth.response;
  const body = (await ctx.request.json().catch(() => ({}))) as { username?: string; password?: string };
  const username = String(body.username ?? '').trim();
  if (!username) return json({ ok: false, error: '请填写用户名' }, 400);

  // 密码留空则自动生成，返回给管理员转告对方
  const password = String(body.password ?? '').trim() || generatePassword();
  const check = validatePassword(password);
  if (!check.ok) return json({ ok: false, error: check.error }, 400);

  const result = await registerUser(username, password);
  if (!result.ok || !result.user) return json({ ok: false, error: result.error }, 400);
  return json({ ok: true, account: result.user, password, generated: !body.password });
};

export const PATCH: APIRoute = async (ctx) => {
  const auth = await requireAdmin(ctx);
  if ('response' in auth) return auth.response;
  const id = ctx.url.searchParams.get('id') || '';
  const body = (await ctx.request.json().catch(() => ({}))) as { password?: string };
  const password = String(body.password ?? '').trim() || generatePassword();
  const result = await adminResetPassword(id, password);
  if (!result.ok) return json({ ok: false, error: result.error }, 400);
  return json({ ok: true, password, generated: !body.password });
};

export const DELETE: APIRoute = async (ctx) => {
  const auth = await requireAdmin(ctx);
  if ('response' in auth) return auth.response;
  const id = ctx.url.searchParams.get('id') || '';
  const target = await findUserById(id);
  if (!target) return json({ ok: false, error: '用户不存在' }, 404);
  if (target.id === auth.user.id) return json({ ok: false, error: '不能删除当前登录的管理员自己。' }, 400);
  const result = await adminDeleteUser(id);
  if (!result.ok) return json({ ok: false, error: result.error }, 400);
  return json({ ok: true, deleted: { id: target.id, username: target.username } });
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
