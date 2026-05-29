const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { executeCode } = require('./codeRunner');
let modelRouter = null;
let visionConfig = { provider: 'groq', model: 'meta-llama/llama-4-scout-17b-16e-instruct', autoRoute: false };

function init(mr, config) {
  modelRouter = mr;
  if (config) visionConfig = config;
}

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
  path.join(USER_HOME, 'Desktop', 'Screenshots'),
  path.join(USER_HOME, 'Pictures', 'Screenshots'),
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

// ── Detect available drive roots (Windows) ──
function getDriveRoots() {
  const roots = [];
  for (let i = 65; i <= 90; i++) {
    const letter = String.fromCharCode(i);
    const root = letter + ':\\';
    try {
      if (fs.existsSync(root)) roots.push(root);
    } catch {}
  }
  return roots;
}

// ── Path safety check ──
function isPathSafe(targetPath) {
  const resolved = path.resolve(targetPath);
  // Allow drive roots (Windows)
  if (/^[A-Z]:\\$/.test(resolved)) {
    return { safe: true, resolved };
  }
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

// ── Binary file detection ──
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg',
  '.mp3', '.wav', '.ogg', '.m4a', '.flac', '.wma',
  '.mp4', '.avi', '.mkv', '.mov', '.wmv', '.webm',
  '.zip', '.rar', '.7z', '.tar', '.gz',
  '.exe', '.dll', '.msi', '.dmg', '.pkg',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.ttf', '.otf', '.woff', '.woff2', '.eot',
]);

function isBinaryFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);

async function readFile(filePath) {
  const check = isPathSafe(filePath);
  if (!check.safe) throw new Error(check.reason);
  if (!fs.existsSync(check.resolved)) throw new Error('File not found');

  const ext = path.extname(check.resolved).toLowerCase();

  // For image files: read as base64 so the agent/LLM can use it
  if (IMAGE_EXTENSIONS.has(ext)) {
    const stat = fs.statSync(check.resolved);
    if (stat.size > MAX_OUTPUT) throw new Error('Image too large (max 512KB)');
    const buffer = fs.readFileSync(check.resolved);
    return {
      path: check.resolved,
      content: buffer.toString('base64'),
      mimeType: `image/${ext.slice(1)}`,
      size: stat.size,
      type: 'image',
    };
  }

  // Other binary files: reject with clear instruction
  if (isBinaryFile(check.resolved)) {
    const stat = fs.statSync(check.resolved);
    return {
      path: check.resolved,
      message: `File "${path.basename(check.resolved)}" is a binary file (${ext}).\n- For images: use the screenshot system action\n- For PDFs/docs: use a dedicated reader`,
      binary: true,
      extension: ext,
      size: stat.size,
    };
  }

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
    const r = await runPowerShell(`Stop-Process -Name ${psQuote(name)} -Force -ErrorAction SilentlyContinue; if ($?) { 'Killed' } else { 'Not found' }`);
    return { action, process: name, result: r.stdout.trim() };
  }

  // ── Desktop Screenshot ──
  if (action === 'screenshot') {
    const ssPath = path.join(os.tmpdir(), `nexus_desktop_${Date.now()}.png`);
    const script = `
      [Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms');
      $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds;
      $bitmap = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height);
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap);
      $graphics.CopyFromScreen($screen.X, $screen.Y, 0, 0, $bitmap.Size);
      $bitmap.Save('${ssPath.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png);
      $graphics.Dispose();
      $bitmap.Dispose();
      if (Test-Path '${ssPath.replace(/\\/g, '\\\\')}') { Write-Output 'OK:' + (Get-Item '${ssPath.replace(/\\/g, '\\\\')}').Length } else { Write-Output 'FAIL' }
    `;
    const ps = await runPowerShell(script);
    if (!ps.stdout.includes('OK:') && !ps.stdout.includes('OK')) {
      throw new Error('Screenshot failed: ' + (ps.stderr || ps.stdout || 'unknown error'));
    }
    if (!fs.existsSync(ssPath)) throw new Error('Screenshot file not created');
    const buffer = fs.readFileSync(ssPath);
    fs.unlinkSync(ssPath);
    return {
      action: 'screenshot',
      screenshot: buffer.toString('base64'),
      size: buffer.length,
      mimeType: 'image/png',
      width: 1920, height: 1080,
    };
  }

  // ── Screen Click ──
  if (action === 'mouse-click') {
    const x = parseInt(params.x) || 0;
    const y = parseInt(params.y) || 0;
    const button = params.button || 'left';
    const downFlag = button === 'right' ? '0x08' : button === 'middle' ? '0x20' : '0x02';
    const upFlag = button === 'right' ? '0x10' : button === 'middle' ? '0x40' : '0x04';
    await runPowerShell(`
      [Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null;
      [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y});
      Start-Sleep -Milliseconds 100;
      Add-Type @"
        using System.Runtime.InteropServices;
        public class MO {
          [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, int e);
        }
"@;
      [MO]::mouse_event(${downFlag}, 0, 0, 0, 0);
      Start-Sleep -Milliseconds 50;
      [MO]::mouse_event(${upFlag}, 0, 0, 0, 0)
    `);
    return { action: 'mouse-click', x, y, button };
  }

  // ── Type Text ──
  if (action === 'type-text') {
    const text = params.text || '';
    const escaped = text.replace(/[{}^+%~()\[\]]/g, '{$&}').replace(/'/g, "''");
    await runPowerShell(`
      [Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null;
      [System.Windows.Forms.SendKeys]::SendWait('${escaped}')
    `);
    return { action: 'type-text', length: text.length, preview: text.slice(0, 50) };
  }

  // ── Scroll ──
  if (action === 'scroll') {
    const amount = Math.abs(parseInt(params.amount) || 1);
    const direction = params.direction || 'down';
    const key = direction === 'up' ? '{UP}' : '{DOWN}';
    await runPowerShell(`
      [Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null;
      1..${amount} | ForEach-Object { [System.Windows.Forms.SendKeys]::SendWait('${key}'); Start-Sleep -Milliseconds 50 }
    `);
    return { action: 'scroll', direction, amount };
  }

  throw new Error(`Unknown system action: ${action}`);
}

// ── Analyze Image (read from disk + vision model) ──
async function analyzeImage(imagePath, query) {
  if (!modelRouter) throw new Error('Vision model not available (modelRouter not initialized)');
  if (!fs.existsSync(imagePath)) throw new Error('Image file not found: ' + imagePath);
  const ext = path.extname(imagePath).toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(ext)) throw new Error('Not a supported image format: ' + ext);
  const buffer = fs.readFileSync(imagePath);
  const b64 = buffer.toString('base64');
  const mimeType = `image/${ext === '.jpg' ? 'jpeg' : ext.slice(1)}`;
  const dataUrl = `data:${mimeType};base64,${b64}`;
  const userPrefs = { provider: visionConfig.provider, model: visionConfig.model, autoRoute: visionConfig.autoRoute };
  const messages = [{
    role: 'user',
    content: [
      { type: 'text', text: query || 'Describe this image in detail.' },
      { type: 'image_url', image_url: { url: dataUrl } },
    ],
  }];
  const result = await modelRouter.routeVision(userPrefs, messages, {
    preferredProvider: visionConfig.provider,
    preferredModel: visionConfig.model,
    forVision: true,
  });
  return { action: 'analyze-image', path: imagePath, result: result.text, model: `${result.provider}/${result.model}`, size: buffer.length };
}

// ═══════════════════════════════════════════
//  5. FILE SEARCH (system-wide)
// ═══════════════════════════════════════════

async function searchFiles({ query, path: searchPath, maxResults = 30 }) {
  const searchRoot = searchPath || USER_HOME;
  const check = isPathSafe(searchRoot);
  if (!check.safe) throw new Error(check.reason);

  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const psScript = `
    $results = Get-ChildItem -Path ${psQuote(check.resolved)} -Recurse -ErrorAction SilentlyContinue -Include *${psQuote(escapedQuery)}* | 
      Where-Object { !$_.PSIsContainer } | 
      Select-Object -First ${maxResults} FullName, Length, LastWriteTime |
      ForEach-Object { $_.FullName + '|' + $_.Length + '|' + $_.LastWriteTime }
    if ($results) { $results -join [char]10 } else { "NO_RESULTS" }
  `;
  const ps = await runPowerShell(psScript);
  const output = ps.stdout.trim();
  if (!output || output === 'NO_RESULTS') {
    return { query, path: check.resolved, results: [], count: 0 };
  }
  const lines = output.split('\n').filter(l => l.trim());
  const results = lines.map(line => {
    const parts = line.split('|');
    return { path: parts[0] || line, size: parseInt(parts[1]) || 0, modified: parts[2] || '' };
  });
  return { query, path: check.resolved, results, count: results.length };
}

// ═══════════════════════════════════════════
//  6. CLIPBOARD
// ═══════════════════════════════════════════

const clipboardHistory = [];

async function clipboardRead() {
  const ps = await runPowerShell('Get-Clipboard -Format Text -Raw');
  const text = (ps.stdout || '').trim();
  const item = { text, timestamp: Date.now() };
  if (text) {
    const last = clipboardHistory[clipboardHistory.length - 1];
    if (!last || last.text !== text) {
      clipboardHistory.push(item);
      if (clipboardHistory.length > 50) clipboardHistory.splice(0, clipboardHistory.length - 50);
    }
  }
  return { text, length: text.length, history: clipboardHistory.slice(-10).reverse() };
}

async function clipboardWrite({ text }) {
  const escaped = text.replace(/'/g, "''");
  await runPowerShell(`Set-Clipboard -Value '${escaped}'`);
  const item = { text, timestamp: Date.now() };
  const last = clipboardHistory[clipboardHistory.length - 1];
  if (!last || last.text !== text) {
    clipboardHistory.push(item);
    if (clipboardHistory.length > 50) clipboardHistory.splice(0, clipboardHistory.length - 50);
  }
  return { text, length: text.length, history: clipboardHistory.slice(-10).reverse() };
}

async function clipboardGetHistory() {
  return { history: clipboardHistory.slice(-20).reverse() };
}

// ═══════════════════════════════════════════
//  7. DOCUMENT READER (PDF/DOCX)
// ═══════════════════════════════════════════

async function extractDocumentText(filePath) {
  const check = isPathSafe(filePath);
  if (!check.safe) throw new Error(check.reason);
  if (!fs.existsSync(check.resolved)) throw new Error('File not found');

  const ext = path.extname(check.resolved).toLowerCase();

  if (ext === '.pdf') {
    try {
      const pdfParse = require('pdf-parse');
      const buffer = fs.readFileSync(check.resolved);
      const data = await pdfParse(buffer);
      return { path: check.resolved, text: data.text, pages: data.numpages, type: 'pdf' };
    } catch (err) {
      throw new Error(`PDF reading failed: ${err.message}`);
    }
  }

  if (ext === '.docx') {
    try {
      const mammoth = require('mammoth');
      const buffer = fs.readFileSync(check.resolved);
      const result = await mammoth.extractRawText({ buffer });
      return { path: check.resolved, text: result.value, type: 'docx' };
    } catch (err) {
      throw new Error(`DOCX reading failed: ${err.message}`);
    }
  }

  if (ext === '.doc') {
    // .doc files — try using PowerShell to extract text
    try {
      const ps = await runPowerShell(`
        Add-Type -AssemblyName "Microsoft.Office.Interop.Word" -ErrorAction Stop;
        $word = New-Object -ComObject Word.Application;
        $word.Visible = $false;
        $doc = $word.Documents.Open('${check.resolved.replace(/\\/g, '\\\\')}');
        $text = $doc.Content.Text;
        $doc.Close();
        $word.Quit();
        Write-Output $text
      `);
      return { path: check.resolved, text: ps.stdout.trim(), type: 'doc' };
    } catch {
      throw new Error('DOC files require Microsoft Word installed. Try converting to .docx or .pdf.');
    }
  }

  throw new Error(`Unsupported document format: ${ext}. Supported: .pdf, .docx, .doc`);
}

async function runCode(language, code) {
  return new Promise((resolve, reject) => {
    const output = [];
    const timer = setTimeout(() => reject(new Error('Code execution timed out')), TIMEOUT);
    executeCode({
      language: language || 'auto',
      code,
      onOutput: (text) => output.push({ type: 'stdout', text }),
      onError: (text) => output.push({ type: 'stderr', text }),
      onDone: (result) => {
        clearTimeout(timer);
        resolve({ output, exitCode: result.exitCode, duration: result.duration });
      },
    });
  });
}

// ═══════════════════════════════════════════
//  TOOL PARSER — Parse tool calls from LLM text
// ═══════════════════════════════════════════

const TOOL_PATTERN = /```tool\s*\n?([\s\S]*?)```/g;

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
        case 'write': case 'create': case 'make': return await writeFile(params.path, params.content);
        case 'list': return await listDir(params.path);
        case 'create-project': return await createProject(params.name, params.structure);
        default: throw new Error(`Unknown file action: ${action}`);
      }

    case 'git':
      return await gitRun(action, params.path, params);

    case 'browser':
      return await browserAction(action, params);

    case 'code':
      return await runCode(params.language, params.code);

    case 'system':
      if (action === 'search-files') return await searchFiles(params);
      if (action === 'clipboard-read') return await clipboardRead();
      if (action === 'clipboard-write') return await clipboardWrite(params);
      if (action === 'clipboard-history') return await clipboardGetHistory();
      if (action === 'read-document') return await extractDocumentText(params.path);
      return await systemControl(action, params);

    case 'vision':
      if (action === 'analyze') return await analyzeImage(params.path, params.query);
      throw new Error(`Unknown vision action: ${action}`);

    default:
      throw new Error(`Unknown tool type: ${type}`);
  }
}

// ── System prompt builder for LLM ──
function buildToolSystemPrompt() {
  return `
You have access to system tools. ONLY use a tool when the user EXPLICITLY asks for a file, git, browser, code execution, or system control operation.

NEVER invent tool calls on your own. NEVER use a tool just because it's available. Only use a tool if the user's request DIRECTLY matches one of the actions below.

To use a tool, output a code block with language "tool" containing JSON:
\`\`\`tool
{ "type": "...", "action": "...", "params": { ... } }
\`\`\`

Available tools:

1. **file** — File operations (only if user mentions reading/writing/listing files)
   - \`{ "type": "file", "action": "read", "params": { "path": "..." } }\`
   - \`{ "type": "file", "action": "write", "params": { "path": "...", "content": "..." } }\`
   - \`{ "type": "file", "action": "list", "params": { "path": "..." } }\`
   - \`{ "type": "file", "action": "create-project", "params": { "name": "...", "structure": { "filename": "content", "subdir": { ... } } } }\`

2. **git** — Git operations (only if user explicitly asks about git)
   - \`{ "type": "git", "action": "status" }\`
   - \`{ "type": "git", "action": "log" }\`
   - \`{ "type": "git", "action": "diff" }\`
   - \`{ "type": "git", "action": "branch" }\`
   - \`{ "type": "git", "action": "commit", "params": { "message": "..." } }\`
   - \`{ "type": "git", "action": "push" }\`
   - \`{ "type": "git", "action": "pull" }\`

3. **browser** — Browser automation (only if user explicitly asks to open a website or search)
   - \`{ "type": "browser", "action": "open", "params": { "url": "..." } }\`
   - \`{ "type": "browser", "action": "search", "params": { "query": "...", "engine": "google|youtube" } }\`
   - \`{ "type": "browser", "action": "screenshot", "params": { "url": "..." } }\`
   - \`{ "type": "browser", "action": "click", "params": { "selector": "..." } }\` or \`{ "params": { "text": "..." } }\`
   - \`{ "type": "browser", "action": "type", "params": { "selector": "...", "text": "..." } }\`
   - \`{ "type": "browser", "action": "extract" }\`

4. **system** — System control (only if user explicitly asks about system)
   - \`{ "type": "system", "action": "volume", "params": { "level": 0-100 } }\`
   - \`{ "type": "system", "action": "volume-up" }\` / \`{ "type": "system", "action": "volume-down" }\` / \`{ "type": "system", "action": "mute" }\`
   - \`{ "type": "system", "action": "brightness", "params": { "level": 0-100 } }\`
   - \`{ "type": "system", "action": "open-app", "params": { "name": "notepad|calculator|chrome|...|spotify|..." } }\`
   - \`{ "type": "system", "action": "system-info" }\`
   - \`{ "type": "system", "action": "process-list" }\`
   - \`{ "type": "system", "action": "kill-process", "params": { "name": "..." } }\`
   - \`{ "type": "system", "action": "screenshot" }\` — Takes desktop screenshot, returns base64 image data
   - \`{ "type": "system", "action": "mouse-click", "params": { "x": 100, "y": 200, "button": "left|right|middle" } }\`
   - \`{ "type": "system", "action": "type-text", "params": { "text": "Hello world" } }\`
   - \`{ "type": "system", "action": "scroll", "params": { "amount": 3, "direction": "down|up" } }\`

5. **code** — Execute code (only if user asks to run code)
   - \`{ "type": "code", "action": "run", "params": { "language": "python|javascript|bash", "code": "..." } }\`

6. **vision** — Analyze image files using AI vision
   - \`{ "type": "vision", "action": "analyze", "params": { "path": "full/path/to/image.png", "query": "What is in this image?" } }\`

7. **system/search** — Search files on the computer
   - \`{ "type": "system", "action": "search-files", "params": { "query": "filename or keyword", "path": "C:\\Users\\...", "maxResults": 30 } }\`

8. **system/clipboard** — Read/write clipboard
   - \`{ "type": "system", "action": "clipboard-read" }\` — Read current clipboard content
   - \`{ "type": "system", "action": "clipboard-write", "params": { "text": "text to copy" } }\` — Write text to clipboard
   - \`{ "type": "system", "action": "clipboard-history" }\` — View clipboard history

9. **system/document** — Read PDF/DOCX document text
   - \`{ "type": "system", "action": "read-document", "params": { "path": "full/path/to/document.pdf" } }\`

Allowed file paths: Desktop, Downloads, Documents, Pictures, Videos, Music, and the project directory.

IMPORTANT: If the user is just having a conversation, asking a question, or greeting you, DO NOT use any tools. Just respond conversationally.
`.trim();
}

module.exports = {
  init,
  readFile,
  writeFile,
  listDir,
  createProject,
  gitRun,
  browserAction,
  systemControl,
  searchFiles,
  clipboardRead,
  clipboardWrite,
  clipboardGetHistory,
  extractDocumentText,
  runCode,
  analyzeImage,
  parseToolCalls,
  executeTool,
  buildToolSystemPrompt,
  isPathSafe,
};
