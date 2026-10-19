// GET/POST /api/auth/logout —— 清除会话并回到登录页

import type { APIRoute } from 'astro';
import '../../../lib/load-env';
import { endSession } from '../../../lib/auth-guard';

export const GET: APIRoute = async ({ cookies, redirect }) => {
  endSession({ cookies });
  return redirect('/login');
};

export const POST = GET;
