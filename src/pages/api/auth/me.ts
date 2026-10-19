// GET /api/auth/me —— 当前登录用户信息

import type { APIRoute } from 'astro';
import '../../../lib/load-env';
import { countUsers, getSessionVersion } from '../../../lib/auth';
import { requireUser } from '../../../lib/auth-guard';

export const GET: APIRoute = async (ctx) => {
  const auth = await requireUser(ctx);
  if ('response' in auth) return auth.response;
  return new Response(
    JSON.stringify({
      ok: true,
      user: auth.user,
      sessionVersion: await getSessionVersion(auth.user.id),
      isFirstUser: (await countUsers()) === 1,
    }),
    { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } }
  );
};
