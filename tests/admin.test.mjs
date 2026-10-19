// 管理员账号相关单元测试：.env 凭据、角色、密码重置、删除、自动生成密码。

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'readbook-admin-'));
process.env.DATA_DIR = tmp;
process.env.ADMIN_USERNAME = 'boss';
process.env.ADMIN_PASSWORD = 'boss-pass-1';

const auth = await import('../src/lib/auth.ts');

after(async () => {
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
});

test('首次用 .env 凭据登录会自动创建管理员账号', async () => {
  const listBefore = await auth.listUsers();
  assert.equal(listBefore.filter((u) => u.role === 'admin').length, 0);

  const ok = await auth.authenticate('boss', 'boss-pass-1');
  assert.equal(ok.ok, true);
  assert.equal(ok.user.role, 'admin');
  assert.equal(ok.user.username, 'boss');

  const listAfter = await auth.listUsers();
  assert.equal(listAfter.filter((u) => u.role === 'admin').length, 1);
});

test('管理员密码错误时登录失败', async () => {
  const bad = await auth.authenticate('boss', 'wrong-pass');
  assert.equal(bad.ok, false);
});

test('普通用户不能注册成管理员用户名', async () => {
  const r = await auth.registerUser('boss', 'whatever123');
  assert.equal(r.ok, false);
  assert.match(r.error, /管理员/);
});

test('.env 修改管理员密码后，新密码生效、旧密码失效', async () => {
  await auth.authenticate('boss', 'boss-pass-1');
  process.env.ADMIN_PASSWORD = 'new-boss-pass';
  const ok = await auth.authenticate('boss', 'new-boss-pass');
  assert.equal(ok.ok, true);
  // 旧密码必须失效
  const old = await auth.authenticate('boss', 'boss-pass-1');
  assert.equal(old.ok, false);
  // 版本号只增不减（保证旧会话不会被无限期沿用）
  const rec = await auth.findUserByName('boss');
  assert.ok(rec.sessionVersion >= 1);
});

test('管理员密码不能在页面修改（需改 .env）', async () => {
  const admin = await auth.findUserByName('boss');
  const r = await auth.changePassword(admin.id, 'new-boss-pass', 'another-pass');
  assert.equal(r.ok, false);
  assert.match(r.error, /ADMIN_PASSWORD/);
});

test('管理员可重置普通用户密码，旧密码立即失效', async () => {
  await auth.registerUser('member1', 'member-pass');
  const member = await auth.findUserByName('member1');
  assert.equal(member.role, 'user');

  const reset = await auth.adminResetPassword(member.id, 'reset-pass-9');
  assert.equal(reset.ok, true);
  assert.equal((await auth.authenticate('member1', 'member-pass')).ok, false);
  assert.equal((await auth.authenticate('member1', 'reset-pass-9')).ok, true);
});

test('管理员不能重置管理员密码，也不能删除管理员', async () => {
  const admin = await auth.findUserByName('boss');
  const reset = await auth.adminResetPassword(admin.id, 'hijack123');
  assert.equal(reset.ok, false);
  const del = await auth.adminDeleteUser(admin.id);
  assert.equal(del.ok, false);
});

test('删除用户会连带删除其数据目录', async () => {
  await auth.registerUser('member2', 'member2-pass');
  const member = await auth.findUserByName('member2');
  const dir = path.join(tmp, 'users', member.id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'vocabulary.json'), '{"entries":[]}', 'utf8');

  const del = await auth.adminDeleteUser(member.id);
  assert.equal(del.ok, true);
  assert.equal(await auth.findUserByName('member2'), null);
  await assert.rejects(() => fs.access(dir));
});

test('自动生成的密码满足长度要求且随机', () => {
  const a = auth.generatePassword(10);
  const b = auth.generatePassword(10);
  assert.equal(a.length, 10);
  assert.notEqual(a, b);
  assert.equal(auth.validatePassword(a).ok, true);
  assert.ok(!/[0O1lI]/.test(a), '避免易混淆字符');
});
