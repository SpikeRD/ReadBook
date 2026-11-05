// 准备桌面版运行时：把服务端打成一个自包含文件 + 带上静态资源与词库
// 产物：desktop/runtime/{app/dist/{server,client}, seed/dict.db}
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.resolve(__dirname, '..');
const ROOT = path.resolve(DESKTOP, '..');
const RUNTIME = path.join(DESKTOP, 'runtime');
const APP = path.join(RUNTIME, 'app');
const requireFromRoot = createRequire(path.join(ROOT, 'package.json'));

const skipBuild = process.argv.includes('--skip-build');

function step(msg) {
  process.stdout.write(`\n▸ ${msg}\n`);
}

function dirSize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return total;
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// 1. 构建站点（Astro）
if (skipBuild) {
  step('跳过 astro build（--skip-build）');
} else {
  step('构建站点：npm run build');
  execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: true });
}

const distServer = path.join(ROOT, 'dist', 'server');
const distClient = path.join(ROOT, 'dist', 'client');
if (!fs.existsSync(path.join(distServer, 'entry.mjs'))) {
  console.error('找不到 dist/server/entry.mjs，请先执行 npm run build');
  process.exit(1);
}

// 2. 清理并重建 runtime
step('清理 desktop/runtime');
fs.rmSync(RUNTIME, { recursive: true, force: true });
fs.mkdirSync(path.join(APP, 'dist', 'server'), { recursive: true });
fs.mkdirSync(path.join(RUNTIME, 'seed'), { recursive: true });

// 3. 用 esbuild 把服务端打成单文件（node_modules 就不用带了）
step('打包服务端为单文件（esbuild）');
const esbuild = requireFromRoot('esbuild');
const banner = [
  "import { createRequire as __cr } from 'node:module';",
  "import { fileURLToPath as __fu } from 'node:url';",
  "import { dirname as __dn } from 'node:path';",
  'const require = __cr(import.meta.url);',
  'const __filename = __fu(import.meta.url);',
  'const __dirname = __dn(__filename);',
].join('\n');

await esbuild.build({
  entryPoints: [path.join(distServer, 'entry.mjs')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: path.join(APP, 'dist', 'server', 'server.mjs'),
  external: ['node:*'],
  banner: { js: banner },
  logLevel: 'error',
  minify: false,
});

// 4. 静态资源
step('复制静态资源 dist/client');
fs.cpSync(distClient, path.join(APP, 'dist', 'client'), { recursive: true });

// 5. 词库种子
const dictSrc = path.join(ROOT, 'data', 'dict.db');
if (!fs.existsSync(dictSrc)) {
  console.error('找不到 data/dict.db：先跑 npm run dict:fetch（联网下载 ECDICT 并生成）或 npm run dict:rebuild（已有 data/ecdict.csv 时）');
  process.exit(1);
}
step('复制词库种子 data/dict.db');
fs.copyFileSync(dictSrc, path.join(RUNTIME, 'seed', 'dict.db'));

// 6. 独立 node.exe（可选：放了就用它跑服务，否则用 Electron 内置 Node）
const bundledNode = path.join(RUNTIME, 'node', 'node.exe');
if (fs.existsSync(bundledNode)) {
  console.log(`  · 检测到自带 node：${bundledNode}`);
} else {
  console.log('  · 未附带 node.exe，将使用 Electron 内置 Node 运行服务');
}

const total = dirSize(RUNTIME);
step(`完成：runtime ${mb(total)}`);
console.log(`  · server.mjs ${mb(fs.statSync(path.join(APP, 'dist', 'server', 'server.mjs')).size)}`);
console.log(`  · client     ${mb(dirSize(path.join(APP, 'dist', 'client')))}`);
console.log(`  · dict.db    ${mb(fs.statSync(path.join(RUNTIME, 'seed', 'dict.db')).size)}`);
