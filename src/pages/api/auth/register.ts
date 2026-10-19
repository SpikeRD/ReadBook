// POST /api/auth/register  body: { username, password }
// 第一个注册的账号会认领旧版单用户数据（文章 + 翻译缓存）。

import type { APIRoute } from 'astro';
import '../../../lib/load-env';
import { registerUser, countUsers, findUserById, getSessionVersion } from '../../../lib/auth';
import { startSession } from '../../../lib/auth-guard';
import { claimLegacyArticles, claimLegacyTranslations } from '../../../lib/articles';
import { seedWelcomeArticle } from '../../../lib/seed';
import { siteConfig } from '../../../config/site';

export const POST: APIRoute = async ({ request, cookies }) => {
  const body = (await request.json().catch(() => ({}))) as { username?: string; password?: string };
  if (!siteConfig.auth.allowRegistration) {
    return json({ ok: false, error: '本站已关闭自助注册，请联系站长开通账号。' }, 403);
  }

  const isFirstUser = (await countUsers()) === 0;
  const result = await registerUser(String(body.username ?? ''), String(body.password ?? ''));
  if (!result.ok || !result.user) return json({ ok: false, error: result.error }, 400);

  let claimed: { articles: number; translations: number } | null = null;
  if (isFirstUser) {
    // 旧版单用户数据移交给第一个账号，避免历史文章"消失"
    claimed = {
      articles: await claimLegacyArticles(result.user.id),
      translations: await claimLegacyTranslations(result.user.id),
    };
  }
  // 新用户没有任何文章时给一篇示例，避免首屏空白
  if (!claimed || claimed.articles === 0) {
    await seedWelcomeArticle(result.user.id);
  }

  const record = await findUserById(result.user.id);
  await startSession({ cookies }, result.user, record?.sessionVersion ?? (await getSessionVersion(result.user.id)));
  return json({ ok: true, user: result.user, claimed });
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
