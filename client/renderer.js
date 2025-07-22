// renderer.js – NetChat Client
// Revisi: 2025‑07‑19 – optimasi DOM, event handling & konsistensi kode

/* ------------------------------------------------------------------ */
/* 0.  Helper: resolveAsset (dev ↔ portable)                           */
/* ------------------------------------------------------------------ */
const resolveAsset = (filename) => {
  try {
    const abs = window.api.sendSync('resolve-asset', filename);
    if (abs) return `file:///${abs.replace(/\\/g, '/')}`;
  } catch (e) { console.error('resolveAsset:', e); }
  return `assets/${filename}`; // fallback dev
};
const toFileURL = (p) => `file://${p.replace(/\\/g, '/')}`;

/* ------------------------------------------------------------------ */
/* 1.  DOM References                                                 */
/* ------------------------------------------------------------------ */
const $ = (id) => document.getElementById(id);

// window control
const minimizeBtn      = $('minimize-window');
const closeBtn         = $('close-window');

// header & chat
const appTitle         = $('app-title');
const messagesList     = $('messages-list');
const messageInput     = $('message-input');
const sendBtn          = $('send-button');
const emojiBtn         = $('emoji-button');
const emojiPicker      = $('emoji-picker');

// footer buttons
const paymentBtn       = $('payment-button');
const settingsBtn      = $('settings-button');
const themeBtn         = $('theme-toggle-button');
const themeIcon        = $('theme-toggle-icon');

// modals &  settings
const settingsModal    = $('settings-modal');
const notifSoundInput  = $('notif-sound-input');
const headerTitleInput = $('header-title-input');
const saveSetBtn       = $('save-settings-button');

// payment
const paymentModal     = $('payment-modal');
const senderInput      = $('sender-name-input');
const amountInput      = $('topup-amount-input');
const methodInput      = $('payment-method-input');
const submitPayBtn     = $('submit-payment-button');

// universal close buttons
Array.from(document.querySelectorAll('.close-modal-button')).forEach((b) =>
  b.addEventListener('click', () => {
    settingsModal.classList.add('hidden');
    paymentModal.classList.add('hidden');
  })
);

/* ------------------------------------------------------------------ */
/* 2.  State & Constants                                              */
/* ------------------------------------------------------------------ */
let currentSettings = {};
const EMOJIS = ['🗿', '😂', '😍', '🤔', '👍', '🙏', '🎉', '❤️', '😊', '😭', '😠', '🔥', '💡', '✅', '❌', '👋'];
const notifSound = new Audio(resolveAsset('notif.wav'));
const numberFmt  = new Intl.NumberFormat('id-ID');

/* ------------------------------------------------------------------ */
/* 3.  Utility Functions                                              */
/* ------------------------------------------------------------------ */
const formatTime = (d = new Date()) =>
  d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

const escapeHTML = (str) =>
  str.replace(/[&<>"']/g, (t) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[t]));

/* ------------------------------------------------------------------ */
/* 4.  Message Handling                                               */
/* ------------------------------------------------------------------ */
let scrollScheduled = false;

const addMessage = ({ author, content, type }) => {
  const safeText   = escapeHTML(content);
  const linkified  = safeText.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" class="chat-link" rel="noreferrer">$1</a>');

  const wrap = document.createElement('div');
  wrap.className = `message-wrapper ${type}`;
  wrap.innerHTML = `<div class="message-bubble">${linkified.replace(/\n/g, '<br>')}</div><span class="timestamp">${formatTime()}</span>`;

  messagesList.appendChild(wrap);

  /*  Optimised scroll – gunakan requestAnimationFrame */
  if (!scrollScheduled) {
    scrollScheduled = true;
    requestAnimationFrame(() => {
      messagesList.scrollTop = messagesList.scrollHeight;
      scrollScheduled = false;
    });
  }
};

/* ------------------------------------------------------------------ */
/* 5.  Theme Handling                                                 */
/* ------------------------------------------------------------------ */
const applyTheme = (theme) => {
  document.body.classList.toggle('dark-mode', theme === 'dark');
  if (themeIcon) themeIcon.textContent = theme === 'dark' ? '🌙' : '🌞';
};

/* ------------------------------------------------------------------ */
/* 6.  Emoji Picker (build once)                                      */
/* ------------------------------------------------------------------ */
(() => {
  const frag = document.createDocumentFragment();
  EMOJIS.forEach((e) => {
    const sp = document.createElement('span');
    sp.textContent = e;
    frag.appendChild(sp);
  });
  emojiPicker.appendChild(frag);
})();

/* ------------------------------------------------------------------ */
/* 7.  Event Bindings                                                 */
/* ------------------------------------------------------------------ */
minimizeBtn.addEventListener('click', () => window.api.send('window-minimize'));
closeBtn   .addEventListener('click', () => window.api.send('window-close'));

themeBtn.addEventListener('click', () => {
  const newTheme = document.body.classList.contains('dark-mode') ? 'light' : 'dark';
  currentSettings.theme = newTheme;
  applyTheme(newTheme);
});

sendBtn.addEventListener('click', () => trySend());

messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    trySend();
  }
});

messageInput.addEventListener('input', () => {
  messageInput.style.height = 'auto';
  messageInput.style.height = `${Math.min(messageInput.scrollHeight, 120)}px`;
});

/** Shared send handler */
const trySend = () => {
  const txt = messageInput.value.trim();
  if (!txt) return;
  addMessage({ author: 'Anda', content: txt, type: 'sent' });
  window.api.send('send-message', txt);
  messageInput.value = '';
  messageInput.style.height = 'auto';
};

/* --- link click (delegated) --------------------------------------- */
messagesList.addEventListener('click', (e) => {
  const a = e.target.closest('a.chat-link');
  if (!a) return;
  e.preventDefault();
  window.api.openExternal(a.href);
});

/* --- emoji picker ------------------------------------------------- */
emojiBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  emojiPicker.classList.toggle('hidden');
});
emojiPicker.addEventListener('click', (e) => {
  e.stopPropagation();
  if (e.target.tagName === 'SPAN') {
    messageInput.value += e.target.textContent;
    messageInput.focus();
  }
});
document.addEventListener('click', () => emojiPicker.classList.add('hidden'));

/* ------------------------------------------------------------------ */
/* 8.  Settings Modal                                                */
/* ------------------------------------------------------------------ */
settingsBtn.addEventListener('click', () => {
  headerTitleInput.value = currentSettings.appTitle || 'Operator DyGaming';
  notifSoundInput.value  = currentSettings.notifSoundPath || '';
  settingsModal.classList.remove('hidden');
});

notifSoundInput.addEventListener('click', async () => {
  const fp = await window.api.selectFile({ filters: [{ name: 'Sounds', extensions: ['wav', 'mp3', 'ogg'] }] });
  if (fp) {
    notifSoundInput.value = fp;
    previewSound(fp);
  }
});

const setNotifSrc = (p) => {
  notifSound.src = p.startsWith('assets/') ? resolveAsset(p.replace(/^assets[\\/]/, '')) : toFileURL(p);
};

const previewSound = (p) => {
  setNotifSrc(p);
  notifSound.play().catch(() => {});
};

const previewProfilePic = (p) => {
  const pic = $('profile-picture');
  if (!p || !pic) return;
  pic.src = p.startsWith('assets/') ? resolveAsset(p.replace(/^assets[\\/]/, '')) : toFileURL(p);
};

saveSetBtn.addEventListener('click', () => {
  const newTitle  = headerTitleInput.value.trim() || 'Operator DyGaming';
  const base      = process.cwd().replace(/\\/g, '/');
  let soundPath   = notifSoundInput.value.trim();
  if (soundPath && soundPath.startsWith(base)) soundPath = soundPath.slice(base.length + 1);
  if (!soundPath) soundPath = currentSettings.notifSoundPath || '';

  const cfg = {
    theme:          currentSettings.theme,
    notifSoundPath: soundPath,
    appTitle:       newTitle,
    profilePicPath: currentSettings.profilePicPath,
  };

  window.api.send('save-settings', cfg);
  currentSettings   = cfg;
  appTitle.textContent = newTitle;
  previewSound(soundPath);
  settingsModal.classList.add('hidden');
});

/* ------------------------------------------------------------------ */
/* 9.  Payment Modal                                                  */
/* ------------------------------------------------------------------ */
const formatNumber = (v) => {
  const n = parseInt(v.replace(/\./g, '')); // strip dots
  return Number.isNaN(n) ? '' : numberFmt.format(n);
};

paymentBtn.addEventListener('click', () => paymentModal.classList.remove('hidden'));
[senderInput, amountInput, methodInput].forEach((el) => el.addEventListener('input', validatePay));
amountInput.addEventListener('input', () => {
  amountInput.value = formatNumber(amountInput.value);
  validatePay();
});

function validatePay() {
  submitPayBtn.disabled = !(senderInput.value.trim() && amountInput.value.trim() && methodInput.value.trim());
}

submitPayBtn.addEventListener('click', () => {
  const data = {
    senderName: senderInput.value.trim(),
    amount: amountInput.value,
    method: methodInput.value.trim(),
  };
  window.api.send('send-payment', data);
  [senderInput, amountInput, methodInput].forEach((i) => (i.value = ''));
  submitPayBtn.disabled = true;
  paymentModal.classList.add('hidden');
});

/* ------------------------------------------------------------------ */
/* 10.  IPC Listeners                                                 */
/* ------------------------------------------------------------------ */
window.api.on('initial-data', ({ member, pc, settings }) => {
  currentSettings = settings;
  appTitle.textContent = settings.appTitle || 'Operator DyGaming';
  if (settings.notifSoundPath) setNotifSrc(settings.notifSoundPath);
  if (settings.profilePicPath) previewProfilePic(settings.profilePicPath);
  applyTheme(settings.theme || 'light');
});

window.api.on('settings-updated', (cfg) => {
  currentSettings   = cfg;
  appTitle.textContent = cfg.appTitle || 'Operator DyGaming';
  if (cfg.notifSoundPath) setNotifSrc(cfg.notifSoundPath);
  if (cfg.profilePicPath) previewProfilePic(cfg.profilePicPath);
});

const playNotif = () => notifSound.play().catch(() => {});

window.api.on('message-received', (m) => {
  addMessage({ author: m.author, content: m.content, type: 'received' });
  playNotif();
});

window.api.on('show-notification', ({ author, content }) => {
  addMessage({ author, content, type: 'received' });
  playNotif();
});

window.api.on('update-status', (st) => {
  appTitle.textContent = st;
});
