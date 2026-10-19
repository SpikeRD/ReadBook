// 请求级鉴权助手：中间件把当前用户放进 locals，页面与接口从这里取。
// 未登录时 API 返回 401（而不是跳转），页面由中间件统一跳转到 /login。

import type { APIContext, AstroGlobal } from 'astro';
import { findUserById, type PublicUser } from './auth.ts';
import { SESSION_COOKIE, parseSession, createSession, sessionCookieOptions } from './session.ts';
import { readEnv } from './env.ts';

export type AuthContext = Pick<APIContext, 'cookies'> | Pick<AstroGlobal, 'cookies'>;

/** 从 Cookie 解析当前用户；无效返回 null */
export async function getCurrentUser(ctx: AuthContext): Promise<PublicUser | null> {
  const env = readEnv();
  const token = ctx.cookies.get(SESSION_COOKIE)?.value;
  const payload = parseSession(token, { secret: env.secret, days: env.sessionDays });
  if (!payload) return null;
  const user = await findUserById(payload.u);
  if (!user) return null;
  // 改密码后旧会话立即失效
  if ((user.sessionVersion || 1) !== payload.v) return null;
  return { id: user.id, username: user.username, role: user.role, createdAt: user.createdAt };
}

/** 登录成功：写入会话 Cookie */
export async function startSession(ctx: AuthContext, user: PublicUser, version: number): Promise<void> {
  const env = readEnv();
  const token = createSession(user.id, version, { secret: env.secret, days: env.sessionDays });
  ctx.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(env.sessionDays));
}

export function endSession(ctx: AuthContext): void {
  const env = readEnv();
  ctx.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions(env.sessionDays), maxAge: 0 });
}

function unauthorized(error = '未登录或登录已过期，请重新登录。'): Response {
  return new Response(JSON.stringify({ ok: false, error }), {
    status: 401,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** API 用：未登录时返回 401 响应，登录时返回用户 */
export async function requireUser(ctx: AuthContext): Promise<{ user: PublicUser } | { response: Response }> {
  const user = await getCurrentUser(ctx);
  if (!user) return { response: unauthorized() };
  return { user };
}

/** API 用：要求管理员身份；非管理员返回 403，未登录返回 401 */
export async function requireAdmin(ctx: AuthContext): Promise<{ user: PublicUser } | { response: Response }> {
  const user = await getCurrentUser(ctx);
  if (!user) return { response: unauthorized() };
  if (user.role !== 'admin') {
    return {
      response: new Response(JSON.stringify({ ok: false, error: '只有管理员可以访问这里。' }), {
        status: 403,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      }),
    };
  }
  return { user };
}
