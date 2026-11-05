// 发音兜底的地址拼装（纯函数部分；Web Speech 与 Audio 只能在浏览器里验证）。

process.env.DSH_TEST_NO_ENV = '1';

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { audioFallbackUrl } = await import('../src/scripts/client/speech.ts');
const { siteConfig } = await import('../src/config/site.ts');

test('词典音源地址按模板替换 {word}', () => {
  const url = audioFallbackUrl('serendipity');
  assert.equal(url, siteConfig.speechFallbackUrl.replace('{word}', 'serendipity'));
  assert.match(url, /audio=serendipity/);
});

test('单词里的特殊字符会被 URL 编码', () => {
  assert.match(audioFallbackUrl('a b'), /audio=a%20b/);
  assert.match(audioFallbackUrl('café'), /audio=caf%C3%A9/);
});

test('兜底地址是 http(s) 且带占位替换后的单词', () => {
  const url = audioFallbackUrl('hello');
  assert.match(url, /^https?:\/\//);
  assert.ok(!url.includes('{word}'));
});
