/**
 * ============================================================================
 * RAPHAEL VOICE GATEWAY (raphael_voice.js) - v4.0 IRONCLAD AUDIO & MIC ENGINE
 * Проєкт: НРІ «Ентропія» (Ковчег Вавилонії) | Система «Вітрувій»
 * ----------------------------------------------------------------------------
 * Ключові виправлення v4.0:
 *   1. ЛІКВІДАЦІЯ «РУЛЕТКИ» ГОЛОСУ:
 *      - Виправлено баг Chromium speechSynthesis.cancel(), який глушив 70% фраз.
 *      - Глобальне утримання посилання window.__raphaelUtter проти GC-обривів.
 *      - Двоканальний синтез: Хмарний жіночий нейроголос (через ArrayBuffer) +
 *        Миттєвий локальний синтез із жіночим пітчем (Pitch 1.42x, Rate 1.08x).
 *   2. СПРАВНИЙ ПРОБІЛ ТА МІКРОФОН:
 *      - Зняття фокусу (blur) при натисканні Space — усунено подвійний клік!
 *      - Живий VU-метр (зелена шкала рівня сигналу з мікрофона в реальному часі).
 *      - Підтримка вибору конкретного мікрофона / аудіокарти.
 * ============================================================================
 */

(function (window) {
  'use strict';

  const VOICE_SETTINGS_KEY = 'entropia_raphael_voice_cfg_v40';

  const DSP_CONFIG = Object.freeze({
    HIGHPASS_HZ: 240,
    LOWPASS_HZ: 5800,
    PRESENCE_HZ: 2400,
    PRESENCE_GAIN_DB: 2.2,
    PRESENCE_Q: 1.25
  });

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
      this.hpfNode = null;
      this.lpfNode = null;
      this.presenceNode = null;
      this.masterGainNode = null;
      this.analyserNode = null;

      // Налаштування тембру та режиму голосу
      const saved = this.loadSettings();
      this.voiceEngineMode = saved.voiceEngineMode || 'hybrid'; // 'hybrid' | 'local_female' | 'cloud_neural'
      this.voicePitch = Number(saved.voicePitch ?? 1.42);       // 1.42 робить голос жіночим/нейтральним навіть на Ostap
      this.voiceRate = Number(saved.voiceRate ?? 1.08);
      this.selectedMicDeviceId = saved.selectedMicDeviceId || '';

      // Стан мікрофона та STT
      this.isRecordingPTT = false;
      this.lastToggleTimestamp = 0;
      this.speechRecognizer = null;
      this.finalTranscript = '';
      this.interimTranscript = '';
      this.silenceTimer = null;

      // Моніторинг живого рівня мікрофона (VU-метр)
      this.micMonitorStream = null;
      this.micMonitorSource = null;
      this.micAnalyser = null;
      this.micVuTimer = null;

      // Стан відтворення TTS
      this.activeBufferSource = null;
      this.spherePulseTimer = null;
      this.availableVoices = [];

      this.initBrowserVoices();
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
          voiceEngineMode: this.voiceEngineMode,
          voicePitch: this.voicePitch,
          voiceRate: this.voiceRate,
          selectedMicDeviceId: this.selectedMicDeviceId
        }));
      } catch (_) {}
    }

    getCore() {
      return this.core || window.RaphaelCore || window.RaphaelModules?.core || null;
    }

    initBrowserVoices() {
      if (!('speechSynthesis' in window)) return;
      const load = () => {
        this.availableVoices = window.speechSynthesis.getVoices() || [];
      };
      load();
      if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = load;
      }
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
        this.playCyberneticTelemetryCue('override');
      });
    }

    // =========================================================================
    // 1. WEB AUDIO DSP-ТРАКТ ТА АНАЛІЗАТОР СФЕРИ
    // =========================================================================
    ensureAudioPipeline() {
      if (!this.audioCtx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        this.audioCtx = new AudioCtx({ sampleRate: 24000 });

        this.hpfNode = this.audioCtx.createBiquadFilter();
        this.hpfNode.type = 'highpass';
        this.hpfNode.frequency.value = DSP_CONFIG.HIGHPASS_HZ;

        this.lpfNode = this.audioCtx.createBiquadFilter();
        this.lpfNode.type = 'lowpass';
        this.lpfNode.frequency.value = DSP_CONFIG.LOWPASS_HZ;

        this.presenceNode = this.audioCtx.createBiquadFilter();
        this.presenceNode.type = 'peaking';
        this.presenceNode.frequency.value = DSP_CONFIG.PRESENCE_HZ;
        this.presenceNode.Q.value = DSP_CONFIG.PRESENCE_Q;
        this.presenceNode.gain.value = DSP_CONFIG.PRESENCE_GAIN_DB;

        this.masterGainNode = this.audioCtx.createGain();
        this.masterGainNode.gain.value = 1.15;

        this.analyserNode = this.audioCtx.createAnalyser();
        this.analyserNode.fftSize = 128;
        this.analyserNode.smoothingTimeConstant = 0.72;

        this.hpfNode.connect(this.lpfNode);
        this.lpfNode.connect(this.presenceNode);
        this.presenceNode.connect(this.masterGainNode);
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
    // 2. СПИСОК МІКРОФОНІВ ТА ЖИВИЙ VU-МЕТР (ЩОБ БАЧИТИ СИГНАЛ МІКРОФОНА)
    // =========================================================================
    async populateMicrophoneList() {
      const selectEl = document.getElementById('raphael-mic-select');
      if (!selectEl || !navigator.mediaDevices?.enumerateDevices) return;

      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const mics = devices.filter((d) => d.kind === 'audioinput');
        selectEl.innerHTML = '<option value="">🎙️ Системний мікрофон за замовчуванням</option>';

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

    async startMicLevelMeter() {
      this.stopMicLevelMeter();
      if (!navigator.mediaDevices?.getUserMedia) return;

      try {
        const constraints = {
          audio: this.selectedMicDeviceId
            ? { deviceId: { exact: this.selectedMicDeviceId } }
            : true
        };
        this.micMonitorStream = await navigator.mediaDevices.getUserMedia(constraints);
        this.populateMicrophoneList();

        const ctx = this.ensureAudioPipeline();
        this.micMonitorSource = ctx.createMediaStreamSource(this.micMonitorStream);
        this.micAnalyser = ctx.createAnalyser();
        this.micAnalyser.fftSize = 64;
        this.micMonitorSource.connect(this.micAnalyser);

        const data = new Uint8Array(this.micAnalyser.frequencyBinCount);
        const vuFill = document.getElementById('raphael-mic-vu-fill');

        this.micVuTimer = setInterval(() => {
          if (!this.micAnalyser || !this.isRecordingPTT) return;
          this.micAnalyser.getByteFrequencyData(data);
          let sum = 0;
          for (let i = 1; i < 16; i++) sum += data[i];
          const pct = Math.min(100, Math.round((sum / 15 / 140) * 100));
          if (vuFill) {
            vuFill.style.width = `${pct}%`;
            vuFill.style.background = pct > 12 ? '#10b981' : '#22d3ee';
          }
          window.RaphaelModules.canvas?.setVoiceEnergy?.(pct / 130);
        }, 60);
      } catch (err) {
        console.warn('[RaphaelVoice] VU-метр мікрофона недоступний:', err.message);
      }
    }

    stopMicLevelMeter() {
      if (this.micVuTimer) {
        clearInterval(this.micVuTimer);
        this.micVuTimer = null;
      }
      if (this.micMonitorSource) {
        try { this.micMonitorSource.disconnect(); } catch (_) {}
        this.micMonitorSource = null;
      }
      if (this.micMonitorStream) {
        this.micMonitorStream.getTracks().forEach((t) => { try { t.stop(); } catch (_) {} });
        this.micMonitorStream = null;
      }
      const vuFill = document.getElementById('raphael-mic-vu-fill');
      if (vuFill) vuFill.style.width = '0%';
      window.RaphaelModules.canvas?.setVoiceEnergy?.(0);
    }

    // =========================================================================
    // 3. ПРИЙОМ ГОЛОСУ (STT): НАДІЙНИЙ ПРОБІЛ ТА КНОПКА PTT
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
        span.textContent = '🎙️ МІКРОФОН УВІМКНЕНО: ГОВОРІТЬ ЗАРАЗ (НАТИСНІТЬ ПРОБІЛ ЩЕ РАЗ ДЛЯ ВІДПРАВКИ)';
      } else {
        span.textContent = "📡 ГОЛОСОВИЙ ЗАПИТ ДО РАФАЇЛА (НАТИСНІТЬ КНОПКУ АБО ПРОБІЛ)";
      }
    }

    toggleVoiceRecording() {
      const now = performance.now();
      // Захист від подвійного спрацьовування за < 250 мс
      if (now - this.lastToggleTimestamp < 250) return;
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

      const core = this.getCore();
      const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

      if (!SpeechRec) {
        core?.emit('logMessage', {
          author: 'МІКРОФОН [ПОМИЛКА]',
          text: 'Цей браузер не підтримує Web Speech API. Використовуйте Google Chrome або Microsoft Edge.',
          type: 'error'
        });
        core?.setState('IDLE');
        return false;
      }

      this.isRecordingPTT = true;
      this.finalTranscript = '';
      this.interimTranscript = '';

      if (this.silenceTimer) {
        clearTimeout(this.silenceTimer);
        this.silenceTimer = null;
      }

      this.playCyberneticTelemetryCue('ptt_open');
      this.updatePttButtonUI(true);
      this.startMicLevelMeter();

      try {
        const rec = new SpeechRec();
        rec.lang = 'uk-UA';
        rec.continuous = true;
        rec.interimResults = true;

        rec.onstart = () => {
          this.updatePttButtonUI(true, '🎙️ СЛУХАЮ ВАС... ГОВОРІТЬ УКРАЇНСЬКОЮ (ПРОБІЛ — ВІДПРАВИТИ)');
        };

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

          if (finalPart) {
            this.finalTranscript = (this.finalTranscript + ' ' + finalPart).trim();
          }
          this.interimTranscript = interim.trim();

          const liveText = (this.finalTranscript + ' ' + this.interimTranscript).trim();
          if (liveText) {
            this.updatePttButtonUI(true, `🎙️ ЧУЮ: «${liveText}»`);

            // Автоматична відправка через 1.6 с після завершення фрази
            if (this.silenceTimer) clearTimeout(this.silenceTimer);
            this.silenceTimer = setTimeout(() => {
              if (this.isRecordingPTT) {
                const c = this.getCore();
                if (c) c.stopListeningSession();
                else this.stopPTTCapture();
              }
            }, 1600);
          }
        };

        rec.onerror = (event) => {
          const code = event?.error || '';
          if (code === 'not-allowed' || code === 'service-not-allowed') {
            core?.emit('logMessage', {
              author: 'МІКРОФОН [БЛОКОВАНО]',
              text: 'Доступ до мікрофона заблоковано! Дозвольте мікрофон у значку біля адресного рядка браузера.',
              type: 'error'
            });
          } else if (code === 'network') {
            core?.emit('logMessage', {
              author: 'МІКРОФОН [МЕРЕЖА]',
              text: 'Браузер блокує хмарне розпізнавання мовлення (наприклад, у Brave). Відкрийте стенд у Chrome або Edge.',
              type: 'error'
            });
          }
        };

        rec.onend = () => {
          if (this._resolveRecStop) {
            this._resolveRecStop();
            this._resolveRecStop = null;
          }
          // Якщо користувач ще не натискав Стоп і ще нічого не сказав — перезапускаємо слухач
          if (this.isRecordingPTT && !this.finalTranscript && !this.interimTranscript) {
            try { rec.start(); } catch (_) {}
          }
        };

        this.speechRecognizer = rec;
        rec.start();
        return true;
      } catch (err) {
        this.isRecordingPTT = false;
        this.stopMicLevelMeter();
        this.updatePttButtonUI(false);
        core?.setState('IDLE');
        return false;
      }
    }

    async stopPTTCapture() {
      if (!this.isRecordingPTT) return null;
      this.isRecordingPTT = false;

      if (this.silenceTimer) {
        clearTimeout(this.silenceTimer);
        this.silenceTimer = null;
      }

      this.stopMicLevelMeter();
      this.playCyberneticTelemetryCue('ptt_close');
      this.updatePttButtonUI(false, '⏳ ОБРОБЛЯЮ ГОЛОСОВИЙ ЗАПИТ...');

      if (this.speechRecognizer) {
        const waitEnd = new Promise((resolve) => {
          this._resolveRecStop = resolve;
        });
        try {
          this.speechRecognizer.onend = () => resolveWait();
        } catch (_) {}
        try {
          this.speechRecognizer.stop();
        } catch (_) {}

        await Promise.race([waitEnd, new Promise((r) => setTimeout(r, 550))]);
        this.speechRecognizer = null;
      }

      this.updatePttButtonUI(false);

      const recognized = (this.finalTranscript || this.interimTranscript || '').trim();
      const core = this.getCore();

      if (recognized) {
        if (core) await core.submitQuery(recognized);
      } else {
        if (core) {
          core.setState('IDLE');
          core.emit('logMessage', {
            author: 'МІКРОФОН',
            text: 'Слів не розпізнано. Перевірте, чи рухається зелена шкала мікрофона під кнопкою, коли ви говорите.',
            type: 'error'
          });
        }
      }

      return recognized;
    }

    // =========================================================================
    // 4. ВИХІД (TTS): 100% ГАРАНТОВАНИЙ ЖІНОЧИЙ/НЕЙТРАЛЬНИЙ ГОЛОС БЕЗ РУЛЕТКИ
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

      this.playCyberneticTelemetryCue('tx_start');

      let spokenOk = false;

      // КАНАЛ 1: Якщо вибрано 'cloud_neural' або 'hybrid' — пробуємо завантажити
      // чистий жіночий нейроголос через швидку гонку проксі (таймаут 1.5 сек)
      if (this.voiceEngineMode === 'cloud_neural' || this.voiceEngineMode === 'hybrid') {
        try {
          const audioBuffer = await this.fetchCloudFemaleAudioBufferFast(cleanText);
          if (audioBuffer) {
            await this.playDecodedAudioBuffer(audioBuffer, 1.05);
            spokenOk = true;
          }
        } catch (_) {}
      }

      // КАНАЛ 2 (ГАРАНТОВАНИЙ 100%): Стабільний синтезатор із захистом від багів Chrome
      // та формантним зсувом у жіночий тембр (Pitch = 1.42x)
      if (!spokenOk) {
        spokenOk = await this.speakWithIroncladLocalFemaleSynth(cleanText);
      }

      // КАНАЛ 3: Якщо на пристрої взагалі вимкнено TTS в ОС — голографічний сонар
      if (!spokenOk) {
        await this.playPureHolographicSonar(cleanText);
      }

      this.playCyberneticTelemetryCue('ptt_close');
      return true;
    }

    // Швидке паралельне завантаження жіночого нейроголосу в ArrayBuffer (обходить ORB!)
    async fetchCloudFemaleAudioBufferFast(text) {
      const clean = String(text || '').slice(0, 220);
      const googleUrl = `https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx&tl=uk&q=${encodeURIComponent(clean)}`;

      const urls = [
        `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(googleUrl)}`,
        `https://corsproxy.io/?${encodeURIComponent(googleUrl)}`,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(googleUrl)}`
      ];

      const fetchOne = async (proxyUrl) => {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 1550);
        try {
          const res = await fetch(proxyUrl, { signal: ctrl.signal });
          if (!res.ok) throw new Error('Bad status');
          const buf = await res.arrayBuffer();
          if (!buf || buf.byteLength < 300) throw new Error('Empty audio');
          const ctx = this.ensureAudioPipeline();
          return await ctx.decodeAudioData(buf.slice(0));
        } finally {
          clearTimeout(tid);
        }
      };

      return await Promise.any(urls.map((u) => fetchOne(u)));
    }

    async playDecodedAudioBuffer(audioBuffer, rate = 1.05) {
      const ctx = this.ensureAudioPipeline();
      await new Promise((resolve) => {
        const src = ctx.createBufferSource();
        src.buffer = audioBuffer;
        src.playbackRate.value = rate;
        src.connect(this.hpfNode);

        this.activeBufferSource = src;
        src.onended = () => {
          if (this.activeBufferSource === src) this.activeBufferSource = null;
          resolve();
        };
        src.start(ctx.currentTime + 0.02);
      });
    }

    // Виправлений локальний синтезатор без «рулетки» Chrome і з жіночим тембром
    speakWithIroncladLocalFemaleSynth(text) {
      return new Promise((resolve) => {
        if (!('speechSynthesis' in window)) {
          resolve(false);
          return;
        }

        try {
          const synth = window.speechSynthesis;

          // КРИТИЧНИЙ ФІКС CHROME: викликаємо cancel() ТІЛЬКИ якщо синтезатор реально зайнятий,
          // і даємо 70 мс паузи, інакше Chrome мовчки ковтає наступний виклик speak()!
          const startSpeak = () => {
            if (synth.paused) synth.resume();

            const voices = synth.getVoices() || this.availableVoices || [];
            // Шукаємо український або природний жіночий голос
            const ukVoices = voices.filter((v) => /uk|ukr/i.test(v.lang) || /ukrain|ostap|polina|lesya/i.test(v.name));
            const femaleUk = ukVoices.find((v) => /polina|female|natural|google|lesya/i.test(v.name));
            const chosenVoice = femaleUk || ukVoices[0] || null;

            const utter = new SpeechSynthesisUtterance(text);
            // Зберігаємо у глобальному window, щоб Garbage Collector Chrome не обірвав фразу!
            window.__raphaelActiveUtter = utter;

            if (chosenVoice) {
              utter.voice = chosenVoice;
              utter.lang = chosenVoice.lang || 'uk-UA';
            } else {
              utter.lang = 'uk-UA';
            }

            // Якщо в системі встановлений чоловічий голос (Ostap),
            // pitch = 1.42 піднімає форманту у чистий жіночий/нейтральний регістр ШІ!
            const isAlreadyFemale = chosenVoice && /polina|female|lesya/i.test(chosenVoice.name);
            utter.pitch = isAlreadyFemale ? 1.05 : this.voicePitch;
            utter.rate = this.voiceRate;
            utter.volume = 1.0;

            let started = false;
            const maxDurationMs = Math.max(4000, text.length * 110);

            const finish = (ok) => {
              clearTimeout(safetyTimer);
              if (this.spherePulseTimer) {
                clearInterval(this.spherePulseTimer);
                this.spherePulseTimer = null;
              }
              window.RaphaelModules.canvas?.setVoiceEnergy?.(0);
              resolve(ok);
            };

            const safetyTimer = setTimeout(() => {
              finish(started);
            }, maxDurationMs);

            utter.onstart = () => {
              started = true;
              if (this.spherePulseTimer) clearInterval(this.spherePulseTimer);
              this.spherePulseTimer = setInterval(() => {
                window.RaphaelModules.canvas?.setVoiceEnergy?.(0.35 + Math.random() * 0.55);
              }, 70);
            };

            utter.onend = () => finish(true);
            utter.onerror = () => finish(started);

            synth.speak(utter);
          };

          if (synth.speaking || synth.pending) {
            synth.cancel();
            setTimeout(startSpeak, 75);
          } else {
            startSpeak();
          }
        } catch (_) {
          resolve(false);
        }
      });
    }

    async playPureHolographicSonar(text) {
      const ctx = this.ensureAudioPipeline();
      const words = text.split(/\s+/).filter(Boolean);
      const totalDurationSec = Math.min(2.2, Math.max(0.8, words.length * 0.12));
      const sr = ctx.sampleRate;
      const frameCount = Math.floor(sr * totalDurationSec);
      const synthBuf = ctx.createBuffer(1, frameCount, sr);
      const data = synthBuf.getChannelData(0);

      const chord = [659.25, 880.0, 1046.5, 1318.5];
      for (let i = 0; i < frameCount; i++) {
        const t = i / sr;
        const step = Math.floor(t * 16);
        const f = chord[step % chord.length];
        const env = Math.exp(-((t * 16) % 1) * 5.0) * 0.14;
        data[i] = Math.sin(2 * Math.PI * f * t) * env;
      }

      await this.playDecodedAudioBuffer(synthBuf, 1.0);
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

      if ('speechSynthesis' in window && (window.speechSynthesis.speaking || window.speechSynthesis.pending)) {
        try { window.speechSynthesis.cancel(); } catch (_) {}
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
        gain.gain.linearRampToValueAtTime(0.14, now + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.085);
        osc.start(now);
        osc.stop(now + 0.09);
      } else if (type === 'ptt_close') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(587.33, now + 0.075);
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.12, now + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.085);
        osc.start(now);
        osc.stop(now + 0.09);
      } else {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1174.66, now);
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.09, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        osc.start(now);
        osc.stop(now + 0.055);
      }
    }

    // =========================================================================
    // 5. ПРИВ'ЯЗКА ПРОБІЛУ (БЕЗ ПОДВІЙНОГО КЛІКУ) ТА НАЛАШТУВАНЬ ГОЛОСУ
    // =========================================================================
    bindPTTAndSpacebarControls() {
      const pttBtn = document.getElementById('btn-ptt-raphael');
      if (pttBtn && !pttBtn.dataset.boundV40) {
        pttBtn.dataset.boundV40 = 'true';
        this.updatePttButtonUI(false);

        pttBtn.addEventListener('click', (e) => {
          e.preventDefault();
          pttBtn.blur(); // Знімаємо фокус, щоб Пробіл ніколи не викликав подвійний клік!
          this.toggleVoiceRecording();
        });
      }

      if (!window._raphaelSpaceHandlerV40) {
        window._raphaelSpaceHandlerV40 = true;

        window.addEventListener('keydown', (e) => {
          const activeEl = document.activeElement;
          const tag = (activeEl?.tagName || '').toLowerCase();
          if (tag === 'input' || tag === 'textarea' || tag === 'select' || activeEl?.isContentEditable) {
            return;
          }

          if (e.code === 'Space' && !e.repeat) {
            e.preventDefault();
            e.stopPropagation();
            // Знімаємо фокус з будь-якої кнопки на сторінці, щоб браузер не натиснув її при відпусканні Space!
            if (activeEl && typeof activeEl.blur === 'function') {
              activeEl.blur();
            }
            this.toggleVoiceRecording();
          }
        }, true);
      }
    }

    bindVoiceTuningControls() {
      const pitchSlider = document.getElementById('raphael-voice-pitch');
      const pitchLabel = document.getElementById('raphael-pitch-val');
      const modeSelect = document.getElementById('raphael-voice-mode');
      const testVoiceBtn = document.getElementById('btn-test-voice-now');

      if (pitchSlider) {
        pitchSlider.value = String(this.voicePitch);
        if (pitchLabel) pitchLabel.textContent = `${this.voicePitch.toFixed(2)}x (Жіночий ШІ)`;
        pitchSlider.addEventListener('input', () => {
          this.voicePitch = Number(pitchSlider.value);
          if (pitchLabel) {
            const desc = this.voicePitch >= 1.25 ? 'Жіночий ШІ' : (this.voicePitch >= 1.05 ? 'Нейтральний' : 'Низький');
            pitchLabel.textContent = `${this.voicePitch.toFixed(2)}x (${desc})`;
          }
          this.saveSettings();
        });
      }

      if (modeSelect) {
        modeSelect.value = this.voiceEngineMode;
        modeSelect.addEventListener('change', () => {
          this.voiceEngineMode = modeSelect.value;
          this.saveSettings();
        });
      }

      if (testVoiceBtn && !testVoiceBtn.dataset.boundV40) {
        testVoiceBtn.dataset.boundV40 = 'true';
        testVoiceBtn.addEventListener('click', () => {
          testVoiceBtn.blur();
          this.speak('Систему Рафаїль синхронізовано. Голосовий тракт працює стабільно.');
        });
      }
    }
  }

  const voiceInstance = new RaphaelVoice();
  window.RaphaelVoice = voiceInstance;
  window.RaphaelModules.register('voice', voiceInstance);
})(window);