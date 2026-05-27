const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

// ── Security Constants ──
const TIMEOUT = 30000;
const MAX_OUTPUT = 512 * 1024;
const USER_HOME = os.homedir();
const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..');
const ALLOWED_FILE_PATHS = [
  USER_HOME,
  WORKSPACE_ROOT,
  path.join(USER_HOME, 'Desktop'),
  path.join(USER_HOME, 'Downloads'),
  path.join(USER_HOME, 'Documents'),
  path.join(USER_HOME, 'Pictures'),
  path.join(USER_HOME, 'Videos'),
  path.join(USER_HOME, 'Music'),
];
const BLOCKED_DIR_PATTERNS = [
  /[/\\]node_modules[/\\]/i,
  /[/\\]\.git[/\\]/i,
  /[/\\]__pycache__[/\\]/i,
  /[/\\]\.next[/\\]/i,
  /[/\\]dist[/\\]/i,
];

const KNOWN_APPS = {
  notepad: { cmd: 'notepad.exe', path: path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'notepad.exe') },
  calculator: { cmd: 'calc.exe' },
  chrome: { cmd: 'chrome.exe' },
  edge: { cmd: 'msedge.exe' },
  firefox: { cmd: 'firefox.exe' },
  vscode: { cmd: 'code' },
  'vs code': { cmd: 'code' },
  code: { cmd: 'code' },
  taskmgr: { cmd: 'taskmgr.exe', name: 'task manager' },
  control: { cmd: 'control.exe', name: 'control panel' },
  explorer: { cmd: 'explorer.exe', name: 'file explorer' },
  cmd: { cmd: 'cmd.exe' },
  terminal: { cmd: 'cmd.exe' },
  paint: { cmd: 'mspaint.exe', path: path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'mspaint.exe') },
  wordpad: { cmd: 'write.exe', path: path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'write.exe') },
  spotify: { web: true, url: 'https://open.spotify.com' },
  youtube: { web: true, url: 'https://www.youtube.com' },
};

// ── Process helpers ──
const launchProcess = (command, args = [], options = {}) => new Promise((resolve, reject) => {
  const captureOutput = Boolean(options.captureOutput);
  const child = spawn(command, args, {
    detached: options.detached ?? !captureOutput,
    shell: Boolean(options.shell),
    stdio: captureOutput ? ['ignore', 'pipe', 'pipe'] : 'ignore',
    windowsHide: false,
  });
  let settled = false;
  let stdout = '';
  let stderr = '';
  const settle = (callback, value) => { if (!settled) { settled = true; callback(value); } };
  const timer = setTimeout(() => settle(reject, new Error(`Timed out after ${TIMEOUT}ms`)), options.timeout || TIMEOUT);
  if (captureOutput) {
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); if (stdout.length > MAX_OUTPUT) child.kill(); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); if (stderr.length > MAX_OUTPUT) child.kill(); });
  }
  child.once('error', (error) => { clearTimeout(timer); settle(reject, error); });
  child.once('exit', (code) => { clearTimeout(timer); if (!captureOutput) return settle(resolve, { stdout, stderr, code }); settle(resolve, { stdout, stderr, code }); });
  child.once('spawn', () => { if (!captureOutput) { clearTimeout(timer); child.unref(); settle(resolve, { stdout: '', stderr: '', code: 0 }); } });
});

const psQuote = (value) => `'${String(value).replace(/'/g, "''")}'`;

const runPowerShell = (command) => {
  return launchProcess('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], { captureOutput: true });
};

// ── Path safety check ──
function isPathSafe(targetPath) {
  const resolved = path.resolve(targetPath);
  if (!ALLOWED_FILE_PATHS.some(allowed => resolved.startsWith(allowed))) {
    return { safe: false, reason: 'Access denied: path outside allowed directories' };
  }
  if (BLOCKED_DIR_PATTERNS.some(p => p.test(resolved))) {
    return { safe: false, reason: 'Access denied: restricted directory' };
  }
  return { safe: true, resolved };
}

// ═══════════════════════════════════════════
//  1. FILE OPERATIONS
// ═══════════════════════════════════════════

async function readFile(filePath) {
  const check = isPathSafe(filePath);
  if (!check.safe) throw new Error(check.reason);
  if (!fs.existsSync(check.resolved)) throw new Error('File not found');
  const content = fs.readFileSync(check.resolved, 'utf-8');
  if (content.length > MAX_OUTPUT) throw new Error('File too large');
  return { path: check.resolved, content, size: content.length };
}

async function writeFile(filePath, content) {
  const check = isPathSafe(filePath);
  if (!check.safe) throw new Error(check.reason);
  if (content.length > MAX_OUTPUT) throw new Error('Content too large');
  const dir = path.dirname(check.resolved);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(check.resolved, content, 'utf-8');
  return { path: check.resolved, size: content.length };
}

async function listDir(dirPath) {
  const check = isPathSafe(dirPath);
  if (!check.safe) throw new Error(check.reason);
  if (!fs.existsSync(check.resolved)) throw new Error('Directory not found');
  const items = fs.readdirSync(check.resolved, { withFileTypes: true });
  return {
    path: check.resolved,
    items: items.map(d => ({
      name: d.name,
      type: d.isDirectory() ? 'dir' : 'file',
      size: d.isFile() ? fs.statSync(path.join(check.resolved, d.name)).size : null,
    })),
    count: items.length,
  };
}

async function createProject(name, structure) {
  const basePath = path.join(USER_HOME, 'Desktop', name);
  const check = isPathSafe(basePath);
  if (!check.safe) throw new Error(check.reason);
  if (fs.existsSync(check.resolved)) throw new Error('Project already exists');
  let fileCount = 0;
  let dirCount = 0;

  if (typeof structure === 'string') {
    structure = { 'index.html': structure };
  }

  function writeTree(base, tree) {
    for (const [key, value] of Object.entries(tree)) {
      const fullPath = path.join(base, key);
      if (typeof value === 'string') {
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); dirCount++; }
        fs.writeFileSync(fullPath, value, 'utf-8');
        fileCount++;
      } else if (typeof value === 'object' && value !== null) {
        fs.mkdirSync(fullPath, { recursive: true });
        dirCount++;
        writeTree(fullPath, value);
      }
    }
  }

  fs.mkdirSync(check.resolved, { recursive: true });
  dirCount++;
  writeTree(check.resolved, structure);

  return { path: check.resolved, name, fileCount, dirCount };
}

// ═══════════════════════════════════════════
//  2. GIT INTEGRATION
// ═══════════════════════════════════════════

const GIT_COMMANDS = {
  status: ['status', '--short', '-b'],
  log: ['log', '--oneline', '-10', '--graph'],
  diff: ['diff', '--stat'],
  branch: ['branch', '-a'],
  'log-full': ['log', '-5', '--oneline'],
};

async function gitRun(action, repoPath, options = {}) {
  const targetDir = repoPath || WORKSPACE_ROOT;
  const check = isPathSafe(targetDir);
  if (!check.safe) throw new Error(check.reason);
  const gitDir = path.join(check.resolved, '.git');
  if (!fs.existsSync(gitDir)) throw new Error('Not a git repository');

  const allowedActions = ['status', 'log', 'diff', 'branch', 'log-full', 'commit', 'add', 'push', 'pull', 'fetch'];
  if (!allowedActions.includes(action)) throw new Error(`Action '${action}' not allowed`);

  if (action === 'status') {
    const r = await launchProcess('git', GIT_COMMANDS.status, { captureOutput: true, cwd: check.resolved });
    return { action, output: r.stdout.trim(), cwd: check.resolved };
  }

  if (action === 'log') {
    const r = await launchProcess('git', GIT_COMMANDS.log, { captureOutput: true, cwd: check.resolved });
    const r2 = await launchProcess('git', ['log', '-1', '--format=%h %s (%ar, %an)'], { captureOutput: true, cwd: check.resolved });
    return { action, log: r.stdout.trim(), latestCommit: r2.stdout.trim(), cwd: check.resolved };
  }

  if (action === 'diff') {
    const r = await launchProcess('git', GIT_COMMANDS.diff, { captureOutput: true, cwd: check.resolved });
    const staged = await launchProcess('git', ['diff', '--cached', '--stat'], { captureOutput: true, cwd: check.resolved });
    return { action, workingTree: r.stdout.trim(), staged: staged.stdout.trim(), cwd: check.resolved };
  }

  if (action === 'branch') {
    const r = await launchProcess('git', GIT_COMMANDS.branch, { captureOutput: true, cwd: check.resolved });
    const current = await launchProcess('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { captureOutput: true, cwd: check.resolved });
    return { action, branches: r.stdout.trim(), current: current.stdout.trim(), cwd: check.resolved };
  }

  if (action === 'add') {
    const files = options.files || '.';
    const r = await launchProcess('git', ['add', ...(Array.isArray(files) ? files : [files])], { captureOutput: true, cwd: check.resolved });
    return { action, message: 'Files staged', files, cwd: check.resolved };
  }

  if (action === 'commit') {
    if (!options.message) throw new Error('Commit message required');
    const addResult = await launchProcess('git', ['add', '.'], { captureOutput: true, cwd: check.resolved });
    const r = await launchProcess('git', ['commit', '-m', options.message], { captureOutput: true, cwd: check.resolved });
    const short = await launchProcess('git', ['log', '-1', '--format=%h %s (%ar)'], { captureOutput: true, cwd: check.resolved });
    return { action, message: r.stdout.trim() || r.stderr.trim(), commit: short.stdout.trim(), cwd: check.resolved };
  }

  if (action === 'push') {
    const r = await launchProcess('git', ['push'], { captureOutput: true, cwd: check.resolved, timeout: 60000 });
    return { action, message: r.stdout.trim() || r.stderr.trim(), cwd: check.resolved };
  }

  if (action === 'pull') {
    const r = await launchProcess('git', ['pull'], { captureOutput: true, cwd: check.resolved, timeout: 60000 });
    return { action, message: r.stdout.trim() || r.stderr.trim(), cwd: check.resolved };
  }

  if (action === 'fetch') {
    const r = await launchProcess('git', ['fetch', '--all'], { captureOutput: true, cwd: check.resolved, timeout: 30000 });
    return { action, message: r.stdout.trim() || r.stderr.trim(), cwd: check.resolved };
  }

  throw new Error(`Git action '${action}' not implemented`);
}

// ═══════════════════════════════════════════
//  3. BROWSER AUTOMATION (Puppeteer)
// ═══════════════════════════════════════════

let puppeteer = null;
try { puppeteer = require('puppeteer'); } catch {}

async function browserAction(action, params = {}) {
  if (!puppeteer) {
    return { error: 'Puppeteer not installed. Run: npm install puppeteer', available: false };
  }
  let browser = null;
  try {
    browser = await puppeteer.launch({
      headless: params.headless !== false ? 'new' : false,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,720'],
    });
    const page = await browser.newPage();
    let result = {};

    if (action === 'open' || action === 'navigate') {
      const url = params.url || 'https://www.google.com';
      await page.goto(url, { waitUntil: 'networkidle2', timeout: TIMEOUT });
      const title = await page.title();
      result = { title, url: page.url(), screenshot: null };
    }

    else if (action === 'search') {
      const query = params.query || '';
      const engine = params.engine || 'google';
      const searchUrl = engine === 'youtube'
        ? `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
        : `https://www.google.com/search?q=${encodeURIComponent(query)}`;
      await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: TIMEOUT });
      const title = await page.title();
      const snippets = await page.evaluate(() => {
        const items = document.querySelectorAll('.g .VwiC3b, .g .lEBKkf, [data-sncf], .rc .s, .BNeawe.s3v9rd.AP7Wnd, .BNeawe.UPmit');
        return Array.from(items).slice(0, 5).map(el => el.textContent).filter(Boolean);
      });
      result = { title, url: page.url(), snippets, engine };
    }

    else if (action === 'screenshot') {
      await page.goto(params.url || 'about:blank', { waitUntil: 'networkidle2', timeout: TIMEOUT });
      const ssPath = path.join(os.tmpdir(), `nexus_ss_${Date.now()}.png`);
      await page.screenshot({ path: ssPath, fullPage: params.fullPage || false });
      const buffer = fs.readFileSync(ssPath);
      result = { screenshot: buffer.toString('base64'), path: ssPath, size: buffer.length };
    }

    else if (action === 'click') {
      if (params.selector) {
        await page.waitForSelector(params.selector, { timeout: 5000 });
        await page.click(params.selector);
        await page.waitForTimeout(1000);
        result = { selector: params.selector, url: page.url(), title: await page.title() };
      } else if (params.text) {
        const elements = await page.$x(`//*[contains(text(), '${params.text}')]`);
        if (elements.length > 0) { await elements[0].click(); await page.waitForTimeout(1000); }
        result = { text: params.text, clicked: elements.length > 0, url: page.url() };
      }
    }

    else if (action === 'type') {
      if (params.selector && params.text) {
        await page.waitForSelector(params.selector, { timeout: 5000 });
        await page.type(params.selector, params.text, { delay: 30 });
        result = { selector: params.selector, typed: params.text.length, chars: params.text.length };
      }
    }

    else if (action === 'extract') {
      const text = await page.evaluate(() => document.body.innerText);
      result = { text: text.substring(0, MAX_OUTPUT), length: text.length };
    }

    else if (action === 'evaluate') {
      if (params.script) {
        result = await page.evaluate(new Function(params.script));
      }
    }

    else {
      throw new Error(`Unknown browser action: ${action}`);
    }

    return { action, params, result, success: true };
  } catch (err) {
    return { action, params, error: err.message, success: false };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// ═══════════════════════════════════════════
//  4. SYSTEM CONTROL
// ═══════════════════════════════════════════

async function systemControl(action, params = {}) {
  if (action === 'volume') {
    const level = Math.max(0, Math.min(100, parseInt(params.level) || 50));
    await runPowerShell(`(new-object -com wscript.shell).SendKeys([char]173)`);
    for (let i = 0; i < Math.floor(level / 2); i++) {
      await runPowerShell(`(new-object -com wscript.shell).SendKeys([char]175)`);
    }
    return { action, level, message: `Volume set to ${level}%` };
  }

  if (action === 'volume-up') {
    await runPowerShell(`(new-object -com wscript.shell).SendKeys([char]175)`);
    return { action, message: 'Volume increased' };
  }

  if (action === 'volume-down') {
    await runPowerShell(`(new-object -com wscript.shell).SendKeys([char]174)`);
    return { action, message: 'Volume decreased' };
  }

  if (action === 'mute') {
    await runPowerShell(`(new-object -com wscript.shell).SendKeys([char]173)`);
    return { action, message: 'Volume toggled mute/unmute' };
  }

  if (action === 'brightness') {
    const level = Math.max(0, Math.min(100, parseInt(params.level) || 50));
    await runPowerShell(`
      $monitor = Get-WmiObject -Namespace root/wmi -Class WmiMonitorBrightnessMethods
      if ($monitor) { $monitor.WmiSetBrightness(1, ${level}) }
    `);
    return { action, level, message: `Brightness set to ${level}%` };
  }

  if (action === 'open-app') {
    const appName = (params.name || '').toLowerCase().trim();
    const app = KNOWN_APPS[appName];
    if (!app) {
      // Try launching as direct command
      try {
        await launchProcess(appName);
        return { action, app: appName, message: `Launched ${appName}` };
      } catch {
        throw new Error(`Unknown app: ${appName}`);
      }
    }
    if (app.web) {
      await launchProcess('explorer.exe', [app.url]);
    } else {
      await launchProcess(app.path || app.cmd);
    }
    return { action, app: appName, message: `Opened ${app.name || appName}` };
  }

  if (action === 'system-info') {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const diskResult = await runPowerShell(`
      Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DriveType=3" | 
        Select-Object DeviceID, @{N='SizeGB';E={[math]::Round($_.Size/1GB,1)}}, 
        @{N='FreeGB';E={[math]::Round($_.FreeSpace/1GB,1)}}
    `);
    return {
      action,
      os: `${os.type()} ${os.release()}`,
      hostname: os.hostname(),
      platform: os.platform(),
      cpu: `${cpus[0]?.model || 'N/A'} (${cpus.length} cores)`,
      memory: { total: `${(totalMem / 1024 / 1024 / 1024).toFixed(1)} GB`, free: `${(freeMem / 1024 / 1024 / 1024).toFixed(1)} GB`, usage: `${((1 - freeMem / totalMem) * 100).toFixed(0)}%` },
      disks: diskResult.stdout,
      uptime: `${Math.floor(os.uptime() / 3600)} hours`,
    };
  }

  if (action === 'process-list') {
    const r = await runPowerShell(`Get-Process | Sort-Object CPU -Descending | Select-Object -First 20 Name, Id, @{N='CPU';E={[math]::Round($_.CPU,1)}}, @{N='MB';E={[math]::Round($_.WorkingSet64/1MB,1)}} | Format-Table -AutoSize | Out-String`);
    return { action, processes: r.stdout.trim() };
  }

  if (action === 'kill-process') {
    const name = params.name || '';
    if (!name) throw new Error('Process name required');
    await runPowerShell(`Stop-Process -Name ${psQuote(name)} -Force -ErrorAction Stop`);
    return { action, process: name, message: `Process ${name} terminated` };
  }

  throw new Error(`Unknown system action: ${action}`);
}

// ═══════════════════════════════════════════
//  TOOL PARSER — Parse tool calls from LLM text
// ═══════════════════════════════════════════

const TOOL_PATTERN = /```tool\s*\n([\s\S]*?)```/g;

function parseToolCalls(text) {
  const tools = [];
  let match;
  while ((match = TOOL_PATTERN.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed && parsed.type && parsed.action) {
        tools.push(parsed);
      }
    } catch {}
  }
  return tools;
}

// ═══════════════════════════════════════════
//  MAIN EXECUTOR
// ═══════════════════════════════════════════

async function executeTool(toolCall) {
  const { type, action, params = {} } = toolCall;
  if (!type || !action) throw new Error('Invalid tool call: missing type or action');

  switch (type) {
    case 'file':
      switch (action) {
        case 'read': return await readFile(params.path);
        case 'write': return await writeFile(params.path, params.content);
        case 'list': return await listDir(params.path);
        case 'create-project': return await createProject(params.name, params.structure);
        default: throw new Error(`Unknown file action: ${action}`);
      }

    case 'git':
      return await gitRun(action, params.path, params);

    case 'browser':
      return await browserAction(action, params);

    case 'system':
      return await systemControl(action, params);

    default:
      throw new Error(`Unknown tool type: ${type}`);
  }
}

// ── System prompt builder for LLM ──
function buildToolSystemPrompt() {
  return `
You have access to system tools. To use a tool, output a code block with language "tool" containing JSON:
\`\`\`tool
{ "type": "...", "action": "...", "params": { ... } }
\`\`\`

Available tools:

1. **file** — File operations
   - \`{ "type": "file", "action": "read", "params": { "path": "..." } }\`
   - \`{ "type": "file", "action": "write", "params": { "path": "...", "content": "..." } }\`
   - \`{ "type": "file", "action": "list", "params": { "path": "..." } }\`
   - \`{ "type": "file", "action": "create-project", "params": { "name": "...", "structure": { "filename": "content", "subdir": { ... } } } }\`

2. **git** — Git operations (in current repo)
   - \`{ "type": "git", "action": "status" }\`
   - \`{ "type": "git", "action": "log" }\`
   - \`{ "type": "git", "action": "diff" }\`
   - \`{ "type": "git", "action": "branch" }\`
   - \`{ "type": "git", "action": "commit", "params": { "message": "..." } }\`
   - \`{ "type": "git", "action": "push" }\`
   - \`{ "type": "git", "action": "pull" }\`

3. **browser** — Browser automation (Puppeteer)
   - \`{ "type": "browser", "action": "open", "params": { "url": "..." } }\`
   - \`{ "type": "browser", "action": "search", "params": { "query": "...", "engine": "google|youtube" } }\`
   - \`{ "type": "browser", "action": "screenshot", "params": { "url": "..." } }\`
   - \`{ "type": "browser", "action": "click", "params": { "selector": "..." } }\` or \`{ "params": { "text": "..." } }\`
   - \`{ "type": "browser", "action": "type", "params": { "selector": "...", "text": "..." } }\`
   - \`{ "type": "browser", "action": "extract" }\`

4. **system** — System control
   - \`{ "type": "system", "action": "volume", "params": { "level": 0-100 } }\`
   - \`{ "type": "system", "action": "volume-up" }\` / \`{ "type": "system", "action": "volume-down" }\` / \`{ "type": "system", "action": "mute" }\`
   - \`{ "type": "system", "action": "brightness", "params": { "level": 0-100 } }\`
   - \`{ "type": "system", "action": "open-app", "params": { "name": "notepad|calculator|chrome|...|spotify|..." } }\`
   - \`{ "type": "system", "action": "system-info" }\`
   - \`{ "type": "system", "action": "process-list" }\`
   - \`{ "type": "system", "action": "kill-process", "params": { "name": "..." } }\`

Allowed file paths: Desktop, Downloads, Documents, Pictures, Videos, Music, and the project directory.
The system will execute the tool and return the result alongside your text response.

When you use a tool, explain what you're doing in natural language first, then output the tool block.
`.trim();
}

module.exports = {
  readFile,
  writeFile,
  listDir,
  createProject,
  gitRun,
  browserAction,
  systemControl,
  parseToolCalls,
  executeTool,
  buildToolSystemPrompt,
  isPathSafe,
};
