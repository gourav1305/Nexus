"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRecipeEngine = createRecipeEngine;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const db = require("./db");
// ── Helpers ──
function parseTimeTrigger(config) {
    const now = new Date();
    const type = config.type || 'interval';
    if (type === 'interval')
        return { kind: 'interval', ms: parseInt(config.intervalMs) || 60000 };
    if (type === 'daily') {
        const [h, m] = (config.time || '09:00').split(':').map(Number);
        const target = new Date(now);
        target.setHours(h || 9, m || 0, 0, 0);
        if (target <= now)
            target.setDate(target.getDate() + 1);
        return { kind: 'daily', target: target.getTime(), hour: h || 9, minute: m || 0 };
    }
    if (type === 'hourly') {
        const mm = parseInt(config.minute) || 0;
        const target = new Date(now);
        target.setMinutes(mm, 0, 0);
        if (target <= now)
            target.setHours(target.getHours() + 1);
        return { kind: 'hourly', target: target.getTime(), minute: mm };
    }
    return { kind: 'interval', ms: 60000 };
}
function isTimeToRun(config, lastRun) {
    const cfg = parseTimeTrigger(config);
    const now = Date.now();
    if (cfg.kind === 'interval')
        return !lastRun || (now - lastRun) >= cfg.ms;
    if (cfg.kind === 'daily')
        return !lastRun || lastRun < cfg.target;
    if (cfg.kind === 'hourly')
        return !lastRun || lastRun < cfg.target;
    return false;
}
async function executeAction(action, recipe, { runPowerShell, logEvent, apiUsage, recipeMessages }) {
    const timestamp = new Date().toLocaleString();
    const interpolate = (str) => str.replace(/\{\{recipeName\}\}/g, recipe.name)
        .replace(/\{\{time\}\}/g, timestamp)
        .replace(/\{\{date\}\}/g, new Date().toLocaleDateString());
    switch (action.type) {
        case 'message': {
            const text = interpolate(action.config.text || `Recipe "${recipe.name}" triggered at ${timestamp}`);
            db.addChatEntry(recipe.userId, 'system', text);
            if (recipeMessages)
                recipeMessages.push({ role: 'system', text, timestamp: Date.now() });
            if (logEvent)
                logEvent('recipe', `Recipe "${recipe.name}" sent message`, text);
            return { result: 'message_sent', text };
        }
        case 'command': {
            const cmd = interpolate(action.config.command || '');
            if (!cmd)
                return { result: 'error', error: 'No command specified' };
            try {
                const output = await runPowerShell(cmd);
                if (logEvent)
                    logEvent('recipe', `Recipe "${recipe.name}" ran command`, cmd);
                if (apiUsage)
                    apiUsage.systemCommands++;
                return { result: 'command_executed', output: output.stdout?.slice(0, 500) };
            }
            catch (err) {
                if (logEvent)
                    logEvent('recipe', `Recipe "${recipe.name}" command failed`, err.message);
                return { result: 'error', error: err.message };
            }
        }
        case 'api': {
            const url = interpolate(action.config.url || '');
            if (!url)
                return { result: 'error', error: 'No URL specified' };
            try {
                const method = (action.config.method || 'GET').toUpperCase();
                const body = action.config.body ? JSON.parse(interpolate(JSON.stringify(action.config.body))) : undefined;
                const response = await fetch(url, {
                    method,
                    headers: { 'Content-Type': 'application/json', ...action.config.headers },
                    body: method !== 'GET' && body ? JSON.stringify(body) : undefined,
                });
                const data = await response.text();
                if (logEvent)
                    logEvent('recipe', `Recipe "${recipe.name}" called API`, `${method} ${url}`);
                return { result: 'api_called', status: response.status, data: data.slice(0, 500) };
            }
            catch (err) {
                if (logEvent)
                    logEvent('recipe', `Recipe "${recipe.name}" API call failed`, err.message);
                return { result: 'error', error: err.message };
            }
        }
        case 'blob': {
            const payload = { color: action.config.color || '#aa3bff', size: action.config.size || null, duration: parseInt(action.config.duration) || 5000 };
            if (logEvent)
                logEvent('recipe', `Recipe "${recipe.name}" changed blob`, JSON.stringify(payload));
            return { result: 'blob_changed', payload };
        }
        default:
            return { result: 'error', error: `Unknown action type: ${action.type}` };
    }
}
// ── File Watchers ──
const activeWatchers = new Map();
function stopFileWatcher(recipeId) {
    if (activeWatchers.has(recipeId)) {
        activeWatchers.get(recipeId).close();
        activeWatchers.delete(recipeId);
    }
}
function startFileWatcher(recipe, onTrigger) {
    stopFileWatcher(recipe.id);
    const watchPath = recipe.trigger.config.path;
    if (!watchPath)
        return;
    try {
        if (!fs.existsSync(watchPath))
            return;
        const stat = fs.statSync(watchPath);
        const watchTarget = stat.isDirectory() ? watchPath : path.dirname(watchPath);
        const watcher = fs.watch(watchTarget, (eventType, filename) => {
            const fresh = db.getRecipeById(recipe.id, recipe.userId);
            if (!fresh || !fresh.enabled)
                return;
            const targetFile = recipe.trigger.config.path;
            if (targetFile && filename && !filename.includes(path.basename(targetFile)))
                return;
            const event = recipe.trigger.config.event || 'change';
            if (event !== 'all' && eventType !== event)
                return;
            onTrigger(recipe.id, recipe.userId);
        });
        activeWatchers.set(recipe.id, watcher);
    }
    catch (err) {
        console.error(`[Recipe] Failed to watch path for recipe "${recipe.name}":`, err.message);
    }
}
// ── Engine ──
function createRecipeEngine({ app, runPowerShell, logEvent, apiUsage, recipeMessages }) {
    let timeInterval = null;
    let emailIntervals = [];
    const recipeLog = [];
    const MAX_RECIPE_LOG = 100;
    const pendingBlobActions = [];
    const registeredWebhooks = new Set();
    function logRecipeEvent(recipeId, message, detail) {
        const entry = { id: recipeLog.length + 1, recipeId, timestamp: Date.now(), message, detail };
        recipeLog.push(entry);
        if (recipeLog.length > MAX_RECIPE_LOG)
            recipeLog.splice(0, recipeLog.length - MAX_RECIPE_LOG);
    }
    function getAllEnabledRecipes() {
        // Load all recipes across users via raw SQL
        const sql = 'SELECT * FROM recipes WHERE enabled = 1';
        const rows = db.getDb().prepare(sql).all();
        return rows.map(r => ({
            id: r.id,
            userId: r.user_id,
            name: r.name,
            description: r.description,
            enabled: Boolean(r.enabled),
            trigger: { type: r.trigger_type, config: safeJson(r.trigger_config) },
            action: { type: r.action_type, config: safeJson(r.action_config) },
            lastRun: r.last_run,
            runCount: r.run_count,
            createdAt: r.created_at,
        }));
    }
    function safeJson(str) {
        try {
            return JSON.parse(str);
        }
        catch {
            return {};
        }
    }
    async function triggerRecipe(recipeId, userId) {
        const recipe = db.getRecipeById(recipeId, userId);
        if (!recipe || !recipe.enabled)
            return null;
        const result = await executeAction(recipe.action, recipe, { runPowerShell, logEvent, apiUsage, recipeMessages });
        db.updateRecipeRun(recipeId, userId);
        logRecipeEvent(recipeId, `Recipe "${recipe.name}" fired`, result.error || result.result);
        if (result.result === 'blob_changed') {
            pendingBlobActions.push({ recipeId, ...result.payload, timestamp: Date.now() });
        }
        return result;
    }
    function getPendingBlobActions() {
        const now = Date.now();
        const active = pendingBlobActions.filter(b => now - b.timestamp < b.duration);
        pendingBlobActions.length = 0;
        pendingBlobActions.push(...active);
        return active;
    }
    function checkTimeTriggers() {
        const recipes = getAllEnabledRecipes();
        for (const recipe of recipes) {
            if (recipe.trigger.type !== 'time')
                continue;
            if (isTimeToRun(recipe.trigger.config, recipe.lastRun)) {
                triggerRecipe(recipe.id, recipe.userId);
            }
        }
    }
    function pollEmailTriggers() {
        const recipes = getAllEnabledRecipes();
        for (const recipe of recipes) {
            if (recipe.trigger.type !== 'email')
                continue;
            if (!recipe.trigger.config.host || !recipe.trigger.config.username)
                continue;
            triggerRecipe(recipe.id, recipe.userId);
        }
    }
    function registerWebhookRoute(recipe) {
        if (registeredWebhooks.has(recipe.id))
            return;
        const hookPath = `/api/webhook/${recipe.id}`;
        app.post(hookPath, async (req, res) => {
            const fresh = db.getRecipeById(recipe.id, recipe.userId);
            if (!fresh || !fresh.enabled)
                return res.status(404).json({ error: 'Recipe not found or disabled' });
            const secret = fresh.trigger.config.secret;
            if (secret && req.headers['x-webhook-secret'] !== secret)
                return res.status(401).json({ error: 'Invalid secret' });
            const result = await triggerRecipe(recipe.id, recipe.userId);
            res.json({ ok: true, result });
        });
        registeredWebhooks.add(recipe.id);
    }
    function getRecipeLog(recipeId) {
        if (recipeId)
            return recipeLog.filter(e => e.recipeId === recipeId).slice(-50);
        return [...recipeLog].reverse().slice(0, 100);
    }
    function start() {
        const recipes = getAllEnabledRecipes();
        for (const recipe of recipes) {
            if (recipe.trigger.type === 'file')
                startFileWatcher(recipe, triggerRecipe);
            if (recipe.trigger.type === 'webhook')
                registerWebhookRoute(recipe);
        }
        timeInterval = setInterval(checkTimeTriggers, 10000);
        const emailInterval = setInterval(pollEmailTriggers, 60000);
        emailIntervals.push(emailInterval);
        console.log(`[RecipeEngine] Started with ${recipes.length} active recipes`);
    }
    function stop() {
        if (timeInterval)
            clearInterval(timeInterval);
        emailIntervals.forEach(ci => clearInterval(ci));
        emailIntervals = [];
        for (const [, watcher] of activeWatchers)
            watcher.close();
        activeWatchers.clear();
    }
    return {
        start, stop,
        getRecipeLog, getPendingBlobActions, triggerRecipe,
    };
}
