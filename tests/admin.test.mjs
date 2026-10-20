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
// 这些用例要精确控制 ADMIN_* 与 DATA_DIR，禁止 src/lib/load-env 再按项目根目录的 .env 回填
process.env.DSH_TEST_NO_ENV = '1';

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

test('并发首次登录只会落一条管理员记录（回归：曾因请求并发产生重复 admin）', async () => {
  const fresh = await fs.mkdtemp(path.join(os.tmpdir(), 'readbook-admin-race-'));
  process.env.DATA_DIR = fresh;
  const racer = await import('../src/lib/auth.ts?race=1');
  try {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => racer.authenticate('boss', 'new-boss-pass').then(() => i))
    );
    assert.equal(results.length, 8, '所有并发登录都应完成');
    const list = await racer.listUsers();
    const admins = list.filter((u) => u.role === 'admin');
    assert.equal(admins.length, 1, `管理员记录应只有 1 条，实际 ${admins.length} 条：${admins.map((a) => a.id).join(',')}`);
  } finally {
    await fs.rm(fresh, { recursive: true, force: true }).catch(() => {});
    process.env.DATA_DIR = tmp;
  }
});

test('并发注册同一用户名只会成功一次（回归：曾因读-改-写竞争产生重复账号）', async () => {
  const fresh = await fs.mkdtemp(path.join(os.tmpdir(), 'readbook-reg-race-'));
  process.env.DATA_DIR = fresh;
  const racer = await import('../src/lib/auth.ts?regrace=1');
  try {
    const outcomes = await Promise.all(Array.from({ length: 6 }, () => racer.registerUser('dupe', 'pass12345')));
    assert.equal(outcomes.filter((r) => r.ok).length, 1, '同名并发注册只应有 1 次成功');
    const dupes = (await racer.listUsers()).filter((u) => u.username === 'dupe');
    assert.equal(dupes.length, 1, `数据表里应只有 1 条 dupe，实际 ${dupes.length} 条`);
  } finally {
    await fs.rm(fresh, { recursive: true, force: true }).catch(() => {});
    process.env.DATA_DIR = tmp;
  }
});

test('未配置管理员凭据时，第一个注册者成为站长（避免无管理员死局）', async () => {
  const fresh = await fs.mkdtemp(path.join(os.tmpdir(), 'readbook-bootstrap-'));
  const savedName = process.env.ADMIN_USERNAME;
  const savedPass = process.env.ADMIN_PASSWORD;
  process.env.DATA_DIR = fresh;
  process.env.ADMIN_USERNAME = '';
  process.env.ADMIN_PASSWORD = '';
  const boot = await import('../src/lib/auth.ts?bootstrap=1');
  try {
    const first = await boot.registerUser('owner', 'pass12345');
    assert.equal(first.ok, true);
    assert.equal(first.user.role, 'admin', '第一个注册者应成为站长');
    const second = await boot.registerUser('friend', 'pass12345');
    assert.equal(second.user.role, 'user', '后续注册者仍是普通用户');
  } finally {
    process.env.DATA_DIR = tmp;
    process.env.ADMIN_USERNAME = savedName;
    process.env.ADMIN_PASSWORD = savedPass;
    await fs.rm(fresh, { recursive: true, force: true }).catch(() => {});
  }
});

test('历史遗留的重复管理员记录可被清理（只保留最早一条）', async () => {
  const fresh = await fs.mkdtemp(path.join(os.tmpdir(), 'readbook-dedupe-'));
  process.env.DATA_DIR = fresh;
  const mod = await import('../src/lib/auth.ts?dedupe=1');
  try {
    // 构造三条同名管理员（模拟缺陷 B 留下的数据）
    await mod.authenticate('boss', 'new-boss-pass');
    const file = path.join(fresh, 'users.json');
    const list = JSON.parse(await fs.readFile(file, 'utf8'));
    const base = list[0];
    for (let i = 0; i < 2; i++) {
      list.push({ ...base, id: `dup${i}0000000`, createdAt: `2020-01-0${i + 1}T00:00:00.000Z` });
    }
    await fs.writeFile(file, JSON.stringify(list), 'utf8');

    const fixed = await mod.dedupeAdminRecords();
    assert.equal(fixed, 2, `应清理 2 条重复记录，实际 ${fixed}`);
    const after = JSON.parse(await fs.readFile(file, 'utf8'));
    const admins = after.filter((u) => u.role === 'admin');
    assert.equal(admins.length, 1);
    // 幂等：再跑一次什么都不做
    assert.equal(await mod.dedupeAdminRecords(), 0);
  } finally {
    process.env.DATA_DIR = tmp;
    await fs.rm(fresh, { recursive: true, force: true }).catch(() => {});
  }
});
