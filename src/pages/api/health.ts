// GET /api/health —— 健康检查（不参与口令验证，方便部署探活）

import type { APIRoute } from 'astro';
import '../../lib/load-env';
import { dictStatus } from '../../lib/dict';

export const GET: APIRoute = async () => {
  const dict = dictStatus();
  return new Response(
    JSON.stringify({
      ok: true,
      time: new Date().toISOString(),
      node: process.version,
      dict,
    }),
    { headers: { 'content-type': 'application/json; charset=utf-8' } }
  );
};
