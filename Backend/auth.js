const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'nexus-jwt-secret-change-in-production';
const JWT_EXPIRES = '7d';
const SALT_ROUNDS = 10;

// ── Auth Middleware ──
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, error: 'No token provided' });
  }
  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.id;
    req.username = decoded.username;
    next();
  } catch {
    return res.status(401).json({ ok: false, error: 'Invalid or expired token' });
  }
}

// ── Optional Auth Middleware (does not reject) ──
function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(header.split(' ')[1], JWT_SECRET);
      req.userId = decoded.id;
      req.username = decoded.username;
    } catch {}
  }
  next();
}

// ── Register ──
router.post('/register', async (req, res) => {
  try {
    const { username, password, email, displayName } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({ ok: false, error: 'Username and password required' });
    }
    if (username.length < 3) {
      return res.status(400).json({ ok: false, error: 'Username must be at least 3 characters' });
    }
    if (password.length < 4) {
      return res.status(400).json({ ok: false, error: 'Password must be at least 4 characters' });
    }

    const existing = db.getUserByUsername(username);
    if (existing) {
      return res.status(409).json({ ok: false, error: 'Username already taken' });
    }

    if (email) {
      const emailUser = db.getUserByEmail(email);
      if (emailUser) {
        return res.status(409).json({ ok: false, error: 'Email already registered' });
      }
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = db.createUser({ username, email, passwordHash, displayName });
    db.updateLastLogin(user.id);

    const settings = db.getSettings(user.id);
    const history = db.getChatHistory(user.id);

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: JWT_EXPIRES });

    res.status(201).json({
      ok: true,
      token,
      user: { id: user.id, username: user.username, email: user.email, displayName: user.display_name },
      settings,
      history,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Login ──
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ ok: false, error: 'Username and password required' });
    }

    const user = db.getUserByUsername(username);
    if (!user) {
      return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    }

    db.updateLastLogin(user.id);
    const settings = db.getSettings(user.id);

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: JWT_EXPIRES });

    res.json({
      ok: true,
      token,
      user: { id: user.id, username: user.username, email: user.email, displayName: user.display_name },
      settings,
      history: db.getChatHistory(user.id),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Get Current User ──
router.get('/me', authMiddleware, (req, res) => {
  const user = db.getUserById(req.userId);
  if (!user) return res.status(404).json({ ok: false, error: 'User not found' });
  const settings = db.getSettings(req.userId);
  const history = db.getChatHistory(req.userId);
  res.json({
    ok: true,
    user: { id: user.id, username: user.username, email: user.email, displayName: user.display_name },
    settings,
    history,
  });
});

// ── Update Profile ──
router.put('/me', authMiddleware, (req, res) => {
  try {
    const { displayName, email } = req.body || {};
    const user = db.updateUserProfile(req.userId, { displayName, email });
    res.json({
      ok: true,
      user: { id: user.id, username: user.username, email: user.email, displayName: user.display_name },
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Settings ──
router.get('/settings', authMiddleware, (req, res) => {
  const settings = db.getSettings(req.userId);
  res.json({ ok: true, settings });
});

router.put('/settings/blob', authMiddleware, (req, res) => {
  db.updateBlobConfig(req.userId, req.body);
  res.json({ ok: true });
});

router.put('/settings/ui', authMiddleware, (req, res) => {
  db.updateUiConfig(req.userId, req.body);
  res.json({ ok: true });
});

router.put('/settings/assistant', authMiddleware, (req, res) => {
  db.updateAssistantSettings(req.userId, req.body);
  res.json({ ok: true });
});

// ── Chat History ──
router.get('/history', authMiddleware, (req, res) => {
  const history = db.getChatHistory(req.userId);
  res.json({ ok: true, history });
});

router.post('/history', authMiddleware, (req, res) => {
  const { role, text } = req.body || {};
  if (!role || !text) return res.status(400).json({ ok: false, error: 'role and text required' });
  db.addChatEntry(req.userId, role, text);
  res.json({ ok: true });
});

router.delete('/history', authMiddleware, (req, res) => {
  db.clearChatHistory(req.userId);
  res.json({ ok: true });
});

// ── Recipes ──
router.get('/recipes', authMiddleware, (req, res) => {
  res.json({ ok: true, recipes: db.getRecipes(req.userId) });
});

router.post('/recipes', authMiddleware, (req, res) => {
  const recipe = db.createRecipe(req.userId, req.body);
  res.status(201).json({ ok: true, recipe });
});

router.get('/recipes/:id', authMiddleware, (req, res) => {
  const recipe = db.getRecipeById(req.params.id, req.userId);
  if (!recipe) return res.status(404).json({ ok: false, error: 'Recipe not found' });
  res.json({ ok: true, recipe });
});

router.put('/recipes/:id', authMiddleware, (req, res) => {
  const recipe = db.updateRecipeById(req.params.id, req.userId, req.body);
  if (!recipe) return res.status(404).json({ ok: false, error: 'Recipe not found' });
  res.json({ ok: true, recipe });
});

router.delete('/recipes/:id', authMiddleware, (req, res) => {
  const deleted = db.deleteRecipeById(req.params.id, req.userId);
  if (!deleted) return res.status(404).json({ ok: false, error: 'Recipe not found' });
  res.json({ ok: true });
});

router.post('/recipes/:id/toggle', authMiddleware, (req, res) => {
  const recipe = db.toggleRecipeById(req.params.id, req.userId);
  if (!recipe) return res.status(404).json({ ok: false, error: 'Recipe not found' });
  res.json({ ok: true, recipe });
});

// ── Todos ──
router.get('/todos', authMiddleware, (req, res) => {
  res.json({ ok: true, todos: db.getTodos(req.userId) });
});

router.post('/todos', authMiddleware, (req, res) => {
  const { text, priority, dueDate } = req.body || {};
  if (!text) return res.status(400).json({ ok: false, error: 'text is required' });
  const todo = db.addTodo(req.userId, text, { priority, dueDate });
  res.status(201).json({ ok: true, todo });
});

router.put('/todos/:id', authMiddleware, (req, res) => {
  const todo = db.updateTodo(req.params.id, req.userId, req.body);
  if (!todo) return res.status(404).json({ ok: false, error: 'Todo not found' });
  res.json({ ok: true, todo });
});

router.delete('/todos/:id', authMiddleware, (req, res) => {
  const deleted = db.deleteTodo(req.params.id, req.userId);
  if (!deleted) return res.status(404).json({ ok: false, error: 'Todo not found' });
  res.json({ ok: true });
});

// ── Calendar ──
router.get('/calendar', authMiddleware, (req, res) => {
  const { start, end } = req.query;
  res.json({ ok: true, events: db.getEvents(req.userId, start, end) });
});

router.post('/calendar', authMiddleware, (req, res) => {
  const event = db.addEvent(req.userId, req.body);
  res.status(201).json({ ok: true, event });
});

router.delete('/calendar/:id', authMiddleware, (req, res) => {
  const deleted = db.deleteEvent(req.params.id, req.userId);
  if (!deleted) return res.status(404).json({ ok: false, error: 'Event not found' });
  res.json({ ok: true });
});

module.exports = { router, authMiddleware, optionalAuth };
