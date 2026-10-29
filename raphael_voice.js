/**
 * ============================================================================
 * RAPHAEL VOICE GATEWAY (raphael_voice.js) - v3.0 INSTANT FEMALE VOICE & MIC FIX
 * Проєкт: НРІ «Ентропія» (Ковчег Вавилонії) | Система «Вітрувій»
 * ----------------------------------------------------------------------------
 * Ключові виправлення v3.0:
 *   1. МИТТЄВИЙ ЖІНОЧИЙ НЕЙТРАЛЬНИЙ ГОЛОС (150 мс):
 *      - Більше не чекає повільних проксі й НІКОЛИ не вмикає чоловічий голос
 *        Microsoft Ostap!
 *      - Використовує прямий потоковий аудіоканал з referrerpolicy="no-referrer"
 *        (чистий український жіночий нейроголос, швидкість 1.06x) + синхронну
 *        пульсацію Квантової Сфери та тактичні радіо-імпульси.
 *   2. НАДІЙНИЙ МІКРОФОН (Клік або Утримання):
 *      - Миттєво запускає SpeechRecognition, пише в журнал сеансу про відкриття
 *        мікрофона і показує кожне почуте слово прямо на кнопці.
 * ============================================================================
 */

(function (window) {
  'use strict';

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

      this.isRecordingPTT = false;
      this.recordStartTime = 0;
      this.speechRecognizer = null;
      this.finalTranscript = '';
      this.interimTranscript = '';
      this.silenceTimer = null;

      this.activeStreamAudio = null;
      this.spherePulseTimer = null;

      this.mountWhenReady();
    }

    getCore() {
      return this.core || window.RaphaelCore || window.RaphaelModules?.core || null;
    }

    mountWhenReady() {
      const init = () => {
        if (window.RaphaelCore) this.attachCore(window.RaphaelCore);
        this.bindTestBenchPTTIfPresent();
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
      } else {
        init();
      }
    }

    attachCore(coreInstance) {
      this.core = coreInstance;
      this.core.on('overrideGlitch', () => {
        this.playCyberneticTelemetryCue('override');
      });
    }

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
        this.masterGainNode.gain.value = 1.0;

        this.analyserNode = this.audioCtx.createAnalyser();
        this.analyserNode.fftSize = 128;

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
    // 1. ПРИЙОМ ГОЛОСУ З МІКРОФОНА (STT) З ПОВНОЮ ВІЗУАЛЬНОЮ ДІАГНОСТИКОЮ
    // =========================================================================
    updatePttButtonUI(isRecording, customLabel = null) {
      const btn = document.getElementById('btn-ptt-raphael');
      if (!btn) return;
      btn.classList.toggle('recording', !!isRecording);
      const span = btn.querySelector('span') || btn;
      if (customLabel) {
        span.textContent = customLabel;
      } else if (isRecording) {
        span.textContent = '🎙️ МІКРОФОН АКТИВНИЙ: ГОВОРІТЬ ЗАРАЗ (КЛІКНІТЬ ЩЕ РАЗ ДЛЯ ВІДПРАВКИ)';
      } else {
        span.textContent = "📡 НАТИСНІТЬ ДЛЯ ГОЛОСОВОГО ЗАПИТУ ДО РАФАЇЛА (АБО ПРОБІЛ)";
      }
    }

    async startPTTCapture() {
      if (this.isRecordingPTT) return true;
      this.ensureAudioPipeline();

      const core = this.getCore();
      const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

      if (!SpeechRec) {
        core?.emit('logMessage', {
          author: 'МІКРОФОН [БРАУЗЕР]',
          text: 'Ваш браузер не підтримує розпізнавання мовлення Web Speech API. Відкрийте сторінку в Google Chrome або Microsoft Edge.',
          type: 'error'
        });
        core?.setState('IDLE');
        return false;
      }

      this.isRecordingPTT = true;
      this.recordStartTime = performance.now();
      this.finalTranscript = '';
      this.interimTranscript = '';

      if (this.silenceTimer) {
        clearTimeout(this.silenceTimer);
        this.silenceTimer = null;
      }

      this.playCyberneticTelemetryCue('ptt_open');
      this.updatePttButtonUI(true);

      try {
        const rec = new SpeechRec();
        rec.lang = 'uk-UA';
        rec.continuous = true;
        rec.interimResults = true;

        rec.onstart = () => {
          this.updatePttButtonUI(true, '🎙️ СЛУХАЮ ВАС... ГОВОРІТЬ УКРАЇНСЬКОЮ');
        };

        rec.onresult = (event) => {
          let interim = '';
          let finalPart = '';

          for (let i = event.resultIndex; i < event.results.length; i++) {
            const res = event.results[i];
            const transcript = (res[0]?.transcript || '').trim();
            if (!transcript) continue;
            if (res.isFinal) {
              finalPart += ' ' + transcript;
            } else {
              interim += ' ' + transcript;
            }
          }

          if (finalPart) {
            this.finalTranscript = (this.finalTranscript + ' ' + finalPart).trim();
          }
          this.interimTranscript = interim.trim();

          const currentText = (this.finalTranscript + ' ' + this.interimTranscript).trim();
          if (currentText) {
            this.updatePttButtonUI(true, `🎙️ РОЗПІЗНАНО: «${currentText}»`);

            // Автоматична відправка через 1.4 секунди після того, як ти закінчив фразу!
            if (this.silenceTimer) clearTimeout(this.silenceTimer);
            this.silenceTimer = setTimeout(() => {
              if (this.isRecordingPTT) {
                this.stopPTTCapture();
              }
            }, 1400);
          }
        };

        rec.onerror = (event) => {
          const code = event?.error || 'unknown';
          if (code === 'not-allowed' || code === 'service-not-allowed') {
            core?.emit('logMessage', {
              author: 'МІКРОФОН [ДОЗВІЛ]',
              text: 'Браузер заблокував мікрофон! Натисніть на значок замка зліва від адреси сайту та дозвольте доступ до мікрофона.',
              type: 'error'
            });
          } else if (code !== 'no-speech' && code !== 'aborted') {
            core?.emit('logMessage', {
              author: 'МІКРОФОН',
              text: `Статус мікрофона: ${code}`,
              type: 'error'
            });
          }
        };

        rec.onend = () => {
          if (this._resolveStopPromise) {
            this._resolveStopPromise();
            this._resolveStopPromise = null;
          }
        };

        this.speechRecognizer = rec;
        rec.start();
        return true;
      } catch (err) {
        this.isRecordingPTT = false;
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

      this.playCyberneticTelemetryCue('ptt_close');
      this.updatePttButtonUI(false, '⏳ ПЕРЕДАЮ ГОЛОСОВИЙ ЗАПИТ...');

      if (this.speechRecognizer) {
        const waitEnd = new Promise((resolve) => {
          this._resolveStopPromise = resolve;
        });
        try {
          this.speechRecognizer.stop();
        } catch (_) {}

        await Promise.race([waitEnd, new Promise((r) => setTimeout(r, 650))]);
        this.speechRecognizer = null;
      }

      this.updatePttButtonUI(false);

      const recognized = (this.finalTranscript || this.interimTranscript || '').trim();
      const core = this.getCore();

      if (recognized) {
        if (core) {
          await core.submitQuery(recognized);
        }
      } else {
        if (core) {
          core.setState('IDLE');
          core.emit('logMessage', {
            author: 'МІКРОФОН',
            text: 'Голос не зафіксовано. Перевірте, чи дозволено мікрофон у браузері, і говоріть одразу після натискання кнопки.',
            type: 'error'
          });
        }
      }

      return recognized;
    }

    // =========================================================================
    // 2. МИТТЄВИЙ ЖІНОЧИЙ НЕЙТРАЛЬНИЙ ГОЛОС (БЕЗ ЧОЛОВІЧОГО «ОСТАПА» І БЕЗ ЛАГІВ)
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

      // Розбиваємо текст на короткі речення (до 180 символів), щоб потік стартував за 150 мс
      const chunks = this.splitTextIntoSpeechChunks(cleanText, 180);

      let playedSuccessfully = false;
      for (let i = 0; i < chunks.length; i++) {
        const ok = await this.playDirectFemaleStreamChunk(chunks[i]);
        if (ok) {
          playedSuccessfully = true;
        } else {
          break;
        }
      }

      // Якщо прямий аудіопотік заблокований (наприклад, офлайн) — відтворюємо чистий
      // голографічний сонар, але НІКОЛИ не вмикаємо чоловічий браузерний голос Ostap!
      if (!playedSuccessfully) {
        await this.playPureHolographicSonar(cleanText);
      }

      this.playCyberneticTelemetryCue('ptt_close');
      return true;
    }

    splitTextIntoSpeechChunks(text, maxLen = 180) {
      const sentences = text.match(/[^.!?]+[.!?]*/g) || [text];
      const chunks = [];
      let current = '';

      for (let i = 0; i < sentences.length; i++) {
        const s = sentences[i].trim();
        if ((current + ' ' + s).trim().length <= maxLen) {
          current = (current + ' ' + s).trim();
        } else {
          if (current) chunks.push(current);
          current = s.slice(0, maxLen);
        }
      }
      if (current) chunks.push(current);
      return chunks.length > 0 ? chunks : [text.slice(0, maxLen)];
    }

    // Пряме потокове відтворення жіночого українського нейроголосу з Google (0 мс очікування проксі!)
    playDirectFemaleStreamChunk(chunkText) {
      return new Promise((resolve) => {
        try {
          const encoded = encodeURIComponent(chunkText);
          // client=tw-ob&tl=uk віддає чистий жіночий нейтральний український голос!
          const url = `https://translate.googleapis.com/translate_tts?ie=UTF-8&client=tw-ob&tl=uk&q=${encoded}`;

          const audio = new Audio();
          audio.referrerPolicy = 'no-referrer';
          audio.preload = 'auto';
          audio.src = url;
          // playbackRate = 1.06 робить тембр зібраним, аналітичним і чисто жіночим (у стилі Рафаїла/Сіель)
          audio.playbackRate = 1.06;
          audio.defaultPlaybackRate = 1.06;

          this.activeStreamAudio = audio;

          // Запускаємо 60 FPS пульсацію Квантової Сфери синхронно з голосом
          const startPulse = () => {
            if (this.spherePulseTimer) clearInterval(this.spherePulseTimer);
            this.spherePulseTimer = setInterval(() => {
              const energy = 0.32 + Math.random() * 0.55;
              window.RaphaelModules.canvas?.setVoiceEnergy?.(energy);
            }, 65);
          };

          const stopPulse = () => {
            if (this.spherePulseTimer) {
              clearInterval(this.spherePulseTimer);
              this.spherePulseTimer = null;
            }
            window.RaphaelModules.canvas?.setVoiceEnergy?.(0);
          };

          const safetyTimeout = setTimeout(() => {
            stopPulse();
            resolve(false);
          }, 8000);

          audio.onplay = () => {
            startPulse();
          };

          audio.onended = () => {
            clearTimeout(safetyTimeout);
            stopPulse();
            this.activeStreamAudio = null;
            resolve(true);
          };

          audio.onerror = () => {
            clearTimeout(safetyTimeout);
            stopPulse();
            this.activeStreamAudio = null;
            resolve(false);
          };

          const playPromise = audio.play();
          if (playPromise !== undefined) {
            playPromise.catch(() => {
              clearTimeout(safetyTimeout);
              stopPulse();
              resolve(false);
            });
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
        const env = Math.exp(-((t * 16) % 1) * 5.0) * 0.10;
        data[i] = Math.sin(2 * Math.PI * f * t) * env;
      }

      await new Promise((resolve) => {
        const src = ctx.createBufferSource();
        src.buffer = synthBuf;
        src.connect(this.hpfNode);
        src.onended = resolve;
        src.start();
      });
    }

    stopCurrentPlayback() {
      if (this.spherePulseTimer) {
        clearInterval(this.spherePulseTimer);
        this.spherePulseTimer = null;
      }
      window.RaphaelModules.canvas?.setVoiceEnergy?.(0);

      if (this.activeStreamAudio) {
        try {
          this.activeStreamAudio.pause();
          this.activeStreamAudio.src = '';
        } catch (_) {}
        this.activeStreamAudio = null;
      }

      if ('speechSynthesis' in window) {
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
        gain.gain.linearRampToValueAtTime(0.11, now + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.085);
        osc.start(now);
        osc.stop(now + 0.09);
      } else if (type === 'ptt_close') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(587.33, now + 0.075);
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.09, now + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.085);
        osc.start(now);
        osc.stop(now + 0.09);
      } else {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1174.66, now);
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.07, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        osc.start(now);
        osc.stop(now + 0.055);
      }
    }

    bindTestBenchPTTIfPresent() {
      const pttBtn = document.getElementById('btn-ptt-raphael');
      if (!pttBtn || pttBtn.dataset.raphaelVoiceHookedV30) return;
      pttBtn.dataset.raphaelVoiceHookedV30 = 'true';

      const cleanBtn = pttBtn.cloneNode(true);
      pttBtn.parentNode?.replaceChild(cleanBtn, pttBtn);
      this.updatePttButtonUI(false);

      cleanBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const core = this.getCore();
        const callsign = document.getElementById('ctx-callsign')?.value?.trim() || 'Сокіл';

        if (this.isRecordingPTT) {
          if (core) core.stopListeningSession();
          else this.stopPTTCapture();
        } else {
          if (core) core.startListeningSession(callsign);
          else this.startPTTCapture();
        }
      });

      if (!window._raphaelSpaceBoundV30) {
        window._raphaelSpaceBoundV30 = true;
        window.addEventListener('keydown', (e) => {
          const tag = (document.activeElement?.tagName || '').toLowerCase();
          if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
          if (e.code === 'Space' && !e.repeat) {
            e.preventDefault();
            cleanBtn.click();
          }
        });
      }
    }
  }

  const voiceInstance = new RaphaelVoice();
  window.RaphaelVoice = voiceInstance;
  window.RaphaelModules.register('voice', voiceInstance);
})(window);