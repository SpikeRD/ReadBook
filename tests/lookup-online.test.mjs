// 在线词典兜底测试：本地词库查不到时走在线接口。
//   - 不配置 ONLINE_DICT_URL 时用内置默认（有道 jsonapi）
//   - ONLINE_DICT_URL 可以换成自定义模板
//   - ONLINE_DICT_URL=off 完全关闭
//   - 「原样返回 / 返回仍是英文」不算查到
// 全部用 fetch stub，不依赖外网。

process.env.DSH_TEST_NO_ENV = '1';
process.env.ONLINE_DICT_URL = '';

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const { lookupWord } = await import('../src/lib/dict.ts');

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  process.env.ONLINE_DICT_URL = '';
});

/** 用一个只存在于本测试里的词，保证本地词库必然查不到 */
function stubJson(payload, onUrl) {
  globalThis.fetch = async (url) => {
    onUrl?.(String(url));
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
}

/** 有道词条形状：ec.word[0].trs[].tr[].l.i 是释义数组，usphone 是音标 */
const youdaoEntry = (lines, phone = '') => ({
  ec: { word: [{ trs: [{ tr: [{ l: { i: lines } }] }], usphone: phone }] },
});

test('默认配置下走内置在线兜底，并解析出中文释义与音标', async () => {
  let called = '';
  stubJson(youdaoEntry(['n. 意外发现美好事物的运气'], 'ˌserənˈdɪpəti'), (u) => (called = u));
  const r = await lookupWord('blorptastic');
  assert.equal(r.found, true);
  assert.equal(r.source, 'online');
  assert.equal(r.translation, 'n. 意外发现美好事物的运气');
  assert.equal(r.phonetic, 'ˌserənˈdɪpəti');
  assert.match(called, /dict\.youdao\.com/);
  assert.match(called, /blorptastic/);
});

test('没有 ec 词条时退回网络释义', async () => {
  stubJson({ web_trans: { 'web-translation': [{ trans: [{ value: '扔出窗外' }] }] } });
  const r = await lookupWord('flarnwuzzle');
  assert.equal(r.found, true);
  assert.equal(r.translation, '扔出窗外');
});

test('自定义 ONLINE_DICT_URL 模板优先于内置默认', async () => {
  process.env.ONLINE_DICT_URL = 'https://dict.example.test/lookup/{word}?lang=zh';
  let called = '';
  stubJson({ translation: '测试释义' }, (u) => (called = u));
  const r = await lookupWord('zibberquux');
  assert.equal(r.found, true);
  assert.equal(r.translation, '测试释义');
  assert.equal(called, 'https://dict.example.test/lookup/zibberquux?lang=zh');
});

test('ONLINE_DICT_URL=off 时不发请求，直接判为未收录', async () => {
  process.env.ONLINE_DICT_URL = 'off';
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error('不应该发请求');
  };
  const r = await lookupWord('quonktastic');
  assert.equal(called, false);
  assert.equal(r.found, false);
  assert.equal(r.source, 'none');
  assert.ok(r.externalUrl, '未收录也要给出在线词典链接');
});

test('在线接口原样返回输入词时视为未收录', async () => {
  stubJson({ web_trans: { 'web-translation': [{ trans: [{ value: 'vlimberous' }] }] } });
  const r = await lookupWord('vlimberous');
  assert.equal(r.found, false);
  assert.equal(r.source, 'none');
});

test('在线接口只返回英文时视为未收录（不把英文释义当中文）', async () => {
  stubJson(youdaoEntry(['a made up word indeed']));
  const r = await lookupWord('gribbleflux');
  assert.equal(r.found, false);
});

test('在线接口报错或超时不会把词永久记成未收录', async () => {
  globalThis.fetch = async () => {
    throw new Error('network down');
  };
  const first = await lookupWord('snorfleblat');
  assert.equal(first.found, false);
  // 网络恢复后同一个词还能再查出来（未命中的结果不进缓存）
  stubJson(youdaoEntry(['n. 虚构词']));
  const second = await lookupWord('snorfleblat');
  assert.equal(second.found, true);
  assert.equal(second.translation, 'n. 虚构词');
});
