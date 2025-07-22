// preload.js  – Bridge API antara Renderer & Main (Operator)

const { contextBridge, ipcRenderer } = require('electron');

const SEND_CHANNELS = [
  'send-reply',
  'send-broadcast',
  'mark-as-read',
  'save-settings',
  'run-simulation',
  'notification-clicked',      // ← wajib ada agar popup bisa klik
  'close-notification-window',
  'window-minimize',
  'window-close'
];

const RECEIVE_CHANNELS = [
  'update-client-list',
  'message-received',
  'client-forced-shutdown',
  'settings-loaded',
  'show-notification',
  'focus-chat',
  'play-sound',
  'show-member-list'           // tampilkan modal daftar member (Ctrl+P)
];

const SYNC_CHANNELS = [
  'resolve-asset'
];

contextBridge.exposeInMainWorld('api', {
  /** ----------------------------------------------------------------
   * Ambil path absolut file di folder assets/
   * @param  {string} file  Nama file, contoh: 'payment.png'
   * @return {Promise<string>}  Path absolut (file://…)
   * ----------------------------------------------------------------*/
  resolveAsset: file => ipcRenderer.invoke('resolve-asset', file),

  /** Kirim data async (fire‑and‑forget) ke Main Process */
  send: (channel, data) => {
    if (SEND_CHANNELS.includes(channel)) ipcRenderer.send(channel, data);
  },

  /** Dengarkan event dari Main Process */
  on: (channel, callback) => {
    if (RECEIVE_CHANNELS.includes(channel)) {
      ipcRenderer.on(channel, (_e, ...args) => callback(...args));
    }
  },

  /** Buka dialog pilih file (misalnya pilih suara notifikasi) */
  selectFile: options => ipcRenderer.invoke('dialog:openFile', options),

  openExternal: url => {
    ipcRenderer.send('open-external', url);
  },

  /** Akses database (semua async) */
  getMessages:    (member, limit = 1000) => ipcRenderer.invoke('db:get-messages', member, limit),
  getAllMembers:  ()                     => ipcRenderer.invoke('db:get-all-members'),
  getUnreadCount: member                 => ipcRenderer.invoke('db:get-unread-count', member)
});