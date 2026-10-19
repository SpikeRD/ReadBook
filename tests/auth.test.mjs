// 账号与鉴权单元测试：密码哈希、用户名/密码校验、会话 token。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, validateUsername, validatePassword } from '../src/lib/auth.ts';
import { createSession, parseSession, verifySession } from '../src/lib/session.ts';

test('密码哈希可验证且每次不同（加盐）', async () => {
  const h1 = await hashPassword('secret123');
  const h2 = await hashPassword('secret123');
  assert.notEqual(h1, h2);
  assert.match(h1, /^scrypt\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.equal(await verifyPassword('secret123', h1), true);
  assert.equal(await verifyPassword('secret124', h1), false);
  assert.equal(await verifyPassword('secret123', 'garbage'), false);
  assert.equal(await verifyPassword('secret123', 'md5$abc$def'), false);
});

test('用户名规则：长度与字符集', () => {
  assert.equal(validateUsername('a').ok, false);
  assert.equal(validateUsername('alice').ok, true);
  assert.equal(validateUsername('张三').ok, true);
  assert.equal(validateUsername('a_b-c1').ok, true);
  assert.equal(validateUsername('bad name').ok, false);
  assert.equal(validateUsername('x'.repeat(30)).ok, false);
});

test('密码至少 6 位', () => {
  assert.equal(validatePassword('12345').ok, false);
  assert.equal(validatePassword('123456').ok, true);
  assert.equal(validatePassword('x'.repeat(300)).ok, false);
});

test('会话 token 携带用户与版本，篡改或过期失效', () => {
  const opts = { secret: 's3cret', days: 30 };
  const token = createSession('user-1', 3, opts);
  const payload = parseSession(token, opts);
  assert.equal(payload?.u, 'user-1');
  assert.equal(payload?.v, 3);

  const [body, sig] = token.split('.');
  assert.equal(parseSession(`${body}.${sig.slice(0, -2)}xx`, opts), null);
  assert.equal(parseSession(token, { ...opts, secret: 'other' }), null);
  assert.equal(parseSession('garbage', opts), null);
  assert.equal(verifySession(token, opts), true);

  const expired = createSession('u', 1, { secret: 'k', days: 1 }, Date.now() - 2 * 24 * 3600 * 1000);
  assert.equal(parseSession(expired, { secret: 'k', days: 1 }), null);
});

test('不同用户/版本产生不同 token', () => {
  const opts = { secret: 'k', days: 7 };
  assert.notEqual(createSession('a', 1, opts), createSession('b', 1, opts));
  assert.notEqual(createSession('a', 1, opts), createSession('a', 2, opts));
});
