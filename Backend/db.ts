import Database = require('better-sqlite3');
import * as path from 'path';
import * as crypto from 'crypto';

const DB_PATH = path.join(__dirname, 'nexus.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH, { fileMustExist: false });
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
      last_login INTEGER
    );

    CREATE TABLE IF NOT EXISTS chat_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      blob_config TEXT NOT NULL DEFAULT '{}',
      ui_config TEXT NOT NULL DEFAULT '{}',
      assistant_settings TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS recipes (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      trigger_type TEXT NOT NULL,
      trigger_config TEXT NOT NULL DEFAULT '{}',
      action_type TEXT NOT NULL,
      action_config TEXT NOT NULL DEFAULT '{}',
      last_run INTEGER,
      run_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      priority TEXT DEFAULT 'normal',
      due_date INTEGER,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS calendar_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      start_time INTEGER NOT NULL,
      end_time INTEGER NOT NULL,
      location TEXT DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_chat_history_user ON chat_history(user_id);
    CREATE INDEX IF NOT EXISTS idx_recipes_user ON recipes(user_id);
    CREATE INDEX IF NOT EXISTS idx_todos_user ON todos(user_id);
    CREATE INDEX IF NOT EXISTS idx_calendar_user ON calendar_events(user_id);
    CREATE INDEX IF NOT EXISTS idx_chat_history_ts ON chat_history(timestamp);
  `);
}

// ── User helpers ──
function createUser({ username, email, passwordHash, displayName }) {
  const stmt = getDb().prepare(`
    INSERT INTO users (username, email, password_hash, display_name)
    VALUES (?, ?, ?, ?)
  `);
  const result = stmt.run(username, email || null, passwordHash, displayName || username);
  return getUserById(result.lastInsertRowid);
}

function getUserById(id) {
  return getDb().prepare('SELECT id, username, email, display_name, created_at, last_login FROM users WHERE id = ?').get(id);
}

function getUserByUsername(username) {
  const row = getDb().prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    display_name: row.display_name,
    password_hash: row.password_hash,
    created_at: row.created_at,
    last_login: row.last_login,
  };
}

function getUserByEmail(email) {
  return getDb().prepare('SELECT id, username, email, display_name, created_at, last_login FROM users WHERE email = ?').get(email);
}

function updateLastLogin(id) {
  getDb().prepare('UPDATE users SET last_login = ? WHERE id = ?').run(Date.now(), id);
}

function updateUserProfile(id, { displayName, email }) {
  getDb().prepare('UPDATE users SET display_name = COALESCE(?, display_name), email = COALESCE(?, email) WHERE id = ?')
    .run(displayName || null, email || null, id);
  return getUserById(id);
}

// ── Chat History ──
function getChatHistory(userId, limit = 100) {
  return getDb().prepare(
    'SELECT id, role, text, timestamp FROM chat_history WHERE user_id = ? ORDER BY timestamp ASC, id ASC LIMIT ?'
  ).all(userId, limit);
}

function addChatEntry(userId, role, text) {
  const stmt = getDb().prepare(
    'INSERT INTO chat_history (user_id, role, text, timestamp) VALUES (?, ?, ?, ?)'
  );
  stmt.run(userId, role, text, Date.now());
  // Keep last 100 entries per user
  getDb().prepare(`
    DELETE FROM chat_history WHERE id IN (
      SELECT id FROM chat_history WHERE user_id = ? ORDER BY timestamp DESC LIMIT -1 OFFSET 100
    )
  `).run(userId);
}

function clearChatHistory(userId) {
  getDb().prepare('DELETE FROM chat_history WHERE user_id = ?').run(userId);
}

// ── Settings ──
function getSettings(userId) {
  let row = getDb().prepare('SELECT * FROM settings WHERE user_id = ?').get(userId);
  if (!row) {
    getDb().prepare('INSERT INTO settings (user_id) VALUES (?)').run(userId);
    row = getDb().prepare('SELECT * FROM settings WHERE user_id = ?').get(userId);
  }
  return {
    blob_config: safeJson(row.blob_config),
    ui_config: safeJson(row.ui_config),
    assistant_settings: safeJson(row.assistant_settings),
  };
}

function updateBlobConfig(userId, config) {
  getDb().prepare('UPDATE settings SET blob_config = ? WHERE user_id = ?').run(JSON.stringify(config), userId);
}

function updateUiConfig(userId, config) {
  getDb().prepare('UPDATE settings SET ui_config = ? WHERE user_id = ?').run(JSON.stringify(config), userId);
}

function updateAssistantSettings(userId, settings) {
  getDb().prepare('UPDATE settings SET assistant_settings = ? WHERE user_id = ?').run(JSON.stringify(settings), userId);
}

function safeJson(str) {
  try { return JSON.parse(str); } catch { return {}; }
}

// ── Recipes ──
function getRecipes(userId) {
  const rows = getDb().prepare(
    'SELECT * FROM recipes WHERE user_id = ? ORDER BY created_at DESC'
  ).all(userId);
  return rows.map(normalizeRecipe);
}

function getRecipeById(id, userId) {
  const row = getDb().prepare('SELECT * FROM recipes WHERE id = ? AND user_id = ?').get(id, userId);
  return row ? normalizeRecipe(row) : null;
}

function createRecipe(userId, data) {
  const id = crypto.randomUUID().slice(0, 8);
  getDb().prepare(`
    INSERT INTO recipes (id, user_id, name, description, enabled, trigger_type, trigger_config, action_type, action_config, created_at)
    VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
  `).run(
    id, userId, data.name || 'Unnamed', data.description || '',
    data.trigger?.type || 'time', JSON.stringify(data.trigger?.config || {}),
    data.action?.type || 'message', JSON.stringify(data.action?.config || {}),
    Date.now()
  );
  return getRecipeById(id, userId);
}

function updateRecipeById(id, userId, data) {
  const existing = getDb().prepare('SELECT * FROM recipes WHERE id = ? AND user_id = ?').get(id, userId);
  if (!existing) return null;
  getDb().prepare(`
    UPDATE recipes SET name = ?, description = ?, trigger_type = ?, trigger_config = ?, action_type = ?, action_config = ?
    WHERE id = ? AND user_id = ?
  `).run(
    data.name ?? existing.name,
    data.description ?? existing.description,
    data.trigger?.type ?? existing.trigger_type,
    JSON.stringify(data.trigger?.config ?? safeJson(existing.trigger_config)),
    data.action?.type ?? existing.action_type,
    JSON.stringify(data.action?.config ?? safeJson(existing.action_config)),
    id, userId
  );
  return getRecipeById(id, userId);
}

function deleteRecipeById(id, userId) {
  return getDb().prepare('DELETE FROM recipes WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
}

function toggleRecipeById(id, userId) {
  const recipe = getDb().prepare('SELECT * FROM recipes WHERE id = ? AND user_id = ?').get(id, userId);
  if (!recipe) return null;
  const newEnabled = recipe.enabled ? 0 : 1;
  getDb().prepare('UPDATE recipes SET enabled = ? WHERE id = ?').run(newEnabled, id);
  return getRecipeById(id, userId);
}

function updateRecipeRun(id, userId) {
  getDb().prepare('UPDATE recipes SET last_run = ?, run_count = run_count + 1 WHERE id = ? AND user_id = ?')
    .run(Date.now(), id, userId);
}

function normalizeRecipe(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    enabled: Boolean(row.enabled),
    trigger: {
      type: row.trigger_type,
      config: safeJson(row.trigger_config),
    },
    action: {
      type: row.action_type,
      config: safeJson(row.action_config),
    },
    lastRun: row.last_run,
    runCount: row.run_count,
    createdAt: row.created_at,
  };
}

// ── Todos ──
function getTodos(userId) {
  return getDb().prepare(
    'SELECT * FROM todos WHERE user_id = ? ORDER BY created_at DESC'
  ).all(userId).map(normalizeTodo);
}

function addTodo(userId: number, text: string, options: Record<string, any> = {}) {
  const stmt = getDb().prepare(`
    INSERT INTO todos (user_id, text, priority, due_date)
    VALUES (?, ?, ?, ?)
  `);
  const result = stmt.run(userId, text, options.priority || 'normal', options.dueDate || null);
  return getTodoById(result.lastInsertRowid, userId);
}

function getTodoById(id, userId) {
  const row = getDb().prepare('SELECT * FROM todos WHERE id = ? AND user_id = ?').get(id, userId);
  return row ? normalizeTodo(row) : null;
}

function updateTodo(id, userId, updates) {
  const existing = getDb().prepare('SELECT * FROM todos WHERE id = ? AND user_id = ?').get(id, userId);
  if (!existing) return null;
  
  getDb().prepare(`
    UPDATE todos SET text = ?, completed = ?, priority = ?, due_date = ?
    WHERE id = ? AND user_id = ?
  `).run(
    updates.text ?? existing.text,
    updates.completed !== undefined ? (updates.completed ? 1 : 0) : existing.completed,
    updates.priority ?? existing.priority,
    updates.dueDate ?? existing.due_date,
    id, userId
  );
  return getTodoById(id, userId);
}

function deleteTodo(id, userId) {
  return getDb().prepare('DELETE FROM todos WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
}

function normalizeTodo(row) {
  return {
    id: row.id,
    text: row.text,
    completed: Boolean(row.completed),
    priority: row.priority,
    dueDate: row.due_date,
    createdAt: row.created_at,
  };
}

// ── Calendar ──
function getEvents(userId, start, end) {
  let query = 'SELECT * FROM calendar_events WHERE user_id = ?';
  const params = [userId];
  if (start) { query += ' AND start_time >= ?'; params.push(start); }
  if (end) { query += ' AND end_time <= ?'; params.push(end); }
  query += ' ORDER BY start_time ASC';
  return getDb().prepare(query).all(...params);
}

function addEvent(userId, data) {
  const stmt = getDb().prepare(`
    INSERT INTO calendar_events (user_id, title, description, start_time, end_time, location)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(userId, data.title, data.description || '', data.startTime, data.endTime, data.location || '');
  return getEventById(result.lastInsertRowid, userId);
}

function getEventById(id, userId) {
  return getDb().prepare('SELECT * FROM calendar_events WHERE id = ? AND user_id = ?').get(id, userId);
}

function deleteEvent(id, userId) {
  return getDb().prepare('DELETE FROM calendar_events WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
}

function close() {
  if (db) { db.close(); db = null; }
}

export {
  getDb,
  createUser, getUserById, getUserByUsername, getUserByEmail,
  updateLastLogin, updateUserProfile,
  getChatHistory, addChatEntry, clearChatHistory,
  getSettings, updateBlobConfig, updateUiConfig, updateAssistantSettings,
  getRecipes, getRecipeById, createRecipe, updateRecipeById,
  deleteRecipeById, toggleRecipeById, updateRecipeRun,
  getTodos, addTodo, updateTodo, deleteTodo,
  getEvents, addEvent, deleteEvent,
  close,
};
