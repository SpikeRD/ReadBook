// 端到端测试：启动已构建的服务，验证账号体系、数据隔离、文章、翻译、CSRF 等核心链路。
// 运行：npm test（会先构建）
// 使用独立的数据目录与端口，不影响你本地的 data/。
//
// 注意：测试进程用 spawn 拉起服务；在受限沙箱里若无法捕获子进程输出（EPERM），
// 请直接在常规 PowerShell 里运行 npm test。

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4599;
const BASE = `http://127.0.0.1:${PORT}`;
const ORIGIN = BASE;
let child;
let tmpDir;

async function waitFor(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* 服务还没起来 */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('server start timeout: ' + url);
}

before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'readbook-test-'));
  // 临时移走项目根 .env，避免覆盖测试环境变量
  const envFile = path.join(root, '.env');
  const envBak = path.join(root, '.env.test-bak');
  if (existsSync(envFile)) await fs.rename(envFile, envBak);

  const prep = spawn(process.execPath, [path.join(root, 'scripts', 'prepare.mjs')], {
    cwd: root,
    env: { ...process.env, DATA_DIR: tmpDir },
    stdio: 'ignore',
  });
  await new Promise((resolve, reject) => {
    prep.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('prepare failed'))));
  });
  if (existsSync(envBak)) await fs.rename(envBak, envFile);

  child = spawn(process.execPath, [path.join(root, 'dist', 'server', 'entry.mjs')], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DATA_DIR: tmpDir,
      SESSION_SECRET: 'test-secret',
      ONLINE_DICT_URL: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d.toString()));
  child.on('exit', (code) => {
    if (code && code !== 0) console.error('server exited with', code, stderr);
  });
  await waitFor(`${BASE}/api/health`);
});

after(async () => {
  child?.kill();
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

/** 带 Origin 的请求（同源写请求） */
async function req(pathname, { method = 'GET', body, cookie, origin = ORIGIN } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  if (origin) headers.origin = origin;
  const res = await fetch(BASE + pathname, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* 非 JSON */
  }
  return { res, status: res.status, data, text, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
}

async function register(name, password = 'secret123') {
  const r = await req('/api/auth/register', { method: 'POST', body: { username: name, password } });
  assert.equal(r.status, 200, r.text);
  return r.cookie;
}

const uniq = () => `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/* ───────────── 账号 ───────────── */

test('未登录：页面跳转登录页，接口返回 401', async () => {
  const page = await req('/', { origin: null });
  assert.equal(page.status, 302);
  assert.match(page.res.headers.get('location'), /^\/login/);
  const api = await req('/api/articles');
  assert.equal(api.status, 401);
  const home = await fetch(`${BASE}/login`);
  assert.equal(home.status, 200);
});

test('注册与登录：校验用户名、密码强度与重复', async () => {
  const name = uniq();
  const cookie = await register(name);
  assert.match(cookie, /^rb_session=/);

  const dup = await req('/api/auth/register', { method: 'POST', body: { username: name, password: 'secret123' } });
  assert.equal(dup.status, 400);
  const weak = await req('/api/auth/register', { method: 'POST', body: { username: uniq(), password: '123' } });
  assert.equal(weak.status, 400);
  const badName = await req('/api/auth/register', { method: 'POST', body: { username: 'a b', password: 'secret123' } });
  assert.equal(badName.status, 400);

  const wrong = await req('/api/auth/login', { method: 'POST', body: { username: name, password: 'nope-nope' } });
  assert.equal(wrong.status, 401);
  const ok = await req('/api/auth/login', { method: 'POST', body: { username: name, password: 'secret123' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user.username, name);

  const me = await req('/api/auth/me', { cookie });
  assert.equal(me.status, 200);
  assert.equal(me.data.user.username, name);
});

test('数据隔离：两个用户的文章与生词本互不可见', async () => {
  const cookieA = await register(uniq());
  const cookieB = await register(uniq());

  const created = await req('/api/articles', {
    method: 'POST',
    cookie: cookieA,
    body: { title: 'A 的文章', text: 'Reading builds vocabulary and memory.' },
  });
  assert.equal(created.status, 200);
  const articleId = created.data.article.id;

  const listA = await req('/api/articles', { cookie: cookieA });
  const listB = await req('/api/articles', { cookie: cookieB });
  // 新账号会各有 1 篇欢迎示例文章，A 多出自己导入的那篇
  assert.ok(listA.data.articles.some((a) => a.id === articleId));
  assert.ok(!listB.data.articles.some((a) => a.id === articleId), 'B 不应看到 A 的文章');
  assert.equal(listB.data.articles.length, 1, 'B 只有自己的欢迎文章');

  // B 无法读取 A 的文章
  const readByB = await req(`/read/${articleId}`, { cookie: cookieB, origin: null });
  assert.equal(readByB.status, 302);
  const readByA = await req(`/read/${articleId}`, { cookie: cookieA, origin: null });
  assert.equal(readByA.status, 200);

  // 生词本隔离
  await req('/api/vocabulary', {
    method: 'PUT',
    cookie: cookieA,
    body: { version: 2, groups: [], entries: [{ word: 'memory', translation: 'n. 记忆', articleId, articleTitle: 'A', tag: null, example: '', createdAt: Date.now(), mastered: false }] },
  });
  const vocabA = await req('/api/vocabulary', { cookie: cookieA });
  const vocabB = await req('/api/vocabulary', { cookie: cookieB });
  assert.equal(vocabA.data.entries.length, 1);
  assert.equal(vocabB.data.entries.length, 0);
});

test('换设备：同一账号重新登录后数据仍在', async () => {
  const name = uniq();
  const deviceOne = await register(name);
  await req('/api/vocabulary', {
    method: 'PUT',
    cookie: deviceOne,
    body: { version: 2, groups: [{ id: 'g1', name: '分组一', createdAt: 1 }], entries: [{ word: 'alpha', translation: '一', articleId: null, articleTitle: '', tag: 'g1', example: '', createdAt: 1, mastered: true }] },
  });

  const login = await req('/api/auth/login', { method: 'POST', body: { username: name, password: 'secret123' } });
  const deviceTwo = login.cookie;
  const vocab = await req('/api/vocabulary', { cookie: deviceTwo });
  assert.equal(vocab.data.entries.length, 1);
  assert.equal(vocab.data.groups[0].name, '分组一');
  assert.equal(vocab.data.entries[0].mastered, true);
});

test('导入本地旧数据：合并且去重', async () => {
  const cookie = await register(uniq());
  const payload = {
    version: 2,
    groups: [{ id: 'legacy', name: '旧分组', createdAt: 1 }],
    entries: [{ word: 'legacy', translation: '旧', articleId: 'x1', articleTitle: '旧文章', tag: null, example: '', createdAt: 1, mastered: false }],
  };
  const first = await req('/api/vocabulary/import', { method: 'POST', cookie, body: payload });
  assert.equal(first.status, 200);
  assert.equal(first.data.added, 1);
  const second = await req('/api/vocabulary/import', { method: 'POST', cookie, body: payload });
  assert.equal(second.data.added, 0);
  assert.equal(second.data.skipped, 1);
});

test('改密码后旧会话失效，当前设备保持登录', async () => {
  const name = uniq();
  const oldCookie = await register(name);
  const changed = await req('/api/auth/password', {
    method: 'POST',
    cookie: oldCookie,
    body: { oldPassword: 'secret123', newPassword: 'brandnew99' },
  });
  assert.equal(changed.status, 200);
  assert.ok(changed.cookie);

  const stale = await req('/api/vocabulary', { cookie: oldCookie });
  assert.equal(stale.status, 401);
  const fresh = await req('/api/vocabulary', { cookie: changed.cookie });
  assert.equal(fresh.status, 200);

  const oldLogin = await req('/api/auth/login', { method: 'POST', body: { username: name, password: 'secret123' } });
  assert.equal(oldLogin.status, 401);
  const newLogin = await req('/api/auth/login', { method: 'POST', body: { username: name, password: 'brandnew99' } });
  assert.equal(newLogin.status, 200);
});

test('退出登录后会话清除', async () => {
  const cookie = await register(uniq());
  const out = await req('/api/auth/logout', { cookie, origin: null });
  assert.equal(out.status, 302);
  assert.match(out.res.headers.get('set-cookie') || '', /rb_session=;/);
});

/* ───────────── 业务功能（以已登录用户身份） ───────────── */

test('查词：本地命中 + 词形还原 + 未收录', async () => {
  const cookie = await register(uniq());
  const hello = await req('/api/lookup?w=hello', { cookie });
  assert.equal(hello.data.found, true);
  const running = await req('/api/lookup?w=running', { cookie });
  assert.equal(running.data.matched, 'run');
  assert.equal(running.data.source, 'lemma');
  const missing = await req('/api/lookup?w=zzqxwv', { cookie });
  assert.equal(missing.data.found, false);
  const invalid = await req('/api/lookup?w=a%20b', { cookie });
  assert.equal(invalid.status, 400);
});

test('文章：导入（含标题推断）→ 阅读页渲染 → 改标题 → 删除', async () => {
  const cookie = await register(uniq());
  const created = await req('/api/articles', {
    method: 'POST',
    cookie,
    body: { title: '', text: '# Test Heading\n\nFirst paragraph with vocabulary and memory.\n\nSecond paragraph.' },
  });
  assert.equal(created.status, 200);
  const id = created.data.article.id;
  assert.equal(created.data.article.title, 'Test Heading');

  const page = await req(`/read/${id}`, { cookie, origin: null });
  assert.equal(page.status, 200);
  assert.ok((page.text.match(/class="word"/g) || []).length > 5);
  assert.match(page.text, /<h2>Test Heading<\/h2>/);

  const renamed = await req(`/api/articles?id=${id}`, { method: 'PATCH', cookie, body: { title: '改过的标题' } });
  assert.equal(renamed.status, 200);
  const afterRename = await req('/api/articles', { cookie });
  assert.equal(afterRename.data.articles[0].title, '改过的标题');

  const del = await req(`/api/articles?id=${id}`, { method: 'DELETE', cookie });
  assert.equal(del.status, 200);
  const gone = await req(`/read/${id}`, { cookie, origin: null });
  assert.equal(gone.status, 302);
});

test('超过 1MB 的单篇导入被拒绝', async () => {
  const cookie = await register(uniq());
  const big = 'word '.repeat(220000);
  const res = await req('/api/articles', { method: 'POST', cookie, body: { title: '太大', text: big } });
  assert.equal(res.status, 413);
  assert.equal(res.data.ok, false);
});

test('全文翻译：参数校验、按页翻译、命中缓存、译文随页面渲染', async () => {
  const cookie = await register(uniq());
  const noId = await req('/api/translate', { method: 'POST', cookie, body: {} });
  assert.equal(noId.status, 400);
  const missing = await req('/api/translate', { method: 'POST', cookie, body: { id: 'not-exist' } });
  assert.equal(missing.status, 404);

  const text = 'Reading is a simple habit. A few pages every morning can change how you think.';
  const created = await req('/api/articles', { method: 'POST', cookie, body: { title: 'Translate', text } });
  const articleId = created.data.article.id;

  // 空 blocks 应被拒绝
  const noBlocks = await req('/api/translate', { method: 'POST', cookie, body: { id: articleId, page: 1, blocks: [] } });
  assert.equal(noBlocks.status, 400);

  // 伪造的 blocks（文本与文章不符）应被过滤掉
  const forged = await req('/api/translate', {
    method: 'POST',
    cookie,
    body: { id: articleId, page: 1, blocks: [{ index: 0, text: 'not in article' }] },
  });
  assert.equal(forged.status, 400);

  const blocks = [{ index: 0, text }];
  let res;
  try {
    res = await req('/api/translate', { method: 'POST', cookie, body: { id: articleId, page: 1, totalPages: 1, blocks } });
  } catch {
    return; // 离网时跳过
  }
  if (res.status === 503 || res.status === 502) {
    assert.equal(res.data.ok, false);
    assert.ok(typeof res.data.error === 'string');
    return;
  }
  assert.equal(res.status, 200);
  assert.equal(res.data.ok, true);
  assert.equal(res.data.cached, false);
  const units = res.data.units;
  assert.equal(units.length, 1);
  assert.ok(units[0].target.length > 0, '第 0 段没有译文');

  // 第二次请求应命中缓存
  const again = await req('/api/translate', { method: 'POST', cookie, body: { id: articleId, page: 1, totalPages: 1, blocks } });
  assert.equal(again.data.cached, true);
  assert.equal(again.data.units[0].target, units[0].target);

  // 刷新页面时应由服务端直接渲染出译文
  const page = await req(`/read/${articleId}`, { cookie, origin: null });
  assert.match(page.text, /data-has-cache="1"/, '已翻译的内容应随页面一起渲染');
});

test('CSRF：同源 DELETE 放行，跨站写请求 403', async () => {
  const cookie = await register(uniq());
  const created = await req('/api/articles', { method: 'POST', cookie, body: { title: 'CSRF', text: 'hello world again' } });
  const id = created.data.article.id;

  const cross = await req(`/api/articles?id=${id}`, { method: 'DELETE', cookie, origin: 'http://evil.example' });
  assert.equal(cross.status, 403);
  const stillThere = await req('/api/articles', { cookie });
  assert.ok(stillThere.data.articles.some((a) => a.id === id));

  const same = await req(`/api/articles?id=${id}`, { method: 'DELETE', cookie });
  assert.equal(same.status, 200);
});
