// renderer.js – Front-End NetChat Operator (07-07-2025)

/* ------------------------------------------------------------------ */
/*                      HELPER PATH RESOLVER                          */
/* ------------------------------------------------------------------ */
function resolveAsset(fn) {
  try {
    const abs = window.api.sendSync('resolve-asset', fn);
    if (abs) return `file:///${abs.replace(/\\/g, '/')}`;
  } catch { /* fallback */ }
  return `assets/${fn}`;
}
const toFileURL = p => p ? `file:///${p.replace(/\\/g, '/')}` : '';

/* ------------------------------------------------------------------ */
/*                     ALIAS API & HELPERS                            */
/* ------------------------------------------------------------------ */
const apiSend       = window.api.send;
const apiSelectFile = () => window.api.selectFile();

const sendReply     = (cid, msg) => apiSend('send-reply',    { clientId: cid, message: msg });
const sendBroadcast = text      => apiSend('send-broadcast', text);
const markAsRead    = cid       => apiSend('mark-as-read',   cid);
const saveSettings  = cfg       => apiSend('save-settings',  cfg);
const runSimulation = pl        => apiSend('run-simulation', pl);
const apiGetAllMembers   = ()   => window.api.getAllMembers();

/* ------------------------------------------------------------------ */
/*                    DEKLARASI ELEMEN UI (DOM)                       */
/* ------------------------------------------------------------------ */
const searchInput           = document.getElementById('search-client-input');
const onlineCountEl         = document.getElementById('online-count');
const clientListAll         = document.getElementById('client-list-all');
const clientListContainer   = document.querySelector('.client-list-container');
const sidebar               = document.getElementById('sidebar');
const resizer               = document.getElementById('resizer');

const welcomePanel          = document.getElementById('welcome-panel');
const conversationPanel     = document.getElementById('conversation-panel');
const chatTitle             = document.getElementById('chat-title');
const messagesList          = document.getElementById('messages-list');

const messageInput          = document.getElementById('message-input');
const sendButton            = document.getElementById('send-button');
const emojiButton           = document.getElementById('emoji-button');
const emojiPicker           = document.getElementById('emoji-picker');

const themeSwitcher         = document.getElementById('theme-switcher');
const settingsButton        = document.getElementById('settings-button');
const broadcastButton       = document.getElementById('broadcast-button');
const settingsModal         = document.getElementById('settings-modal');
const broadcastModal        = document.getElementById('broadcast-modal');
const closeModalButtons     = document.querySelectorAll('.close-modal-button');

const ipInput               = document.getElementById('ip-input');
const portInput             = document.getElementById('port-input');
const chatSoundSelect       = document.getElementById('chat-sound-select');
const paymentSoundSelect    = document.getElementById('payment-sound-select');
const shutdownSoundSelect   = document.getElementById('shutdown-sound-select');
const saveSettingsButton    = document.getElementById('save-settings-button');

const broadcastMessageInput = document.getElementById('broadcast-message');
const sendBroadcastButton   = document.getElementById('send-broadcast-button');

const memberListModal       = document.getElementById('member-list-modal');
const memberListUl          = document.getElementById('member-list');
const memberCountSpan       = document.getElementById('member-count');
const memberListTitle       = document.getElementById('member-list-title');
const memberSearchInput     = document.getElementById('member-search-input');
const closeMemberListBtn    = document.getElementById('close-member-list');

/* ------------------------------------------------------------------ */
/*                         STATE & AUDIO                              */
/* ------------------------------------------------------------------ */
let currentMember   = null;
let clientsData     = new Map();
let currentSettings = {};
let lastUpdatedId   = null;

const displayedMessages = new Set();

const sounds = {
  chat:     new Audio(),
  payment:  new Audio(),
  shutdown: new Audio()
};

/* ------------------------------------------------------------------ */
/*                       HELPER UI FUNCTIONS                          */
/* ------------------------------------------------------------------ */
// untuk track header tanggal terakhir kali ditampilkan
let lastDateDisplayed = null;

/**
 * Escape HTML agar aman ditampilkan di chat bubble.
 */
function escapeHTML(s) {
  return s.replace(/[&<>'"]/g, t => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[t]));
}

/**
 * Format waktu saja, misal "08:45" dalam locale id-ID.
 */
function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('id-ID', {
    hour:   '2-digit',
    minute: '2-digit'
  });
}

/**
 * Format header tanggal penuh, misal "Senin, 7-7-2025".
 */
function formatDateHeader(ts) {
  return new Date(ts).toLocaleDateString('id-ID', {
    weekday: 'long',
    day:     'numeric',
    month:   'numeric',
    year:    'numeric'
  });
}

/**
 * Buat elemen separator tanggal.
 */
function createDateSeparator(ts) {
  const sep = document.createElement('div');
  sep.className = 'date-separator';
  sep.textContent = formatDateHeader(ts);
  return sep;
}

/**
 * Scroll chat panel ke bawah.
 */
function scrollToBottom() {
  messagesList.scrollTop = messagesList.scrollHeight;
}

function applyMemberSearchFilter() {
  const q = memberSearchInput.value.trim().toLowerCase();
  Array.from(memberListUl.children).forEach(li => {
    li.style.display = li.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}
memberSearchInput.addEventListener('input', applyMemberSearchFilter);


/* ------------------------------------------------------------------ */
/*                 MEMUAT RIWAYAT DARI DATABASE                       */
/* ------------------------------------------------------------------ */
async function loadHistory(member) {
  messagesList.innerHTML = '';
  // reset lastDateDisplayed agar header tanggal muncul sekali di tiap chat
  lastDateDisplayed = null;

  try {
    const rows = await window.api.getMessages(member, 1000);
    // tampilkan dari terlama ke terbaru
    rows.reverse().forEach(r => {
      const ts = new Date(r.time);
      const dateString = ts.toDateString(); // ex: "Mon Jul 07 2025"

      // sisipkan header tanggal jika hari berbeda
      if (lastDateDisplayed !== dateString) {
        messagesList.appendChild(createDateSeparator(ts));
        lastDateDisplayed = dateString;
      }

      // siapkan objek pesan
      const isPayment = /<strong>/.test(r.content);
      const msg = {
        sender:    r.sender,
        content:   r.content,
        type:      r.sender === 'system'
                     ? 'system'
                     : isPayment ? 'payment' : 'chat',
        timestamp: ts
      };

      // append pesan
      messagesList.appendChild(createMessageElement(msg));
    });
    scrollToBottom();
  } catch (e) {
    console.error('loadHistory error:', e);
  }
}


/* ------------------------------------------------------------------ */
/*               MEMBUAT ELEMEN CLIENT DI SIDEBAR                     */
/* ------------------------------------------------------------------ */
function createClientElement(c) {
  const li = document.createElement('li');
  li.className        = 'client-item';
  li.dataset.clientId = c.clientId;
  li.dataset.member   = c.member;
  li.dataset.pc       = c.pcName;
  li.dataset.status   = c.status;

  let cls = c.status === 'online' ? 'online' : 'offline';
  if (c.forcedShutdown) cls = 'forced-shutdown';

  const unread = c.unreadCount>0
    ? `<span class="unread-badge">${c.unreadCount}</span>` : '';
  const time = c.lastActivity ? formatTime(c.lastActivity) : '';

  li.innerHTML = `
    <span class="status-icon ${cls}"></span>
    <span class="client-name">${c.member.toUpperCase()} (${c.pcName})</span>
    ${unread}
    <span class="timestamp">${time}</span>
  `;
  return li;
}

/* ------------------------------------------------------------------ */
/*            MEMBUAT ELEMEN PESAN DI PANEL CHAT                      */
/* ------------------------------------------------------------------ */
function createMessageElement(m) {
  // Pastikan timestamp bertipe Date
  let ts = m.timestamp;
  if (!(ts instanceof Date)) ts = new Date(ts);

  const w = document.createElement('div');
  const t = formatTime(ts);

  // Normalisasi konten untuk deduplikasi dan tampilan
  let rawContent = '';
  if (m.type === 'payment') {
    rawContent = m.content;
  } else if (m.type === 'shutdown' && (!m.content || m.content.trim() === '')) {
    rawContent = `Klien Shutdown Paksa di Jam ${t}`;
  } else if (m.type === 'shutdown') {
    // Jika main process sudah mengirim teks shutdown custom, tambahkan jam di belakang jika belum ada
    if (!/jam|[0-9]{2}:[0-9]{2}/i.test(m.content)) {
      rawContent = `${m.content} (${t})`;
    } else {
      rawContent = m.content;
    }
  } else {
    rawContent = escapeHTML(m.content || '');
  }

  // Set atribut dataset untuk dedupe
  w.dataset.ts      = ts.getTime();
  w.dataset.content = rawContent;

    rawContent = rawContent.replace(
      /(https?:\/\/[^\s<]+)/g,
      '<a href="$1" class="chat-link">$1</a>'
    );

  // Pesan sistem (system, shutdown, dsb)
  if (m.sender === 'system') {
    const isShutdown = m.type === 'shutdown' || /shutdown paksa/i.test(rawContent);
    w.className = 'message-wrapper system' + (isShutdown ? ' shutdown' : '');

    w.innerHTML = `
      <span class="system-content">${rawContent}</span>
      <span class="timestamp">${t}</span>
    `;
    return w;
  }

  document.addEventListener('click', e => {
    const a = e.target.closest('a.chat-link');
    if (!a) return;
    e.preventDefault();           // cegah default buka internal
    e.stopImmediatePropagation(); // hentikan event lain
    window.api.openExternal(a.href);
  });


  // Pesan operator/client (chat/payment)
  const type = m.sender === 'operator' ? 'sent' : 'received';
  w.className = `message-wrapper ${type}`;
  w.innerHTML = `
    ${type === 'sent' ? `<span class="timestamp">${t}</span>` : ''}
    <div class="message-bubble"><span class="message-content">${rawContent}</span></div>
    ${type === 'received' ? `<span class="timestamp">${t}</span>` : ''}
  `;
  return w;
}




/* ------------------------------------------------------------------ */
/*               CARI PC ONLINE MILIK MEMBER                          */
/* ------------------------------------------------------------------ */
function findPcByMember(m) {
  const li = document.querySelector(`.client-item[data-member="${m}"][data-status="online"]`);
  return li ? li.dataset.pc : null;
}

/* ------------------------------------------------------------------ */
/*                         INTERAKSI SIDEBAR                          */
/* ------------------------------------------------------------------ */
// saat input, panggil fungsi filter
searchInput.addEventListener('input', applySearchFilter);

resizer.addEventListener('mousedown', () => {
  const move = e => {
    const w   = e.clientX;
    const min = parseInt(getComputedStyle(sidebar).minWidth);
    const max = parseInt(getComputedStyle(sidebar).maxWidth);
    if (w > min && w < max) sidebar.style.width = `${w}px`;
  };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', () => {
    document.removeEventListener('mousemove', move);
  }, { once: true });
});

/* ------------------------------------------------------------------ */
/*                          BUKA CHAT                                 */
/* ------------------------------------------------------------------ */
async function openChat(li) {
  const cid    = li.dataset.clientId;
  const member = li.dataset.member;
  currentMember = member;

  markAsRead(cid);

  welcomePanel.classList.add('hidden');
  conversationPanel.classList.remove('hidden');
  chatTitle.textContent=`Percakapan: ${member.toUpperCase()} (${li.dataset.pc})`;

  document.querySelectorAll('.client-item.active').forEach(x=>x.classList.remove('active'));
  li.classList.add('active');

  await loadHistory(member);

}
clientListContainer.addEventListener('click',e=>{
  const li=e.target.closest('.client-item');
  if(li) openChat(li);
});

/* ------------------------------------------------------------------ */
/*                    FUNGSI FILTER PENCARIAN                         */
/* ------------------------------------------------------------------ */
function applySearchFilter() {
  const q = searchInput.value.trim().toLowerCase();
  document.querySelectorAll('.client-item').forEach(li => {
    const name = li.querySelector('.client-name').textContent.toLowerCase();
    li.classList.toggle('hidden', !name.includes(q));
  });
}


/* ------------------------------------------------------------------ */
/*                         KIRIM PESAN                                */
/* ------------------------------------------------------------------ */
function showToast(message) {
  const t = document.createElement('div');
  t.id = 'toast';
  t.textContent = message;
  document.body.appendChild(t);
  setTimeout(() => {
    t.classList.add('fade-out');
    setTimeout(() => t.remove(), 300);
  }, 2000);
}

function doSend() {
  const txt = messageInput.value.trim();
  if (!txt || !currentMember) return;

  const pc = findPcByMember(currentMember);
  if (!pc) {
    showToast('⚠️ Klien sedang offline, pesan tidak terkirim.');
    return;
  }

  sendReply(`${currentMember}_${pc}`, txt);
  messageInput.value = '';
  messageInput.focus();
}

sendButton.addEventListener('click', doSend);
messageInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    doSend();
  }
});

/* ------------------------------------------------------------------ */
/*                         EMOJI PICKER                               */
/* ------------------------------------------------------------------ */
emojiButton.addEventListener('click',e=>{ e.stopPropagation(); emojiPicker.classList.toggle('hidden'); });
emojiPicker.addEventListener('click',e=>{ e.stopPropagation(); if(e.target.tagName==='SPAN'){ messageInput.value+=e.target.textContent; messageInput.focus(); } });
document.addEventListener('click',()=>emojiPicker.classList.add('hidden'));

/* ------------------------------------------------------------------ */
/*                            TEMA                                    */
/* ------------------------------------------------------------------ */
themeSwitcher.addEventListener('click',()=>{ 
  document.body.classList.toggle('light-mode');
  document.body.classList.toggle('dark-mode');
  const isLight=document.body.classList.contains('light-mode');
  themeSwitcher.textContent=isLight?'🌙':'☀️';
  themeSwitcher.title=isLight?'Ganti ke Mode Gelap':'Ganti ke Mode Terang';
});

/* ------------------------------------------------------------------ */
/*                  MODAL PENGATURAN & BROADCAST                      */
/* ------------------------------------------------------------------ */
function closeModal() {
  settingsModal.classList.add('hidden');
  broadcastModal.classList.add('hidden');
  broadcastMessageInput.value='';
}

settingsButton.addEventListener('click',()=>{
  ipInput.value=currentSettings.server_ip||'';
  portInput.value=currentSettings.server_port||'';
  chatSoundSelect.value=currentSettings.sounds?.chat||'';
  paymentSoundSelect.value=currentSettings.sounds?.payment||'';
  shutdownSoundSelect.value=currentSettings.sounds?.shutdown||'';
  settingsModal.classList.remove('hidden');
});

// **INTEGRASI BROADCAST**
broadcastButton.addEventListener('click',()=>{
  broadcastModal.classList.remove('hidden');
  broadcastMessageInput.focus();
});
sendBroadcastButton.addEventListener('click',()=>{
  const txt = broadcastMessageInput.value.trim();
  if(!txt) return;
  sendBroadcast(txt);
  broadcastModal.classList.add('hidden');
  broadcastMessageInput.value='';
});
closeModalButtons.forEach(b=>b.addEventListener('click',closeModal));
window.addEventListener('click',e=>{
  if(e.target===settingsModal||e.target===broadcastModal) closeModal();
});

/* ------------------------------------------------------------------ */
/*                     MENU KONTEKS KLIEN VIRTUAL                     */
/* ------------------------------------------------------------------ */
clientListContainer.addEventListener('contextmenu', e => {
  const li = e.target.closest('.client-item');
  if (!li || !li.dataset.clientId.includes('VIRTUAL')) return;
  e.preventDefault();

  const cid = li.dataset.clientId;
  document.querySelector('.context-menu')?.remove();

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.left = `${e.clientX}px`;
  menu.style.top  = `${e.clientY}px`;
  menu.innerHTML = `
    <div data-action="send-instant">Kirim Pesan Instan</div>
    <div data-action="send-messages">Kirim 3 Pesan (15s)</div>
    <div data-action="receive-custom">Terima 2 Balasan (10s)</div>
    <div data-action="send-broadcast">Tes 3 Broadcast (15s)</div>
  `;
  document.body.appendChild(menu);

  menu.addEventListener('click', ev => {
    const act = ev.target.dataset.action;
    if (act) runSimulation({ clientId: cid, action: act });
    menu.remove();
  });
  document.addEventListener('click', () => menu.remove(), { once: true });
});

/* ------------------------------------------------------------------ */
/*                        LISTENER IPC                                */
/* ------------------------------------------------------------------ */
window.api.on('settings-loaded', set => {
  currentSettings = set;
  if (set.sounds.chat)     sounds.chat.src     = toFileURL(set.sounds.chat);
  if (set.sounds.payment)  sounds.payment.src  = toFileURL(set.sounds.payment);
  if (set.sounds.shutdown) sounds.shutdown.src = toFileURL(set.sounds.shutdown);
});

window.api.on('update-client-list', list => {
  list.sort((a, b) => {
   /* 1️⃣  Prioritas: ada unread badge → paling atas */
   const aHasUnread = a.unreadCount > 0;
   const bHasUnread = b.unreadCount > 0;
   if (aHasUnread !== bHasUnread) return aHasUnread ? -1 : 1;

   /* 2️⃣  Kalau dua‑duanya unread atau sama‑sama sudah dibaca:
          online tetap di atas offline                           */
    if (a.status !== b.status) return a.status === 'online' ? -1 : 1;

   /* 3️⃣  Terakhir, urut berdasarkan lastActivity desc */
    return (b.lastActivity || 0) - (a.lastActivity || 0);
  });

  const frag = document.createDocumentFragment();
  let online = 0;

  list.forEach(c => {
    if (c.status === 'online') online++;
    const prev = clientsData.get(c.clientId);
    clientsData.set(
      c.clientId,
      prev ? { ...c, chatHistory: prev.chatHistory }
           : { ...c, chatHistory: [] }
    );
    frag.appendChild(createClientElement(c));
  });

  clientListAll.innerHTML = '';
  clientListAll.appendChild(frag);
  onlineCountEl.textContent = online;

    // **Panggil ulang filter di sini** agar hasil pencarian tetap berlaku
  applySearchFilter();

  if (currentMember) {
    document.querySelector(`.client-item[data-member="${currentMember}"]`)
            ?.classList.add('active');
  }
  if (lastUpdatedId) {
    document.querySelector(`.client-item[data-client-id="${lastUpdatedId}"]`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    lastUpdatedId = null;
  }
});

window.api.on('message-received', ({ clientId, message }) => {
  const [member] = clientId.split('_');
  const data     = clientsData.get(clientId);

  // Paksa timestamp selalu Date
  let ts = message.timestamp;
  if (!(ts instanceof Date)) ts = new Date(ts);

  // update local data
  if (data) {
    data.chatHistory.push({
      ...message,
      timestamp: ts
    });
    data.lastActivity = ts.getTime();
  }

  // hanya kalau ini chat aktif
  if (member === currentMember) {
    const dateStr = ts.toDateString();

    // Dedupe hanya pakai ts dan content (dan hanya jika ada content)
    const rawContent = message.type === 'payment'
      ? message.content
      : escapeHTML(message.content || '');

    const exists = messagesList.querySelector(
      `.message-wrapper[data-ts="${ts.getTime()}"][data-content="${CSS.escape(rawContent)}"]`
    );
    if (exists) return;

    // sisipkan header tanggal bila perlu
    if (lastDateDisplayed !== dateStr) {
      messagesList.appendChild(createDateSeparator(ts));
      lastDateDisplayed = dateStr;
    }

    // --- Tambahan: default content untuk pesan shutdown paksa
    let showMessage = { ...message, timestamp: ts };
    if (showMessage.sender === 'system' && showMessage.type === 'shutdown' && !showMessage.content) {
      showMessage.content = `Klien Shutdown Paksa di Jam ${formatTime(ts)}`;
    }

    // render dan scroll
    messagesList.appendChild(createMessageElement(showMessage));
    scrollToBottom();

    // tanda sudah dibaca
    markAsRead(clientId);
  } else {
    lastUpdatedId = clientId;
  }

  // suara notifikasi
  if (message.sender !== 'operator') {
    if (message.type === 'payment' && sounds.payment.src) {
      sounds.payment.play().catch(()=>{});
    } else if (message.type === 'chat' && sounds.chat.src) {
      sounds.chat.play().catch(()=>{});
    }
    // Bisa juga tambahkan suara khusus shutdown:
    else if (message.type === 'shutdown' && sounds.shutdown.src) {
      sounds.shutdown.play().catch(()=>{});
    }
  }
});




window.api.on('focus-chat', cid => {
  document.querySelector(`.client-item[data-client-id="${cid}"]`)?.click();
});

window.api.on('play-sound', t => {
  if (t && sounds[t] && sounds[t].src) {
    sounds[t].play().catch(() => {});
  }
});

/* ------------------------------------------------------------------ */
/*                   Fitur Daftar Semua Member (Ctrl+P)               */
/* ------------------------------------------------------------------ */
async function openMemberList() {
  // ambil semua member, kecuali “GUEST”
  const members = (await apiGetAllMembers()).filter(m => m !== 'GUEST');
  memberCountSpan.textContent = members.length;
  memberSearchInput.value = '';                   // reset search
  memberListUl.innerHTML = members
    .map(m => `<li class="member-item">${m}</li>`)
    .join('');
  applyMemberSearchFilter();                      // langsung filter (kosong = all)
  memberListModal.classList.remove('hidden');

  // tiap <li> diklik → buka chat (online dulu, kalau tidak ada buka history offline)
  document.querySelectorAll('.member-item').forEach(li => {
    li.addEventListener('click', async () => {
      const member = li.textContent.trim();
      memberListModal.classList.add('hidden');

      // coba cari di sidebar (online atau offline <30 menit)
      const sidebarLi = document.querySelector(`.client-item[data-member="${member}"]`);
      if (sidebarLi) {
        sidebarLi.click();    // sudah otomatis loadHistory + openChat
      } else {
        // offline sepenuhnya: tampilkan hanya history dari DB
        currentMember = member;
        welcomePanel.classList.add('hidden');
        conversationPanel.classList.remove('hidden');
        chatTitle.textContent = `Percakapan (Offline): ${member}`;
        await loadHistory(member);
      }
    });
  });
}

// tutup modal
closeMemberListBtn.addEventListener('click', () => {
  memberListModal.classList.add('hidden');
});

// shortcut Ctrl+P untuk buka modal
document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.key.toLowerCase() === 'p') {
    e.preventDefault();
    openMemberList();
  }
});

// juga bisa dipicu dari main process (shortcut globalShortcut)
window.api.on('show-member-list', () => {
  openMemberList();
});


/* ------------------------------------------------------------------ */
/*                          INIT UI                                   */
/* ------------------------------------------------------------------ */
chatTitle.textContent = 'Pilih klien di sebelah kiri';
