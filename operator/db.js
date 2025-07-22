/**********************************************************************
 * db.js  –  Lapisan database NetChat (SQLite via better-sqlite3)
 * Versi revisi: 07-07-2025
 *********************************************************************/

const path     = require('path');
const fs       = require('fs');
const { app }  = require('electron');
const Database = require('better-sqlite3');

// ======================================================
// 1. Tentukan path ke netchat.db (dev vs packaged)
// ======================================================
const baseDir = app.isPackaged
  ? path.dirname(process.execPath)
  : __dirname;

const dbFile = path.join(baseDir, 'netchat.db');
// Pastikan folder ada
if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });

// ======================================================
// 2. Buka / buat database
// ======================================================
const db = new Database(dbFile);
// Optimasi & foreign keys
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ======================================================
// 3. Inisialisasi skema (selalu idempoten)
// ======================================================
db.exec(`
  CREATE TABLE IF NOT EXISTS members (
    member        TEXT PRIMARY KEY,
    display_name  TEXT
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    member        TEXT NOT NULL,
    pc_name       TEXT NOT NULL,
    login_time    INTEGER NOT NULL,
    logout_time   INTEGER,
    FOREIGN KEY(member) REFERENCES members(member)
  );
  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    member     TEXT    NOT NULL,
    sender     TEXT    NOT NULL,  -- 'client' | 'operator' | 'system'
    content    TEXT    NOT NULL,
    timestamp  INTEGER NOT NULL,  -- epoch seconds
    read       INTEGER DEFAULT 0, -- 0 = unread, 1 = read
    FOREIGN KEY(member) REFERENCES members(member)
  );
`);

// ======================================================
// 4. Prepared statements
// ======================================================
const stmtInsertMember     = db.prepare(`
  INSERT OR IGNORE INTO members (member, display_name)
  VALUES (?, ?);
`);

const stmtSelectMembers    = db.prepare(`
  SELECT member
    FROM members
 ORDER BY member;
`);

const stmtOpenSession      = db.prepare(`
  INSERT INTO sessions (member, pc_name, login_time)
  VALUES (?, ?, strftime('%s','now'));
`);

const stmtCloseSession     = db.prepare(`
  UPDATE sessions
     SET logout_time = strftime('%s','now')
   WHERE id = ?;
`);

const stmtInsertMessage    = db.prepare(`
  INSERT INTO messages (member, sender, content, timestamp, read)
  VALUES (?, ?, ?, strftime('%s','now'), 0);
`);

const stmtSelectMessages   = db.prepare(`
  SELECT sender, content, timestamp, read
    FROM messages
   WHERE member = ?
   ORDER BY timestamp DESC
   LIMIT ?;
`);

const stmtMarkAllRead      = db.prepare(`
  UPDATE messages
     SET read = 1
   WHERE member = ? AND sender = 'client';
`);

const stmtCountUnread = db.prepare(`
  SELECT COUNT(*) AS cnt
    FROM messages
   WHERE member = ? AND sender = 'client' AND read = 0;
`);

// ======================================================
// 5. Fungsi API
// ======================================================
function openSession(member, pcName) {
  stmtInsertMember.run(member, null);
  const info = stmtOpenSession.run(member, pcName);
  return info.lastInsertRowid;
}

function closeSession(sessionId) {
  if (sessionId) {
    stmtCloseSession.run(sessionId);
  }
}

function insertMessage(member, sender, content) {
  stmtInsertMember.run(member, null);
  stmtInsertMessage.run(member, sender, content);
}

function getMessagesByMember(member, limit = 1000) {
  return stmtSelectMessages
    .all(member, limit)
    .map(r => ({
      sender:   r.sender,
      content:  r.content,
      time:     r.timestamp * 1000, // ke ms
      read:     Boolean(r.read)
    }));
}

function markMessagesRead(member) {
  stmtMarkAllRead.run(member);
}

function getUnreadCount(member) {
  return stmtCountUnread.get(member).cnt;
}

/**
 * Ambil semua member yang pernah terdaftar / memiliki history
 * @returns {string[]} daftar member
 */
function getAllMembers() {
  return stmtSelectMembers.all().map(r => r.member);
}

// ======================================================
// 6. Ekspor
// ======================================================
module.exports = {
  openSession,
  closeSession,
  insertMessage,
  getMessagesByMember,
  markMessagesRead,
  getAllMembers,
  getUnreadCount
};
