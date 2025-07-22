/**********************************************************************
 *  NetChat Operator – Main Process
 *  Versi: 05-07-2025 • Fitur:
 *   • Perangkat virtual (Ctrl/⌘+T) 30 klien
 *   • Sembunyikan klien offline >30 menit (tetap simpan riwayat)
 *   • Database SQLite (better-sqlite3) per-member
 *********************************************************************/

const { app, BrowserWindow, ipcMain, dialog, globalShortcut, screen, shell } = require('electron');
const net          = require('net');
const fs           = require('fs');
const path         = require('path');
const db           = require('./db');      // ← modul database

/* =================================================================== */
/*                    0.  UTILITAS PATH PORTABLE / DEV                */
/* =================================================================== */
const baseDir   = app.isPackaged ? path.dirname(process.execPath) : __dirname;
const assetPath = (...sub) => path.join(baseDir, 'assets', ...sub);
const configPath= path.join(baseDir, 'config.json');
const THIRTY_MIN = 15 * 60 * 1000; // cukup 15 menit = 90.000 ms

/* =================================================================== */
/*                1.  SINGLE-INSTANCE LOCK & VAR GLOBAL                */
/* =================================================================== */
if (!app.requestSingleInstanceLock()) app.quit();

let mainWindow;
const clients             = new Map();   // key = member_pcName
const notificationWindows = new Map();
let heartbeatIntervalId;

/* =================================================================== */
/*           2.  FUNGSI – BUAT 30 PERANGKAT VIRTUAL                    */
/* =================================================================== */
function createVirtualDevices() {
  // 20 online
  for (let i = 1; i <= 20; i++) {
    const pc = `PC-${i.toString().padStart(2, '0')}`;
    const cid = `VIRTUAL_${pc}`;
    if (clients.has(cid)) continue;
    clients.set(cid, {
      pcName: pc, member: 'VIRTUAL', status: 'online', isVirtual: true,
      chatHistory: [], lastSeen: Date.now(), lastActivity: null,
      forcedShutdown: false
    });
  }
  // 10 offline
  for (let i = 21; i <= 30; i++) {
    const pc = `PC-${i.toString().padStart(2, '0')}`;
    const cid = `VIRTUAL_${pc}`;
    if (clients.has(cid)) continue;
    clients.set(cid, {
      pcName: pc, member: 'VIRTUAL', status: 'offline', isVirtual: true,
      chatHistory: [], lastSeen: null, lastActivity: null,
      forcedShutdown: false
    });
  }
  updateClientListUI();
}

/* =================================================================== */
/*                3.  MEMUAT / MEMBUAT KONFIGURASI                     */
/* =================================================================== */
let config = {};
function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return;
    }
    throw new Error('Config file not found');
  } catch {
    config = {
      server_ip: '0.0.0.0',
      server_port: 5000,
      client_timeout_seconds: 25,
      heartbeat_interval_seconds: 20,
      sounds: { chat: '', payment: '', shutdown: '' }
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  }
}
loadConfig();

/* =================================================================== */
/*                       4.  MEMBUAT JENDELA UTAMA                     */
/* =================================================================== */
function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'NetChat Operator',
    autoHideMenuBar: true,
    width: 890, height: 540,
    minWidth: 900, minHeight: 600,
    icon: assetPath('icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.webContents.on('did-finish-load', () =>
    mainWindow.webContents.send('settings-loaded', config));
  mainWindow.on('closed', () => { mainWindow = null; });
}

/* =================================================================== */
/*           5.  NOTIFIKASI POP-UP (BrowserWindow kecil)               */
/* =================================================================== */
function showNotificationWindow(messageData) {
  const { clientId } = messageData;

  // Tutup pop-up lama untuk klien yang sama
  if (notificationWindows.has(clientId)) {
    const old = notificationWindows.get(clientId);
    if (old && !old.isDestroyed()) old.close();
  }

  const notifWin = new BrowserWindow({
    width: 350,
    height: 120,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Pojok kanan-bawah
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  notifWin.setPosition(width - 360, height - 130);

  notifWin.loadFile(path.join(__dirname, 'notification.html'));
  notificationWindows.set(clientId, notifWin);

  notifWin.webContents.on('did-finish-load', () => {
    notifWin.webContents.send('show-notification', {
      ...messageData,
      windowId: notifWin.id
    });
  });

  // Tutup otomatis setelah 5 detik
  setTimeout(() => {
    if (!notifWin.isDestroyed()) notifWin.close();
  }, 5000);

  notifWin.on('closed', () => {
    if (notificationWindows.get(clientId) === notifWin) {
      notificationWindows.delete(clientId);
    }
  });
}

/* =================================================================== */
/*                       6.  SERVER TCP LISTENING                      */
/* =================================================================== */
const server = net.createServer(socket => {
  socket.on('data', raw => {
    try {
      const [pcName, member, type, ...rest] =
        raw.toString().trim().split('|');
      if (!pcName || !member || !type) return;
      const clientId = `${member}_${pcName}`;

      /* ---------- LOGOUT BERSIH ---------- */
      if (type === '__LOGOUT_CLEAN__') {
        if (clients.has(clientId)) {
          const cd = clients.get(clientId);
          if (cd.sessionId) db.closeSession(cd.sessionId);
          cd.socket?.end();
          clients.delete(clientId);
          updateClientListUI();
        }
        return;
      }

      /* ---------- ENTRI BARU / UPDATE ---------- */
      if (!clients.has(clientId)) {

        /* ★ buang entri OFFLINE lain milik member yang sama ★ */
        removeStaleOffline(member);

        const sessionId = db.openSession(member, pcName);
        clients.set(clientId, {
          socket, pcName, member, status: 'online',
          chatHistory: [], isVirtual: false,
          lastSeen: Date.now(), lastActivity: null,
          forcedShutdown: false, sessionId
        });
      }
      const cd = clients.get(clientId);
      if (!cd.sessionId) cd.sessionId = db.openSession(member, pcName);
      cd.socket = socket;
      cd.status = 'online';
      cd.lastSeen = Date.now();
      cd.forcedShutdown = false;

      /* ---------- HEARTBEAT ---------- */
      if (type === '__HEARTBEAT__') { updateClientListUI(); return; }

      /* ---------- PESAN MASUK ---------- */
      cd.lastActivity = Date.now();
      let msgObj = { sender: 'client', type: 'chat',
                     content: [type, ...rest].join('|'),
                     timestamp: new Date(), read: false };
      let notifTp = 'chat';

      if (type === '__PAYMENT__') {
        const [sender, amount, method] = rest;
        notifTp     = 'payment';
        msgObj.type = 'payment';
        msgObj.content =
          `<strong>Konfirmasi Pembayaran</strong><br>` +
          `Nama: ${sender}<br>Jumlah: Rp ${amount}<br>ID: ${method}`;
      }

      cd.chatHistory.push(msgObj);
      db.insertMessage(member, msgObj.sender, msgObj.content);

      mainWindow?.webContents.send('message-received',
        { clientId, message: msgObj });
      updateClientListUI();

      if (mainWindow && (mainWindow.isMinimized() || !mainWindow.isFocused())) {
        showNotificationWindow({ clientId, type: notifTp, message: msgObj,
                                 pcName: pcName, member: member });
        mainWindow.flashFrame(true);
      }
    } catch (e) { console.error('Parse data error:', e); }
  });

  socket.on('end', () => handleDisconnect(socket));
  socket.on('error', err => { console.error(err.message); handleDisconnect(socket); });
});

server.listen(config.server_port, config.server_ip,
  () => console.log(`[TCP] Listening on ${config.server_ip}:${config.server_port}`));

/* =================================================================== */
/*                     7.  HANDLE DISCONNECT & TIMEOUT                 */
/* =================================================================== */
/* --- Tambahan helper: buang semua entri OFFLINE milik member tertentu --- */
function removeStaleOffline(member) {
  for (const [cid, cd] of clients.entries()) {
    if (cd.member === member && cd.status === 'offline') {
      clients.delete(cid);
    }
  }
}

function handleDisconnect(sock) {
  for (const [cid, cd] of clients.entries()) {
    if (cd.socket === sock) {
      cd.status = 'offline';
      cd.socket = null;
      if (cd.sessionId) db.closeSession(cd.sessionId);
      updateClientListUI();
      break;
    }
  }
}

function checkStaleClients() {
  const now = Date.now();
  for (const [cid, cd] of clients.entries()) {
    if (cd.isVirtual) continue;
    const timeoutMs = (config.client_timeout_seconds || 25) * 1000;
    const stale = now - (cd.lastSeen || 0) > timeoutMs;

    if (cd.status === 'online' && stale && !cd.forcedShutdown) {
      cd.forcedShutdown = true;
      cd.status = 'offline';
      cd.lastActivity = Date.now(); 
      cd.socket?.destroy();

      const waktu = new Date().toLocaleTimeString('id-ID');
      const shutdownMsg = {
        sender: 'system',
        content: `Klien Shutdown Paksa di Jam ${waktu}`,
        type: 'shutdown',
        timestamp: new Date()
      };
      cd.chatHistory.push(shutdownMsg);
      db.insertMessage(cd.member, 'system', 'shutdown', shutdownMsg.content);

      if (mainWindow) {
        mainWindow.webContents.send('message-received', { clientId: cid, message: shutdownMsg });
        showNotificationWindow({ clientId: cid, type: 'shutdown', pcName: cd.pcName, member: cd.member });
        mainWindow.webContents.send('play-sound', 'shutdown');
      }
    }
  }
  updateClientListUI();
}

/* =================================================================== */
/*                        8.  UPDATE LIST KE UI                        */
/* =================================================================== */
function updateClientListUI() {
  if (!mainWindow) return;
  const list = Array.from(clients.values()).map(c => ({
    clientId: `${c.member}_${c.pcName}`,
    pcName: c.pcName,
    member: c.member,
    status: c.status,
    lastActivity: c.lastActivity,
    forcedShutdown: c.forcedShutdown,
    unreadCount: db.getUnreadCount(c.member)
  }));
  mainWindow.webContents.send('update-client-list', list);
}

/* =================================================================== */
/*                   9.  IPC RENDERER ↔ MAIN                           */
/* =================================================================== */
ipcMain.handle('resolve-asset', (_e, f) => assetPath(f));

ipcMain.on('send-reply', (_e, { clientId, message }) => {
  const cd = clients.get(clientId); if (!cd) return;
  if (cd.status === 'online' && cd.socket)
    cd.socket.write(`OPERATOR|Admin|${message}`);

  const msg = { sender: 'operator', type: 'chat', content: message, timestamp: new Date() };
  cd.chatHistory.push(msg);
  db.insertMessage(cd.member, 'operator', message);
  mainWindow?.webContents.send('message-received', { clientId, message: msg });
  updateClientListUI();
});

ipcMain.on('send-broadcast', (_e, text) => {
  const msg = { sender: 'operator', type: 'chat', content: text, timestamp: new Date() };

  for (const [cid, cd] of clients.entries()) {
    if (cd.status === 'online' && cd.socket) {
      cd.socket.write(`OPERATOR|Broadcast|${text}`);
      cd.chatHistory.push(msg);
      db.insertMessage(cd.member, 'operator', text);
      mainWindow?.webContents.send('message-received', { clientId: cid, message: msg });
    }
  }
  updateClientListUI();
});

// ── Handler untuk mengambil riwayat chat dari SQLite ──
ipcMain.handle('db:get-messages', (_event, member, limit = 1000) => {
  return db.getMessagesByMember(member, limit);
});

// ── Handler untuk mengambil daftar semua member ──
ipcMain.handle('db:get-all-members', () => { 
  return db 
    .getAllMembers() 
    .filter(m => !(m.startsWith('GUEST') || m.startsWith('G_'))); 
});

ipcMain.handle('db:get-unread-count', (_e, member) => {
  return db.getUnreadCount(member);
});

// ── Klik notifikasi popup: buka dan fokus percakapan ──
ipcMain.on('notification-clicked', (_e, { clientId, windowId }) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('focus-chat', clientId);
  }
  const win = BrowserWindow.fromId(windowId);
  if (win && !win.isDestroyed()) win.close();
});

// ── Tombol “×” di popup: cukup tutup jendela ──
ipcMain.on('close-notification-window', (_e, windowId) => {
  const win = BrowserWindow.fromId(windowId);
  if (win && !win.isDestroyed()) win.close();
});

// ── mark-as-read: set semua pesan client pada session ini sebagai read ──
ipcMain.on('mark-as-read', (_e, clientId) => {
  const cd = clients.get(clientId);
  if (!cd) return;
  // tandai di buffer
  cd.chatHistory.forEach(m => { if (m.sender==='client') m.read = true; });
  // tandai di DB
  db.markMessagesRead(cd.member);
  updateClientListUI();
});

ipcMain.on('open-external', (_e, url) => {
  shell.openExternal(url);
});


ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-close', () => mainWindow?.minimize());

/* =================================================================== */
/*                10.  APP LIFECYCLE & TIMER HEARTBEAT                 */
/* =================================================================== */
app.on('ready', () => {
  createWindow();
  globalShortcut.register('CommandOrControl+P', () => {
    mainWindow.webContents.send('show-member-list');
  });
  globalShortcut.register('CommandOrControl+T', createVirtualDevices);
  heartbeatIntervalId = setInterval(
    checkStaleClients,
    (config.heartbeat_interval_seconds || 20) * 1000
  );
});


app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

app.on('will-quit', () => {
  server.close();
  clearInterval(heartbeatIntervalId);
  globalShortcut.unregisterAll();
});

// ── 11. HANDLER SIMPAN PENGATURAN & RESTART ──
ipcMain.on('save-settings', (_event, newCfg) => {
  config = {
    ...config,
    server_ip:  newCfg.server_ip,
    server_port:newCfg.server_port,
    client_timeout_seconds:      newCfg.client_timeout_seconds,
    heartbeat_interval_seconds:  newCfg.heartbeat_interval_seconds,
    sounds: newCfg.sounds
  };
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  } catch (err) {
    console.error('Gagal menulis config:', err);
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('settings-loaded', config);
  }
  app.relaunch();
  app.exit(0);
});
