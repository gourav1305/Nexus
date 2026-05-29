import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// ── Config ──
const MAX_CODE_SIZE = 50 * 1024;
const EXECUTION_TIMEOUT = 30000;
const MAX_OUTPUT_BYTES = 512 * 1024;
const DOCKER_MEMORY = '256m';
const DOCKER_CPU = '0.5';

// ── Dangerous patterns ──
const DANGEROUS_PYTHON = /\b(os|subprocess|shutil|socket|ctypes|signal|multiprocessing|threading|requests|urllib|http|ftplib|smtplib|telnetlib|paramiko|pexpect|psutil|winreg|cryptography|base64|pickle|shelve|marshal|tempfile|inspect|importlib|__import__|exec|eval|compile|open|file|input|breakpoint|sys\.(exit|modules|path)|__builtins__|__class__|__subclasses__|__globals__)\b/i;
const DANGEROUS_NODE = /\b(child_process|fs|net|dgram|cluster|cluster|worker_threads|vm|module|process\.(exit|kill|abort|binding|dlopen)|require|import\s+.*from|__dirname|__filename|global|eval|Function\(|exec|spawn|sync)\b/i;
const DANGEROUS_BASH = /\b(rm\s+-rf|dd\s+|:\(\)\s*\{|>\/dev\/sda|format\s+|mkfs|fdisk|mkswap|shutdown|reboot|halt|poweroff|init\s+0|chmod\s+777|chown|passwd|sudo|su\s+-|wget|curl|nc\s+|bash\s+-i|exec\s+.*<)\b/i;

const BLOCKED_IMPORTS = {
  python: DANGEROUS_PYTHON,
  javascript: DANGEROUS_NODE,
  bash: DANGEROUS_BASH,
};

// ── Docker detection ──
let dockerAvailable = null;
async function checkDocker() {
  if (dockerAvailable !== null) return dockerAvailable;
  try {
    const { execSync }: typeof import('child_process') = require('child_process');
    execSync('docker --version', { stdio: 'ignore', timeout: 3000 });
    dockerAvailable = true;
  } catch {
    dockerAvailable = false;
  }
  return dockerAvailable;
}

// ── Security scan ──
function scanCode(language, code) {
  const issues = [];
  if (code.length > MAX_CODE_SIZE) {
    issues.push(`Code too large (${code.length} bytes, max ${MAX_CODE_SIZE})`);
    return issues;
  }

  const pattern = BLOCKED_IMPORTS[language];
  if (pattern && pattern.test(code)) {
    const lines = code.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) {
        issues.push(`Line ${i + 1}: Blocked pattern detected — "${lines[i].trim().slice(0, 60)}"`);
      }
    }
  }

  return issues;
}

// ── Language detection ──
function guessLanguage(code) {
  if (/^\s*(import |from |def |class |print|#!|if __name__)/m.test(code) || /\b(input\(|print\()/m.test(code)) return 'python';
  if (/^\s*(const |let |var |function|import |export |console\.|require\()/m.test(code) || /=>\s*{/.test(code)) return 'javascript';
  if (/^\s*(#!\/bin\/bash|echo |export |alias |if \[|for i in |while true|case\s+\$)/m.test(code)) return 'bash';
  return 'python';
}

// ── File-based execution ──
function createTempFile(language, code) {
  const ext = { python: '.py', javascript: '.js', bash: '.sh' }[language] || '.txt';
  const tmpPath = path.join(os.tmpdir(), `nexus-code-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  fs.writeFileSync(tmpPath, code, 'utf-8');
  return tmpPath;
}

// ── Windows path -> WSL path ──
function toWslPath(winPath) {
  if (process.platform !== 'win32') return winPath;
  const abs = path.resolve(winPath);
  const parts = abs.split(path.sep).filter(Boolean);
  const drive = parts[0].toLowerCase().replace(':', '');
  return `/mnt/${drive}/${parts.slice(1).join('/')}`;
}

// ── Direct child_process runner ──
function runDirect(language, code, onOutput, onError, onDone) {
  const tmpFile = createTempFile(language, code);
  const startTime = Date.now();
  let totalOutput = 0;
  let outputBuffer = '';
  let settled = false;

  const settle = (fn, arg) => { if (!settled) { settled = true; fn(arg); } };

  const cmds = {
    python: ['python', ['-u', tmpFile]],
    javascript: ['node', [tmpFile]],
    bash: ['bash', [process.platform === 'win32' ? toWslPath(tmpFile) : tmpFile]],
  };

  const [cmd, args] = cmds[language] || cmds.python;
  const child = spawn(cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    timeout: EXECUTION_TIMEOUT,
  });

  const flushOutput = () => {
    if (outputBuffer) {
      onOutput(outputBuffer);
      outputBuffer = '';
    }
  };

  child.stdout.on('data', (chunk) => {
    totalOutput += chunk.length;
    if (totalOutput > MAX_OUTPUT_BYTES) {
      child.kill('SIGKILL');
      flushOutput();
      settle(onDone, { exitCode: null, duration: Date.now() - startTime, truncated: true });
      return;
    }
    outputBuffer += chunk.toString();
    // Flush on newline for real-time feel
    if (outputBuffer.includes('\n')) {
      flushOutput();
    }
  });

  child.stderr.on('data', (chunk) => {
    outputBuffer += chunk.toString();
    if (outputBuffer.includes('\n')) flushOutput();
  });

  child.on('error', (err) => {
    flushOutput();
    settle(onDone, { exitCode: -1, duration: Date.now() - startTime, error: err.message });
  });

  child.on('exit', (exitCode) => {
    flushOutput();
    settle(onDone, { exitCode, duration: Date.now() - startTime });
  });

  // Timeout kill
  const timer = setTimeout(() => {
    if (!settled) {
      child.kill('SIGKILL');
      flushOutput();
      settle(onDone, { exitCode: null, duration: EXECUTION_TIMEOUT, error: 'Execution timeout' });
    }
  }, EXECUTION_TIMEOUT);

  child.on('close', () => clearTimeout(timer));

  return { tmpFile, child };
}

// ── Docker runner (if available) ──
async function runDocker(language, code, onOutput, onError, onDone) {
  const tmpFile = createTempFile(language, code);
  const startTime = Date.now();
  let settled = false;

  const settle = (fn, arg) => { if (!settled) { settled = true; fn(arg); } };

  const images = { python: 'python:3.13-alpine', javascript: 'node:22-alpine', bash: 'alpine:latest' };
  const image = images[language] || images.python;

  const cmds = {
    python: ['python', '-u', `/tmp/code${path.extname(tmpFile)}`],
    javascript: ['node', `/tmp/code${path.extname(tmpFile)}`],
    bash: ['sh', `/tmp/code${path.extname(tmpFile)}`],
  };

  const containerCmd = cmds[language] || cmds.python;

  const dockerArgs = [
    'run', '--rm',
    '--memory', DOCKER_MEMORY,
    '--cpus', DOCKER_CPU,
    '--network', 'none',
    '--pids-limit', '100',
    '--read-only',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges:true',
    '-v', `${tmpFile}:/tmp/code${path.extname(tmpFile)}:ro`,
    image,
    ...containerCmd,
  ];

  const child = spawn('docker', dockerArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    timeout: EXECUTION_TIMEOUT,
  });

  let outputBuffer = '';
  const flushOutput = () => { if (outputBuffer) { onOutput(outputBuffer); outputBuffer = ''; } };

  child.stdout.on('data', (chunk) => {
    outputBuffer += chunk.toString();
    if (outputBuffer.includes('\n')) flushOutput();
  });

  child.stderr.on('data', (chunk) => {
    outputBuffer += chunk.toString();
    if (outputBuffer.includes('\n')) flushOutput();
  });

  child.on('error', (err) => {
    flushOutput();
    settle(onDone, { exitCode: -1, duration: Date.now() - startTime, error: err.message });
  });

  child.on('exit', (exitCode) => {
    flushOutput();
    settle(onDone, { exitCode, duration: Date.now() - startTime });
  });

  const timer = setTimeout(() => {
    if (!settled) {
      child.kill('SIGKILL');
      flushOutput();
      settle(onDone, { exitCode: null, duration: EXECUTION_TIMEOUT, error: 'Execution timeout' });
    }
  }, EXECUTION_TIMEOUT);

  child.on('close', () => { clearTimeout(timer); cleanup(tmpFile); });

  return { child };
}

function cleanup(tmpFile) {
  try { fs.unlinkSync(tmpFile); } catch {}
}

// ── Public API ──
async function executeCode({ language, code, onOutput, onError, onDone }) {
  // Guess language if not provided
  if (!language || language === 'auto') {
    language = guessLanguage(code);
  }

  // Validate
  if (!['python', 'javascript', 'bash'].includes(language)) {
    onError(`Unsupported language: ${language}. Use python, javascript, or bash.`);
    onDone({ exitCode: 1 });
    return;
  }

  // Security scan
  const issues = scanCode(language, code);
  if (issues.length > 0) {
    onError(`⚠ Security violation:\n${issues.join('\n')}`);
    onDone({ exitCode: 1 });
    return;
  }

  // Try Docker first, fallback to direct
  const hasDocker = await checkDocker();
  if (hasDocker) {
    try {
      await runDocker(language, code, onOutput, onError, onDone);
      return;
    } catch (dockerErr) {
      onError(`Docker failed (${dockerErr.message}), falling back to direct execution...`);
    }
  }

  runDirect(language, code, onOutput, onError, onDone);
}

export { executeCode, checkDocker, guessLanguage, scanCode };
