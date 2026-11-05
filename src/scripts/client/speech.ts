// 发音：优先浏览器语音合成（Web Speech API）；
// 没有英文音色 / 合成失败 / 环境不支持时，退回词典音源播放单词读音。
// 两路都失败才提示，不打断阅读。

// 说明：这里用显式的 .ts 后缀，和 src/lib 下的写法一致——测试用 `node --test`
// 直接跑源码时，Node 的 ESM 解析器不会自动补扩展名。
import { siteConfig } from '../../config/site.ts';

let voices: SpeechSynthesisVoice[] = [];
let lastAudio: HTMLAudioElement | null = null;

function supported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function loadVoices(): SpeechSynthesisVoice[] {
  if (!supported()) return [];
  voices = window.speechSynthesis.getVoices();
  return voices;
}

export function hasEnglishVoice(): boolean {
  const list = loadVoices();
  if (list.length === 0) return true; // 有些浏览器延迟加载，先假定可用
  return list.some((v) => /^en([-_]|$)/i.test(v.lang));
}

/** 词典音源地址（纯函数，便于测试）；未配置兜底时返回空串 */
export function audioFallbackUrl(word: string): string {
  const template = siteConfig.speechFallbackUrl;
  if (!template) return '';
  return template.replace('{word}', encodeURIComponent(word));
}

export interface SpeakResult {
  ok: boolean;
  message?: string;
}

/** 用词典音源播放；播放被浏览器拦截时静默失败，不弹窗打断阅读 */
function playAudioFallback(word: string): SpeakResult {
  const url = audioFallbackUrl(word);
  if (!url || typeof Audio === 'undefined') {
    return { ok: false, message: '当前浏览器不支持语音合成，也没有可用的词典音源' };
  }
  try {
    lastAudio?.pause();
    const audio = new Audio(url);
    audio.preload = 'auto';
    lastAudio = audio;
    void audio.play().catch(() => {});
    return { ok: true };
  } catch (err) {
    return { ok: false, message: `发音失败：${(err as Error).message}` };
  }
}

export function speak(word: string, lang = 'en-US'): SpeakResult {
  if (!word) return { ok: false, message: '没有可朗读的内容' };

  // 浏览器没有语音合成，或者装了语音但没有英文音色 → 直接走词典音源
  if (!supported() || !hasEnglishVoice()) return playAudioFallback(word);

  try {
    window.speechSynthesis.cancel();
    const list = loadVoices();
    const utter = new SpeechSynthesisUtterance(word);
    utter.lang = lang;
    utter.rate = 0.92;
    const exact = list.find((v) => v.lang.replace('_', '-').toLowerCase() === lang.toLowerCase());
    const anyEnglish = list.find((v) => /^en([-_]|$)/i.test(v.lang));
    const voice = exact || anyEnglish;
    if (voice) utter.voice = voice;
    // 合成阶段报错（音色损坏、被策略拦截等）时静默退回音源
    utter.onerror = () => {
      playAudioFallback(word);
    };
    window.speechSynthesis.speak(utter);
    return { ok: true };
  } catch {
    return playAudioFallback(word);
  }
}

export function stop(): void {
  if (supported()) window.speechSynthesis.cancel();
  lastAudio?.pause();
}

if (supported()) {
  window.speechSynthesis.onvoiceschanged = () => loadVoices();
  loadVoices();
}
