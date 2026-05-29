import { spawn } from 'child_process';
import * as path from 'path';
import {
  userHome, windowsDir, knownFolders, logEvent,
} from './context';

const launchProcess = (command: string, args: string[] = [], options: Record<string, any> = {}) => new Promise<any>((resolve, reject) => {
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
  const settle = (callback: (...args: any[]) => void, value?: any) => {
    if (settled) return;
    settled = true;
    callback(value);
  };
  if (captureOutput) {
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  }
  child.once('error', (error) => { settle(reject, error); });
  child.once('exit', (code) => {
    if (!captureOutput) return;
    if (code === 0) settle(resolve, { stdout, stderr });
    else settle(reject, new Error(stderr || stdout || `${command} exited with code ${code}`));
  });
  child.once('spawn', () => {
    if (captureOutput) return;
    setTimeout(() => settle(resolve), 250);
  });
  if (!captureOutput) child.unref();
});

const psQuote = (value: any) => `'${String(value).replace(/'/g, "''")}'`;

export const runPowerShell = (command: string) => {
  console.log('[NEXUS Tool] PowerShell:', command);
  return launchProcess('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command,
  ], { captureOutput: true });
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isProcessRunning = async (imageName: string) => {
  const result = await launchProcess('tasklist.exe', [
    '/FI', `IMAGENAME eq ${imageName}`, '/NH',
  ], { captureOutput: true });
  return result.stdout.toLowerCase().includes(imageName.toLowerCase());
};

const openUrl = async (url: string) => {
  console.log('[NEXUS Tool] Opening URL:', url);
  try {
    await launchProcess('explorer.exe', [url]);
  } catch (error: any) {
    console.warn('[NEXUS Tool] Explorer URL open failed, trying rundll32:', error.message);
    await launchProcess('rundll32.exe', ['url.dll,FileProtocolHandler', url]);
  }
};

export const openApp = async (appName: string, options: Record<string, any> = {}) => {
  const appPath = options.path || appName;
  console.log('[NEXUS Tool] Opening app:', appPath);
  try {
    await launchProcess(appPath);
  } catch (error: any) {
    console.warn('[NEXUS Tool] Direct app open failed, trying PowerShell:', error.message);
    await runPowerShell(`Start-Process -FilePath ${psQuote(appPath)} -WindowStyle Normal`);
  }
  if (options.verifyProcess) {
    await wait(700);
    const running = await isProcessRunning(options.verifyProcess);
    if (!running) throw new Error(`${options.verifyProcess} process launch verify failed`);
  }
};

const openFolder = async (folderPath: string) => {
  console.log('[NEXUS Tool] Opening folder:', folderPath);
  try {
    await launchProcess('explorer.exe', [folderPath]);
  } catch (error: any) {
    console.warn('[NEXUS Tool] Explorer folder open failed, trying PowerShell:', error.message);
    await runPowerShell(`Start-Process -FilePath 'explorer.exe' -ArgumentList ${psQuote(folderPath)}`);
  }
};

import modelRouter = require('../services/modelRouter');

async function handleSummarization(input: string, userId: number | null) {
  const { serverModelPrefs, logEvent } = await import('./context');
  logEvent('system', 'Summarization requested', input);
  let contentToSummarize = input;
  if (input.includes(':') || input.includes('\\') || input.includes('/')) {
    try {
      const sysComm = require('../services/systemCommander');
      const result = await sysComm.readFile(input);
      if (result.content) contentToSummarize = result.content;
    } catch {}
  }
  const prompt = `Please provide a concise and clear summary of the following content. Use bullet points if necessary. Keep it under 200 words.\n\nContent:\n${contentToSummarize.slice(0, 10000)}`;
  const result = await modelRouter.routeQuery(serverModelPrefs, [
    { role: 'system', content: 'You are a helpful assistant that summarizes text efficiently.' },
    { role: 'user', content: prompt },
  ]);
  return result.text;
}

const normalizeCommand = (text: string) => text
  .toLowerCase()
  .replace(/[^\p{L}\p{N}\s.:/-]/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

export const detectSystemCommand = (message: string) => {
  const text = normalizeCommand(message);
  const wantsOpen = /\b(open|launch|start|kholo|khol|karo|kar|chalao|run)\b/.test(text);
  if (!wantsOpen) return null;

  if (/\bnotepad\b/.test(text) || text.includes('note pad')) {
    return {
      name: 'open_notepad', reply: 'Notepad open kar diya.',
      run: () => openApp('notepad.exe', { path: path.join(windowsDir, 'System32', 'notepad.exe'), verifyProcess: 'notepad.exe' }),
    };
  }
  if (/\b(calculator|calc)\b/.test(text) || text.includes('calculator kholo')) {
    return { name: 'open_calculator', reply: 'Calculator open kar diya.', run: () => openApp('calc.exe') };
  }
  if (/\b(youtube|you tube)\b/.test(text)) {
    const searchMatch = text.match(/(?:youtube|you tube)(?:\s+(?:par|pe|me|mein|search|search for))?\s+(.+)/);
    const query = searchMatch?.[1]?.replace(/\b(open|launch|start|kholo|khol|karo|kar|do|chalao|run|search|for|par|pe|me|mein)\b/g, ' ').replace(/\s+/g, ' ').trim();
    const url = query ? `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}` : 'https://www.youtube.com';
    return { name: 'open_youtube', reply: query ? `YouTube par ${query} search kar diya.` : 'YouTube open kar diya.', run: () => openUrl(url) };
  }
  if (/\b(google|browser|chrome)\b/.test(text)) {
    return { name: 'open_google', reply: 'Browser me Google open kar diya.', run: () => openUrl('https://www.google.com') };
  }
  for (const [folderName, folderPath] of Object.entries(knownFolders)) {
    if (new RegExp(`\\b${folderName}\\b`).test(text)) {
      return {
        name: `open_${folderName}`,
        reply: `${folderName.charAt(0).toUpperCase() + folderName.slice(1)} folder open kar diya.`,
        run: () => openFolder(folderPath),
      };
    }
  }
  if (text.includes('file explorer') || text.includes('explorer') || text.includes('file manager') || text.includes('files') || text.includes('folders') || /\bfolder\b/.test(text)) {
    return { name: 'open_file_explorer', reply: 'File Explorer open kar diya.', run: () => openFolder(userHome) };
  }
  if (text.includes('this pc') || text.includes('my computer')) {
    return { name: 'open_this_pc', reply: 'This PC open kar diya.', run: () => openFolder('shell:MyComputerFolder') };
  }
  if (/\b(vs code|vscode|code)\b/.test(text)) {
    return { name: 'open_vscode', reply: 'Visual Studio Code open kar diya.', run: () => openApp('code') };
  }
  if (/\b(chrome|google chrome)\b/.test(text)) {
    return { name: 'open_chrome', reply: 'Google Chrome open kar diya.', run: () => openApp('chrome.exe') };
  }
  if (/\b(whatsapp|whats app|wa)\b/.test(text)) {
    return { name: 'open_whatsapp', reply: 'WhatsApp Web open kar diya.', run: () => openUrl('https://web.whatsapp.com') };
  }
  if (/\bspotify\b/.test(text)) {
    return { name: 'open_spotify', reply: 'Spotify open kar diya.', run: () => openUrl('https://open.spotify.com') };
  }
  if (/\bvolume (up|badhao|tej)\b/.test(text)) {
    return { name: 'volume_up', reply: 'Volume badha diya.', run: () => runPowerShell('(new-object -com wscript.shell).SendKeys([char]175)') };
  }
  if (/\bvolume (down|kam|ghatao)\b/.test(text)) {
    return { name: 'volume_down', reply: 'Volume kam kar diya.', run: () => runPowerShell('(new-object -com wscript.shell).SendKeys([char]174)') };
  }
  if (/\b(mute|unmute|silent)\b/.test(text)) {
    return { name: 'volume_mute', reply: 'Volume mute ya unmute kar diya.', run: () => runPowerShell('(new-object -com wscript.shell).SendKeys([char]173)') };
  }
  if (/\b(screenshot|screen shot|capture screen)\b/.test(text)) {
    return {
      name: 'capture_screenshot', reply: 'Screenshot le liya aur Pictures folder me save kar diya.',
      run: async () => {
        const ssPath = path.join(knownFolders.pictures, `Nexus_SS_${Date.now()}.png`);
        const script = `[Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms');$screen=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds;$bitmap=New-Object System.Drawing.Bitmap($screen.Width,$screen.Height);$graphics=[System.Drawing.Graphics]::FromImage($bitmap);$graphics.CopyFromScreen($screen.X,$screen.Y,0,0,$bitmap.Size);$bitmap.Save('${ssPath}',[System.Drawing.Imaging.ImageFormat]::Png);$graphics.Dispose();$bitmap.Dispose();`;
        return runPowerShell(script);
      },
    };
  }
  if (/\b(task manager|taskmanager|processes)\b/.test(text)) {
    return { name: 'open_task_manager', reply: 'Task Manager open kar diya.', run: () => launchProcess('taskmgr.exe') };
  }
  if (/\b(control panel|settings|controlpanel)\b/.test(text) && !text.includes('wifi')) {
    return { name: 'open_control_panel', reply: 'Control Panel open kar diya.', run: () => launchProcess('control.exe') };
  }
  if (/\b(wifi|wi fi|internet settings)\b/.test(text)) {
    return { name: 'open_wifi_settings', reply: 'WiFi setting open kar diya.', run: () => runPowerShell('Start-Process ms-settings:network-wifi') };
  }
  if (/\b(shutdown|shut down|power off|band kar)\b/.test(text)) {
    return {
      name: 'system_shutdown_init', reply: 'NEXUS command locked: Are you sure you want to shutdown the computer? Please say "Confirm Shutdown" to proceed.',
      requiresConfirmation: true, confirmKeyword: 'shutdown',
      run: () => runPowerShell('shutdown /s /t 10 /f'),
    };
  }
  if (/\b(add|put|write|nawa|likho|rakhu|rakh)\b/.test(text) && /\b(todo|task|kaam|list)\b/.test(text)) {
    const todoMatch = text.match(/(?:add|put|write|nawa|likho|rakhu|rakh)\s+(?:todo|task|kaam|list)?\s*(.+)/);
    const todoText = todoMatch?.[1]?.trim();
    if (todoText) {
      return {
        name: 'add_todo', reply: `Theek hai, maine list me add kar diya: "${todoText}"`,
        run: async (userId: number) => {
          if (!userId) throw new Error('User not authenticated');
          const db = require('../db');
          return db.addTodo(userId, todoText);
        },
      };
    }
  }
  if (/\b(show|tell|check|dekh|dikhao|batao)\b/.test(text) && /\b(todo|task|kaam|list)\b/.test(text)) {
    return {
      name: 'list_todos', reply: 'Aapki current list ye rahi.',
      run: async (userId: number) => {
        if (!userId) throw new Error('User not authenticated');
        const db = require('../db');
        return db.getTodos(userId);
      },
    };
  }
  if (/\b(summarize|summary|nichod|chhota karo|shorten|brief)\b/.test(text)) {
    const topicMatch = text.match(/(?:summarize|summary|nichod|chhota karo|shorten|brief)\s+(?:of|this|the|is|ka|ki|ko)?\s*(.+)/);
    const topic = topicMatch?.[1]?.trim();
    return {
      name: 'summarize_content',
      reply: topic ? `Wait, main "${topic}" ko summarize kar rha hun...` : 'Theek hai, main summarize kar raha hun.',
      run: async (userId: number | null, fullMsg: string) => handleSummarization(topic || fullMsg, userId),
    };
  }
  if (/\b(schedule|events|meetings|mulaqat|calendar)\b/.test(text)) {
    return {
      name: 'list_calendar_events', reply: 'Checking your schedule...',
      run: async (userId: number) => {
        if (!userId) throw new Error('User not authenticated');
        const db = require('../db');
        const now = Date.now();
        const endOfDay = new Date().setHours(23, 59, 59, 999);
        return db.getEvents(userId, now, endOfDay);
      },
    };
  }
  return null;
};
