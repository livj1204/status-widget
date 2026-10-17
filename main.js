'use strict';
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, screen, powerMonitor, dialog } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const status = require('./status');

// 현황판 파일: 트레이에서 고른 파일 → (Claude Code를 쓰면) ~/.claude/STATUS.md → 문서\현황판\STATUS.md
// 시험할 때만 STATUS_WIDGET_FILE로 다른 파일을 쓴다
const TEST = !!process.env.STATUS_WIDGET_FILE;
if (TEST) app.setPath('userData', path.join(os.tmpdir(), 'status-widget-test'));
let FILE = '';

function defaultFile() {
  const claudeDir = path.join(os.homedir(), '.claude');
  if (fs.existsSync(claudeDir)) return path.join(claudeDir, 'STATUS.md');
  return path.join(app.getPath('documents'), '현황판', 'STATUS.md');
}

// 파일이 없으면 STATUS.example.md(같은 폴더)로 새로 만든다
function ensureFile(file) {
  if (fs.existsSync(file)) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let text = '# 작업 현황판\n\n## 할 일\n\n## 보류\n\n## 완료\n';
    try { text = fs.readFileSync(path.join(__dirname, 'STATUS.example.md'), 'utf8'); } catch (e) {}
    fs.writeFileSync(file, text, 'utf8');
  } catch (e) {}
}

// 작은 위젯이라 그래픽 가속 없이 그려도 충분하다 (GPU 프로세스 메모리 절약)
app.disableHardwareAcceleration();
// in-process-gpu(메모리 −24MB 더 절약)는 투명 부분이 하얗게 변하는 문제가 의심돼서 쓰지 않는다

// 창·전원·화면 이벤트 기록 (흰 화면 같은 일이 다시 생기면 언제·무엇 뒤였는지 보려고)
function logEvent(msg) {
  try {
    const file = path.join(app.getPath('userData'), 'events.log');
    try {
      if (fs.statSync(file).size > 200 * 1024) fs.renameSync(file, file + '.old');
    } catch (e) {}
    const d = new Date();
    const stamp = d.toLocaleDateString('ko-KR') + ' ' + d.toTimeString().slice(0, 8);
    fs.appendFileSync(file, stamp + ' ' + msg + '\n');
  } catch (e) {}
}

// 창 크기: 펼친 판(340×652) + 그림자 여백. 접히면 같은 창 안에 알약만 그리고 나머지는 클릭이 통과한다
const WIN_W = 380;
const WIN_H = 700;

let win = null;
let tray = null;
let lastText = null;
let undoStack = [];
let watchTimer = null;
let pinned = false;
let stay = false;
let quitting = false;
let wall = null;
let wallStamp = '';

function readText() {
  try {
    return fs.readFileSync(FILE, 'utf8');
  } catch (e) {
    return null;
  }
}

function eolOf(text) {
  return /\r\n/.test(text) ? '\r\n' : '\n';
}

function writeText(text) {
  try {
    fs.copyFileSync(FILE, FILE + '.bak');
  } catch (e) {}
  const tmp = FILE + '.tmp';
  try {
    fs.writeFileSync(tmp, text, 'utf8');
    fs.renameSync(tmp, FILE);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) {}
    fs.writeFileSync(FILE, text, 'utf8');
  }
  lastText = text;
}

function snapshot(text, extra) {
  const name = path.basename(FILE);
  if (text === null) return Object.assign({ ok: false, error: name + '을(를) 찾을 수 없어요', path: FILE, name }, extra);
  const v = status.view(status.parse(text));
  let mtime = 0;
  try { mtime = fs.statSync(FILE).mtimeMs; } catch (e) {}
  return Object.assign({ ok: true, todo: v.todo, hold: v.hold, done: v.done, canUndo: undoStack.length > 0, mtime, path: FILE, name }, extra);
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function checkExternal() {
  const text = readText();
  if (text === null || text === lastText) return;
  lastText = text;
  undoStack = [];
  send('status:changed', snapshot(text, { external: true }));
}

let watcher = null;
function watchFile() {
  try { if (watcher) watcher.close(); } catch (e) {}
  watcher = null;
  try {
    watcher = fs.watch(path.dirname(FILE), (_ev, name) => {
      if (name && name !== path.basename(FILE)) return;
      clearTimeout(watchTimer);
      watchTimer = setTimeout(checkExternal, 200);
    });
  } catch (e) {}
}

// 트레이에서 다른 현황판 파일로 바꾸기
function useFile(file, remember) {
  FILE = file;
  ensureFile(FILE);
  undoStack = [];
  lastText = readText();
  watchFile();
  if (remember) {
    const st = loadWinState();
    st.file = FILE;
    try {
      fs.mkdirSync(app.getPath('userData'), { recursive: true });
      fs.writeFileSync(stateFile(), JSON.stringify(st));
    } catch (e) {}
  }
  send('status:changed', snapshot(lastText));
  buildTrayMenu();
  logEvent('file ' + FILE);
}

async function pickFile() {
  const r = await dialog.showOpenDialog({ title: '현황판 파일 고르기', defaultPath: path.dirname(FILE), properties: ['openFile'], filters: [{ name: '마크다운', extensions: ['md', 'txt'] }] });
  if (!r.canceled && r.filePaths[0]) useFile(r.filePaths[0], true);
}

async function newFile() {
  const r = await dialog.showSaveDialog({ title: '새 현황판 만들기', defaultPath: path.join(app.getPath('documents'), 'STATUS.md'), filters: [{ name: '마크다운', extensions: ['md'] }] });
  if (r.canceled || !r.filePath) return;
  useFile(r.filePath, true); // 없으면 예시로 만들고, 이미 있으면 덮어쓰지 않고 그대로 연다
}

// 로그인할 때 자동 실행 (Windows 시작 프로그램)
function loginOpts() {
  return { path: process.execPath, args: [app.getAppPath()] };
}
function autoStartOn() {
  try { return app.getLoginItemSettings(loginOpts()).openAtLogin; } catch (e) { return false; }
}

function todayStr() {
  const d = new Date();
  return (d.getMonth() + 1) + '/' + d.getDate();
}

ipcMain.handle('status:get', () => {
  lastText = readText();
  return snapshot(lastText);
});

ipcMain.handle('status:apply', (_e, op) => {
  const cur = readText();
  if (cur === null) return snapshot(null);
  let next;
  try {
    next = status.serialize(status.applyOp(status.parse(cur), Object.assign({ date: todayStr() }, op)), eolOf(cur));
  } catch (err) {
    lastText = cur;
    return snapshot(cur, { error: err.message });
  }
  if (cur !== lastText) undoStack = [];
  if (next !== cur) {
    undoStack.push(cur);
    if (undoStack.length > 50) undoStack.shift();
    writeText(next);
  }
  return snapshot(next);
});

ipcMain.handle('status:undo', () => {
  const cur = readText();
  if (!undoStack.length || cur !== lastText) {
    undoStack = [];
    lastText = cur;
    return snapshot(cur);
  }
  const prev = undoStack.pop();
  writeText(prev);
  return snapshot(prev);
});

ipcMain.handle('status:open', () => shell.openPath(FILE));
ipcMain.handle('win:state', () => ({ pinned, stay, test: TEST, startOpen: !!process.env.STATUS_WIDGET_OPEN }));
ipcMain.handle('win:pin', (_e, on) => setPinned(!!on));
ipcMain.handle('win:stay', (_e, on) => {
  stay = !!on;
  buildTrayMenu();
  saveWinState();
  return stay;
});
// 알약을 눌러 고정한 동안만 잠깐 맨 위에 (트레이의 "항상 위에 두기"와 따로)
let tempTop = false;
function applyTop() {
  if (win && !win.isDestroyed()) win.setAlwaysOnTop(pinned || tempTop || TEST);
}
ipcMain.on('win:top', (_e, on) => {
  tempTop = !!on;
  applyTop();
  logEvent('top ' + (pinned || tempTop));
});
ipcMain.on('win:redraw', () => recreateWindow('page'));
ipcMain.on('win:ignore', (_e, on) => {
  if (!win || win.isDestroyed()) return;
  if (on) win.setIgnoreMouseEvents(true, { forward: true });
  else win.setIgnoreMouseEvents(false);
});
ipcMain.handle('wall:get', async () => {
  if (!wall) await loadWallpaper();
  return { wall, bounds: win ? win.getBounds() : null, layer: layerRect() };
});

// 바탕화면 그림: 위젯 뒤가 휘어 보이도록 같은 그림을 창 안에 맞춰 깐다
function regQuery(key, name) {
  return new Promise(resolve => {
    execFile('reg', ['query', key, '/v', name], { windowsHide: true }, (err, out) => {
      if (err) return resolve('');
      const m = new RegExp(name + '\\s+REG_\\w+\\s+(.*)').exec(String(out));
      resolve(m ? m[1].trim() : '');
    });
  });
}

async function loadWallpaper() {
  try {
    const style = await regQuery('HKCU\\Control Panel\\Desktop', 'WallpaperStyle');
    const tile = await regQuery('HKCU\\Control Panel\\Desktop', 'TileWallpaper');
    const color = await regQuery('HKCU\\Control Panel\\Colors', 'Background');
    let file = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Themes', 'TranscodedWallpaper');
    if (!fs.existsSync(file)) file = await regQuery('HKCU\\Control Panel\\Desktop', 'WallPaper');
    if (TEST && process.env.STATUS_WIDGET_WALLPAPER) file = process.env.STATUS_WIDGET_WALLPAPER; // 소개 그림 찍을 때만
    let stamp = style + '|' + tile + '|' + color + '|' + file;
    try { stamp += '|' + fs.statSync(file).mtimeMs; } catch (e) {}
    if (stamp === wallStamp && wall) return;
    wallStamp = stamp;

    const rgb = (color || '0 0 0').split(/\s+/).map(Number);
    const bg = 'rgb(' + (rgb[0] || 0) + ',' + (rgb[1] || 0) + ',' + (rgb[2] || 0) + ')';
    let url = '';
    if (file && fs.existsSync(file)) {
      let img = nativeImage.createFromBuffer(fs.readFileSync(file));
      if (!img.isEmpty()) {
        const maxW = Math.max(...screen.getAllDisplays().map(d => d.size.width * d.scaleFactor));
        const size = img.getSize();
        if (size.width > maxW) img = img.resize({ width: maxW, quality: 'good' });
        url = 'data:image/jpeg;base64,' + img.toJPEG(86).toString('base64');
      }
    }
    const s = Number(style);
    let fit = { size: 'cover', position: 'center', repeat: 'no-repeat', span: false };
    if (s === 6) fit = { size: 'contain', position: 'center', repeat: 'no-repeat', span: false };
    else if (s === 2) fit = { size: '100% 100%', position: 'center', repeat: 'no-repeat', span: false };
    else if (s === 22) fit = { size: 'cover', position: 'center', repeat: 'no-repeat', span: true };
    else if (s === 0 && tile === '1') fit = { size: 'auto', position: '0 0', repeat: 'repeat', span: false };
    else if (s === 0) fit = { size: 'auto', position: 'center', repeat: 'no-repeat', span: false };
    wall = Object.assign({ url, bg }, fit);
    sendWall();
  } catch (e) {
    wall = { url: '', bg: 'rgb(30,40,60)', size: 'cover', position: 'center', repeat: 'no-repeat', span: false };
    sendWall();
  }
}

function layerRect() {
  if (!win || win.isDestroyed()) return null;
  if (wall && wall.span) {
    const ds = screen.getAllDisplays().map(d => d.bounds);
    const x = Math.min(...ds.map(b => b.x));
    const y = Math.min(...ds.map(b => b.y));
    return { x, y, w: Math.max(...ds.map(b => b.x + b.width)) - x, h: Math.max(...ds.map(b => b.y + b.height)) - y };
  }
  const b = screen.getDisplayMatching(win.getBounds()).bounds;
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}

function sendWall() {
  if (!win || win.isDestroyed() || !wall) return;
  send('wall:update', { wall, layer: layerRect(), bounds: win.getBounds() });
}

function sendBounds() {
  if (!win || win.isDestroyed()) return;
  send('win:bounds', { bounds: win.getBounds(), layer: layerRect() });
}

// 창 위치·항상 위·펼친 채로 두기 기억
function stateFile() {
  return path.join(app.getPath('userData'), 'window.json');
}

function loadWinState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
  } catch (e) {
    return {};
  }
}

let saveTimer = null;
function saveWinState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!win || win.isDestroyed()) return;
    const b = win.getBounds();
    try {
      fs.mkdirSync(app.getPath('userData'), { recursive: true });
      const keep = loadWinState().file;
      fs.writeFileSync(stateFile(), JSON.stringify(Object.assign({ x: b.x, y: b.y, pinned, stay }, keep ? { file: keep } : {})));
    } catch (e) {}
  }, 400);
}

function defaultBounds() {
  const wa = screen.getPrimaryDisplay().workArea;
  return { x: wa.x + wa.width - WIN_W - 6, y: wa.y + 6, width: WIN_W, height: WIN_H };
}

function onScreen(b) {
  return screen.getAllDisplays().some(d => {
    const a = d.workArea;
    return b.x + b.width - 60 > a.x && b.x + 60 < a.x + a.width && b.y > a.y - 40 && b.y < a.y + a.height - 80;
  });
}

function setPinned(on) {
  pinned = on;
  applyTop();
  send('win:pinned', on);
  buildTrayMenu();
  saveWinState();
  return on;
}

function showWindow() {
  if (!win || win.isDestroyed()) return;
  win.show();
  win.focus();
  send('win:open', true);
}

function resetPosition() {
  if (!win || win.isDestroyed()) return;
  win.setBounds(defaultBounds());
  showWindow();
}

function createWindow() {
  const st = loadWinState();
  pinned = !!st.pinned;
  stay = !!st.stay;
  let bounds = defaultBounds();
  if (Number.isFinite(st.x) && Number.isFinite(st.y)) {
    const saved = { x: st.x, y: st.y, width: WIN_W, height: WIN_H };
    if (onScreen(saved)) bounds = saved;
  }
  win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: WIN_W,
    height: WIN_H,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: pinned || TEST,
    show: false,
    title: '현황판',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'index.html'));
  const shown = win;
  const showOnce = () => {
    if (shown.isDestroyed() || shown.isVisible()) return;
    shown.showInactive();
  };
  shown.once('ready-to-show', showOnce);
  setTimeout(showOnce, 1500); // 다시 그릴 때 ready-to-show가 안 오는 경우가 있어서
  win.on('move', sendBounds);
  win.on('moved', () => {
    sendWall();
    saveWinState();
  });
  win.on('close', e => {
    // 창의 닫기는 트레이로 숨기기. 끝내기는 트레이 메뉴에서
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  for (const ev of ['show', 'hide', 'focus', 'blur', 'minimize', 'restore', 'unresponsive', 'responsive']) {
    win.on(ev, () => logEvent('win ' + ev));
  }
  win.on('moved', () => logEvent('win moved ' + JSON.stringify(win.getBounds())));
  win.webContents.on('render-process-gone', (_e, d) => {
    logEvent('renderer gone ' + d.reason);
    recreateWindow('renderer gone');
  });
  logEvent('window created ' + JSON.stringify(win.getBounds()));
}

// 창을 새로 만들어 다시 그린다 (투명 부분이 하얗게 남는 경우 대비)
let redrawTimer = null;
function recreateWindow(why) {
  logEvent('redraw: ' + why);
  if (!win || win.isDestroyed()) return;
  const old = win;
  tempTop = false; // 새 창은 고정 풀린 상태로 시작한다
  createWindow(); // 새 창을 먼저 만들고 옛 창을 없앤다 (창이 0개가 되면 앱이 꺼지므로)
  old.removeAllListeners('close');
  old.destroy();
  wallStamp = '';
  win.webContents.once('did-finish-load', () => loadWallpaper());
}
function redrawSoon(why) {
  clearTimeout(redrawTimer);
  redrawTimer = setTimeout(() => recreateWindow(why), 1500);
}

function buildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '현황판 펼치기', click: showWindow },
    { label: '항상 위에 두기', type: 'checkbox', checked: pinned, click: mi => setPinned(mi.checked) },
    { label: '펼친 채로 두기', type: 'checkbox', checked: stay, click: mi => { stay = mi.checked; send('win:stay', stay); saveWinState(); } },
    { type: 'separator' },
    { label: path.basename(FILE) + ' 열어서 고치기', click: () => shell.openPath(FILE) },
    { label: '다른 현황판 파일 고르기…', click: pickFile },
    { label: '새 현황판 만들기…', click: newFile },
    { type: 'separator' },
    { label: '로그인할 때 자동 실행', type: 'checkbox', checked: autoStartOn(), click: mi => { app.setLoginItemSettings(Object.assign({ openAtLogin: mi.checked }, loginOpts())); buildTrayMenu(); } },
    { label: '위치 처음으로', click: resetPosition },
    { label: '다시 그리기', click: () => recreateWindow('tray') },
    { type: 'separator' },
    { label: '끝내기', click: () => { quitting = true; app.quit(); } }
  ]));
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'tray.png')));
  tray.setToolTip('현황판');
  tray.on('click', () => {
    if (!win.isVisible()) win.showInactive();
    send('win:open', true);
  });
  buildTrayMenu();
}

// 시험용: 화면을 PNG로 저장하고 끝낸다 (STATUS_WIDGET_SHOT, STATUS_WIDGET_SCRIPT)
function runTestShot() {
  const out = process.env.STATUS_WIDGET_SHOT;
  if (!out) return;
  win.webContents.once('did-finish-load', async () => {
    await new Promise(r => setTimeout(r, 1500));
    const script = process.env.STATUS_WIDGET_SCRIPT;
    if (script) {
      try {
        const result = await win.webContents.executeJavaScript(fs.readFileSync(script, 'utf8'));
        fs.writeFileSync(out + '.result.json', JSON.stringify(result, null, 1));
      } catch (e) {
        fs.writeFileSync(out + '.error.txt', String(e && e.stack || e));
      }
      await new Promise(r => setTimeout(r, 900));
    }
    const shot = await win.webContents.capturePage();
    fs.writeFileSync(out, shot.toPNG());
    fs.writeFileSync(out + '.bounds.json', JSON.stringify(Object.assign({ scale: screen.getPrimaryDisplay().scaleFactor }, win.getBounds())));
    if (!process.env.STATUS_WIDGET_KEEP) {
      quitting = true;
      app.quit();
    }
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(() => {
    const saved = loadWinState().file;
    FILE = process.env.STATUS_WIDGET_FILE || (saved && fs.existsSync(saved) ? saved : defaultFile());
    ensureFile(FILE);
    createWindow();
    if (!TEST) createTray();
    watchFile();
    setInterval(checkExternal, 4000); // 감시가 놓친 변경 대비
    loadWallpaper();
    setInterval(loadWallpaper, 30000); // 바탕화면이 바뀌면 따라간다
    logEvent('app ready' + (TEST ? ' (test)' : ''));
    // 절전·잠금·화면 구성 변경 뒤에는 투명 창이 깨질 수 있어서 새로 그린다
    for (const ev of ['suspend', 'resume', 'lock-screen', 'unlock-screen']) {
      powerMonitor.on(ev, () => {
        logEvent('power ' + ev);
        if (ev === 'resume' || ev === 'unlock-screen') redrawSoon(ev);
      });
    }
    for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) {
      screen.on(ev, () => {
        logEvent('screen ' + ev);
        redrawSoon(ev);
      });
    }
    app.on('child-process-gone', (_e, d) => logEvent('child gone ' + d.type + ' ' + d.reason));
    runTestShot();
  });
  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => {
    if (quitting) app.quit();
  });
}
