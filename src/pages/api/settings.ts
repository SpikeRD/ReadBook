// 翻译设置接口
//   GET  /api/settings   → 当前账号的翻译设置（API Key 只回传尾巴）
//   PUT  /api/settings   → 保存翻译设置
//        body: { provider: 'default' | 'custom', apiUrl?: string, apiKey?: string }
//        apiKey 省略（不传该字段）表示「保留已保存的密钥」，传空字符串表示清除。
//
// 设置存在 data/users/<userId>/settings.json，按账号隔离，换设备登录即生效。

import type { APIRoute } from 'astro';
import '../../lib/load-env';
import { requireUser } from '../../lib/auth-guard';
import { siteConfig } from '../../config/site';
import { getProvider } from '../../lib/translate';
import {
  getUserTranslationSettings,
  saveTranslationSettings,
  validateTranslationSettings,
  maskApiKey,
} from '../../lib/translate-settings';

/** 组装给前端的视图：密钥永远不出现明文 */
async function view(userId: string) {
  const settings = await getUserTranslationSettings(userId);
  // 站点默认服务商（不受账号设置影响）
  const siteProvider = getProvider(null);
  return {
    ok: true,
    configurable: siteConfig.translation.userConfigurable,
    translation: {
      provider: settings.provider,
      apiUrl: settings.apiUrl,
      hasKey: settings.apiKey.length > 0,
      keyHint: maskApiKey(settings.apiKey),
      updatedAt: settings.updatedAt ?? null,
    },
    siteDefault: {
      provider: siteProvider?.id ?? siteConfig.translation.provider,
      label: siteProvider?.label ?? '未启用',
    },
  };
}

export const GET: APIRoute = async (ctx) => {
  const auth = await requireUser(ctx);
  if ('response' in auth) return auth.response;
  return json(await view(auth.user.id));
};

export const PUT: APIRoute = async (ctx) => {
  const auth = await requireUser(ctx);
  if ('response' in auth) return auth.response;

  if (!siteConfig.translation.userConfigurable) {
    return json({ ok: false, error: '本站不允许单独设置翻译服务商，请联系站长。' }, 403);
  }

  const body = (await ctx.request.json().catch(() => ({}))) as {
    provider?: unknown;
    apiUrl?: unknown;
    apiKey?: unknown;
  };

  const provider = body.provider === 'custom' ? 'custom' : 'default';
  // 未传（或传非字符串）表示「保留已保存的值」；传空字符串才是清空
  const apiUrl = typeof body.apiUrl === 'string' ? body.apiUrl.trim() : undefined;
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : undefined;

  const current = await getUserTranslationSettings(auth.user.id);
  const error = validateTranslationSettings({
    provider,
    apiUrl: apiUrl ?? current.apiUrl,
    apiKey: apiKey ?? current.apiKey,
  });
  if (error) return json({ ok: false, error }, 400);

  await saveTranslationSettings(auth.user.id, { provider, apiUrl, apiKey });
  return json(await view(auth.user.id));
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
