// 运行时环境配置：从 process.env 读取，带默认值。
// 本机开发不需要 .env 也能跑（账号存在 data/users.json）。

export interface AppEnv {
  /** 会话签名密钥 */
  secret: string;
  dataDir: string;
  port: number;
  host: string;
  /** 在线词典兜底接口模板，含 {word} 占位；为空则关闭兜底 */
  onlineDictUrl: string;
  /** 自定义翻译接口模板，含 {q} 与 {to} 占位；为空则使用 site.ts 里的默认 provider */
  translateUrl: string;
  /** 管理员用户名（.env 的 ADMIN_USERNAME，默认 admin） */
  adminUsername: string;
  /** 管理员密码（.env 的 ADMIN_PASSWORD，默认 admin；上线前务必修改） */
  adminPassword: string;
  /** 会话有效天数 */
  sessionDays: number;
}

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function readEnv(): AppEnv {
  return {
    secret: process.env.SESSION_SECRET || 'dev-only-secret-please-change-me',
    dataDir: process.env.DATA_DIR || 'data',
    port: num(process.env.PORT, 4321),
    host: process.env.HOST || '127.0.0.1',
    onlineDictUrl: process.env.ONLINE_DICT_URL || '',
    translateUrl: process.env.ONLINE_TRANSLATE_URL || '',
    adminUsername: (process.env.ADMIN_USERNAME || 'admin').trim(),
    adminPassword: process.env.ADMIN_PASSWORD ?? 'admin',
    sessionDays: num(process.env.SESSION_DAYS, 30),
  };
}

export const isProduction = process.env.NODE_ENV === 'production';
