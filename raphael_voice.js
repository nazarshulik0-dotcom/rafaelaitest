/**
 * ============================================================================
 * RAPHAEL VOICE GATEWAY (raphael_voice.js) - v2.0 NEURAL STREAM (NO SPEECHSYNTH)
 * Проєкт: НРІ «Ентропія» (Ковчег Вавилонії) | Система «Вітрувій»
 * ----------------------------------------------------------------------------
 * Головне оновлення v2.0:
 *   1. ПОВНІСТЮ ВИДАЛЕНО кривий браузерний window.speechSynthesis!
 *   2. Трикаскадний нейромережевий синтез (завжди через decodeAudioData):
 *      - Каскад 1: Gemini / Vertex Neural Audio TTS (Charon 24kHz).
 *      - Каскад 2: Потоковий хмарний TTS-синтез через Web Audio API з
 *        пониженням форманти (0.94x) та смуговим фільтром 300 Hz – 4.5 kHz.
 *      - Каскад 3: Кібернетичний телеметричний сонар (якщо немає інтернету).
 * ============================================================================
 */

(function (window) {
  'use strict';

  const DSP_CONFIG = Object.freeze({
    HIGHPASS_HZ: 300,
    LOWPASS_HZ: 4500,
    PRESENCE_HZ: 1850,
    PRESENCE_GAIN_DB: 3.0,
    PRESENCE_Q: 1.45,
    SATURATION_AMOUNT: 10
  });

  window.RaphaelModules = window.RaphaelModules || {
    core: null,
    canvas: null,
    brain: null,
    voice: null,
    optimizer: null,
    register(name, instance) {
      this[name] = instance;
      if (this.core && name !== 'core' && typeof this.core.onSubmoduleRegistered === 'function') {
        this.core.onSubmoduleRegistered(name, instance);
      }
    }
  };

  class RaphaelVoice {
    constructor(options = {}) {
      this.core = null;
      this.audioCtx = null;

      this.hpfNode = null;
      this.lpfNode = null;
      this.presenceNode = null;
      this.shaperNode = null;
      this.masterGainNode = null;
      this.analyserNode = null;
      this.aetherStreamDest = null;

      this.isRecordingPTT = false;
      this.pttMicStream = null;
      this.mediaRecorder = null;
      this.recordedChunks = [];
      this.speechRecognizer = null;
      this.interimTranscript = '';
      this.finalTranscript = '';

      this.activeSourceNode = null;
      this.activeHtmlAudio = null;
      this.ttsVoiceName = options.voiceName || 'Charon';
      this.ttsModelName = options.ttsModel || 'gemini-2.5-flash-preview-tts';
      this.sttModelName = options.sttModel || 'gemini-2.5-flash';

      this.mountWhenReady();
    }

    mountWhenReady() {
      const init = () => {
        if (window.RaphaelCore) {
          this.attachCore(window.RaphaelCore);
        }
        this.bindTestBenchPTTIfPresent();
      };

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
      } else {
        init();
      }
    }

    attachCore(coreInstance) {
      if (!coreInstance || this.core === coreInstance) return;
      this.core = coreInstance;

      this.core.on('overrideGlitch', () => {
        this.playCyberneticTelemetryCue('override');
      });
    }

    // =========================================================================
    // 1. WEB AUDIO DSP-ТРАКТ БОРТОВОГО ТЕРМІНАЛА (300 Hz – 4.5 kHz)
    // =========================================================================
    ensureAudioPipeline() {
      if (!this.audioCtx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        this.audioCtx = new AudioCtx({ sampleRate: 24000 });

        this.hpfNode = this.audioCtx.createBiquadFilter();
        this.hpfNode.type = 'highpass';
        this.hpfNode.frequency.value = DSP_CONFIG.HIGHPASS_HZ;
        this.hpfNode.Q.value = 0.707;

        this.lpfNode = this.audioCtx.createBiquadFilter();
        this.lpfNode.type = 'lowpass';
        this.lpfNode.frequency.value = DSP_CONFIG.LOWPASS_HZ;
        this.lpfNode.Q.value = 0.707;

        this.presenceNode = this.audioCtx.createBiquadFilter();
        this.presenceNode.type = 'peaking';
        this.presenceNode.frequency.value = DSP_CONFIG.PRESENCE_HZ;
        this.presenceNode.Q.value = DSP_CONFIG.PRESENCE_Q;
        this.presenceNode.gain.value = DSP_CONFIG.PRESENCE_GAIN_DB;

        this.shaperNode = this.audioCtx.createWaveShaper();
        this.shaperNode.curve = this.buildTerminalSaturationCurve(DSP_CONFIG.SATURATION_AMOUNT);
        this.shaperNode.oversample = '2x';

        this.masterGainNode = this.audioCtx.createGain();
        this.masterGainNode.gain.value = 1.1;

        this.analyserNode = this.audioCtx.createAnalyser();
        this.analyserNode.fftSize = 128;
        this.analyserNode.smoothingTimeConstant = 0.72;

        if (typeof this.audioCtx.createMediaStreamDestination === 'function') {
          this.aetherStreamDest = this.audioCtx.createMediaStreamDestination();
        }

        this.hpfNode.connect(this.lpfNode);
        this.lpfNode.connect(this.presenceNode);
        this.presenceNode.connect(this.shaperNode);
        this.shaperNode.connect(this.masterGainNode);
        this.masterGainNode.connect(this.analyserNode);

        this.analyserNode.connect(this.audioCtx.destination);
        if (this.aetherStreamDest) {
          this.analyserNode.connect(this.aetherStreamDest);
        }

        if (window.RaphaelModules.canvas && typeof window.RaphaelModules.canvas.bindAnalyser === 'function') {
          window.RaphaelModules.canvas.bindAnalyser(this.analyserNode);
        }
      }

      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }

      return this.audioCtx;
    }

    buildTerminalSaturationCurve(amount = 10) {
      const samples = 2048;
      const curve = new Float32Array(samples);
      const deg = Math.PI / 180;
      for (let i = 0; i < samples; i++) {
        const x = (i * 2) / samples - 1;
        curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
      }
      return curve;
    }

    getVirtualMediaStream() {
      this.ensureAudioPipeline();
      return this.aetherStreamDest ? this.aetherStreamDest.stream : null;
    }

    // =========================================================================
    // 2. ВХІД (STT): ПЕРЕХОПЛЕННЯ МІКРОФОНА ЗА PTT
    // =========================================================================
    async startPTTCapture() {
      if (this.isRecordingPTT) return true;
      this.ensureAudioPipeline();

      this.isRecordingPTT = true;
      this.recordedChunks = [];
      this.interimTranscript = '';
      this.finalTranscript = '';

      this.playCyberneticTelemetryCue('ptt_open');
      this.setAetherRoomChannelsDucking(true);

      const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRec) {
        try {
          this.speechRecognizer = new SpeechRec();
          this.speechRecognizer.lang = 'uk-UA';
          this.speechRecognizer.continuous = true;
          this.speechRecognizer.interimResults = true;

          this.speechRecognizer.onresult = (event) => {
            let interim = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
              const res = event.results[i];
              const txt = (res[0]?.transcript || '').trim();
              if (res.isFinal) {
                this.finalTranscript = (this.finalTranscript + ' ' + txt).trim();
              } else {
                interim += ' ' + txt;
              }
            }
            this.interimTranscript = interim.trim();
          };
          this.speechRecognizer.onerror = () => {};
          this.speechRecognizer.start();
        } catch (_) {}
      }

      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
          const existingAetherMic = window.AetherOptimizers?.activeEngine?.audio?.rawMicStream;
          this.pttMicStream = existingAetherMic || await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: false,
              autoGainControl: true
            }
          });
          this._ownsMicStream = !existingAetherMic;

          if (window.MediaRecorder) {
            const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
              ? 'audio/webm;codecs=opus'
              : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '');

            this.mediaRecorder = mimeType
              ? new MediaRecorder(this.pttMicStream, { mimeType })
              : new MediaRecorder(this.pttMicStream);

            this.mediaRecorder.ondataavailable = (e) => {
              if (e.data && e.data.size > 0) {
                this.recordedChunks.push(e.data);
              }
            };
            this.mediaRecorder.start(120);
          }
        } catch (_) {}
      }

      return true;
    }

    async stopPTTCapture() {
      if (!this.isRecordingPTT) return null;
      this.isRecordingPTT = false;

      this.playCyberneticTelemetryCue('ptt_close');
      this.setAetherRoomChannelsDucking(false);

      if (this.speechRecognizer) {
        try { this.speechRecognizer.stop(); } catch (_) {}
        this.speechRecognizer = null;
      }

      const audioBlob = await new Promise((resolve) => {
        if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
          resolve(null);
          return;
        }
        this.mediaRecorder.onstop = () => {
          const mime = this.mediaRecorder?.mimeType || 'audio/webm';
          const blob = this.recordedChunks.length > 0
            ? new Blob(this.recordedChunks, { type: mime })
            : null;
          resolve(blob);
        };
        try {
          this.mediaRecorder.stop();
        } catch (_) {
          resolve(null);
        }
      });

      this.mediaRecorder = null;

      if (this._ownsMicStream && this.pttMicStream) {
        this.pttMicStream.getTracks().forEach((t) => { try { t.stop(); } catch (_) {} });
        this.pttMicStream = null;
      }

      await new Promise((r) => setTimeout(r, 180));

      let recognizedText = (this.finalTranscript || this.interimTranscript || '').trim();
      const apiKey = this.getApiKey();

      if (!recognizedText && audioBlob && audioBlob.size > 512 && apiKey) {
        if (this.core) this.core.setState('THINKING');
        recognizedText = await this.transcribeAudioBlobWithGemini(audioBlob, apiKey);
      }

      if (recognizedText && this.core) {
        await this.core.submitQuery(recognizedText);
      } else if (this.core) {
        this.core.setState('IDLE');
      }

      return recognizedText;
    }

    async transcribeAudioBlobWithGemini(audioBlob, apiKey) {
      try {
        const base64Audio = await this.blobToBase64(audioBlob);
        const mimeType = (audioBlob.type || 'audio/webm').split(';')[0];
        const endpoints = window.RaphaelModules.brain?.getEndpointsForKey?.(apiKey, this.sttModelName) || [
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.sttModelName)}:generateContent?key=${encodeURIComponent(apiKey)}`
        ];

        for (let i = 0; i < endpoints.length; i++) {
          const res = await fetch(endpoints[i], {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [
                {
                  role: 'user',
                  parts: [
                    { text: 'Розпізнай українське голосове звернення до бортового ШІ «Рафаїль». Поверни ТІЛЬКИ точний текст сказаного.' },
                    { inlineData: { mimeType, data: base64Audio } }
                  ]
                }
              ],
              generationConfig: { temperature: 0.1, maxOutputTokens: 80 }
            })
          });

          if (res.ok) {
            const data = await res.json();
            const txt = (data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
            if (txt) return txt;
          }
        }
        return '';
      } catch (_) {
        return '';
      }
    }

    setAetherRoomChannelsDucking(duckActive) {
      const aetherEngine = window.AetherOptimizers?.activeEngine;
      if (!aetherEngine || !aetherEngine.audio || !aetherEngine.audio.masterGain) return;
      const ctx = aetherEngine.audio.ctx;
      if (!ctx) return;

      try {
        aetherEngine.audio.masterGain.gain.setTargetAtTime(duckActive ? 0.18 : 1.0, ctx.currentTime, 0.05);
      } catch (_) {}
    }

    // =========================================================================
    // 3. ВИХІД (TTS): ЧИСТИЙ НЕЙРОПОТІК ЧЕРЕЗ WEB AUDIO API (БЕЗ SPEECHSYNTHESIS!)
    // =========================================================================
    async speak(text) {
      const cleanText = String(text || '').trim();
      if (!cleanText) return false;

      this.ensureAudioPipeline();
      this.stopCurrentPlayback();

      if (this.core && this.core.getState() !== 'SPEAKING') {
        this.core.setState('SPEAKING');
      }

      // 1. Перевірка миттєвого кешу AudioBuffer у raphael_optimizer.js (0 мс затримки)
      const cachedBuffer = window.RaphaelModules.optimizer?.getCachedAudioBuffer?.(cleanText);
      if (cachedBuffer) {
        await this.playAudioBufferThroughDSP(cachedBuffer, 0.95);
        return true;
      }

      // 2. Спроба №1: Gemini / Vertex Neural Audio TTS (24kHz PCM16 -> WAV -> decodeAudioData)
      const apiKey = this.getApiKey();
      if (apiKey) {
        try {
          const neuralBuffer = await this.requestGeminiNeuralTTS(cleanText, apiKey);
          if (neuralBuffer) {
            window.RaphaelModules.optimizer?.cacheAudioBuffer?.(cleanText, neuralBuffer);
            await this.playAudioBufferThroughDSP(neuralBuffer, 1.0);
            return true;
          }
        } catch (_) {}
      }

      // 3. Спроба №2: Безключовий хмарний Neural TTS потік із розпаковкою в AudioBuffer
      try {
        const cloudBuffer = await this.fetchKeylessCloudNeuralTTS(cleanText);
        if (cloudBuffer) {
          window.RaphaelModules.optimizer?.cacheAudioBuffer?.(cleanText, cloudBuffer);
          await this.playAudioBufferThroughDSP(cloudBuffer, 0.94);
          return true;
        }
      } catch (_) {}

      // 4. Якщо навіть бінарний проксі недоступний — чистий кібернетичний радіо-сонар (без кривого браузерного голосу)
      await this.playPureCyberneticDataTelemetry(cleanText);
      return true;
    }

    async requestGeminiNeuralTTS(text, apiKey) {
      const endpoints = window.RaphaelModules.brain?.getEndpointsForKey?.(apiKey, this.ttsModelName) || [
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.ttsModelName)}:generateContent?key=${encodeURIComponent(apiKey)}`
      ];

      for (let i = 0; i < endpoints.length; i++) {
        try {
          const response = await fetch(endpoints[i], {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    { text: `Прочитай спокійним, чітким тактичним голосом бортового ШІ українською мовою: ${text}` }
                  ]
                }
              ],
              generationConfig: {
                responseModalities: ['AUDIO'],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: this.ttsVoiceName }
                  }
                }
              }
            })
          });

          if (!response.ok) continue;

          const data = await response.json();
          const inlineData = data?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
          if (!inlineData || !inlineData.data) continue;

          const mimeType = (inlineData.mimeType || '').toLowerCase();
          const rawBytes = this.base64ToUint8Array(inlineData.data);

          if (
            mimeType.includes('wav') ||
            mimeType.includes('mp3') ||
            mimeType.includes('mpeg') ||
            mimeType.includes('ogg') ||
            mimeType.includes('webm')
          ) {
            return await this.decodeBinaryAudioBuffer(rawBytes.buffer);
          }

          const wavBuffer = this.wrapPcm16InWavContainer(rawBytes, 24000);
          return await this.decodeBinaryAudioBuffer(wavBuffer);
        } catch (_) {}
      }

      return null;
    }

    // Завантажує чистий український нейроголос у бінарний ArrayBuffer та декодує через AudioContext.decodeAudioData()
    async fetchKeylessCloudNeuralTTS(text) {
      const clean = String(text || '').slice(0, 260);
      const encodedText = encodeURIComponent(clean);
      const targetGoogleUrl = `https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx&tl=uk&q=${encodedText}`;

      const corsTunnels = [
        `https://corsproxy.io/?${encodeURIComponent(targetGoogleUrl)}`,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(targetGoogleUrl)}`
      ];

      for (let i = 0; i < corsTunnels.length; i++) {
        try {
          const res = await fetch(corsTunnels[i]);
          if (!res.ok) continue;
          const arrayBuf = await res.arrayBuffer();
          if (arrayBuf && arrayBuf.byteLength > 256) {
            return await this.decodeBinaryAudioBuffer(arrayBuf);
          }
        } catch (_) {}
      }

      return null;
    }

    async decodeBinaryAudioBuffer(arrayBuffer) {
      const ctx = this.ensureAudioPipeline();
      return await ctx.decodeAudioData(arrayBuffer.slice(0));
    }

    async playAudioBufferThroughDSP(audioBuffer, playbackRate = 1.0) {
      if (!audioBuffer) return;
      const ctx = this.ensureAudioPipeline();

      this.playCyberneticTelemetryCue('tx_start');

      if (window.AetherRafaelBridge && typeof window.AetherRafaelBridge.injectTtsAudio === 'function') {
        this.renderOfflineDspBuffer(audioBuffer).then((filteredSamples) => {
          if (filteredSamples && window.AetherRafaelBridge.isActive?.()) {
            window.AetherRafaelBridge.injectTtsAudio(filteredSamples, audioBuffer.sampleRate);
          }
        }).catch(() => {});
      }

      await new Promise((resolve) => {
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.playbackRate.value = playbackRate;
        source.connect(this.hpfNode);

        this.activeSourceNode = source;
        source.onended = () => {
          if (this.activeSourceNode === source) {
            this.activeSourceNode = null;
          }
          resolve();
        };

        source.start(ctx.currentTime + 0.04);
      });
    }

    async renderOfflineDspBuffer(sourceBuffer) {
      const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!OfflineCtx) return sourceBuffer.getChannelData(0);

      const offline = new OfflineCtx(1, sourceBuffer.length, sourceBuffer.sampleRate);
      const src = offline.createBufferSource();
      src.buffer = sourceBuffer;

      const hpf = offline.createBiquadFilter();
      hpf.type = 'highpass';
      hpf.frequency.value = DSP_CONFIG.HIGHPASS_HZ;

      const lpf = offline.createBiquadFilter();
      lpf.type = 'lowpass';
      lpf.frequency.value = DSP_CONFIG.LOWPASS_HZ;

      const presence = offline.createBiquadFilter();
      presence.type = 'peaking';
      presence.frequency.value = DSP_CONFIG.PRESENCE_HZ;
      presence.Q.value = DSP_CONFIG.PRESENCE_Q;
      presence.gain.value = DSP_CONFIG.PRESENCE_GAIN_DB;

      src.connect(hpf);
      hpf.connect(lpf);
      lpf.connect(presence);
      presence.connect(offline.destination);

      src.start(0);
      const rendered = await offline.startRendering();
      return rendered.getChannelData(0);
    }

    // Чиста кібернетична телеметрія бортового комп'ютера (без жодного виклику кривого speechSynthesis!)
    async playPureCyberneticDataTelemetry(text) {
      const ctx = this.ensureAudioPipeline();
      this.playCyberneticTelemetryCue('tx_start');

      const words = text.split(/\s+/).filter(Boolean);
      const totalDurationSec = Math.min(2.8, Math.max(0.9, words.length * 0.14));
      const sr = ctx.sampleRate;
      const frameCount = Math.floor(sr * totalDurationSec);
      const synthBuf = ctx.createBuffer(1, frameCount, sr);
      const data = synthBuf.getChannelData(0);

      const chord = [523.25, 659.25, 783.99, 987.77, 1174.66];
      for (let i = 0; i < frameCount; i++) {
        const t = i / sr;
        const step = Math.floor(t * 14);
        const f = chord[step % chord.length];
        const env = Math.exp(-((t * 14) % 1) * 4.5) * 0.12;
        data[i] = Math.sin(2 * Math.PI * f * t) * env;
      }

      await new Promise((resolve) => {
        const src = ctx.createBufferSource();
        src.buffer = synthBuf;
        src.connect(this.hpfNode);
        this.activeSourceNode = src;
        src.onended = () => {
          this.activeSourceNode = null;
          resolve();
        };
        src.start();
      });
    }

    stopCurrentPlayback() {
      if (this.activeSourceNode) {
        try {
          this.activeSourceNode.stop();
          this.activeSourceNode.disconnect();
        } catch (_) {}
        this.activeSourceNode = null;
      }
      if (this.activeHtmlAudio) {
        try {
          this.activeHtmlAudio.pause();
          this.activeHtmlAudio = null;
        } catch (_) {}
      }
    }

    playCyberneticTelemetryCue(type = 'ptt_open') {
      const ctx = this.ensureAudioPipeline();
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(this.hpfNode);

      if (type === 'ptt_open') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(540, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.075);
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.14, now + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
        osc.start(now);
        osc.stop(now + 0.095);
      } else if (type === 'ptt_close') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(780, now);
        osc.frequency.exponentialRampToValueAtTime(460, now + 0.08);
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.12, now + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
        osc.start(now);
        osc.stop(now + 0.095);
      } else if (type === 'override') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(320, now);
        osc.frequency.linearRampToValueAtTime(1420, now + 0.16);
        osc.frequency.exponentialRampToValueAtTime(640, now + 0.34);
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.22, now + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.36);
        osc.start(now);
        osc.stop(now + 0.38);
      } else {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(960, now);
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.10, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
        osc.start(now);
        osc.stop(now + 0.065);
      }
    }

    wrapPcm16InWavContainer(pcmBytes, sampleRate = 24000) {
      const numChannels = 1;
      const bitsPerSample = 16;
      const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
      const blockAlign = (numChannels * bitsPerSample) / 8;
      const dataSize = pcmBytes.byteLength;

      const buffer = new ArrayBuffer(44 + dataSize);
      const view = new DataView(buffer);

      const writeStr = (offset, str) => {
        for (let i = 0; i < str.length; i++) {
          view.setUint8(offset + i, str.charCodeAt(i));
        }
      };

      writeStr(0, 'RIFF');
      view.setUint32(4, 36 + dataSize, true);
      writeStr(8, 'WAVE');
      writeStr(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, numChannels, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, byteRate, true);
      view.setUint16(32, blockAlign, true);
      view.setUint16(34, bitsPerSample, true);
      writeStr(36, 'data');
      view.setUint32(40, dataSize, true);

      new Uint8Array(buffer, 44).set(pcmBytes);
      return buffer;
    }

    base64ToUint8Array(base64) {
      const binary = atob(base64);
      const len = binary.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    }

    blobToBase64(blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const res = String(reader.result || '');
          const commaIdx = res.indexOf(',');
          resolve(commaIdx >= 0 ? res.slice(commaIdx + 1) : res);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }

    getApiKey() {
      if (window.RaphaelModules.brain && typeof window.RaphaelModules.brain.getApiKey === 'function') {
        return window.RaphaelModules.brain.getApiKey();
      }
      return '';
    }

    bindTestBenchPTTIfPresent() {
      const pttBtn = document.getElementById('btn-ptt-raphael');
      if (!pttBtn || pttBtn.dataset.raphaelVoiceHooked) return;
      pttBtn.dataset.raphaelVoiceHooked = 'true';

      const cleanBtn = pttBtn.cloneNode(true);
      pttBtn.parentNode?.replaceChild(cleanBtn, pttBtn);

      const startHold = (e) => {
        if (e.type === 'touchstart') e.preventDefault();
        if (!this.core) return;
        const callsign = document.getElementById('ctx-callsign')?.value?.trim() || 'Сокіл';
        const started = this.core.startListeningSession(callsign);
        if (started) {
          cleanBtn.classList.add('recording');
          const span = cleanBtn.querySelector('span');
          if (span) span.textContent = '🎙️ КАНАЛ ВІДКРИТО: ГОВОРІТЬ У МІКРОФОН (ВІДПУСТІТЬ ДЛЯ ПЕРЕДАЧІ)...';
        }
      };

      const endHold = () => {
        if (!this.isRecordingPTT) return;
        cleanBtn.classList.remove('recording');
        const span = cleanBtn.querySelector('span');
        if (span) span.textContent = "📡 УТРИМУЙТЕ: ЗВ'ЯЗОК З РАФАЇЛОМ (ГОЛОСОВИЙ ЗАПИТ / ПРОБІЛ)";
        if (this.core) {
          this.core.stopListeningSession();
        } else {
          this.stopPTTCapture();
        }
      };

      cleanBtn.addEventListener('mousedown', startHold);
      window.addEventListener('mouseup', endHold);
      cleanBtn.addEventListener('touchstart', startHold, { passive: false });
      window.addEventListener('touchend', endHold);
    }
  }

  const voiceInstance = new RaphaelVoice();
  window.RaphaelVoice = voiceInstance;
  window.RaphaelModules.register('voice', voiceInstance);
})(window);