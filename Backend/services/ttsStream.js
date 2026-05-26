const { spawn } = require('child_process');
const { resolveVoicePrefs } = require('../voiceCatalog');

function createTtsStreamHandler(wss, logEvent) {
  wss.on('connection', (ws) => {
    ws.on('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return ws.send(JSON.stringify({ error: 'Invalid JSON' }));
      }

      if (msg.type === 'speak') {
        const text = (msg.text || '').trim();
        if (!text) return ws.send(JSON.stringify({ error: 'No text' }));

        const voicePrefs = resolveVoicePrefs(msg.voicePrefs || {});
        const engine = msg.engine || 'edge-tts';

        ws.send(JSON.stringify({ type: 'start', textLength: text.length }));

        try {
          await streamEdgeTts(ws, text, voicePrefs);
          ws.send(JSON.stringify({ type: 'done' }));
        } catch (err) {
          try {
            logEvent && logEvent('tts', 'Stream TTS fallback to SAPI', err.message);
            await streamWindowsSapi(ws, text, voicePrefs);
            ws.send(JSON.stringify({ type: 'done' }));
          } catch (sapiErr) {
            ws.send(JSON.stringify({ type: 'error', error: sapiErr.message }));
          }
        }
      }
    });
  });
}

function streamEdgeTts(ws, text, resolved) {
  return new Promise((resolve, reject) => {
    const script = `
const { tts } = require('${__dirname.replace(/\\/g, '\\\\')}\\\\..\\\\node_modules\\\\edge-tts\\\\out\\\\index.js');
(async () => {
  const result = await tts(${JSON.stringify(text)}, {
    voice: ${JSON.stringify(resolved.voice)},
    rate: ${JSON.stringify(resolved.rate)},
    pitch: '+0Hz',
  });
  process.stdout.write(result);
})().catch(e => { process.stderr.write(e.message); process.exit(1); });
`;

    const child = spawn('node', ['-e', script], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const chunks = [];
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(stderr || 'edge-tts stream failed'));
      const audioBuffer = Buffer.concat(chunks);
      ws.send(JSON.stringify({ type: 'audio', data: audioBuffer.toString('base64'), mime: 'audio/mpeg' }));
      resolve();
    });
    child.on('error', reject);
  });
}

function streamWindowsSapi(ws, text, resolved) {
  return new Promise((resolve, reject) => {
    const gender = resolved.gender === 'male' ? 'Male' : 'Female';
    const escaped = text.replace(/'/g, "''");
    const script = `
Add-Type -AssemblyName System.Speech;
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer;
$installed = $synth.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo };
$preferred = $installed | Where-Object { $_.Gender -eq [System.Speech.Synthesis.VoiceGender]::${gender} } | Select-Object -First 1;
if ($preferred) { $synth.SelectVoice($preferred.Name); }
$synth.Rate = 0;
$stream = New-Object System.IO.MemoryStream;
$synth.SetOutputToWaveStream($stream);
$synth.Speak('${escaped}');
$synth.Dispose();
$bytes = $stream.ToArray();
[Console]::Out.Write([Convert]::ToBase64String($bytes));
`;

    const child = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-Command', script,
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    child.on('close', (code) => {
      if (code !== 0 || !stdout) return reject(new Error(stderr || 'SAPI stream failed'));
      ws.send(JSON.stringify({ type: 'audio', data: stdout.trim(), mime: 'audio/wav' }));
      resolve();
    });
    child.on('error', reject);
  });
}

module.exports = { createTtsStreamHandler };
