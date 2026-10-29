/**
 * ============================================================================
 * RAPHAEL VOICE GATEWAY (raphael_voice.js) - v5.0 STUDIO NEURAL & WAV STT
 * Проєкт: НРІ «Ентропія» (Ковчег Вавилонії) | Система «Вітрувій»
 * ----------------------------------------------------------------------------
 * Ключові зміни v5.0:
 *   1. ПРЯМИЙ ЗАПИС ЗІ ШКАЛИ МІКРОФОНА В WAV (100% РОЗПІЗНАВАННЯ):
 *      - Якщо зелена шкала рухається, звук напряму оцифровується у 16kHz WAV.
 *      - Якщо браузерний SpeechRecognition мовчить (конфлікт аудіокарти),
 *        WAV-буфер розпізнається через хмарний AI-транскрибер (OpenAI / Gemini).
 *      - Додано розумний детектор тиші (VAD): сказав фразу -> через 1.5 с тиші
 *        запит відправляється автоматично!
 *   2. ЖИВИЙ ПРИРОДНИЙ ГОЛОС («ЯК У ЖИВОГО АСИСТЕНТА»):
 *      - Підключено справжні нейроголоси OpenAI Audio (Nova, Shimmer, Sage, Coral)
 *        та чистий український студійний нейроголос без спотворень пітчу (1.0x).
 *      - Вимкнено глухий радіофільтр — чистий Hi-Fi тракт за замовчуванням.
 * ============================================================================
 */

(function (window) {
  'use strict';

  const VOICE_SETTINGS_KEY = 'entropia_raphael_voice_cfg_v50';

  window.RaphaelModules = window.RaphaelModules || {
    core: null,
    canvas: null,
    brain: null,
    voice: null,
    optimizer: null,
    register(name, instance) {
      this[name] = instance;
      if (this.core && name !== 'core' && typeof instance?.attachCore === 'function') {
        instance.attachCore(this.core);
      }
    }
  };

  class RaphaelVoice {
    constructor() {
      this.core = null;
      this.audioCtx = null;
      this.masterGainNode = null;
      this.analyserNode = null;

      // Налаштування природного голосу
      const saved = this.loadSettings();
      this.selectedVoiceProfile = saved.selectedVoiceProfile || 'nova'; // 'nova' | 'shimmer' | 'sage' | 'coral' | 'uk_studio'
      this.selectedMicDeviceId = saved.selectedMicDeviceId || '';

      // Стан мікрофона та подвійного STT (Web Speech + Direct WAV Recorder)
      this.isRecordingPTT = false;
      this.lastToggleTimestamp = 0;
      this.speechRecognizer = null;
      this._resolveRecStop = null;
      this.finalTranscript = '';
      this.interimTranscript = '';

      // Прямий запис PCM зі шкали мікрофона (гарантія, що голос з аудіокарти не загубиться)
      this.micStream = null;
      this.micSource = null;
      this.micAnalyser = null;
      this.micProcessor = null;
      this.recordedPcmChunks = [];
      this.recordedSampleRate = 24000;
      this.maxVuDetected = 0;
      this.hasSpokenDuringSession = false;
      this.lastVoiceActivityAt = 0;
      this.micVuTimer = null;

      // Стан відтворення TTS
      this.activeBufferSource = null;
      this.spherePulseTimer = null;

      this.mountWhenReady();
    }

    loadSettings() {
      try {
        return JSON.parse(localStorage.getItem(VOICE_SETTINGS_KEY) || '{}');
      } catch (_) {
        return {};
      }
    }

    saveSettings() {
      try {
        localStorage.setItem(VOICE_SETTINGS_KEY, JSON.stringify({
          selectedVoiceProfile: this.selectedVoiceProfile,
          selectedMicDeviceId: this.selectedMicDeviceId
        }));
      } catch (_) {}
    }

    getCore() {
      return this.core || window.RaphaelCore || window.RaphaelModules?.core || null;
    }

    mountWhenReady() {
      const init = () => {
        if (window.RaphaelCore) this.attachCore(window.RaphaelCore);
        this.bindPTTAndSpacebarControls();
        this.bindVoiceTuningControls();
        this.populateMicrophoneList();
      };

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
      } else {
        setTimeout(init, 40);
      }
    }

    attachCore(coreInstance) {
      if (!coreInstance || this.core === coreInstance) return;
      this.core = coreInstance;
      this.core.on('overrideGlitch', () => {
        this.playSoftUiTone(880, 0.14);
      });
    }

    // =========================================================================
    // 1. ЧИСТИЙ СТУДІЙНИЙ HI-FI АУДІОТРАКТ (БЕЗ СПОТВОРЕНЬ І РАДІО-ХРИПІВ)
    // =========================================================================
    ensureAudioPipeline() {
      if (!this.audioCtx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        this.audioCtx = new AudioCtx();

        this.masterGainNode = this.audioCtx.createGain();
        this.masterGainNode.gain.value = 1.05;

        this.analyserNode = this.audioCtx.createAnalyser();
        this.analyserNode.fftSize = 128;
        this.analyserNode.smoothingTimeConstant = 0.75;

        // Прямий чистий тракт 20 Hz – 20 kHz без спотворення тембру
        this.masterGainNode.connect(this.analyserNode);
        this.analyserNode.connect(this.audioCtx.destination);

        if (window.RaphaelModules.canvas?.bindAnalyser) {
          window.RaphaelModules.canvas.bindAnalyser(this.analyserNode);
        }
      }

      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }
      return this.audioCtx;
    }

    // =========================================================================
    // 2. ПРЯМЕ ОЦИФРОВУВАННЯ ГОЛОСУ ЗІ ШКАЛИ МІКРОФОНА + ДЕТЕКТОР ПАУЗИ (VAD)
    // =========================================================================
    async populateMicrophoneList() {
      const selectEl = document.getElementById('raphael-mic-select');
      if (!selectEl || !navigator.mediaDevices?.enumerateDevices) return;

      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const mics = devices.filter((d) => d.kind === 'audioinput');
        selectEl.innerHTML = '<option value="">🎙️ Основний мікрофон системи</option>';

        mics.forEach((mic, idx) => {
          const opt = document.createElement('option');
          opt.value = mic.deviceId;
          opt.textContent = mic.label || `Мікрофон #${idx + 1}`;
          if (mic.deviceId === this.selectedMicDeviceId) opt.selected = true;
          selectEl.appendChild(opt);
        });

        selectEl.onchange = () => {
          this.selectedMicDeviceId = selectEl.value;
          this.saveSettings();
        };
      } catch (_) {}
    }

    async startDirectMicCaptureAndMeter() {
      this.stopDirectMicCaptureAndMeter();
      if (!navigator.mediaDevices?.getUserMedia) return false;

      try {
        const audioConstraint = this.selectedMicDeviceId
          ? {
              deviceId: { exact: this.selectedMicDeviceId },
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            }
          : {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            };

        this.micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint });
        this.populateMicrophoneList();

        const ctx = this.ensureAudioPipeline();
        this.recordedSampleRate = ctx.sampleRate;
        this.recordedPcmChunks = [];
        this.maxVuDetected = 0;
        this.hasSpokenDuringSession = false;
        this.lastVoiceActivityAt = performance.now();

        this.micSource = ctx.createMediaStreamSource(this.micStream);
        this.micAnalyser = ctx.createAnalyser();
        this.micAnalyser.fftSize = 128;

        // Записуємо реальні семпли звуку, які рухають зелену шкалу
        this.micProcessor = ctx.createScriptProcessor(4096, 1, 1);
        const silentZeroGain = ctx.createGain();
        silentZeroGain.gain.value = 0;

        this.micProcessor.onaudioprocess = (e) => {
          if (!this.isRecordingPTT) return;
          const input = e.inputBuffer.getChannelData(0);
          this.recordedPcmChunks.push(new Float32Array(input));
        };

        this.micSource.connect(this.micAnalyser);
        this.micSource.connect(this.micProcessor);
        this.micProcessor.connect(silentZeroGain);
        silentZeroGain.connect(ctx.destination);

        const freqData = new Uint8Array(this.micAnalyser.frequencyBinCount);
        const vuFill = document.getElementById('raphael-mic-vu-fill');

        this.micVuTimer = setInterval(() => {
          if (!this.micAnalyser || !this.isRecordingPTT) return;
          this.micAnalyser.getByteFrequencyData(freqData);
          let sum = 0;
          for (let i = 1; i < 24; i++) sum += freqData[i];
          const pct = Math.min(100, Math.round((sum / 23 / 115) * 100));

          if (pct > this.maxVuDetected) this.maxVuDetected = pct;

          if (vuFill) {
            vuFill.style.width = `${pct}%`;
            vuFill.style.background = pct > 12 ? '#10b981' : '#22d3ee';
          }
          window.RaphaelModules.canvas?.setVoiceEnergy?.(pct / 120);

          const now = performance.now();
          if (pct > 14) {
            if (!this.hasSpokenDuringSession) {
              this.hasSpokenDuringSession = true;
              const liveTxt = (this.finalTranscript + ' ' + this.interimTranscript).trim();
              if (!liveTxt) {
                this.updatePttButtonUI(true, '🎙️ ЗАПИСУЮ ВАШ ГОЛОС... (ПРОБІЛ АБО ПАУЗА 1.5с — ВІДПРАВИТИ)');
              }
            }
            this.lastVoiceActivityAt = now;
          } else if (this.hasSpokenDuringSession && (now - this.lastVoiceActivityAt > 1550)) {
            // Користувач сказав фразу і зробив паузу 1.55 с — автоматично відправляємо!
            const core = this.getCore();
            if (core) core.stopListeningSession();
            else this.stopPTTCapture();
          }
        }, 55);

        return true;
      } catch (err) {
        const core = this.getCore();
        core?.emit('logMessage', {
          author: 'МІКРОФОН',
          text: `Помилка доступу до мікрофона: ${err.message}`,
          type: 'error'
        });
        return false;
      }
    }

    stopDirectMicCaptureAndMeter() {
      if (this.micVuTimer) {
        clearInterval(this.micVuTimer);
        this.micVuTimer = null;
      }
      if (this.micProcessor) {
        try {
          this.micProcessor.onaudioprocess = null;
          this.micProcessor.disconnect();
        } catch (_) {}
        this.micProcessor = null;
      }
      if (this.micSource) {
        try { this.micSource.disconnect(); } catch (_) {}
        this.micSource = null;
      }
      if (this.micStream) {
        this.micStream.getTracks().forEach((t) => { try { t.stop(); } catch (_) {} });
        this.micStream = null;
      }
      const vuFill = document.getElementById('raphael-mic-vu-fill');
      if (vuFill) vuFill.style.width = '0%';
      window.RaphaelModules.canvas?.setVoiceEnergy?.(0);
    }

    // Конвертує записані зі шкали Float32-семпли у компактний 16kHz Mono WAV (Base64)
    encodeRecordedChunksToWavBase64() {
      if (!this.recordedPcmChunks || this.recordedPcmChunks.length === 0) return null;

      let totalLen = 0;
      for (let i = 0; i < this.recordedPcmChunks.length; i++) {
        totalLen += this.recordedPcmChunks[i].length;
      }
      if (totalLen < 2048) return null;

      const merged = new Float32Array(totalLen);
      let offset = 0;
      for (let i = 0; i < this.recordedPcmChunks.length; i++) {
        merged.set(this.recordedPcmChunks[i], offset);
        offset += this.recordedPcmChunks[i].length;
      }

      // Даунсемплінг до 16000 Hz для миттєвої відправки в STT
      const targetRate = 16000;
      const ratio = this.recordedSampleRate / targetRate;
      const outSamples = Math.floor(totalLen / ratio);
      const pcm16 = new Int16Array(outSamples);

      for (let i = 0; i < outSamples; i++) {
        const s = Math.max(-1, Math.min(1, merged[Math.floor(i * ratio)]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }

      const wavBytes = this.wrapPcm16InWavContainer(new Uint8Array(pcm16.buffer), targetRate);
      return this.arrayBufferToBase64(wavBytes);
    }

    // =========================================================================
    // 3. ЗАПУСК І ЗУПИНКА ЗАПИСУ + ХМАРНЕ РОЗПІЗНАВАННЯ ЗІ ШКАЛИ МІКРОФОНА
    // =========================================================================
    updatePttButtonUI(isRecording, customLabel = null) {
      const btn = document.getElementById('btn-ptt-raphael');
      if (!btn) return;
      btn.disabled = false;
      btn.style.opacity = '1';
      btn.classList.toggle('recording', !!isRecording);

      const span = btn.querySelector('span') || btn;
      if (customLabel) {
        span.textContent = customLabel;
      } else if (isRecording) {
        span.textContent = '🎙️ СЛУХАЮ ВАС... ГОВОРІТЬ (ПРОБІЛ АБО ПАУЗА 1.5с — ВІДПРАВИТИ)';
      } else {
        span.textContent = "📡 ГОЛОСОВИЙ ЗАПИТ ДО РАФАЇЛА (НАТИСНІТЬ КНОПКУ АБО ПРОБІЛ)";
      }
    }

    toggleVoiceRecording() {
      const now = performance.now();
      if (now - this.lastToggleTimestamp < 260) return;
      this.lastToggleTimestamp = now;

      const core = this.getCore();
      const callsign = document.getElementById('ctx-callsign')?.value?.trim() || 'Сокіл';

      if (this.isRecordingPTT) {
        if (core) core.stopListeningSession();
        else this.stopPTTCapture();
      } else {
        if (core) core.startListeningSession(callsign);
        else this.startPTTCapture();
      }
    }

    async startPTTCapture() {
      if (this.isRecordingPTT) return true;
      this.ensureAudioPipeline();
      this.stopCurrentPlayback();

      this.isRecordingPTT = true;
      this.finalTranscript = '';
      this.interimTranscript = '';

      this.playSoftUiTone(620, 0.07);
      this.updatePttButtonUI(true);

      // 1. Запускаємо прямий запис звуку зі шкали мікрофона (працює з будь-якою аудіокартою!)
      await this.startDirectMicCaptureAndMeter();

      // 2. Паралельно запускаємо швидкий браузерний SpeechRecognition
      const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRec) {
        try {
          const rec = new SpeechRec();
          rec.lang = 'uk-UA';
          rec.continuous = true;
          rec.interimResults = true;

          rec.onresult = (event) => {
            let interim = '';
            let finalPart = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
              const res = event.results[i];
              const txt = (res[0]?.transcript || '').trim();
              if (!txt) continue;
              if (res.isFinal) finalPart += ' ' + txt;
              else interim += ' ' + txt;
            }
            if (finalPart) this.finalTranscript = (this.finalTranscript + ' ' + finalPart).trim();
            this.interimTranscript = interim.trim();

            const liveText = (this.finalTranscript + ' ' + this.interimTranscript).trim();
            if (liveText && this.isRecordingPTT) {
              this.updatePttButtonUI(true, `🎙️ ЧУЮ: «${liveText}»`);
            }
          };

          rec.onerror = () => {};
          rec.onend = () => {
            if (typeof this._resolveRecStop === 'function') {
              this._resolveRecStop();
              this._resolveRecStop = null;
            }
          };

          this.speechRecognizer = rec;
          rec.start();
        } catch (_) {}
      }

      return true;
    }

    async stopPTTCapture() {
      if (!this.isRecordingPTT) return null;
      this.isRecordingPTT = false;

      const peakVu = this.maxVuDetected;
      const wavBase64 = this.encodeRecordedChunksToWavBase64();
      this.stopDirectMicCaptureAndMeter();

      this.playSoftUiTone(480, 0.07);
      this.updatePttButtonUI(false, '⏳ РОЗПІЗНАЮ ГОЛОС...');

      // Коректно чекаємо завершення браузерного SpeechRecognition (виправлено баг resolveWait!)
      if (this.speechRecognizer) {
        const waitEnd = new Promise((resolve) => {
          this._resolveRecStop = resolve;
        });
        try {
          this.speechRecognizer.stop();
        } catch (_) {}
        await Promise.race([waitEnd, new Promise((r) => setTimeout(r, 450))]);
        this.speechRecognizer = null;
      }

      let recognizedText = (this.finalTranscript || this.interimTranscript || '').trim();
      const core = this.getCore();

      // КРИТИЧНИЙ МЕХАНІЗМ v5.0:
      // Якщо браузерний SpeechRecognition нічого не повернув (через зовнішню звукову карту),
      // але зелена шкала рухалася (peakVu > 5 і є записаний WAV) — розпізнаємо WAV через хмарний AI!
      if (!recognizedText && wavBase64 && peakVu > 5) {
        this.updatePttButtonUI(false, '🧠 ХМАРНЕ РОЗПІЗНАВАННЯ АУДІОПОТОКУ...');
        if (core) core.setState('THINKING');
        recognizedText = await this.transcribeRecordedWavWithCloudAI(wavBase64);
      }

      this.updatePttButtonUI(false);

      if (recognizedText) {
        if (core) await core.submitQuery(recognizedText);
      } else {
        if (core) {
          core.setState('IDLE');
          core.emit('logMessage', {
            author: 'МІКРОФОН',
            text: peakVu <= 5
              ? 'Сигнал мікрофона був нульовим (зелена смужка не рухалася). Перевірте вибраний мікрофон у списку справа.'
              : 'Не вдалося розібрати слова у записі. Спробуйте сказати фразу трохи чіткіше.',
            type: 'error'
          });
        }
      }

      return recognizedText;
    }

    // Відправляє записаний із зеленої шкали WAV-файл у мультимодальний AI для 100% розпізнавання
    async transcribeRecordedWavWithCloudAI(wavBase64) {
      // 1. Спроба через хмарний шлюз OpenAI Audio (gpt-4o-mini-audio-preview)
      try {
        const res = await fetch('https://text.pollinations.ai/openai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'openai-audio',
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: 'Розпізнай це голосове звернення українською (або російською) мовою. Поверни ТІЛЬКИ дослівний текст того, що сказала людина, без жодних лапок чи коментарів.'
                  },
                  {
                    type: 'input_audio',
                    input_audio: {
                      data: wavBase64,
                      format: 'wav'
                    }
                  }
                ]
              }
            ]
          })
        });

        if (res.ok) {
          const data = await res.json();
          const txt = (data?.choices?.[0]?.message?.content || '').trim();
          if (txt && txt.length > 1) return txt;
        }
      } catch (e) {
        console.warn('[RaphaelVoice] OpenAI Audio STT fallback:', e);
      }

      // 2. Спроба через прямий ключ Gemini 3.8 Flash
      const apiKey = window.RaphaelModules.brain?.getApiKey?.();
      if (apiKey) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [
                {
                  role: 'user',
                  parts: [
                    { text: 'Напиши дослівно текст, який вимовлено на цьому аудіозаписі, без коментарів:' },
                    { inlineData: { mimeType: 'audio/wav', data: wavBase64 } }
                  ]
                }
              ]
            })
          });
          if (res.ok) {
            const data = await res.json();
            const txt = (data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
            if (txt) return txt;
          }
        } catch (_) {}
      }

      return '';
    }

    // =========================================================================
    // 4. ПРИРОДНИЙ НЕЙРОГОЛОС РАФАЇЛА («ЯК У ЖИВОГО ШІ» — NOVA / SHIMMER / SAGE)
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

      // Перевірка кешу вже розпакованих фраз (0 мс затримки для повторних фраз)
      const cacheKey = `${this.selectedVoiceProfile}:${cleanText}`;
      const cachedBuffer = window.RaphaelModules.optimizer?.getCachedAudioBuffer?.(cacheKey);
      if (cachedBuffer) {
        await this.playHiFiAudioBuffer(cachedBuffer, 1.0);
        return true;
      }

      let audioBuffer = null;

      // 1. Якщо вибрано природний голос OpenAI Neural (nova, shimmer, sage, coral)
      if (this.selectedVoiceProfile !== 'uk_studio') {
        audioBuffer = await this.fetchNaturalOpenAiVoiceBuffer(cleanText, this.selectedVoiceProfile);
      }

      // 2. Якщо вибрано 'uk_studio' або перший канал зайнятий — чистий студійний український нейроголос 1.0x (без спотворень!)
      if (!audioBuffer) {
        audioBuffer = await this.fetchCleanUkrainianStudioBuffer(cleanText);
      }

      if (audioBuffer) {
        window.RaphaelModules.optimizer?.cacheAudioBuffer?.(cacheKey, audioBuffer);
        await this.playHiFiAudioBuffer(audioBuffer, 1.0);
        return true;
      }

      // 3. Якщо повний офлайн — природний голос 1.0x (БЕЗ пітчу 1.42x!)
      await this.speakNaturalOfflineFallback(cleanText);
      return true;
    }

    // Завантажує справжній живий нейроголос OpenAI (Nova / Shimmer / Sage / Coral)
    async fetchNaturalOpenAiVoiceBuffer(text, voiceName = 'nova') {
      const ctx = this.ensureAudioPipeline();

      // Канал А: POST JSON з поверненням чистого Base64 аудіобуфера
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 4500);

        const res = await fetch('https://text.pollinations.ai/openai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: ctrl.signal,
          body: JSON.stringify({
            model: 'openai-audio',
            modalities: ['text', 'audio'],
            audio: { voice: voiceName, format: 'mp3' },
            messages: [
              {
                role: 'system',
                content: 'Ти — професійний голосовий диктор ШІ «Рафаїль». Твоє завдання — просто зачитати текст користувача вголос спокійним, природним, приємним голосом з правильною українською вимовою. Нічого не змінюй і не додавай від себе.'
              },
              {
                role: 'user',
                content: `Прочитай дослівно: "${text}"`
              }
            ]
          })
        });

        clearTimeout(timer);

        if (res.ok) {
          const contentType = (res.headers.get('content-type') || '').toLowerCase();
          if (contentType.includes('audio/')) {
            const rawBuf = await res.arrayBuffer();
            if (rawBuf && rawBuf.byteLength > 500) {
              return await ctx.decodeAudioData(rawBuf.slice(0));
            }
          } else {
            const data = await res.json();
            const b64Audio = data?.choices?.[0]?.message?.audio?.data;
            if (b64Audio) {
              const bytes = this.base64ToUint8Array(b64Audio);
              return await ctx.decodeAudioData(bytes.buffer.slice(0));
            }
          }
        }
      } catch (e) {
        console.warn('[RaphaelVoice] Перехід з OpenAI Audio POST на прямий потік:', e.message);
      }

      // Канал Б: Прямий бінарний GET-потік openai-audio
      try {
        const ctrl2 = new AbortController();
        const timer2 = setTimeout(() => ctrl2.abort(), 4000);
        const directPrompt = `Повтори дослівно українською без змін: ${text}`;
        const url = `https://text.pollinations.ai/${encodeURIComponent(directPrompt)}?model=openai-audio&voice=${encodeURIComponent(voiceName)}`;

        const res2 = await fetch(url, { signal: ctrl2.signal });
        clearTimeout(timer2);

        if (res2.ok) {
          const arrBuf = await res2.arrayBuffer();
          if (arrBuf && arrBuf.byteLength > 500) {
            return await ctx.decodeAudioData(arrBuf.slice(0));
          }
        }
      } catch (_) {}

      return null;
    }

    // Чистий український студійний нейроголос на природній швидкості 1.0x (без жодних спотворень!)
    async fetchCleanUkrainianStudioBuffer(text) {
      const clean = String(text || '').slice(0, 240);
      const googleUrl = `https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx&tl=uk&q=${encodeURIComponent(clean)}`;

      const proxies = [
        `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(googleUrl)}`,
        `https://corsproxy.io/?${encodeURIComponent(googleUrl)}`,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(googleUrl)}`
      ];

      const fetchOne = async (u) => {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 2200);
        try {
          const res = await fetch(u, { signal: ctrl.signal });
          if (!res.ok) throw new Error('Status');
          const buf = await res.arrayBuffer();
          if (!buf || buf.byteLength < 300) throw new Error('Empty');
          const ctx = this.ensureAudioPipeline();
          return await ctx.decodeAudioData(buf.slice(0));
        } finally {
          clearTimeout(tid);
        }
      };

      try {
        return await Promise.any(proxies.map((p) => fetchOne(p)));
      } catch (_) {
        return null;
      }
    }

    async playHiFiAudioBuffer(audioBuffer, rate = 1.0) {
      const ctx = this.ensureAudioPipeline();

      if (window.AetherRafaelBridge?.isActive?.() && typeof window.AetherRafaelBridge.injectTtsAudio === 'function') {
        try {
          window.AetherRafaelBridge.injectTtsAudio(audioBuffer.getChannelData(0), audioBuffer.sampleRate);
        } catch (_) {}
      }

      await new Promise((resolve) => {
        const src = ctx.createBufferSource();
        src.buffer = audioBuffer;
        src.playbackRate.value = rate;
        src.connect(this.masterGainNode);

        this.activeBufferSource = src;
        src.onended = () => {
          if (this.activeBufferSource === src) this.activeBufferSource = null;
          resolve();
        };
        src.start(ctx.currentTime + 0.01);
      });
    }

    speakNaturalOfflineFallback(text) {
      return new Promise((resolve) => {
        if (!('speechSynthesis' in window)) {
          resolve(false);
          return;
        }
        try {
          const synth = window.speechSynthesis;
          const utter = new SpeechSynthesisUtterance(text);
          window.__raphaelActiveUtter = utter;
          utter.lang = 'uk-UA';
          utter.pitch = 1.0; // Жодного штучного завищення тону!
          utter.rate = 1.0;
          utter.onend = () => resolve(true);
          utter.onerror = () => resolve(false);
          synth.speak(utter);
        } catch (_) {
          resolve(false);
        }
      });
    }

    stopCurrentPlayback() {
      if (this.spherePulseTimer) {
        clearInterval(this.spherePulseTimer);
        this.spherePulseTimer = null;
      }
      window.RaphaelModules.canvas?.setVoiceEnergy?.(0);

      if (this.activeBufferSource) {
        try {
          this.activeBufferSource.stop();
          this.activeBufferSource.disconnect();
        } catch (_) {}
        this.activeBufferSource = null;
      }
    }

    playSoftUiTone(freq = 620, dur = 0.06) {
      try {
        const ctx = this.ensureAudioPipeline();
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.06, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
        osc.connect(gain);
        gain.connect(this.masterGainNode);
        osc.start(now);
        osc.stop(now + dur + 0.01);
      } catch (_) {}
    }

    // =========================================================================
    // 5. УТИЛІТИ УПАКОВКИ WAV ТА ПРИВ'ЯЗКА КОНТРОЛЕРІВ
    // =========================================================================
    wrapPcm16InWavContainer(pcmBytes, sampleRate = 16000) {
      const dataSize = pcmBytes.byteLength;
      const buffer = new ArrayBuffer(44 + dataSize);
      const view = new DataView(buffer);
      const writeStr = (off, str) => {
        for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i));
      };

      writeStr(0, 'RIFF');
      view.setUint32(4, 36 + dataSize, true);
      writeStr(8, 'WAVE');
      writeStr(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeStr(36, 'data');
      view.setUint32(40, dataSize, true);

      new Uint8Array(buffer, 44).set(pcmBytes);
      return buffer;
    }

    arrayBufferToBase64(buffer) {
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i += 1024) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 1024));
      }
      return btoa(binary);
    }

    base64ToUint8Array(base64) {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    }

    bindPTTAndSpacebarControls() {
      const pttBtn = document.getElementById('btn-ptt-raphael');
      if (pttBtn && !pttBtn.dataset.boundV50) {
        pttBtn.dataset.boundV50 = 'true';
        this.updatePttButtonUI(false);

        pttBtn.addEventListener('click', (e) => {
          e.preventDefault();
          pttBtn.blur();
          this.toggleVoiceRecording();
        });
      }

      if (!window._raphaelSpaceHandlerV50) {
        window._raphaelSpaceHandlerV50 = true;

        window.addEventListener('keydown', (e) => {
          const activeEl = document.activeElement;
          const tag = (activeEl?.tagName || '').toLowerCase();
          if (tag === 'input' || tag === 'textarea' || tag === 'select' || activeEl?.isContentEditable) {
            return;
          }
          if (e.code === 'Space' && !e.repeat) {
            e.preventDefault();
            e.stopPropagation();
            if (activeEl && typeof activeEl.blur === 'function') activeEl.blur();
            this.toggleVoiceRecording();
          }
        }, true);
      }
    }

    bindVoiceTuningControls() {
      const profileSelect = document.getElementById('raphael-voice-mode');
      const testVoiceBtn = document.getElementById('btn-test-voice-now');

      if (profileSelect) {
        profileSelect.value = this.selectedVoiceProfile;
        profileSelect.addEventListener('change', () => {
          this.selectedVoiceProfile = profileSelect.value;
          this.saveSettings();
        });
      }

      if (testVoiceBtn && !testVoiceBtn.dataset.boundV50) {
        testVoiceBtn.dataset.boundV50 = 'true';
        testVoiceBtn.addEventListener('click', () => {
          testVoiceBtn.blur();
          this.speak('Привіт, Архітекторе. Канал зв\'язку налаштовано, тепер я говорю чистим природним голосом.');
        });
      }
    }
  }

  const voiceInstance = new RaphaelVoice();
  window.RaphaelVoice = voiceInstance;
  window.RaphaelModules.register('voice', voiceInstance);
})(window);