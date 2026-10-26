/**
 * ============================================================================
 * RAPHAEL VOICE GATEWAY (raphael_voice.js) - ФАЗА 4: АУДІО-ПАЙПЛАЙН ТА DSP
 * Проєкт: НРІ «Ентропія» (Ковчег Вавилонії) | Система «Вітрувій»
 * ----------------------------------------------------------------------------
 * Функціонал модуля:
 *   1. Вхід (STT / Push-to-Talk):
 *      - Захоплення мікрофона активного гравця під час утримання кнопки PTT.
 *      - Пакетування фрагмента (WebM/WAV) + розпізнавання через Gemini Audio STT
 *        та паралельний Web Speech API.
 *   2. Вихід (Neural TTS + Web Audio API):
 *      - Отримання бінарного аудіобуфера (Gemini 2.5 TTS / зовнішній TTS API).
 *      - Розпаковка через AudioContext.decodeAudioData() та PCM16 24kHz декодер.
 *   3. Кібернетичний DSP-тракт бортового термінала:
 *      - Смугова фільтрація Bandpass (300 Hz – 4.5 kHz) + тактильний резонанс
 *        1.85 kHz + легка сатурація радіоканалу.
 *   4. Інтеграція з «Етером» та Квантовою Сферою:
 *      - Пряма прив'язка AnalyserNode до raphael_canvas.js (60 FPS пульсація).
 *      - Вивід у віртуальний вузол MediaStreamDestination та AetherRafaelBridge.
 * ============================================================================
 */

(function (window) {
  'use strict';

  const STORAGE_KEYS = Object.freeze({
    API_KEY: 'entropia_raphael_gemini_key',
    TTS_VOICE_NAME: 'entropia_raphael_tts_voice'
  });

  // Параметри кібернетичного DSP-тракту бортового термінала (300 Hz – 4.5 kHz)
  const DSP_CONFIG = Object.freeze({
    HIGHPASS_HZ: 300,
    LOWPASS_HZ: 4500,
    PRESENCE_HZ: 1850,
    PRESENCE_GAIN_DB: 2.8,
    PRESENCE_Q: 1.45,
    SATURATION_AMOUNT: 12
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

      // Вузли Web Audio DSP графа
      this.hpfNode = null;
      this.lpfNode = null;
      this.presenceNode = null;
      this.shaperNode = null;
      this.masterGainNode = null;
      this.analyserNode = null;
      this.aetherStreamDest = null; // MediaStreamDestination для P2P-каналів aether.html

      // Стан Push-to-Talk (STT)
      this.isRecordingPTT = false;
      this.pttMicStream = null;
      this.mediaRecorder = null;
      this.recordedChunks = [];
      this.speechRecognizer = null;
      this.interimTranscript = '';
      this.finalTranscript = '';

      // Стан відтворення (TTS)
      this.activeSourceNode = null;
      this.ttsVoiceName = options.voiceName || 'Charon'; // Тактичний низький голос Gemini TTS
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

      // При сюжетному зламі AETHER_SYSTEM_OVERRIDE відтворюємо акустичний імпульс розблокування
      this.core.on('overrideGlitch', () => {
        this.playCyberneticTelemetryCue('override');
      });
    }

    // =========================================================================
    // 1. ІНІЦІАЛІЗАЦІЯ WEB AUDIO API ТА DSP-ТРАКТУ (300 Hz – 4.5 kHz)
    // =========================================================================
    ensureAudioPipeline() {
      if (!this.audioCtx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        this.audioCtx = new AudioCtx({ sampleRate: 24000 });

        // 1. Нижній зріз смугового фільтра (Highpass 300 Hz)
        this.hpfNode = this.audioCtx.createBiquadFilter();
        this.hpfNode.type = 'highpass';
        this.hpfNode.frequency.value = DSP_CONFIG.HIGHPASS_HZ;
        this.hpfNode.Q.value = 0.707;

        // 2. Верхній зріз смугового фільтра (Lowpass 4.5 kHz)
        this.lpfNode = this.audioCtx.createBiquadFilter();
        this.lpfNode.type = 'lowpass';
        this.lpfNode.frequency.value = DSP_CONFIG.LOWPASS_HZ;
        this.lpfNode.Q.value = 0.707;

        // 3. Тактильний резонанс розбірливості бортового термінала (1.85 kHz)
        this.presenceNode = this.audioCtx.createBiquadFilter();
        this.presenceNode.type = 'peaking';
        this.presenceNode.frequency.value = DSP_CONFIG.PRESENCE_HZ;
        this.presenceNode.Q.value = DSP_CONFIG.PRESENCE_Q;
        this.presenceNode.gain.value = DSP_CONFIG.PRESENCE_GAIN_DB;

        // 4. Легка сатурація для кібернетичного забарвлення
        this.shaperNode = this.audioCtx.createWaveShaper();
        this.shaperNode.curve = this.buildTerminalSaturationCurve(DSP_CONFIG.SATURATION_AMOUNT);
        this.shaperNode.oversample = '2x';

        // 5. Вихідний підсилювач та AnalyserNode для 60 FPS Квантової Сфери
        this.masterGainNode = this.audioCtx.createGain();
        this.masterGainNode.gain.value = 1.05;

        this.analyserNode = this.audioCtx.createAnalyser();
        this.analyserNode.fftSize = 128;
        this.analyserNode.smoothingTimeConstant = 0.72;

        // 6. Віртуальний аудіовузол MediaStreamDestination для трансляції в WebRTC (aether.html)
        if (typeof this.audioCtx.createMediaStreamDestination === 'function') {
          this.aetherStreamDest = this.audioCtx.createMediaStreamDestination();
        }

        // З'єднуємо послідовний DSP-ланцюг:
        // [Source] -> HPF (300Hz) -> LPF (4.5kHz) -> Presence (1.85kHz) -> Shaper -> MasterGain -> Analyser
        this.hpfNode.connect(this.lpfNode);
        this.lpfNode.connect(this.presenceNode);
        this.presenceNode.connect(this.shaperNode);
        this.shaperNode.connect(this.masterGainNode);
        this.masterGainNode.connect(this.analyserNode);

        // Вихід на локальні динаміки та віртуальний потік Етеру
        this.analyserNode.connect(this.audioCtx.destination);
        if (this.aetherStreamDest) {
          this.analyserNode.connect(this.aetherStreamDest);
        }

        // Прив'язуємо AnalyserNode до візуалізатора Квантової Сфери (raphael_canvas.js)
        if (window.RaphaelModules.canvas && typeof window.RaphaelModules.canvas.bindAnalyser === 'function') {
          window.RaphaelModules.canvas.bindAnalyser(this.analyserNode);
        }
      }

      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }

      return this.audioCtx;
    }

    buildTerminalSaturationCurve(amount = 12) {
      const samples = 2048;
      const curve = new Float32Array(samples);
      const deg = Math.PI / 180;
      for (let i = 0; i < samples; i++) {
        const x = (i * 2) / samples - 1;
        curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
      }
      return curve;
    }

    // Повертає MediaStream віртуального вузла для прямого підключення у P2P-кімнату aether.html
    getVirtualMediaStream() {
      this.ensureAudioPipeline();
      return this.aetherStreamDest ? this.aetherStreamDest.stream : null;
    }

    // =========================================================================
    // 2. ВХІД (STT): ПЕРЕХОПЛЕННЯ МІКРОФОНА ЗА PTT ТА ПАКЕТУВАННЯ АУДІО
    // =========================================================================
    async startPTTCapture() {
      if (this.isRecordingPTT) return true;
      this.ensureAudioPipeline();

      this.isRecordingPTT = true;
      this.recordedChunks = [];
      this.interimTranscript = '';
      this.finalTranscript = '';

      this.playCyberneticTelemetryCue('ptt_open');

      // Якщо ми в aether.html — тимчасово приглушуємо інші вхідні канали на час запису наказу
      this.setAetherRoomChannelsDucking(true);

      // 1. Запускаємо паралельний Web Speech API для миттєвого транскрибування
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

      // 2. Захоплюємо аудіопотік мікрофона та пакуємо у WebM/Opus для мультимодального STT
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
          // Якщо в Етері вже відкрито мікрофонний потік — використовуємо його, щоб не перезапитувати дозвіл
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
        } catch (err) {
          console.warn('[RaphaelVoice] Мікрофон недоступний для MediaRecorder:', err);
        }
      }

      return true;
    }

    async stopPTTCapture() {
      if (!this.isRecordingPTT) return null;
      this.isRecordingPTT = false;

      this.playCyberneticTelemetryCue('ptt_close');
      this.setAetherRoomChannelsDucking(false);

      // Зупиняємо Web Speech API
      if (this.speechRecognizer) {
        try { this.speechRecognizer.stop(); } catch (_) {}
        this.speechRecognizer = null;
      }

      // Збираємо бінарний аудіофрагмент із MediaRecorder
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

      // Даємо 180 мс, щоб фінальний колбек Web Speech API встиг записати останні слова
      await new Promise((r) => setTimeout(r, 180));

      let recognizedText = (this.finalTranscript || this.interimTranscript || '').trim();

      // Якщо Web Speech API не дав тексту (наприклад, у Firefox), але є записаний аудіофрагмент і API-ключ —
      // розпізнаємо голос через Gemini Multimodal Audio STT!
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

        const endpoint =
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.sttModelName)}:generateContent?key=${encodeURIComponent(apiKey)}`;

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text: 'Розпізнай українське голосове звернення до бортового ШІ «Рафаїль». Поверни ТІЛЬКИ точний текст сказаного без жодних коментарів.'
                  },
                  {
                    inlineData: {
                      mimeType,
                      data: base64Audio
                    }
                  }
                ]
              }
            ],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 80
            }
          })
        });

        if (!res.ok) return '';
        const data = await res.json();
        return (data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
      } catch (err) {
        console.warn('[RaphaelVoice] Помилка Gemini Audio STT:', err);
        return '';
      }
    }

    setAetherRoomChannelsDucking(duckActive) {
      const aetherEngine = window.AetherOptimizers?.activeEngine;
      if (!aetherEngine || !aetherEngine.audio || !aetherEngine.audio.masterGain) return;
      const ctx = aetherEngine.audio.ctx;
      if (!ctx) return;

      const targetGain = duckActive ? 0.18 : 1.0;
      try {
        aetherEngine.audio.masterGain.gain.setTargetAtTime(targetGain, ctx.currentTime, 0.05);
      } catch (_) {}
    }

    // =========================================================================
    // 3. ВИХІД (TTS): НЕЙРОСИНТЕЗ, DECODEAUDIODATA ТА ТРАНСЛЯЦІЯ В «ЕТЕР»
    // =========================================================================
    async speak(text) {
      const cleanText = String(text || '').trim();
      if (!cleanText) return false;

      this.ensureAudioPipeline();
      this.stopCurrentPlayback();

      if (this.core && this.core.getState() !== 'SPEAKING') {
        this.core.setState('SPEAKING');
      }

      // 1. Перевіряємо, чи є фраза у миттєвому кеші raphael_optimizer.js (0 мс затримки)
      const cachedBuffer = window.RaphaelModules.optimizer?.getCachedAudioBuffer?.(cleanText);
      if (cachedBuffer) {
        await this.playAudioBufferThroughDSP(cachedBuffer);
        return true;
      }

      // 2. Якщо налаштовано ключ Gemini API — генеруємо чистий нейромережевий голос (Gemini Audio TTS)
      const apiKey = this.getApiKey();
      if (apiKey) {
        try {
          const neuralAudioBuffer = await this. requestGeminiNeuralTTS(cleanText, apiKey);
          if (neuralAudioBuffer) {
            window.RaphaelModules.optimizer?.cacheAudioBuffer?.(cleanText, neuralAudioBuffer);
            await this.playAudioBufferThroughDSP(neuralAudioBuffer);
            return true;
          }
        } catch (err) {
          console.warn('[RaphaelVoice] Перехід з Neural TTS на резервний вокалізатор:', err);
        }
      }

      // 3. Якщо API-ключ ще не введено — відтворюємо тактичну кібернетичну телеметрію через Web Audio DSP
      await this.playCyberneticArticulatedFallback(cleanText);
      return true;
    }

    // Запит бінарного звукового буфера від нейромережевого генератора Gemini TTS
    async requestGeminiNeuralTTS(text, apiKey) {
      const endpoint =
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.ttsModelName)}:generateContent?key=${encodeURIComponent(apiKey)}`;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `Прочитай спокійним, чітким тактичним голосом бортового ШІ українською мовою: ${text}`
                }
              ]
            }
          ],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: this.ttsVoiceName
                }
              }
            }
          }
        })
      });

      if (!response.ok) {
        throw new Error(`TTS HTTP ${response.status}`);
      }

      const data = await response.json();
      const inlineData = data?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
      if (!inlineData || !inlineData.data) return null;

      const mimeType = (inlineData.mimeType || '').toLowerCase();
      const rawBytes = this.base64ToUint8Array(inlineData.data);

      // Якщо сервер повернув стандартний аудіоконтейнер (WAV / MP3 / OGG / WebM) —
      // розпаковуємо через штатний AudioContext.decodeAudioData() згідно з ТЗ
      if (
        mimeType.includes('wav') ||
        mimeType.includes('mp3') ||
        mimeType.includes('mpeg') ||
        mimeType.includes('ogg') ||
        mimeType.includes('webm')
      ) {
        return await this.decodeBinaryAudioBuffer(rawBytes.buffer);
      }

      // Якщо Gemini повернув сирий студійний потік PCM16 24kHz (audio/L16;rate=24000) —
      // огортаємо його у WAV-заголовок і декодуємо через AudioContext.decodeAudioData()
      const wavBuffer = this.wrapPcm16InWavContainer(rawBytes, 24000);
      return await this.decodeBinaryAudioBuffer(wavBuffer);
    }

    // Публічний метод для розпаковки будь-якого бінарного буфера (ElevenLabs / Edge-TTS / OpenAI)
    async decodeBinaryAudioBuffer(arrayBuffer) {
      const ctx = this.ensureAudioPipeline();
      return await ctx.decodeAudioData(arrayBuffer.slice(0));
    }

    // Пропускає розпакований AudioBuffer через DSP-фільтр (300 Hz – 4.5 kHz),
    // розгойдує Квантову Сферу та транслює в P2P/Relay канали «Етеру»
    async playAudioBufferThroughDSP(audioBuffer) {
      if (!audioBuffer) return;
      const ctx = this.ensureAudioPipeline();

      // 1. Попередній тактильний біп відкриття радіоканалу
      this.playCyberneticTelemetryCue('tx_start');

      // 2. Рендеримо копію буфера через OfflineAudioContext з тим самим Bandpass (300 Hz – 4.5 kHz),
      // щоб передати вже відфільтрований кібернетичний голос усім гравцям у кімнаті «Етеру»!
      if (window.AetherRafaelBridge && typeof window.AetherRafaelBridge.injectTtsAudio === 'function') {
        this.renderOfflineDspBuffer(audioBuffer).then((filteredSamples) => {
          if (filteredSamples && window.AetherRafaelBridge.isActive?.()) {
            window.AetherRafaelBridge.injectTtsAudio(filteredSamples, audioBuffer.sampleRate);
          }
        }).catch(() => {});
      }

      // 3. Відтворюємо через живий граф: Source -> HPF(300Hz) -> LPF(4.5kHz) -> Presence -> Shaper -> AnalyserNode
      await new Promise((resolve) => {
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.hpfNode);

        this.activeSourceNode = source;
        source.onended = () => {
          if (this.activeSourceNode === source) {
            this.activeSourceNode = null;
          }
          resolve();
        };

        source.start(ctx.currentTime + 0.05);
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

    // Резервний вокалізатор бортового термінала (коли Gemini API ключ ще не введено на стенді):
    // Генерує реальну звукову хвилю через Bandpass (300Hz–4.5kHz) + AnalyserNode синхронно зі складами тексту
    async playCyberneticArticulatedFallback(text) {
      const ctx = this.ensureAudioPipeline();
      this.playCyberneticTelemetryCue('tx_start');

      // Синтезуємо модульований голосовий підклад через наш DSP-тракт, щоб AnalyserNode отримував реальний спектр
      const words = text.split(/\s+/).filter(Boolean);
      const totalDurationSec = Math.min(5.0, Math.max(1.2, words.length * 0.26));
      const sr = ctx.sampleRate;
      const frameCount = Math.floor(sr * totalDurationSec);
      const synthBuf = ctx.createBuffer(1, frameCount, sr);
      const data = synthBuf.getChannelData(0);

      for (let i = 0; i < frameCount; i++) {
        const t = i / sr;
        // Складова огинаюча (7.5 Гц — ритм складів української мови)
        const syllableEnv = Math.max(0, Math.sin(2 * Math.PI * 6.8 * t) * 0.65 + Math.sin(2 * Math.PI * 2.7 * t) * 0.35);
        // Формантні частоти у смузі 300 Hz – 4.5 kHz
        const f1 = Math.sin(2 * Math.PI * (145 + Math.sin(t * 9) * 18) * t);
        const f2 = Math.sin(2 * Math.PI * (880 + Math.cos(t * 14) * 120) * t) * 0.45;
        const f3 = Math.sin(2 * Math.PI * 2150 * t) * 0.18;
        data[i] = (f1 + f2 + f3) * syllableEnv * 0.045;
      }

      const carrierSource = ctx.createBufferSource();
      carrierSource.buffer = synthBuf;
      carrierSource.connect(this.hpfNode);
      this.activeSourceNode = carrierSource;
      carrierSource.start();

      if ('speechSynthesis' in window) {
        await new Promise((resolve) => {
          try {
            window.speechSynthesis.cancel();
            const utter = new SpeechSynthesisUtterance(text);
            utter.lang = 'uk-UA';
            utter.rate = 0.98;
            utter.pitch = 0.92;
            utter.onend = resolve;
            utter.onerror = resolve;
            window.speechSynthesis.speak(utter);
          } catch (_) {
            setTimeout(resolve, totalDurationSec * 1000);
          }
        });
      } else {
        await new Promise((r) => setTimeout(r, totalDurationSec * 1000));
      }

      try { carrierSource.stop(); } catch (_) {}
      this.activeSourceNode = null;
    }

    stopCurrentPlayback() {
      if (this.activeSourceNode) {
        try {
          this.activeSourceNode.stop();
          this.activeSourceNode.disconnect();
        } catch (_) {}
        this.activeSourceNode = null;
      }
      if ('speechSynthesis' in window) {
        try { window.speechSynthesis.cancel(); } catch (_) {}
      }
    }

    // =========================================================================
    // 4. АКУСТИЧНІ СИГНАЛИ ТЕРМІНАЛА ТА УТИЛІТИ КОНВЕРТАЦІЇ
    // =========================================================================
    playCyberneticTelemetryCue(type = 'ptt_open') {
      const ctx = this.ensureAudioPipeline();
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(this.hpfNode); // Проходить через той самий Bandpass 300Hz–4.5kHz

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
      view.setUint16(20, 1, true); // PCM format
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
      try {
        return (localStorage.getItem(STORAGE_KEYS.API_KEY) || '').trim();
      } catch (_) {
        return '';
      }
    }

    // =========================================================================
    // 5. АВТО-ПРИВ'ЯЗКА ДО КНОПКИ PUSH-TO-TALK НА ТЕСТОВОМУ СТЕНДІ
    // =========================================================================
    bindTestBenchPTTIfPresent() {
      const pttBtn = document.getElementById('btn-ptt-raphael');
      if (!pttBtn || pttBtn.dataset.raphaelVoiceHooked) return;
      pttBtn.dataset.raphaelVoiceHooked = 'true';

      // Замінюємо кнопку чистим клоном, щоб перевести її на реальний пайплайн Фази 4
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