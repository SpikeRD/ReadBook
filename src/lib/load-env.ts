// 从项目根 .env 加载环境变量（Node 20.12+ 内置，不依赖 dotenv）。
//
// 优先级：进程环境变量 > .env 文件 > 代码默认值。
// 这样在 Docker / 系统服务里用 `-e ADMIN_PASSWORD=...` 设置的变量一定能覆盖镜像或仓库里的 .env。

import { existsSync } from 'node:fs';
import path from 'node:path';

const envFile = path.resolve(process.cwd(), '.env');

if (existsSync(envFile)) {
  // 记录已被外部显式设置的键，加载 .env 后还原它们
  const preset = new Map<string, string>();
  for (const key of ['SESSION_SECRET', 'SESSION_DAYS', 'DATA_DIR', 'HOST', 'PORT', 'COOKIE_SECURE', 'ONLINE_DICT_URL', 'ONLINE_TRANSLATE_URL', 'ADMIN_USERNAME', 'ADMIN_PASSWORD']) {
    const v = process.env[key];
    if (v !== undefined) preset.set(key, v);
  }
  try {
    process.loadEnvFile(envFile);
  } catch {
    /* .env 格式有问题时忽略，使用默认值 */
  }
  for (const [key, value] of preset) process.env[key] = value;
}
