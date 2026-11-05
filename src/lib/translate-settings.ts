// 用户级翻译设置：data/users/<userId>/settings.json
//
//   { "translation": { "provider": "custom", "apiUrl": "...", "apiKey": "...", "updatedAt": "..." } }
//
// provider：
//   'default' —— 跟随站点配置（site.ts 的 translation.provider，默认腾讯翻译，免费免密钥）
//   'custom'  —— 用自己在设置页填的个人接口（apiUrl 必填，apiKey 可选）
//
// 该文件与 articles/、vocabulary.json、translations/ 平级，互不影响；
// 文件不存在时一律按「跟随站点默认」处理，所以老账号不需要做任何迁移。

import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { userDir } from './paths.ts';

export type TranslationProviderChoice = 'default' | 'custom';

export interface TranslationSettings {
  provider: TranslationProviderChoice;
  /** 个人接口 URL 模板，含 {q}（原文）与 {to}（目标语言），可选 {key} */
  apiUrl: string;
  /** 个人 API Key；为空表示不带认证 */
  apiKey: string;
  updatedAt?: string;
}

export interface UserSettings {
  translation: TranslationSettings;
}

/** 未配置时的默认值：跟随站点（免费腾讯翻译） */
export const DEFAULT_TRANSLATION_SETTINGS: TranslationSettings = {
  provider: 'default',
  apiUrl: '',
  apiKey: '',
};

function settingsFile(userId: string): string {
  return path.join(userDir(userId), 'settings.json');
}

/** 把任意输入收敛成合法的设置对象（读盘与写入共用，避免脏数据流进翻译流程） */
function normalize(input: unknown): TranslationSettings {
  const raw = (input && typeof input === 'object' ? input : {}) as Partial<TranslationSettings>;
  const provider: TranslationProviderChoice = raw.provider === 'custom' ? 'custom' : 'default';
  return {
    provider,
    apiUrl: typeof raw.apiUrl === 'string' ? raw.apiUrl.slice(0, 2000) : '',
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey.slice(0, 500) : '',
    ...(typeof raw.updatedAt === 'string' ? { updatedAt: raw.updatedAt } : {}),
  };
}

/** 读取某个账号的翻译设置；文件缺失或损坏时返回默认值（不抛错） */
export async function getUserTranslationSettings(userId: string): Promise<TranslationSettings> {
  const file = settingsFile(userId);
  if (!existsSync(file)) return { ...DEFAULT_TRANSLATION_SETTINGS };
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as Partial<UserSettings>;
    return normalize(parsed?.translation);
  } catch {
    return { ...DEFAULT_TRANSLATION_SETTINGS };
  }
}

/**
 * 保存翻译设置。
 * apiKey 传 undefined 表示「不修改已保存的值」，传空字符串表示「清除」。
 */
export async function saveTranslationSettings(
  userId: string,
  input: { provider?: unknown; apiUrl?: unknown; apiKey?: unknown }
): Promise<TranslationSettings> {
  const current = await getUserTranslationSettings(userId);
  const next = normalize({
    provider: input.provider ?? current.provider,
    apiUrl: input.apiUrl ?? current.apiUrl,
    apiKey: input.apiKey === undefined ? current.apiKey : input.apiKey,
    updatedAt: new Date().toISOString(),
  });

  const file = settingsFile(userId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const payload: UserSettings = { translation: next };
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8');
  await fs.rename(tmp, file);
  return next;
}

/** 设置页用：只暴露 Key 的尾巴，避免把明文密钥回传到浏览器 */
export function maskApiKey(apiKey: string): string {
  const key = apiKey.trim();
  if (!key) return '';
  if (key.length <= 4) return '••••';
  return `••••${key.slice(-4)}`;
}

/** 校验设置是否可用；返回 null 表示没问题 */
export function validateTranslationSettings(settings: TranslationSettings): string | null {
  if (settings.provider !== 'custom') return null;
  const url = settings.apiUrl.trim();
  if (!url) return '选择「个人接口」时需要填写接口地址。';
  if (!/^https?:\/\//i.test(url)) return '接口地址必须以 http:// 或 https:// 开头。';
  if (!url.includes('{q}')) return '接口地址里需要用 {q} 表示原文的位置，例如 https://api.example.com/translate?q={q}&to={to}';
  return null;
}
