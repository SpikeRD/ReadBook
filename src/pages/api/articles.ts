// 文章接口（数据按当前登录用户隔离）
//   GET    /api/articles             当前用户的文章列表
//   POST   /api/articles             导入：{ title, text } 或 multipart(formData: file)
//   PATCH  /api/articles?id=xxx      重命名：{ title }
//   DELETE /api/articles?id=xxx      删除

import type { APIRoute } from 'astro';
import '../../lib/load-env';
import { createArticle, deleteArticle, listArticles, renameArticle } from '../../lib/articles';
import { requireUser } from '../../lib/auth-guard';
import { byteLength, inferTitle } from '../../lib/text';
import { siteConfig } from '../../config/site';

export const GET: APIRoute = async (ctx) => {
  const auth = await requireUser(ctx);
  if ('response' in auth) return auth.response;
  const list = await listArticles(auth.user.id);
  return json({ ok: true, articles: list });
};

export const POST: APIRoute = async (ctx) => {
  const auth = await requireUser(ctx);
  if ('response' in auth) return auth.response;

  const request = ctx.request;
  let title = '';
  let text = '';
  const type = request.headers.get('content-type') || '';

  if (type.includes('application/json')) {
    const body = (await request.json().catch(() => ({}))) as { title?: string; text?: string };
    title = String(body.title ?? '');
    text = String(body.text ?? '');
  } else {
    const form = await request.formData();
    const file = form.get('file');
    title = String(form.get('title') ?? '');
    text = String(form.get('text') ?? '');
    if (file && typeof file === 'object' && 'text' in file) {
      const f = file as File;
      if (f.size > siteConfig.limits.maxArticleBytes) {
        return json({ ok: false, error: '文件超过 1MB，请拆分后再导入。' }, 413);
      }
      const content = await f.text();
      text = text ? `${text}\n\n${content}` : content;
      if (!title) title = inferTitle(content, f.name.replace(/\.(txt|md|markdown)$/i, ''));
    }
  }

  if (byteLength(text) > siteConfig.limits.maxArticleBytes) {
    return json({ ok: false, error: '内容超过单篇 1MB 上限，请拆分后再导入。' }, 413);
  }
  if (!text.trim()) {
    return json({ ok: false, error: '没有可导入的内容，请粘贴文本或选择 txt / md 文件。' }, 400);
  }
  if (!title.trim()) title = inferTitle(text);

  const result = await createArticle(auth.user.id, { title, text });
  if (!result.ok) return json({ ok: false, error: result.error }, 400);
  return json({
    ok: true,
    article: { id: result.article!.id, title: result.article!.title, wordCount: result.article!.wordCount },
  });
};

export const PATCH: APIRoute = async (ctx) => {
  const auth = await requireUser(ctx);
  if ('response' in auth) return auth.response;
  const id = ctx.url.searchParams.get('id') || '';
  const body = (await ctx.request.json().catch(() => ({}))) as { title?: string };
  const ok = await renameArticle(auth.user.id, id, String(body.title ?? ''));
  return ok ? json({ ok: true }) : json({ ok: false, error: '文章不存在或标题为空' }, 404);
};

export const DELETE: APIRoute = async (ctx) => {
  const auth = await requireUser(ctx);
  if ('response' in auth) return auth.response;
  const id = ctx.url.searchParams.get('id') || '';
  const ok = await deleteArticle(auth.user.id, id);
  return ok ? json({ ok: true }) : json({ ok: false, error: '文章不存在' }, 404);
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
