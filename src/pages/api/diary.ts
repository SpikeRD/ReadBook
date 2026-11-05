// 日记接口（数据按当前登录用户隔离，写请求的同源校验由 middleware 统一处理）
//   GET    /api/diary               该账号的全部日记（日期倒序）
//   GET    /api/diary?id=xxx        单篇
//   POST   /api/diary               新增：{ date, title?, body }
//   PATCH  /api/diary               修改：{ id, date?, title?, body? }
//   DELETE /api/diary?id=xxx        删除
//
// 存在 data/users/<userId>/diary.json；id 经过路径安全校验，读不到别人的日记。

import type { APIRoute } from 'astro';
import '../../lib/load-env';
import { addEntry, deleteEntry, getEntry, listEntries, updateEntry } from '../../lib/diary';
import { requireUser } from '../../lib/auth-guard';

export const GET: APIRoute = async (ctx) => {
  const auth = await requireUser(ctx);
  if ('response' in auth) return auth.response;

  const id = ctx.url.searchParams.get('id');
  if (id) {
    const entry = await getEntry(auth.user.id, id);
    if (!entry) return json({ ok: false, error: '日记不存在' }, 404);
    return json({ ok: true, entry });
  }

  const entries = await listEntries(auth.user.id);
  return json({ ok: true, entries });
};

export const POST: APIRoute = async (ctx) => {
  const auth = await requireUser(ctx);
  if ('response' in auth) return auth.response;

  const body = (await ctx.request.json().catch(() => ({}))) as {
    date?: unknown;
    title?: unknown;
    body?: unknown;
  };
  const result = await addEntry(auth.user.id, {
    date: body.date,
    title: body.title,
    body: body.body,
  });
  if (!result.ok) return json({ ok: false, error: result.error }, 400);
  return json({ ok: true, entry: result.entry });
};

export const PATCH: APIRoute = async (ctx) => {
  const auth = await requireUser(ctx);
  if ('response' in auth) return auth.response;

  const body = (await ctx.request.json().catch(() => ({}))) as {
    id?: unknown;
    date?: unknown;
    title?: unknown;
    body?: unknown;
  };
  const result = await updateEntry(auth.user.id, String(body.id ?? ''), {
    date: body.date,
    title: body.title,
    body: body.body,
  });
  if (!result.ok) return json({ ok: false, error: result.error }, 400);
  return json({ ok: true, entry: result.entry });
};

export const DELETE: APIRoute = async (ctx) => {
  const auth = await requireUser(ctx);
  if ('response' in auth) return auth.response;

  const id = ctx.url.searchParams.get('id') || '';
  const ok = await deleteEntry(auth.user.id, id);
  return ok ? json({ ok: true }) : json({ ok: false, error: '日记不存在' }, 404);
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
