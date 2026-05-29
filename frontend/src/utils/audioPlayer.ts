// @ts-nocheck
export class StreamingAudioPlayer {
  constructor(options = {}) {
    this.onStart = options.onStart || (() => {});
    this.onDone = options.onDone || (() => {});
    this.onError = options.onError || (() => {});
    this.ws = null;
    this.audioQueue = [];
    this.isPlaying = false;
    this.audioContext = null;
    this.reconnectAttempts = 0;
    this.maxReconnect = options.maxReconnect || 3;
  }

  connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws/tts`;

    this.ws = new WebSocket(wsUrl);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
    };

    this.ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      switch (msg.type) {
        case 'start':
          this.onStart();
          break;
        case 'audio':
          this._enqueueAudio(msg.data, msg.mime || 'audio/mpeg');
          break;
        case 'done':
          this.onDone();
          break;
        case 'error':
          this.onError(new Error(msg.error));
          break;
      }
    };

    this.ws.onclose = () => {
      if (this.reconnectAttempts < this.maxReconnect) {
        this.reconnectAttempts++;
        setTimeout(() => this.connect(), 2000);
      }
    };

    this.ws.onerror = () => {};
  }

  disconnect() {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.audioQueue = [];
    this.isPlaying = false;
  }

  speak(text, voicePrefs = {}) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'speak',
        text,
        voicePrefs,
      }));
    }
  }

  _enqueueAudio(base64Data, mimeType) {
    this.audioQueue.push({ base64Data, mimeType });
    if (!this.isPlaying) this._playNext();
  }

  async _playNext() {
    if (this.audioQueue.length === 0) {
      this.isPlaying = false;
      return;
    }

    this.isPlaying = true;
    const item = this.audioQueue.shift();

    try {
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }

      const binaryStr = atob(item.base64Data);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      const audioBuffer = await this.audioContext.decodeAudioData(bytes.buffer);
      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.audioContext.destination);

      source.onended = () => {
        this._playNext();
      };

      source.start(0);
    } catch (err) {
      this.onError(err);
      this._playNext();
    }
  }
}
