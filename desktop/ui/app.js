// 启动器界面逻辑：读配置 → 渲染 → 启动 / 停止服务
const $ = (id) => document.getElementById(id);

const els = {
  port: $('port'),
  lan: $('lan'),
  lanHint: $('lan-hint'),
  dataDir: $('dataDir'),
  adminUser: $('adminUser'),
  adminPassword: $('adminPassword'),
  openOnStart: $('openOnStart'),
  startBtn: $('start-btn'),
  stopBtn: $('stop-btn'),
  openSite: $('open-site'),
  copyUrl: $('copy-url'),
  url: $('url'),
  msg: $('msg'),
  badge: $('status-badge'),
  log: $('log'),
  toggleLog: $('toggle-log'),
  pickDir: $('pick-dir'),
  openDir: $('open-dir'),
};

let currentUrl = '';
let busy = false;

const STATUS_TEXT = {
  stopped: '已停止',
  starting: '启动中…',
  running: '运行中',
  stopping: '停止中…',
};

function setMsg(text, kind = '') {
  els.msg.textContent = text || '';
  els.msg.dataset.kind = kind;
}

function readForm() {
  return {
    port: Number(els.port.value) || 4321,
    lan: els.lan.checked,
    dataDir: els.dataDir.value.trim(),
    adminUser: els.adminUser.value.trim() || 'admin',
    adminPassword: els.adminPassword.value || 'admin',
    openOnStart: els.openOnStart.checked,
  };
}

function fillForm(cfg) {
  els.port.value = cfg.port;
  els.lan.checked = !!cfg.lan;
  els.dataDir.value = cfg.dataDir;
  els.adminUser.value = cfg.adminUser || 'admin';
  els.adminPassword.value = cfg.adminPassword || 'admin';
  els.openOnStart.checked = cfg.openOnStart !== false;
  els.lanHint.textContent = cfg.lan ? '开启后同一网络的设备也能访问（0.0.0.0）' : '关闭时只有本机能访问（127.0.0.1）';
}

function applyState(state) {
  els.badge.textContent = STATUS_TEXT[state.status] || state.status;
  els.badge.dataset.status = state.status;

  const running = state.status === 'running';
  const working = state.status === 'starting' || state.status === 'stopping';

  els.startBtn.disabled = busy || working || running;
  els.stopBtn.disabled = busy || working || !running;
  els.openSite.disabled = !running;
  els.copyUrl.disabled = !running;

  for (const el of [els.port, els.lan, els.dataDir, els.adminUser, els.adminPassword, els.pickDir]) {
    el.disabled = running || working;
  }

  currentUrl = state.url || '';
  els.url.textContent = currentUrl || '—';

  const logText = state.logs && state.logs.length ? state.logs.join('\n') : '（尚未启动）';
  const atBottom = els.log.scrollTop + els.log.clientHeight >= els.log.scrollHeight - 8;
  els.log.textContent = logText;
  if (atBottom) els.log.scrollTop = els.log.scrollHeight;
}

async function persist() {
  const patch = readForm();
  if (!patch.dataDir) return;
  await window.launcher.saveConfig(patch);
}

async function onStart() {
  busy = true;
  setMsg('正在启动…');
  try {
    await persist();
    const res = await window.launcher.start();
    if (res.ok) {
      setMsg(`服务已启动：${res.url}`, 'ok');
      currentUrl = res.url;
    } else {
      setMsg(res.error || '启动失败', 'error');
    }
  } catch (err) {
    setMsg(String(err && err.message ? err.message : err), 'error');
  } finally {
    busy = false;
    applyState(await window.launcher.getState());
  }
}

async function onStop() {
  busy = true;
  setMsg('正在停止…');
  try {
    await window.launcher.stop();
    setMsg('服务已停止', 'ok');
  } catch (err) {
    setMsg(String(err && err.message ? err.message : err), 'error');
  } finally {
    busy = false;
    applyState(await window.launcher.getState());
  }
}

async function init() {
  const { config } = await window.launcher.loadConfig();
  fillForm(config);
  applyState(await window.launcher.getState());

  window.launcher.onState((state) => applyState(state));

  els.startBtn.addEventListener('click', onStart);
  els.stopBtn.addEventListener('click', onStop);

  els.openSite.addEventListener('click', () => window.launcher.openSite(currentUrl));
  els.copyUrl.addEventListener('click', async () => {
    await window.launcher.copy(currentUrl);
    setMsg('地址已复制', 'ok');
  });

  els.pickDir.addEventListener('click', async () => {
    const dir = await window.launcher.pickDataDir();
    if (dir) {
      els.dataDir.value = dir;
      await persist();
      setMsg('数据目录已更新，下次启动生效', 'ok');
    }
  });

  els.openDir.addEventListener('click', () => {
    const dir = els.dataDir.value.trim();
    if (dir) window.launcher.openDataDir(dir);
  });

  els.lan.addEventListener('change', () => {
    els.lanHint.textContent = els.lan.checked
      ? '开启后同一网络的设备也能访问（0.0.0.0）'
      : '关闭时只有本机能访问（127.0.0.1）';
  });

  // 改动即保存，避免忘了点保存
  for (const el of [els.port, els.dataDir, els.adminUser, els.adminPassword]) {
    el.addEventListener('change', persist);
  }
  els.lan.addEventListener('change', persist);
  els.openOnStart.addEventListener('change', persist);

  els.toggleLog.addEventListener('click', () => {
    const hidden = !els.log.hidden;
    els.log.hidden = hidden;
    els.toggleLog.textContent = hidden ? '展开' : '收起';
  });
}

init();
