// 会话：HMAC 签名的无状态 Cookie，负载带用户 id，不引入 session 表（2C2G 零额外内存）。
//
// token = base64url({ u: userId, v: 用户信息版本, e: 过期秒 }) . 签名

import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

export interface SessionOptions {
  secret: string;
  days: number;
}

export const SESSION_COOKIE = 'rb_session';
export const DEVICE_COOKIE = 'rb_device';

interface SessionPayload {
  /** 用户 id */
  u: string;
  /** 会话版本：改密码后递增，让旧会话全部失效 */
  v: number;
  /** 过期时间（秒） */
  e: number;
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function encode(payload: SessionPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

/** 生成 token */
export function createSession(userId: string, version: number, options: SessionOptions, now = Date.now()): string {
  const expires = Math.floor((now + options.days * 24 * 60 * 60 * 1000) / 1000);
  const body = encode({ u: userId, v: version, e: expires });
  return `${body}.${sign(body, options.secret)}`;
}

/** 解析并校验 token；无效返回 null */
export function parseSession(
  token: string | undefined | null,
  options: SessionOptions,
  now = Date.now()
): SessionPayload | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!safeEqual(sig, sign(body, options.secret))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (!payload || typeof payload.u !== 'string' || !payload.u) return null;
    if (typeof payload.e !== 'number' || payload.e * 1000 <= now) return null;
    if (typeof payload.v !== 'number') return null;
    return payload;
  } catch {
    return null;
  }
}

/** 兼容旧调用：只判断是否有效 */
export function verifySession(
  token: string | undefined | null,
  options: SessionOptions,
  now = Date.now()
): boolean {
  return parseSession(token, options, now) !== null;
}

/** 设备标识（可选，用于记录） */
export function createDeviceId(): string {
  return randomBytes(16).toString('hex');
}

export function sessionCookieOptions(days: number) {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    maxAge: days * 24 * 60 * 60,
    secure: process.env.COOKIE_SECURE === '1',
  };
}
