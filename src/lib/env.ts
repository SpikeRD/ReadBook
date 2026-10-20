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
  /** 管理员密码是否来自 .env / 进程环境变量（而不是代码里的默认值 admin） */
  adminPasswordConfigured: boolean;
  /** 会话有效天数 */
  sessionDays: number;
}

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function readEnv(): AppEnv {
  // 注意：必须在读取时才判断。src/lib/load-env 负责把 .env 载入 process.env，
  // 如果在模块顶层取值，加载顺序不同就会拿到空值（曾经因此导致「默认密码」告警永远不显示）。
  const adminPassword = process.env.ADMIN_PASSWORD ?? 'admin';
  return {
    secret: process.env.SESSION_SECRET || 'dev-only-secret-please-change-me',
    dataDir: process.env.DATA_DIR || 'data',
    port: num(process.env.PORT, 4321),
    host: process.env.HOST || '127.0.0.1',
    onlineDictUrl: process.env.ONLINE_DICT_URL || '',
    translateUrl: process.env.ONLINE_TRANSLATE_URL || '',
    // 空字符串视为「未配置」：此前 `process.env.ADMIN_USERNAME || 'admin'` 把空串回退成 admin，
    // 而空值又会在用户表里写出一个「空用户名管理员」，两种结果都不是使用者想要的。
    adminUsername: (process.env.ADMIN_USERNAME ?? 'admin').trim(),
    adminPassword,
    adminPasswordConfigured: adminPassword !== '',
    sessionDays: num(process.env.SESSION_DAYS, 30),
  };
}

export const isProduction = process.env.NODE_ENV === 'production';
