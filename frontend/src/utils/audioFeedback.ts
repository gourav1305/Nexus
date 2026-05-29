// @ts-nocheck
let sharedCtx = null;

function getAudioCtx() {
  if (!sharedCtx) {
    sharedCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (sharedCtx.state === 'suspended') {
    sharedCtx.resume();
  }
  return sharedCtx;
}

function playTone(freq, duration, type = 'sine', volume = 0.08) {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch (e) {
    /* audio not available */
  }
}

function playStartupHum() {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 55;
    gain.gain.setValueAtTime(0.04, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 3);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 200;
    osc.connect(filter).connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 3);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.value = 82.5;
    gain2.gain.setValueAtTime(0.02, ctx.currentTime + 0.5);
    gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 3.5);
    osc2.connect(filter).connect(gain2).connect(ctx.destination);
    osc2.start(ctx.currentTime + 0.5);
    osc2.stop(ctx.currentTime + 3.5);
  } catch (e) { /* audio not available */ }
}

function playHoverBlip() {
  playTone(880, 0.06, 'sine', 0.03);
}

function playClickBlip() {
  playTone(660, 0.08, 'sine', 0.05);
  setTimeout(() => playTone(880, 0.1, 'sine', 0.04), 50);
}

function playActivationChime() {
  try {
    const ctx = getAudioCtx();
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = ctx.currentTime + i * 0.12;
      gain.gain.setValueAtTime(0.07, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.3);
    });
    const oscBass = ctx.createOscillator();
    const gainBass = ctx.createGain();
    oscBass.type = 'sine';
    oscBass.frequency.value = 130.81;
    gainBass.gain.setValueAtTime(0.05, ctx.currentTime);
    gainBass.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.2);
    oscBass.connect(gainBass).connect(ctx.destination);
    oscBass.start();
    oscBass.stop(ctx.currentTime + 1.2);
  } catch (e) { /* audio not available */ }
}

function playDeactivationChime() {
  try {
    const ctx = getAudioCtx();
    const notes = [783.99, 659.25, 523.25, 392];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = ctx.currentTime + i * 0.1;
      gain.gain.setValueAtTime(0.06, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.25);
    });
  } catch (e) { /* audio not available */ }
}

function playErrorSound() {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = 150;
    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500;
    osc.connect(filter).connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sawtooth';
    osc2.frequency.value = 100;
    gain2.gain.setValueAtTime(0.05, ctx.currentTime + 0.15);
    gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc2.connect(filter).connect(gain2).connect(ctx.destination);
    osc2.start(ctx.currentTime + 0.15);
    osc2.stop(ctx.currentTime + 0.5);
  } catch (e) { /* audio not available */ }
}

function playSuccessSound() {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
    setTimeout(() => playTone(1108.73, 0.3, 'sine', 0.05), 100);
  } catch (e) { /* audio not available */ }
}

export {
  playTone,
  playStartupHum,
  playHoverBlip,
  playClickBlip,
  playActivationChime,
  playDeactivationChime,
  playErrorSound,
  playSuccessSound,
  getAudioCtx,
};
