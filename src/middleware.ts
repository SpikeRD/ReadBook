// 全局中间件：
//   1. 登录拦截：未登录访问页面跳 /login；访问 API 返回 401
//   2. CSRF：按真实 Host 判断同源，跨站写请求一律 403
//   3. 页面响应加 no-store，避免登录后页面被浏览器历史缓存
// 当前用户写入 locals.user，页面与接口通过 Astro.locals 读取。

import { defineMiddleware } from 'astro:middleware';
import './lib/load-env';
import { getCurrentUser } from './lib/auth-guard';
import type { PublicUser } from './lib/auth';

/** 无需登录即可访问 */
const PUBLIC_PATHS = new Set(['/login', '/register', '/api/health', '/api/auth/login', '/api/auth/register', '/favicon.svg', '/robots.txt']);
const PUBLIC_PREFIXES = ['/_astro', '/assets', '/src/', '/placeholder.svg'];
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
declare global {
  namespace App {
    interface Locals {
      user: PublicUser | null;
    }
  }
}

export const onRequest = defineMiddleware(async (context, next) => {
  const requestUrl = new URL(context.request.url);
  const path = requestUrl.pathname;
  const isApi = path.startsWith('/api/');
  const isPublic = PUBLIC_PATHS.has(path) || PUBLIC_PREFIXES.some((p) => path.startsWith(p));

  // CSRF：非安全方法先做同源校验（浏览器同源 DELETE 可能不带 Origin，见 isCrossSite 注释）
  const method = context.request.method.toUpperCase();
  if (!SAFE_METHODS.has(method)) {
    if (isCrossSite(context.request)) {
      return new Response('Cross-site request forbidden', { status: 403 });
    }
    if (!context.request.headers.has('content-type')) {
      const headers = new Headers(context.request.headers);
      headers.set('content-type', 'application/json');
      context.request = new Request(context.request, { headers });
    }
  }

  // 登录态
  const user = isPublic ? await getCurrentUser(context).catch(() => null) : await getCurrentUser(context);
  context.locals.user = user;

  if (!isPublic && !user) {
    if (isApi) {
      return json({ ok: false, error: '未登录或登录已过期，请重新登录。' }, 401);
    }
    const next = encodeURIComponent(path + requestUrl.search);
    const res = context.redirect(`/login?next=${next}`);
    res.headers.set('Cache-Control', 'no-store');
    return res;
  }

  // 已登录再访问登录/注册页 → 回到首页
  if (user && (path === '/login' || path === '/register')) {
    return context.redirect('/');
  }

  const response = await next();
  if (!isApi && !PUBLIC_PREFIXES.some((p) => path.startsWith(p))) {
    response.headers.set('Cache-Control', 'no-store');
  }
  return response;
});

function isCrossSite(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) {
    // 浏览器同源 DELETE 通常不带 Origin。跨站伪造页面里，脚本发起的写请求自带 Origin；
    // 普通表单无法发 DELETE/PATCH，因此这里放行。
    return false;
  }
  try {
    const originUrl = new URL(origin);
    const requestHost = new URL(request.url).host;
    const forwardedHost = request.headers.get('x-forwarded-host');
    const hostHeader = request.headers.get('host');
    const candidates = new Set([requestHost, hostHeader, forwardedHost].filter(Boolean).map((h) => String(h).toLowerCase()));
    // 回环地址之间视为同源：127.0.0.1 与 localhost 不同字符串但同属本机
    const normalize = (h: string) => h.replace(/^localhost(?=:|$)/, '127.0.0.1');
    const o = normalize(originUrl.host.toLowerCase());
    for (const c of candidates) if (normalize(c) === o) return false;
    return true;
  } catch {
    return true;
  }
}

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
