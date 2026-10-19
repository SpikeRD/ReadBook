// 发音：优先浏览器语音合成（Web Speech API），失败时安静提示，不打断阅读。

let voices: SpeechSynthesisVoice[] = [];

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

export interface SpeakResult {
  ok: boolean;
  message?: string;
}

export function speak(word: string, lang = 'en-US'): SpeakResult {
  if (!word) return { ok: false, message: '没有可朗读的内容' };
  if (!supported()) {
    return { ok: false, message: '当前浏览器不支持语音合成' };
  }
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
    window.speechSynthesis.speak(utter);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: `发音失败：${(err as Error).message}` };
  }
}

export function stop(): void {
  if (supported()) window.speechSynthesis.cancel();
}

if (supported()) {
  window.speechSynthesis.onvoiceschanged = () => loadVoices();
  loadVoices();
}
