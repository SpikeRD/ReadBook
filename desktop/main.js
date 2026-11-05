// ReadBook 桌面启动器（Electron 主进程）
// 职责：一个设置界面 + 拉起 / 关闭本地 Node 服务（服务端已打成单文件，见 scripts/build-runtime.mjs）

const { app, BrowserWindow, ipcMain, shell, dialog, Menu } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');

const isWin = process.platform === 'win32';

// 固定应用名：决定配置与数据的落盘位置（%APPDATA%\ReadBook），避免用 package.json 的 name
app.setName('ReadBook');

// ── 路径 ──────────────────────────────────────────────────────
// 打包后 runtime 在 resources/runtime，开发时在 desktop/runtime
const RESOURCES = app.isPackaged ? process.resourcesPath : __dirname;
const RUNTIME = path.join(RESOURCES, 'runtime');
const APP_DIR = path.join(RUNTIME, 'app');
const SERVER_ENTRY = path.join(APP_DIR, 'dist', 'server', 'server.mjs');
const SEED_DICT = path.join(RUNTIME, 'seed', 'dict.db');
const BUNDLED_NODE = path.join(RUNTIME, 'node', isWin ? 'node.exe' : 'node');

const CONFIG_FILE = () => path.join(app.getPath('userData'), 'config.json');

// ── 配置 ──────────────────────────────────────────────────────
function defaultConfig() {
  return {
    port: 4321,
    lan: false,
    dataDir: path.join(app.getPath('userData'), 'data'),
    openOnStart: true,
    adminUser: 'admin',
    adminPassword: 'admin',
    sessionSecret: crypto.randomBytes(24).toString('hex'),
  };
}

function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE(), 'utf8'));
    return { ...defaultConfig(), ...raw };
  } catch {
    return defaultConfig();
  }
}

function saveConfig(next) {
  const cfg = { ...loadConfig(), ...next };
  fs.mkdirSync(path.dirname(CONFIG_FILE()), { recursive: true });
  fs.writeFileSync(CONFIG_FILE(), JSON.stringify(cfg, null, 2), 'utf8');
  return cfg;
}

// ── 运行状态 ──────────────────────────────────────────────────
let win = null;
let child = null;
let status = 'stopped'; // stopped | starting | running | stopping
let currentUrl = '';
const logs = [];
let stopping = false;

function pushLog(line) {
  const text = String(line).replace(/\u001b\[[0-9;]*m/g, '').trimEnd();
  if (!text) return;
  for (const part of text.split(/\r?\n/)) {
    logs.push(part);
    if (logs.length > 400) logs.shift();
  }
  sendState();
}

function setStatus(next) {
  status = next;
  sendState();
}

function snapshot() {
  const cfg = loadConfig();
  return {
    status,
    port: cfg.port,
    host: cfg.lan ? '0.0.0.0' : '127.0.0.1',
    url: currentUrl,
    pid: child ? child.pid : null,
    logs: logs.slice(-200),
    serverPath: SERVER_ENTRY,
  };
}

function sendState() {
  if (win && !win.isDestroyed()) win.webContents.send('server:state', snapshot());
}

// ── 工具 ──────────────────────────────────────────────────────
function portFree(port, host) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, host);
  });
}

function nodeCommand() {
  if (fs.existsSync(BUNDLED_NODE)) return { cmd: BUNDLED_NODE, extraEnv: {} };
  // 没带独立 node.exe 时，用 Electron 自带的 Node（ELECTRON_RUN_AS_NODE）
  return { cmd: process.execPath, extraEnv: { ELECTRON_RUN_AS_NODE: '1' } };
}

async function waitHealthy(port, timeoutMs = 25000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!child) return false;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 1500);
      const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) return true;
    } catch {
      /* 还没起来，继续等 */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

function stopServer() {
  return new Promise((resolve) => {
    if (!child) {
      setStatus('stopped');
      return resolve(true);
    }
    setStatus('stopping');
    const pid = child.pid;
    const done = () => {
      child = null;
      currentUrl = '';
      setStatus('stopped');
      resolve(true);
    };
    child.once('exit', done);
    if (isWin) {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
    } else {
      child.kill('SIGTERM');
    }
    setTimeout(() => {
      if (child) {
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      }
    }, 4000);
  });
}

async function startServer() {
  if (status === 'running' || status === 'starting') return { ok: false, error: '服务已在运行' };
  const cfg = loadConfig();

  const port = Number(cfg.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: '端口号需要是 1–65535 之间的整数' };
  }
  if (!fs.existsSync(SERVER_ENTRY)) {
    return { ok: false, error: `找不到服务端文件：${SERVER_ENTRY}` };
  }

  const host = cfg.lan ? '0.0.0.0' : '127.0.0.1';
  if (!(await portFree(port, host))) {
    return { ok: false, error: `端口 ${port} 已被占用，换一个端口再试` };
  }

  // 数据目录：不存在就建，并铺一份词库（首次运行）
  const dataDir = cfg.dataDir;
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const dictFile = path.join(dataDir, 'dict.db');
    if (!fs.existsSync(dictFile)) {
      if (fs.existsSync(SEED_DICT)) {
        fs.copyFileSync(SEED_DICT, dictFile);
        pushLog(`已初始化词库：${dictFile}`);
      } else {
        pushLog('警告：随包词库缺失，查词功能可能不可用');
      }
    }
  } catch (err) {
    return { ok: false, error: `数据目录不可用：${err.message}` };
  }

  const { cmd, extraEnv } = nodeCommand();
  setStatus('starting');
  currentUrl = `http://127.0.0.1:${port}`;
  pushLog(`启动服务：端口 ${port}，数据目录 ${dataDir}`);

  child = spawn(cmd, [SERVER_ENTRY], {
    cwd: APP_DIR,
    windowsHide: true,
    env: {
      ...process.env,
      ...extraEnv,
      NODE_ENV: 'production',
      PORT: String(port),
      HOST: host,
      DATA_DIR: dataDir,
      SESSION_SECRET: cfg.sessionSecret,
      ADMIN_USERNAME: cfg.adminUser || 'admin',
      ADMIN_PASSWORD: cfg.adminPassword || 'admin',
    },
  });

  child.stdout.on('data', (buf) => pushLog(buf.toString()));
  child.stderr.on('data', (buf) => pushLog(buf.toString()));

  child.once('exit', (code, signal) => {
    const wasStopping = stopping;
    child = null;
    currentUrl = '';
    if (!wasStopping) {
      pushLog(`服务已退出（code=${code}${signal ? `, signal=${signal}` : ''}）`);
      setStatus('stopped');
    }
  });

  const ok = await waitHealthy(port);
  if (!ok) {
    pushLog('启动超时：服务没有在 25 秒内响应 /api/health');
    await stopServer();
    return { ok: false, error: '启动失败，请查看日志' };
  }

  setStatus('running');
  pushLog(`服务已就绪：${currentUrl}`);
  if (cfg.openOnStart) shell.openExternal(currentUrl);
  return { ok: true, url: currentUrl };
}

// ── 窗口 ──────────────────────────────────────────────────────
function createWindow() {
  win = new BrowserWindow({
    width: 800,
    height: 740,
    minWidth: 660,
    minHeight: 580,
    show: false,
    backgroundColor: '#f5f6f8',
    title: 'ReadBook 启动器',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.once('ready-to-show', () => win.show());

  win.on('close', async (e) => {
    if (child && !stopping) {
      e.preventDefault();
      stopping = true;
      await stopServer();
      win.destroy();
      app.quit();
    }
  });

  win.on('closed', () => {
    win = null;
  });
}

// ── IPC ───────────────────────────────────────────────────────
ipcMain.handle('config:load', () => ({ config: loadConfig(), runtime: { appDir: APP_DIR, hasServer: fs.existsSync(SERVER_ENTRY) } }));

ipcMain.handle('config:save', (_e, patch) => {
  const cfg = saveConfig(patch || {});
  return { config: cfg };
});

ipcMain.handle('data:pick', async () => {
  const cfg = loadConfig();
  const res = await dialog.showOpenDialog(win, {
    title: '选择数据目录',
    defaultPath: cfg.dataDir,
    properties: ['openDirectory', 'createDirectory'],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  return res.filePaths[0];
});

ipcMain.handle('server:start', async () => startServer());
ipcMain.handle('server:stop', async () => {
  stopping = true;
  await stopServer();
  stopping = false;
  return true;
});
ipcMain.handle('server:state', () => snapshot());
ipcMain.handle('app:openSite', (_e, url) => {
  if (url) shell.openExternal(url);
});
ipcMain.handle('app:openDataDir', (_e, dir) => {
  if (dir) shell.openPath(dir);
});
ipcMain.handle('app:copy', (_e, text) => {
  require('electron').clipboard.writeText(String(text || ''));
});

// ── 生命周期 ──────────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    createWindow();
  });

  app.on('before-quit', () => {
    if (child) {
      try {
        if (isWin) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
        else child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
    }
  });

  app.on('window-all-closed', () => app.quit());
}
