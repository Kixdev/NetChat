// main.js – Proses Utama Aplikasi Klien (Portable‑Ready • 2025‑07‑01)
// Revisi: 2025‑07‑19 – penanganan alias "GUEST" otomatis & pengecualian history

const { app, BrowserWindow, ipcMain, dialog, Menu, screen, shell } = require('electron');
const path  = require('path');
const net   = require('net');
const fs    = require('fs');
const os    = require('os');
const Store = require('electron-store');

/* ==================================================================== */
/*                0.  UTILITAS PATH (DEV vs PORTABLE EXE)               */
/* ==================================================================== */
const baseDir    = app.isPackaged ? path.dirname(process.execPath) : __dirname; // dir EXE / project
const assetPath  = (...sub) => path.join(baseDir, 'assets', ...sub);           // <base>/assets/…
const configPath = path.join(baseDir, 'config.json');                          // <base>/config.json

/* ==================================================================== */
/* 1.  Ambil username terakhir dari log iCafeMenu                       */
/* ==================================================================== */
async function getLatestUsernameFromLogs () {
  const drives = ['C', 'D', 'E', 'F'];
  let logDir = null;
  for (const d of drives) {
    const p = `${d}:\\Apps\\iCafeMenu\\Log`;
    if (fs.existsSync(p)) { logDir = p; break; }
  }
  if (!logDir) return 'GUEST';

  try {
    const files = (await fs.promises.readdir(logDir))
      .filter(f => /\.(log|txt)$/i.test(f));
    if (!files.length) return 'GUEST';

    const latest = files
      .map(f => ({ f, m: fs.statSync(path.join(logDir, f)).mtime }))
      .sort((a, b) => b.m - a.m)[0].f;

    const lines = (await fs.promises.readFile(path.join(logDir, latest), 'utf8'))
                   .split(/\r?\n/).reverse();

    const reName  = /(?:ICAFEMENU_MEMBER=|INIT_GAME_SAVING\s+)([A-Za-z0-9_]+)/i;
    /* penanda “awal sesi”; jika tercapai duluan → stop */
    const reSessionBoundary = /(parent process CCBootClient\.exe.*exit|Current state is logout|RUN logout\.bat|SHUTDOWN)/i;

    for (const ln of lines) {
      if (reName.test(ln))        return ln.match(reName)[1];
      if (reSessionBoundary.test(ln)) break;   // sudah melewati sesi baru
    }
  } catch (err) {
    console.error('[LogReader]', err);
  }
  return 'GUEST';
}

/* ==================================================================== */
/* 1A.  ALGORTIMA ALIAS OTOMATIS UNTUK “GUEST”                          */
/* ==================================================================== */
/**
 * Membuat alias unik untuk user yang tidak ter‑identifikasi ("GUEST").
 * Format:  GUEST#<n> (PC‑X)
 *   – <n> diambil dari angka pertama pada nama PC; jika tidak ada → 0.
 *   – "PC‑X" tetap ditampilkan agar operator mudah mengenali workstation.
 * @param {string} pc Hostname PC.
 */
function generateGuestAlias(pc) {
  const match = pc.match(/(\d+)/);           // ambil digit pertama (jika ada)
  const n     = match ? String(parseInt(match[1], 10)) : '1';
  return `GUEST#${n}`;                       // mulai dari GUEST#1
}

/* ==================================================================== */
/*                   2.  MEMUAT / MEMBUAT CONFIG                        */
/* ==================================================================== */
let connectionConfig = {};
function loadConnectionConfig() {
  let cfg = {};
  try { if (fs.existsSync(configPath)) cfg = JSON.parse(fs.readFileSync(configPath, 'utf8')); }
  catch { console.error('Gagal parse config.json, membuat baru.'); }

  if (!cfg.operatorIp || !cfg.operatorPort) {
    cfg = { operatorIp: '127.0.0.1', operatorPort: 5000 };
    try { fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2)); }
    catch (e) { console.error('Gagal tulis config default:', e); }
  }
  connectionConfig = cfg;
}

/* ==================================================================== */
/*                3.  PREFERENSI (electron-store)                       */
/* ==================================================================== */
const store = new Store({
  cwd: baseDir,
  schema: {
    theme:           { type: 'string', default: 'light' },
    notifSoundPath:  { type:'string', default: assetPath('notif.wav') },
    appTitle:        { type: 'string', default: 'Operator DyGaming' },
    profilePicPath:  { type: 'string', default: 'assets/profile.png' }
  }
});

/* ==================================================================== */
/*                      4.  VARIABEL GLOBAL                             */
/* ==================================================================== */
let mainWindow;
let clientSocket;
let heartbeatInterval;
let memberAccount = 'GUEST';
const pcName      = os.hostname();
let isQuitting    = false;

const activeNotifications = [];
const NOTIF_W = 350, NOTIF_H = 100, NOTIF_M = 10;

/* ==================================================================== */
/*          5.  SINGLE‑INSTANCE LOCK & ARGUMENT HANDLER                 */
/* ==================================================================== */
if (!app.requestSingleInstanceLock()) app.quit();

app.on('second-instance', (_e, argv) => {
  if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  processArgs(argv);
});

/* ==================================================================== */
/*                      6.  MEMBUAT JENDELA UTAMA                       */
/* ==================================================================== */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420, height: 750, minWidth: 380, minHeight: 500,
    frame: false, show: false,
    icon: assetPath('icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.once('ready-to-show', () => { mainWindow.show(); mainWindow.minimize(); });
  mainWindow.on('close', e => { e.preventDefault(); mainWindow.minimize(); });

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('initial-data', {
      member: memberAccount,
      pc:     pcName,
      settings: {
        theme:          store.get('theme'),
        notifSoundPath: store.get('notifSoundPath'),
        appTitle:       store.get('appTitle'),
        profilePicPath: store.get('profilePicPath')
      }
    });
  });
}

/* ==================================================================== */
/*                7.  NOTIFIKASI FLOATING WINDOW                        */
/* ==================================================================== */
function showNotificationWindow(msg) {
  const win = new BrowserWindow({
    width: NOTIF_W, height: NOTIF_H,
    frame: false, transparent: true, alwaysOnTop: true,
    resizable: false, movable: false, skipTaskbar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const yOff = activeNotifications.length * (NOTIF_H + NOTIF_M);
  win.setPosition(width - NOTIF_W - 10, height - NOTIF_H - 10 - yOff);

  win.loadFile(path.join(__dirname, 'notification.html'));
  activeNotifications.push(win);

  win.webContents.on('did-finish-load', () => {
    win.webContents.send('show-notification', { ...msg, windowId: win.id });
  });

  setTimeout(() => !win.isDestroyed() && win.close(), 5000);

  win.on('closed', () => {
    const i = activeNotifications.indexOf(win);
    if (i !== -1) activeNotifications.splice(i, 1);
    repositionNotifications();
  });
}

function repositionNotifications() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  activeNotifications.forEach((w, i) => {
    if (!w.isDestroyed()) {
      w.setPosition(width - NOTIF_W - 10, height - NOTIF_H - 10 - i * (NOTIF_H + NOTIF_M), true);
    }
  });
}

/* ==================================================================== */
/*                     8.  TCP CLIENT → OPERATOR                        */
/* ==================================================================== */
function connectToServer() {
  const { operatorIp, operatorPort } = connectionConfig;
  console.log(`Connecting to ${operatorIp}:${operatorPort} …`);

  if (clientSocket) { clientSocket.destroy(); clearInterval(heartbeatInterval); }

  clientSocket = new net.Socket();
  clientSocket.connect(operatorPort, operatorIp, () => {
    console.log('Connected to operator.');
    mainWindow?.webContents.send('update-status', 'Terhubung');
    heartbeatInterval = setInterval(() => sendMessage('__HEARTBEAT__'), 15000);
  });

  clientSocket.on('data', d => {
    const raw   = d.toString().trim();
    const parts = raw.split('|');
    if (parts.length < 3) return;

    const [sender, account, ...rest] = parts;
    const content = rest.join('|');

    if (content === '__HEARTBEAT__') {
      // kalau mau, catat lastHeartbeat = Date.now();
      return;
    }

    if (sender === 'OPERATOR') {
      const payload = { author: account, content, type: 'received' };
      mainWindow?.webContents.send('message-received', payload);
      if (mainWindow && (mainWindow.isMinimized() || !mainWindow.isFocused())) {
        showNotificationWindow(payload);
        mainWindow.flashFrame(true);
      }
    }
  });


  clientSocket.on('close', () => {
    console.log('Disconnected. Retry in 5s');
    mainWindow?.webContents.send('update-status', 'Menyambung ulang');
    clearInterval(heartbeatInterval);
    if (!isQuitting) setTimeout(connectToServer, 5000);
  });

  clientSocket.on('error', e => {
    console.error('Socket error:', e.message);
    mainWindow?.webContents.send('update-status', 'Gagal terhubung');
  });
}

const sendMessage = msg => clientSocket?.writable && clientSocket.write(`${pcName}|${memberAccount}|${msg}`);

/* ==================================================================== */
/*                   9.  ARGUMENT HANDLER (PROTOCOL)                    */
/* ==================================================================== */
function processArgs(argv) {
  const a = argv.slice(1).find(x => x.startsWith('dygaming-chat:') || x === '--logout');
  if (a?.startsWith('dygaming-chat:')) {
    memberAccount = a.split(':')[1] || 'GUEST';
  } else if (a === '--logout') {
    connectToServer();
    setTimeout(() => { sendMessage('Member Telah Logout'); setTimeout(() => app.quit(), 500); }, 1000);
    return true;
  }
  return false;
}

/* ==================================================================== */
/*                          10.  APP EVENTS                             */
/* ==================================================================== */
app.on('ready', async () => {
  loadConnectionConfig();
  memberAccount = await getLatestUsernameFromLogs();

  /* ------------------------------------------------------------- */
  /*  Revisi: buat alias jika user "GUEST" agar mudah diidentifikasi */
  /* ------------------------------------------------------------- */
  if (memberAccount === 'GUEST') {
    memberAccount = generateGuestAlias(pcName);
  }

  if (process.defaultApp && process.argv.length >= 2)
    app.setAsDefaultProtocolClient('dygaming-chat', process.execPath, [path.resolve(process.argv[1])]);
  else app.setAsDefaultProtocolClient('dygaming-chat');

  if (processArgs(process.argv)) return;

  createWindow();
  connectToServer();
});

app.on('window-all-closed', () => {/* keep running */});

app.on('will-quit', e => {
  clearInterval(heartbeatInterval);
  if (isQuitting) return;
  if (clientSocket?.writable) {
    e.preventDefault();
    isQuitting = true;
    clientSocket.write(`${pcName}|${memberAccount}|__LOGOUT_CLEAN__`, () => {
      clientSocket.end(); app.quit();
    });
    setTimeout(() => app.quit(), 1500);
  }
});

/* ==================================================================== */
/*                       11.  IPC RENDERER ↔ MAIN                       */
/* ==================================================================== */

/* -------- listener sinkron resolve-asset (FIX) -------- */
ipcMain.on('resolve-asset', (ev, filename) => {
  ev.returnValue = assetPath(filename);
});

ipcMain.on('send-message', (_e, m) => sendMessage(m));
ipcMain.on('send-payment', (_e, d) => sendMessage(`__PAYMENT__|${d.senderName}|${d.amount}|${d.method}`));

ipcMain.handle('dialog:openFile', async (_e, o) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(o);
  return canceled ? undefined : filePaths[0];
});

/* ---------------- simpan settings & kirim balik ke renderer -------- */
ipcMain.on('save-settings', (_e, newCfg) => {
  /* 1. tulis ke electron-store */
  Object.entries(newCfg).forEach(([k,v]) => store.set(k, v));

  /* 2. kirim ke renderer supaya bisa dipakai tanpa reload */
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('settings-updated', newCfg);
  }
});


ipcMain.on('notification-clicked', (_e, { windowId }) => {
  if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); }
  const n = BrowserWindow.fromId(windowId); if (n && !n.isDestroyed()) n.close();
});

ipcMain.on('close-notification-window', (_e, id) => {
  const n = BrowserWindow.fromId(id); if (n && !n.isDestroyed()) n.close();
});

ipcMain.on('open-external', (_e, url) => {
  shell.openExternal(url);
});

ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-close',    () => mainWindow?.minimize());
