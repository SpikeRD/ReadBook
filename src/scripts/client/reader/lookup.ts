// 查词请求与缓存：同一单词只请求一次。

export interface LookupResponse {
  ok: boolean;
  word: string;
  matched?: string;
  phonetic?: string;
  translation?: string;
  definition?: string;
  source: 'local' | 'lemma' | 'online' | 'none';
  found: boolean;
  externalUrl?: string;
  error?: string;
}

const cache = new Map<string, LookupResponse>();

export function getCached(word: string): LookupResponse | undefined {
  return cache.get(word);
}

export async function lookup(word: string): Promise<LookupResponse> {
  const hit = cache.get(word);
  if (hit) return hit;
  try {
    const res = await fetch(`/api/lookup?w=${encodeURIComponent(word)}`);
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as LookupResponse;
    cache.set(word, data);
    return data;
  } catch {
    const fallback: LookupResponse = {
      ok: false,
      word,
      source: 'none',
      found: false,
      translation: '',
      externalUrl: `https://www.iciba.com/word?w=${encodeURIComponent(word)}`,
    };
    return fallback;
  }
}
