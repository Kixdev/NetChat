// preload.js  – Bridge API antara Renderer & Main (Operator)

const { contextBridge, ipcRenderer } = require('electron');

/* ------------------------------------------------------------------ */
/*                        WHITE-LISTED IPC CHANNELS                   */
/* ------------------------------------------------------------------ */
const SEND_CHANNELS = [
  'send-message',        // chat biasa
  'send-payment',        // kirim data pembayaran
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
  'initial-data',        // data awal: member, pc, settings
  'update-client-list',
  'update-status',       // status koneksi (Terhubung / Gagal / dsb)
  'message-received',
  'client-forced-shutdown',
  'settings-loaded',
  'show-notification',
  'focus-chat',
  'play-sound',
  'settings-updated'     // setelah simpan settings sukses
];

const SYNC_CHANNELS = [
  'resolve-asset'
];

/* ------------------------------------------------------------------ */
/*                 BRIDGE API TEREXPOSE DI CONTEXT RENDERER           */
/* ------------------------------------------------------------------ */
contextBridge.exposeInMainWorld('api', {
  /**
   * Kirim data asynchronous ke Main Process (fire-and-forget)
   * @param {string} channel
   * @param {any=}   data
   */
  send: (channel, data) => {
    if (SEND_CHANNELS.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },

  /**
   * Terima data dari Main Process
   * @param {string}   channel
   * @param {Function} callback
   */
  on: (channel, callback) => {
    if (RECEIVE_CHANNELS.includes(channel)) {
      ipcRenderer.on(channel, (_evt, ...args) => callback(...args));
    }
  },

  /**
   * Kirim permintaan sinkron (blok hingga jawaban)
   * – hanya untuk 'resolve-asset'
   * @param {string} channel
   * @param {any=}   data
   * @returns {any}
   */
  sendSync: (channel, data) => {
    if (SYNC_CHANNELS.includes(channel)) {
      return ipcRenderer.sendSync(channel, data);
    }
  },
  
  openExternal: url => ipcRenderer.send('open-external', url),

  /**
   * Buka dialog pemilihan file (async)
   * – untuk memilih file suara di settings
   * @param {Object} options
   * @returns {Promise<string|undefined>}
   */
  selectFile: (options) => ipcRenderer.invoke('dialog:openFile', options)
});
