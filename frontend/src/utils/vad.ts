// @ts-nocheck
export class VoiceActivityDetector {
  constructor(options = {}) {
    this.sampleRate = options.sampleRate || 16000;
    this.speechThreshold = options.speechThreshold || 0.015;
   this.silenceThreshold = options.silenceThreshold || 0.008;
    this.speechFrames = options.speechFrames || 6;
    this.silenceFrames = options.silenceFrames || 20;
    this.onSpeechStart = options.onSpeechStart || (() => {});
    this.onSpeechEnd = options.onSpeechEnd || (() => {});
    this.onAudioData = options.onAudioData || (() => {});

    this.audioContext = null;
    this.analyser = null;
    this.processor = null;
    this.source = null;
    this.stream = null;
    this.isListening = false;
    this.isSpeaking = false;
    this.speechFrameCount = 0;
    this.silenceFrameCount = 0;
    this.recordingChunks = [];
    this.mediaRecorder = null;
  }

  async start() {
    if (this.isListening) return;
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: this.sampleRate });
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    }});

    this.source = this.audioContext.createMediaStreamSource(this.stream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 512;
    this.source.connect(this.analyser);

    // Create MediaRecorder for capturing speech
    this.mediaRecorder = new MediaRecorder(this.stream, {
      mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm',
    });

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.recordingChunks.push(e.data);
    };

    this.mediaRecorder.onstop = () => {
      const blob = new Blob(this.recordingChunks, { type: this.mediaRecorder.mimeType });
      this.recordingChunks = [];
      this.onAudioData(blob);
    };

    this.isListening = true;
    this._processAudio();
  }

  stop() {
    this.isListening = false;
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    if (this.source) this.source.disconnect();
    if (this.audioContext) this.audioContext.close();
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    this.source = null;
    this.audioContext = null;
    this.analyser = null;
    this.stream = null;
    this.mediaRecorder = null;
    this.isSpeaking = false;
    this.speechFrameCount = 0;
    this.silenceFrameCount = 0;
    this.recordingChunks = [];
  }

  _processAudio() {
    if (!this.isListening) return;
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteTimeDomainData(data);

    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const value = (data[i] / 128) - 1;
      sum += value * value;
    }
    const rms = Math.sqrt(sum / data.length);

    if (rms > this.speechThreshold) {
      this.speechFrameCount++;
      this.silenceFrameCount = 0;
      if (!this.isSpeaking && this.speechFrameCount >= this.speechFrames) {
        this.isSpeaking = true;
        this.recordingChunks = [];
        this.mediaRecorder.start();
        this.onSpeechStart();
      }
    } else if (rms < this.silenceThreshold) {
      this.silenceFrameCount++;
      if (this.isSpeaking && this.silenceFrameCount >= this.silenceFrames) {
        this.isSpeaking = false;
        this.speechFrameCount = 0;
        this.silenceFrameCount = 0;
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
          this.mediaRecorder.stop();
        }
        this.onSpeechEnd();
      }
    }

    requestAnimationFrame(() => this._processAudio());
  }
}
