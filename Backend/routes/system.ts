import express from 'express';
import { Router } from 'express';
import * as os from 'os';
import * as path from 'path';
import { executeCode } from '../services/codeRunner';
import { searchWeb, fetchPageContent } from '../services/webSearch';
import { getInfoApiStatus } from '../services/infoServices';
import systemCommander = require('../services/systemCommander');
import agentOrchestrator = require('../services/agentOrchestrator');
import modelRouter = require('../services/modelRouter');
import {
  apiUsage, eventLog, logEvent, searchCache, serverModelPrefs, windowsDir,
  userHome, knownFolders,
} from './context';
import { runPowerShell, openApp } from './systemHelpers';

const router = Router();

// ── Web Search ──
router.get('/web/search', async (req, res) => {
  try {
    const { q, limit } = req.query as Record<string, string>;
    if (!q || !q.trim()) return res.status(400).json({ ok: false, error: 'Query param "q" required' });
    const num = Math.min(parseInt(limit) || 5, 10);
    const cacheKey = `${q}:${num}`;
    if (searchCache[cacheKey] && Date.now() - searchCache[cacheKey].ts < 120000) {
      return res.json({ ok: true, ...searchCache[cacheKey].data, cached: true });
    }
    const results = await searchWeb(q, num);
    searchCache[cacheKey] = { data: results, ts: Date.now() };
    res.json({ ok: true, ...results });
  } catch (err: any) {
    logEvent('error', 'Web search failed', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Test Notepad ──
router.get('/test/notepad', async (req, res) => {
  try {
    await openApp('notepad.exe', { path: path.join(windowsDir, 'System32', 'notepad.exe'), verifyProcess: 'notepad.exe' });
    res.json({ ok: true, message: 'notepad.exe started and verified' });
  } catch (error: any) {
    console.error('[NEXUS Tool] Notepad test failed:', error);
    res.status(500).json({ ok: false, error: error.message, platform: process.platform, windowsDir, cwd: process.cwd() });
  }
});

// ── System Stats ──
router.get('/system/stats', async (req, res) => {
  try {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const cpuLoad = os.loadavg();
    const cpus = os.cpus();
    const cpuModel = cpus.length > 0 ? cpus[0].model : 'unknown';
    const cpuCores = cpus.length;
    let diskInfo: any = {};
    try {
      const diskResult = await runPowerShell('Get-PSDrive -PSProvider FileSystem | Select-Object Name, @{N="GBUsed";E={[math]::Round(($_.Used/1GB),1)}}, @{N="GBFree";E={[math]::Round(($_.Free/1GB),1)}}, @{N="GBTotal";E={[math]::Round(($_.Used+$_.Free)/1GB,1)}} | ConvertTo-Json');
      diskInfo = JSON.parse(diskResult.stdout);
    } catch { diskInfo = { error: 'Disk info unavailable' }; }
    res.json({
      ok: true, platform: process.platform, hostname: os.hostname(),
      uptime: Math.floor(process.uptime()), systemUptime: Math.floor(os.uptime()),
      memory: { total: totalMem, free: freeMem, used: usedMem, usagePercent: Math.round((usedMem / totalMem) * 100) },
      cpu: { model: cpuModel, cores: cpuCores, load1: cpuLoad[0]?.toFixed(2), load5: cpuLoad[1]?.toFixed(2), load15: cpuLoad[2]?.toFixed(2) },
      disk: diskInfo, nodeVersion: process.version,
    });
  } catch (err: any) { res.status(500).json({ ok: false, error: err.message }); }
});

// ── System Usage ──
router.get('/system/usage', (req, res) => {
  res.json({ ok: true, uptime: Math.floor((Date.now() - apiUsage.startTime) / 1000), counters: apiUsage, startTime: apiUsage.startTime });
});

// ── System Logs ──
router.get('/system/logs', (req, res) => {
  const { category, search, limit = 50, since } = req.query as Record<string, string>;
  let filtered = [...eventLog];
  if (category) filtered = filtered.filter(e => e.category === category);
  if (search) {
    const s = search.toLowerCase();
    filtered = filtered.filter(e => e.message.toLowerCase().includes(s) || (e.detail && e.detail.toLowerCase().includes(s)));
  }
  if (since) {
    const sinceTs = parseInt(since);
    if (!isNaN(sinceTs)) filtered = filtered.filter(e => e.timestamp > sinceTs);
  }
  filtered.reverse();
  const page = parseInt(req.query.page as string) || 1;
  const pageSize = Math.min(parseInt(limit as string), 100);
  const start = (page - 1) * pageSize;
  const items = filtered.slice(start, start + pageSize);
  res.json({ ok: true, total: filtered.length, page, pageSize, totalPages: Math.ceil(filtered.length / pageSize), entries: items });
});

// ── Code Execution Sandbox ──
router.post('/execute', express.raw({ type: '*/*', limit: '64kb' }), async (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' });
  const sendEvent = (event: string, data: any) => { if (res.writableEnded) return; res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { code, language = 'auto' } = body || {};
    if (!code || !code.trim()) { sendEvent('error', { message: 'No code provided' }); sendEvent('done', { exitCode: 1, duration: 0 }); res.end(); return; }
    logEvent('code', `Executing ${language}`, `${code.length} chars`);
    await executeCode({
      language, code,
      onOutput: (text: string) => sendEvent('output', { type: 'stdout', text }),
      onError: (text: string) => sendEvent('output', { type: 'stderr', text }),
      onDone: (result: any) => { sendEvent('done', result); res.end(); },
    });
  } catch (err: any) { sendEvent('error', { message: err.message }); sendEvent('done', { exitCode: -1, duration: 0 }); if (!res.writableEnded) res.end(); }
});

// ── Screen Action ──
router.post('/system/screen-action', async (req, res) => {
  try {
    const { action, params } = req.body || {};
    if (!action) return res.status(400).json({ ok: false, error: 'Action required' });
    logEvent('system', `Screen action: ${action}`, JSON.stringify(params));
    const result = await systemCommander.executeTool({
      type: 'system',
      action: action === 'click' ? 'mouse-click' : action === 'type' ? 'type-text' : action === 'scroll' ? 'scroll' : action,
      params: params || {},
    });
    res.json({ ok: true, ...(result as any) });
  } catch (err: any) { res.status(500).json({ ok: false, error: err.message }); }
});

// ── Agent Task ──
router.post('/task', async (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' });
  const sendEvent = (event: string, data: any) => { if (res.writableEnded) return; res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
  try {
    const { message } = req.body || {};
    if (!message || !message.trim()) { sendEvent('error', { message: 'Task description required' }); sendEvent('done', {}); res.end(); return; }
    logEvent('agent', 'Task via SSE', message);
    const result = await agentOrchestrator.processTask(message.trim(), serverModelPrefs, (type: string, msg: string) => {
      if (type === 'step') sendEvent('step', msg);
      else sendEvent('log', { text: msg });
    });
    sendEvent('done', { summary: result.summary, steps: result.steps });
    if (!res.writableEnded) res.end();
  } catch (err: any) { sendEvent('error', { message: err.message }); sendEvent('done', {}); if (!res.writableEnded) res.end(); }
});

// ── System Dynamic Commands ──
router.post('/system/:action', async (req, res) => {
  try {
    const { action } = req.params;
    const { params } = req.body || {};
    logEvent('system', `Dynamic action: ${action}`, JSON.stringify(params));
    const result = await systemCommander.executeTool({ type: 'system', action, params: params || {} });
    res.json({ ok: true, ...(result as any) });
  } catch (err: any) { res.status(500).json({ ok: false, error: err.message }); }
});

// ── Screen Analysis ──
const DRIVE_QUERY = /\b([a-zA-Z]):\\|([a-zA-Z])\s+drive\b/;
router.post('/screen/analyze', async (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' });
  const sendEvent = (event: string, data: any) => { if (res.writableEnded) return; res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
  try {
    const { message } = req.body || {};
    if (DRIVE_QUERY.test(message)) {
      sendEvent('log', { text: 'Listing drive contents...' });
      const driveMatch = message.match(DRIVE_QUERY);
      const drive = driveMatch ? (driveMatch[1] || driveMatch[2])?.toUpperCase() + ':\\' : 'C:\\';
      const result = await systemCommander.executeTool({ type: 'system', action: 'file-list', params: { path: drive, maxResults: 50 } }) as any;
      const fileList = (result.files || result.children || []).map((f: any) => `${f.name}${f.isDirectory ? '/' : ''}`).join('\n');
      sendEvent('result', { text: `Contents of ${drive}:\n${fileList}` });
      sendEvent('done', { text: `Contents of ${drive} listed` });
    } else {
      sendEvent('log', { text: 'Capturing screenshot...' });
      const screenshotResult = await systemCommander.executeTool({ type: 'system', action: 'capture-screenshot', params: {} }) as any;
      const { imageBase64, imageMimeType } = screenshotResult;
      if (imageBase64) {
        sendEvent('log', { text: 'Analyzing screenshot...' });
        const dataUrl = `data:${imageMimeType || 'image/png'};base64,${imageBase64}`;
        const messages = [{ role: 'user', content: [{ type: 'text', text: message || 'What do you see in this screenshot?' }, { type: 'image_url', image_url: { url: dataUrl } }] }];
        const result = await modelRouter.routeVision(serverModelPrefs, messages, { preferredProvider: serverModelPrefs.provider, preferredModel: serverModelPrefs.visionModel, category: 'general', forVision: true });
        sendEvent('result', { text: result.text, imageBase64, imageMimeType });
        sendEvent('done', { text: result.text });
      } else {
        sendEvent('log', { text: 'No screenshot captured. Ensure screen capture tool is available.' });
        sendEvent('done', { text: 'Screenshot capture failed.' });
      }
    }
    if (!res.writableEnded) res.end();
  } catch (err: any) { sendEvent('error', { message: err.message }); sendEvent('done', {}); if (!res.writableEnded) res.end(); }
});

export default router;
