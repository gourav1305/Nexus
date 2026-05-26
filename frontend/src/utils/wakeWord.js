export class WakeWordDetector {
  constructor(options = {}) {
    this.keywords = options.keywords || ['hey nexus', 'nexus'];
    this.onWakeWord = options.onWakeWord || (() => {});
    this.onError = options.onError || (() => {});
    this.isListening = false;
    this.recognition = null;
    this.restartTimeout = null;
  }

  start() {
    if (this.isListening) return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      this.onError(new Error('SpeechRecognition not supported in this browser'));
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = 'en-US';

    this.recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript.toLowerCase().trim();
        for (const keyword of this.keywords) {
          if (transcript.includes(keyword)) {
            this.onWakeWord(keyword, transcript);
            return;
          }
        }
      }
    };

    this.recognition.onerror = (event) => {
      if (event.error === 'no-speech') return;
      this.onError(event.error);
      this._restart();
    };

    this.recognition.onend = () => {
      this._restart();
    };

    this.isListening = true;
    try {
      this.recognition.start();
    } catch (e) {
      this.onError(e.message);
    }
  }

  stop() {
    this.isListening = false;
    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }
    if (this.recognition) {
      try { this.recognition.stop(); } catch {}
      this.recognition = null;
    }
  }

  _restart() {
    if (!this.isListening) return;
    this.restartTimeout = setTimeout(() => {
      if (!this.isListening) return;
      try {
        this.recognition.start();
      } catch (e) {
        this.onError(e.message);
      }
    }, 300);
  }
}
