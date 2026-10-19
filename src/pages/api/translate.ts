// 全文翻译接口（按页请求 + 增量缓存）
//   POST /api/translate  body: { id, page, totalPages, blocks: [{index, text}], refresh? }
// 返回本页各段译文。已翻译的段落直接命中缓存，不会重复请求服务商。

import type { APIRoute } from 'astro';
import '../../lib/load-env';
import { getArticle } from '../../lib/articles';
import { translatePage, getProvider } from '../../lib/translate';
import { requireUser } from '../../lib/auth-guard';
import { siteConfig } from '../../config/site';

export const POST: APIRoute = async (ctx) => {
  const auth = await requireUser(ctx);
  if ('response' in auth) return auth.response;
  const body = (await ctx.request.json().catch(() => ({}))) as {
    id?: string;
    page?: number;
    totalPages?: number;
    blocks?: { index?: number; text?: string }[];
    refresh?: boolean;
  };
  const id = String(body.id ?? '');
  if (!id) return json({ ok: false, error: '缺少参数 id' }, 400);

  const article = await getArticle(auth.user.id, id);
  if (!article) return json({ ok: false, error: '文章不存在' }, 404);

  const cfg = siteConfig.translation;
  if (!getProvider()) {
    return json(
      {
        ok: false,
        error:
          cfg.provider === 'none'
            ? '全文翻译已在配置中关闭。'
            : '翻译接口未配置：请在 .env 设置 ONLINE_TRANSLATE_URL，或把 siteConfig.translation.provider 改为 "tencent"。',
        provider: cfg.provider,
      },
      503
    );
  }

  // 只接受本文真实存在的块，防止伪造请求撑爆缓存
  const valid = new Map(article.blocks.map((b, i) => [i, b.text]));
  const units = (Array.isArray(body.blocks) ? body.blocks : [])
    .map((b) => ({ index: Number(b?.index), text: String(b?.text ?? '') }))
    .filter((b) => Number.isInteger(b.index) && valid.has(b.index) && valid.get(b.index) === b.text)
    .slice(0, 400);
  if (units.length === 0) return json({ ok: false, error: '本页没有可翻译的内容' }, 400);

  const result = await translatePage({
    userId: auth.user.id,
    articleId: article.id,
    page: Number(body.page) || 1,
    totalPages: Number(body.totalPages) || 1,
    units,
    targetLang: cfg.targetLang,
    refresh: body.refresh === true,
  });

  if (!result.ok && result.units.length === 0) {
    return json({ ok: false, error: result.message || '翻译失败', provider: cfg.provider }, 502);
  }
  return json(result);
};

export const GET: APIRoute = async (ctx) => {
  const auth = await requireUser(ctx);
  if ('response' in auth) return auth.response;
  const id = ctx.url.searchParams.get('id') || '';
  if (!id) return json({ ok: false, error: '缺少参数 id' }, 400);
  // 兼容旧调用：整篇按「块」翻译（不分页），主要用于脚本 / 调试
  const article = await getArticle(auth.user.id, id);
  if (!article) return json({ ok: false, error: '文章不存在' }, 404);
  const cfg = siteConfig.translation;
  const result = await translatePage({
    userId: auth.user.id,
    articleId: article.id,
    page: 1,
    totalPages: 1,
    units: article.blocks.map((b, index) => ({ index, text: b.text })),
    targetLang: cfg.targetLang,
    refresh: ctx.url.searchParams.get('refresh') === '1',
  });
  return json(result);
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
