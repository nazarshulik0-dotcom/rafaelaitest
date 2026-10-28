/**
 * ============================================================================
 * RAPHAEL VOICE GATEWAY (raphael_voice.js) - v2.2 MIC FIX & FEMALE NEUTRAL AI
 * Проєкт: НРІ «Ентропія» (Ковчег Вавилонії) | Система «Вітрувій»
 * ----------------------------------------------------------------------------
 * Виправлення мікрофона у v2.2:
 *   1. Усунено апаратний конфлікт між SpeechRecognition та getUserMedia.
 *   2. Додано гібридний режим PTT: працює і при УТРИМАННІ (Hold), і при
 *      ОДИНОЧНОМУ КЛІКУ (Click-to-Talk), і через клавішу ПРОБІЛ.
 *   3. Живий вивід розпізнаних слів прямо на кнопці під час говоріння.
 *   4. Коректне очікування події onend (слова більше не губляться при відпусканні).
 *   5. Збережено нейтральний жіночий голос Рафаїла (240 Hz – 5.8 kHz, 1.03x).
 * ============================================================================
 */

(function (window) {
  'use strict';

  const DSP_CONFIG = Object.freeze({
    HIGHPASS_HZ: 240,
    LOWPASS_HZ: 5800,
    PRESENCE_HZ: 2400,
    PRESENCE_GAIN_DB: 2.2,
    PRESENCE_Q: 1.25,
    SATURATION_AMOUNT: 5
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

      // Стан мікрофона та розпізнавання мовлення (STT)
      this.isRecordingPTT = false;
      this.recordStartTime = 0;
      this.pttMicStream = null;
      this.mediaRecorder = null;
      this.recordedChunks = [];
      this.speechRecognizer = null;
      this.recognizerEndPromiseResolve = null;
      this.interimTranscript = '';
      this.finalTranscript = '';
      this.autoSubmitSilenceTimer = null;

      // Стан синтезу мовлення (TTS)
      this.activeSourceNode = null;
      this.ttsVoiceName = options.voiceName || 'Aoede';
      this.ttsModelName = options.ttsModel || 'gemini-2.5-flash-preview-tts';
      this.sttModelName = options.sttModel || 'gemini-3.8-flash';

      this.mountWhenReady();
    }

    getCore() {
      if (!this.core && window.RaphaelCore) {
        this.attachCore(window.RaphaelCore);
      }
      return this.core || window.RaphaelCore || window.RaphaelModules?.core || null;
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
        setTimeout(init, 50);
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
    // 1. WEB AUDIO DSP-ТРАКТ ПІД ЖІНОЧИЙ НЕЙТРАЛЬНИЙ ГОЛОС (240 Hz – 5.8 kHz)
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
        this.masterGainNode.gain.value = 1.12;

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

    buildTerminalSaturationCurve(amount = 5) {
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
    // 2. ВХІД (STT): НАДІЙНИЙ ЗАХВАТ МІКРОФОНА БЕЗ КОНФЛІКТУ ПОТОКІВ
    // =========================================================================
    updatePttButtonUI(isRecording, statusText = null) {
      const btn = document.getElementById('btn-ptt-raphael');
      if (!btn) return;
      btn.classList.toggle('recording', !!isRecording);
      const span = btn.querySelector('span') || btn;
      if (statusText) {
        span.textContent = statusText;
      } else if (isRecording) {
        span.textContent = '🎙️ СЛУХАЮ ВАС... ГОВОРІТЬ (НАТИСНІТЬ АБО ВІДПУСТІТЬ ДЛЯ ВІДПРАВКИ)';
      } else {
        span.textContent = "📡 ЗВ'ЯЗОК З РАФАЇЛОМ (КЛІК АБО УТРИМАННЯ / ПРОБІЛ)";
      }
    }

    async startPTTCapture() {
      if (this.isRecordingPTT) return true;
      this.ensureAudioPipeline();

      this.isRecordingPTT = true;
      this.recordStartTime = performance.now();
      this.recordedChunks = [];
      this.interimTranscript = '';
      this.finalTranscript = '';

      if (this.autoSubmitSilenceTimer) {
        clearTimeout(this.autoSubmitSilenceTimer);
        this.autoSubmitSilenceTimer = null;
      }

      this.playCyberneticTelemetryCue('ptt_open');
      this.setAetherRoomChannelsDucking(true);
      this.updatePttButtonUI(true);

      const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

      // РЕЖИМ А: Браузер підтримує нативний Web Speech API (Chrome, Edge, Safari, Android)
      // НЕ запускаємо getUserMedia одночасно, щоб не блокувати мікрофон!
      if (SpeechRec) {
        try {
          const rec = new SpeechRec();
          rec.lang = 'uk-UA';
          rec.continuous = true;
          rec.interimResults = true;
          rec.maxAlternatives = 1;

          const endPromise = new Promise((resolve) => {
            this.recognizerEndPromiseResolve = resolve;
          });
          this._currentRecEndPromise = endPromise;

          rec.onresult = (event) => {
            let interim = '';
            let finalChunk = '';

            for (let i = event.resultIndex; i < event.results.length; i++) {
              const res = event.results[i];
              const txt = (res[0]?.transcript || '').trim();
              if (!txt) continue;
              if (res.isFinal) {
                finalChunk += ' ' + txt;
              } else {
                interim += ' ' + txt;
              }
            }

            if (finalChunk) {
              this.finalTranscript = (this.finalTranscript + ' ' + finalChunk).trim();
            }
            this.interimTranscript = interim.trim();

            const livePreview = (this.finalTranscript + ' ' + this.interimTranscript).trim();
            if (livePreview && this.isRecordingPTT) {
              this.updatePttButtonUI(true, `🎙️ ЧУЮ: «${livePreview.slice(-55)}»`);

              // Якщо користувач просто клікнув кнопку (Click-to-Talk) і зробив паузу 1.6 с після фрази —
              // автоматично завершуємо запис і відправляємо запит!
              if (this.autoSubmitSilenceTimer) clearTimeout(this.autoSubmitSilenceTimer);
              this.autoSubmitSilenceTimer = setTimeout(() => {
                if (this.isRecordingPTT && !this._isHoldingKeyOrMouse) {
                  const core = this.getCore();
                  if (core) core.stopListeningSession();
                  else this.stopPTTCapture();
                }
              }, 1650);
            }
          };

          rec.onerror = (err) => {
            const errCode = err?.error || '';
            if (errCode === 'not-allowed' || errCode === 'service-not-allowed') {
              const core = this.getCore();
              core?.emit('logMessage', {
                author: 'МІКРОФОН [БЛОКОВАНО]',
                text: 'Доступ до мікрофона заборонено браузером. Натисніть на значок замка/камери біля адресного рядка і дозвольте мікрофон.',
                type: 'error'
              });
            } else if (errCode === 'audio-capture') {
              const core = this.getCore();
              core?.emit('logMessage', {
                author: 'МІКРОФОН [ПОМИЛКА]',
                text: 'Мікрофон не знайдено або він зайнятий іншою програмою.',
                type: 'error'
              });
            }
          };

          rec.onend = () => {
            if (typeof this.recognizerEndPromiseResolve === 'function') {
              this.recognizerEndPromiseResolve();
              this.recognizerEndPromiseResolve = null;
            }
          };

          rec.start();
          this.speechRecognizer = rec;
          return true;
        } catch (err) {
          console.warn('[RaphaelVoice] Перехід зі SpeechRecognition на MediaRecorder:', err);
        }
      }

      // РЕЖИМ Б: Якщо браузер не має SpeechRecognition (наприклад, Firefox) —
      // записуємо звук через MediaRecorder і розпізнаємо через Gemini 3.8 Flash!
      return await this.startFallbackMediaRecorder();
    }

    async startFallbackMediaRecorder() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        const core = this.getCore();
        core?.emit('logMessage', {
          author: 'СИСТЕМА',
          text: 'Ваш браузер не підтримує захоплення мікрофона (потрібен HTTPS або localhost).',
          type: 'error'
        });
        return false;
      }

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
          this.mediaRecorder.start(100);
        }
        return true;
      } catch (err) {
        const core = this.getCore();
        core?.emit('logMessage', {
          author: 'МІКРОФОН',
          text: `Не вдалося відкрити мікрофон: ${err.message}`,
          type: 'error'
        });
        return false;
      }
    }

    async stopPTTCapture() {
      if (!this.isRecordingPTT) return null;
      this.isRecordingPTT = false;

      if (this.autoSubmitSilenceTimer) {
        clearTimeout(this.autoSubmitSilenceTimer);
        this.autoSubmitSilenceTimer = null;
      }

      this.playCyberneticTelemetryCue('ptt_close');
      this.setAetherRoomChannelsDucking(false);
      this.updatePttButtonUI(false, '⏳ ОБРОБКА ГОЛОСОВОГО СИГНАЛУ...');

      // 1. Якщо працював Web Speech API — зупиняємо і чекаємо його фінальний пакет (до 850 мс)
      if (this.speechRecognizer) {
        try {
          this.speechRecognizer.stop();
        } catch (_) {}

        if (this._currentRecEndPromise) {
          await Promise.race([
            this._currentRecEndPromise,
            new Promise((r) => setTimeout(r, 850))
          ]);
        }
        this.speechRecognizer = null;
      }

      // 2. Якщо працював MediaRecorder — збираємо аудіо-блоб
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

      this.updatePttButtonUI(false);

      let recognizedText = (this.finalTranscript || this.interimTranscript || '').trim();
      const core = this.getCore();
      const apiKey = this.getApiKey();

      // 3. Якщо використовувався MediaRecorder (наприклад, у Firefox) — розпізнаємо через Gemini 3.8 Flash
      if (!recognizedText && audioBlob && audioBlob.size > 512 && apiKey) {
        if (core) core.setState('THINKING');
        recognizedText = await this.transcribeAudioBlobWithGemini(audioBlob, apiKey);
      }

      if (recognizedText) {
        if (core) {
          await core.submitQuery(recognizedText);
        }
      } else {
        if (core) {
          core.setState('IDLE');
          core.emit('logMessage', {
            author: 'СИСТЕМА [МІКРОФОН]',
            text: 'Голосовий сигнал занадто тихий або не розпізнано жодного слова. Говоріть трохи голосніше після звукового сигналу.',
            type: 'error'
          });
        }
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
    // 3. ВИХІД (TTS): ЖІНОЧИЙ НЕЙТРАЛЬНИЙ ГОЛОС БОРТОВОГО ШІ
    // =========================================================================
    async speak(text) {
      const cleanText = String(text || '').trim();
      if (!cleanText) return false;

      this.ensureAudioPipeline();
      this.stopCurrentPlayback();

      const core = this.getCore();
      if (core && core.getState() !== 'SPEAKING') {
        core.setState('SPEAKING');
      }

      const cachedBuffer = window.RaphaelModules.optimizer?.getCachedAudioBuffer?.(cleanText);
      if (cachedBuffer) {
        await this.playAudioBufferThroughDSP(cachedBuffer, 1.03);
        return true;
      }

      try {
        const cloudFemaleBuffer = await this.fetchKeylessCloudNeuralTTS(cleanText);
        if (cloudFemaleBuffer) {
          window.RaphaelModules.optimizer?.cacheAudioBuffer?.(cleanText, cloudFemaleBuffer);
          await this.playAudioBufferThroughDSP(cloudFemaleBuffer, 1.03);
          return true;
        }
      } catch (_) {}

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
                    { text: `Прочитай спокійним, нейтральним жіночим голосом аналітичного ШІ українською мовою: ${text}` }
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

    async playAudioBufferThroughDSP(audioBuffer, playbackRate = 1.03) {
      if (!audioBuffer) return;
      const ctx = this.ensureAudioPipeline();

      this.playCyberneticTelemetryCue('tx_start');

      if (window.AetherRafaelBridge && typeof window.AetherRafaelBridge.injectTtsAudio === 'function') {
        this.renderOfflineDspBuffer(audioBuffer, playbackRate).then((filteredSamples) => {
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

    async renderOfflineDspBuffer(sourceBuffer, playbackRate = 1.03) {
      const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!OfflineCtx) return sourceBuffer.getChannelData(0);

      const outLength = Math.max(1, Math.floor(sourceBuffer.length / playbackRate));
      const offline = new OfflineCtx(1, outLength, sourceBuffer.sampleRate);
      const src = offline.createBufferSource();
      src.buffer = sourceBuffer;
      src.playbackRate.value = playbackRate;

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

    async playPureCyberneticDataTelemetry(text) {
      const ctx = this.ensureAudioPipeline();
      this.playCyberneticTelemetryCue('tx_start');

      const words = text.split(/\s+/).filter(Boolean);
      const totalDurationSec = Math.min(2.6, Math.max(0.9, words.length * 0.13));
      const sr = ctx.sampleRate;
      const frameCount = Math.floor(sr * totalDurationSec);
      const synthBuf = ctx.createBuffer(1, frameCount, sr);
      const data = synthBuf.getChannelData(0);

      const chord = [587.33, 783.99, 987.77, 1174.66, 1567.98];
      for (let i = 0; i < frameCount; i++) {
        const t = i / sr;
        const step = Math.floor(t * 15);
        const f = chord[step % chord.length];
        const env = Math.exp(-((t * 15) % 1) * 4.8) * 0.11;
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
    }

    playCyberneticTelemetryCue(type = 'ptt_open') {
      const ctx = this.ensureAudioPipeline();
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(this.hpfNode);

      if (type === 'ptt_open') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(660, now);
        osc.frequency.exponentialRampToValueAtTime(990, now + 0.07);
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.12, now + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.085);
        osc.start(now);
        osc.stop(now + 0.09);
      } else if (type === 'ptt_close') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(587.33, now + 0.075);
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.10, now + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.085);
        osc.start(now);
        osc.stop(now + 0.09);
      } else if (type === 'override') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.linearRampToValueAtTime(1760, now + 0.16);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.32);
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.18, now + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.34);
        osc.start(now);
        osc.stop(now + 0.36);
      } else {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1174.66, now);
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.08, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);
        osc.start(now);
        osc.stop(now + 0.06);
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

    // =========================================================================
    // 4. ГІБРИДНА ПРИВ'ЯЗКА PTT (ПРАЦЮЄ І КЛІКОМ, І УТРИМАННЯМ, І ПРОБІЛОМ)
    // =========================================================================
    bindTestBenchPTTIfPresent() {
      const pttBtn = document.getElementById('btn-ptt-raphael');
      if (!pttBtn || pttBtn.dataset.raphaelVoiceHookedV22) return;
      pttBtn.dataset.raphaelVoiceHookedV22 = 'true';

      const cleanBtn = pttBtn.cloneNode(true);
      pttBtn.parentNode?.replaceChild(cleanBtn, pttBtn);
      this.updatePttButtonUI(false);

      const triggerStart = () => {
        const core = this.getCore();
        const callsign = document.getElementById('ctx-callsign')?.value?.trim() || 'Сокіл';
        if (core) {
          core.startListeningSession(callsign);
        } else {
          this.startPTTCapture();
        }
      };

      const triggerStop = () => {
        const core = this.getCore();
        if (core) {
          core.stopListeningSession();
        } else {
          this.stopPTTCapture();
        }
      };

      cleanBtn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        // Якщо вже слухає (режим Click-to-Talk) — повторний клік завершує і відправляє!
        if (this.isRecordingPTT) {
          this._isHoldingKeyOrMouse = false;
          triggerStop();
          return;
        }
        this._isHoldingKeyOrMouse = true;
        triggerStart();
      });

      window.addEventListener('pointerup', () => {
        if (!this.isRecordingPTT || !this._isHoldingKeyOrMouse) return;
        this._isHoldingKeyOrMouse = false;
        const heldDurationMs = performance.now() - this.recordStartTime;
        // Якщо кнопку тримали довше 400 мс (режим Hold-to-Talk) — відправляємо при відпусканні.
        // Якщо це був швидкий клік (< 400 мс) — залишаємо мікрофон увімкненим у режимі Click-to-Talk!
        if (heldDurationMs > 400) {
          triggerStop();
        }
      });

      // Клавіша ПРОБІЛ для голосового виклику (поза полями вводу)
      if (!window._raphaelSpaceBoundV22) {
        window._raphaelSpaceBoundV22 = true;

        window.addEventListener('keydown', (e) => {
          const tag = (document.activeElement?.tagName || '').toLowerCase();
          if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
          if (e.code === 'Space' && !e.repeat && !this.isRecordingPTT) {
            e.preventDefault();
            this._isHoldingKeyOrMouse = true;
            triggerStart();
          }
        });

        window.addEventListener('keyup', (e) => {
          if (e.code === 'Space' && this.isRecordingPTT) {
            e.preventDefault();
            this._isHoldingKeyOrMouse = false;
            triggerStop();
          }
        });
      }
    }
  }

  const voiceInstance = new RaphaelVoice();
  window.RaphaelVoice = voiceInstance;
  window.RaphaelModules.register('voice', voiceInstance);
})(window);