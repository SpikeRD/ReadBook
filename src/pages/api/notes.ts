// 笔记接口（数据按当前登录用户隔离，写请求的同源校验由 middleware 统一处理）
//   GET    /api/notes?articleId=xxx            该文章的笔记列表（按正文顺序）
//   POST   /api/notes                          新增：{ articleId, blockIndex, quote?, body }
//   PATCH  /api/notes                          修改正文：{ articleId, noteId, body }
//   DELETE /api/notes?articleId=xxx&noteId=yyy 删除
//
// 笔记存在 data/users/<userId>/notes.json，锚点是「全局块序号」，与页码无关。
// 所有接口都先用当前账号的文章列表校验 articleId 归属，避免读写别人的文章。

import type { APIRoute } from 'astro';
import '../../lib/load-env';
import { listArticles } from '../../lib/articles';
import { addNote, deleteNote, listArticleNotes, updateNote } from '../../lib/notes';
import { requireUser } from '../../lib/auth-guard';

async function ownsArticle(userId: string, articleId: string): Promise<boolean> {
  if (!articleId) return false;
  const list = await listArticles(userId);
  return list.some((a) => a.id === articleId);
}

export const GET: APIRoute = async (ctx) => {
  const auth = await requireUser(ctx);
  if ('response' in auth) return auth.response;

  const articleId = ctx.url.searchParams.get('id') || ctx.url.searchParams.get('articleId') || '';
  if (!(await ownsArticle(auth.user.id, articleId))) {
    return json({ ok: false, error: '文章不存在' }, 404);
  }
  const notes = await listArticleNotes(auth.user.id, articleId);
  return json({ ok: true, notes });
};

export const POST: APIRoute = async (ctx) => {
  const auth = await requireUser(ctx);
  if ('response' in auth) return auth.response;

  const body = (await ctx.request.json().catch(() => ({}))) as {
    articleId?: unknown;
    blockIndex?: unknown;
    quote?: unknown;
    body?: unknown;
  };
  const articleId = String(body.articleId ?? '');
  if (!(await ownsArticle(auth.user.id, articleId))) {
    return json({ ok: false, error: '文章不存在' }, 404);
  }

  const result = await addNote(auth.user.id, articleId, {
    blockIndex: Number(body.blockIndex),
    quote: String(body.quote ?? ''),
    body: String(body.body ?? ''),
  });
  if (!result.ok) return json({ ok: false, error: result.error }, 400);
  return json({ ok: true, note: result.note });
};

export const PATCH: APIRoute = async (ctx) => {
  const auth = await requireUser(ctx);
  if ('response' in auth) return auth.response;

  const body = (await ctx.request.json().catch(() => ({}))) as {
    articleId?: unknown;
    noteId?: unknown;
    body?: unknown;
  };
  const articleId = String(body.articleId ?? '');
  if (!(await ownsArticle(auth.user.id, articleId))) {
    return json({ ok: false, error: '文章不存在' }, 404);
  }

  const result = await updateNote(auth.user.id, articleId, String(body.noteId ?? ''), String(body.body ?? ''));
  if (!result.ok) return json({ ok: false, error: result.error }, 404);
  return json({ ok: true, note: result.note });
};

export const DELETE: APIRoute = async (ctx) => {
  const auth = await requireUser(ctx);
  if ('response' in auth) return auth.response;

  const articleId = ctx.url.searchParams.get('articleId') || ctx.url.searchParams.get('id') || '';
  const noteId = ctx.url.searchParams.get('noteId') || '';
  if (!(await ownsArticle(auth.user.id, articleId))) {
    return json({ ok: false, error: '文章不存在' }, 404);
  }

  const ok = await deleteNote(auth.user.id, articleId, noteId);
  return ok ? json({ ok: true }) : json({ ok: false, error: '笔记不存在' }, 404);
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
