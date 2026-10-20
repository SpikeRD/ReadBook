// 全文翻译接口（按页 + 预取后续页）
//   POST /api/translate
//     body: {
//       id,
//       page, totalPages,
//       blocks: [{index, text}],        当前页的块
//       prefetch?: [ { page, blocks } ] 需要一并预翻译的后续页
//       refresh?
//     }
//   返回当前页译文；预取页的译文写入缓存，翻到那页时自动带出。
//
//   GET /api/translate?id=...  兼容旧调用（整篇翻译，供脚本/调试）

import type { APIRoute } from 'astro';
import '../../lib/load-env';
import { getArticle } from '../../lib/articles';
import { translateRange, getProvider, translatePage } from '../../lib/translate';
import { requireUser } from '../../lib/auth-guard';
import { siteConfig } from '../../config/site';

interface IncomingBlock {
  index?: number;
  text?: string;
}

/** 校验并过滤某页的块：index 必须存在且文本与文章一致，防止伪造请求污染缓存 */
function pickValidUnits(incoming: IncomingBlock[] | undefined, valid: Map<number, string>, limit: number) {
  return (Array.isArray(incoming) ? incoming : [])
    .map((b) => ({ index: Number(b?.index), text: String(b?.text ?? '') }))
    .filter((b) => Number.isInteger(b.index) && valid.has(b.index) && valid.get(b.index) === b.text)
    .slice(0, limit);
}

export const POST: APIRoute = async (ctx) => {
  const auth = await requireUser(ctx);
  if ('response' in auth) return auth.response;
  const body = (await ctx.request.json().catch(() => ({}))) as {
    id?: string;
    page?: number;
    totalPages?: number;
    blocks?: IncomingBlock[];
    prefetch?: { page?: number; blocks?: IncomingBlock[] }[];
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

  // 文章真实的块内容（index -> text）
  const valid = new Map(article.blocks.map((b, i) => [i, b.text]));
  const page = Math.max(1, Number(body.page) || 1);

  const currentPageUnits = pickValidUnits(body.blocks, valid, 400);
  if (currentPageUnits.length === 0) return json({ ok: false, error: '本页没有可翻译的内容' }, 400);

  // 预取页：每页单独校验；页码必须大于当前页且在总页数内
  const totalPages = Math.max(1, Number(body.totalPages) || 1);
  const maxPrefetch = Math.max(1, cfg.prefetchPages - 1); // prefetchPages 含当前页
  const prefetch =
    (Array.isArray(body.prefetch) ? body.prefetch : [])
      .map((p) => ({ page: Number(p?.page) || 0, units: pickValidUnits(p?.blocks, valid, 400) }))
      .filter((p) => p.page > page && p.page <= totalPages && p.units.length > 0)
      .slice(0, maxPrefetch);

  const result = await translateRange({
    userId: auth.user.id,
    articleId: article.id,
    pages: [{ page, units: currentPageUnits }, ...prefetch.map((p) => ({ page: p.page, units: p.units }))],
    targetLang: cfg.targetLang,
    refresh: body.refresh === true,
  });

  if (!result.ok && result.currentPageUnits.length === 0) {
    return json({ ok: false, error: result.message || '翻译失败', provider: cfg.provider }, 502);
  }
  return json({
    ok: result.ok,
    articleId: article.id,
    page,
    provider: result.provider,
    providerLabel: result.providerLabel,
    targetLang: result.targetLang,
    cached: result.cached,
    failed: result.failed,
    message: result.message,
    units: result.currentPageUnits.map((u) => ({ index: u.index, target: u.target, error: u.error })),
    prefetched: result.prefetched,
  });
};

export const GET: APIRoute = async (ctx) => {
  const auth = await requireUser(ctx);
  if ('response' in auth) return auth.response;
  const id = ctx.url.searchParams.get('id') || '';
  if (!id) return json({ ok: false, error: '缺少参数 id' }, 400);
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
