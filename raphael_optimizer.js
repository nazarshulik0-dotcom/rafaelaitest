/**
 * ============================================================================
 * RAPHAEL OPTIMIZER & GM CONSOLE (raphael_optimizer.js) - ФАЗА 5: СТАБІЛЬНІСТЬ
 * Проєкт: НРІ «Ентропія» (Ковчег Вавилонії) | Система «Вітрувій»
 * ----------------------------------------------------------------------------
 * Функціонал модуля:
 *   1. Обмеження токенів і слів: жорсткий ліміт до 50 слів (~70 токенів) із
 *      розумним обрізанням по межі речення.
 *   2. Debounce / Lock: блокування повторних викликів кнопки PTT та текстових
 *      запитів, поки Рафаїль не завершить поточну відповідь (+ 650 мс кулдаун).
 *   3. Кеш системних реплік (0 мс затримки): збереження базових фраз
 *      («Слухаю вас», «Канал стабільний», «Аналізую біометрію», Fail-Safe)
 *      та LRU-кеш синтезованих AudioBuffer.
 *   4. Пульт Майстра (GM Direct Access) та глітч-тригер AETHER_SYSTEM_OVERRIDE.
 * ============================================================================
 */

(function (window) {
  'use strict';

  const LIMITS = Object.freeze({
    MAX_WORDS: 50,
    MAX_TOKENS: 70,
    COOLDOWN_MS: 650,
    MAX_CACHED_BUFFERS: 30
  });

  // Канонічні системні репліки для миттєвого кешу (0 мс затримки)
  const SYSTEM_PHRASES = Object.freeze({
    LISTENING_ACK: 'Слухаю вас.',
    CHANNEL_STABLE: 'Канал стабільний.',
    ANALYZING_BIO: 'Аналізую біометрію.',
    FAILSAFE_MEM: '[ПОМИЛКА ДОСТУПУ: Сектор пам\'яті пошкоджено. Необхідна синхронізація з Маяком.]',
    FAILSAFE_PROTO: '[Помилка протоколу: фрагмент даних пошкоджено. Потрібна синхронізація з терміналом Маяка.]'
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

  class RaphaelOptimizer {
    constructor() {
      this.core = null;

      // Стан блокування (Debounce / Lock)
      this.activeLock = false;
      this.cooldownUntil = 0;
      this.lastTriggerAt = 0;

      // LRU-кеш аудіобуферів (ключ: нормалізований текст репліки -> значення: AudioBuffer)
      this.audioBufferCache = new Map();
      this.systemCachePrewarmed = false;

      // Метрики продуктивності сесії
      this.telemetry = {
        totalQueries: 0,
        cacheHits: 0,
        truncatedResponses: 0,
        blockedSpamClicks: 0
      };

      this.injectGlitchAndConsoleStyles();
      this.mountWhenReady();
    }

    mountWhenReady() {
      const init = () => {
        if (window.RaphaelCore) {
          this.attachCore(window.RaphaelCore);
        }
        this.mountGmQuickConsoleEnhancements();
        this.mountAetherIntegrationBridgeIfPresent();
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

      // Відстежуємо переходи станів FSM для керування Debounce / Lock
      this.core.on('stateChange', ({ state, prevState }) => {
        if (state === 'THINKING' || state === 'SPEAKING' || state === 'LISTENING') {
          this.activeLock = true;
        } else if (state === 'IDLE' || state === 'DORMANT') {
          if (prevState === 'SPEAKING' || prevState === 'THINKING') {
            this.cooldownUntil = performance.now() + LIMITS.COOLDOWN_MS;
          }
          this.activeLock = false;
        }
        this.updateLockIndicatorUI(state);
      });

      // Сюжетний злам AETHER_SYSTEM_OVERRIDE: тактильна вібрація + візуальний глітч
      this.core.on('overrideGlitch', () => {
        this.executeHardwareAndVisualGlitch();
      });

      // Попереднє прогрівання кешу системних реплік при першій взаємодії з документом
      const warmOnce = () => {
        this.prewarmSystemAudioCache();
        window.removeEventListener('pointerdown', warmOnce);
        window.removeEventListener('keydown', warmOnce);
      };
      window.addEventListener('pointerdown', warmOnce, { once: true });
      window.addEventListener('keydown', warmOnce, { once: true });
    }

    // =========================================================================
    // 1. ОБМЕЖЕННЯ ТОКЕНІВ ТА СЛІВ (МАКСИМУМ 50 СЛІВ / 70 ТОКЕНІВ)
    // =========================================================================
    estimateTokenCount(text) {
      const clean = String(text || '').trim();
      if (!clean) return 0;
      const words = clean.split(/\s+/).length;
      // Для кириличного тексту 1 слово в середньому становить ~1.38 токена
      return Math.ceil(words * 1.38);
    }

    enforceWordLimit(rawText, maxWords = LIMITS.MAX_WORDS, maxTokens = LIMITS.MAX_TOKENS) {
      let text = String(rawText || '').replace(/\s+/g, ' ').trim();
      if (!text) return '';

      // Системні заглушки Fail-Safe повертаємо без змін
      if (text.startsWith('[ПОМИЛКА') || text.startsWith('[Помилка')) {
        return text;
      }

      const words = text.split(' ');
      const estimatedTokens = this.estimateTokenCount(text);
      const effectiveWordCap = Math.min(maxWords, Math.floor(maxTokens / 1.38));

      if (words.length <= maxWords && estimatedTokens <= maxTokens) {
        return text;
      }

      this.telemetry.truncatedResponses++;
      const sliced = words.slice(0, effectiveWordCap).join(' ');

      // Шукаємо останню крапку, знак оклику або питання, щоб не обривати фразу посеред речення
      const lastDot = Math.max(
        sliced.lastIndexOf('.'),
        sliced.lastIndexOf('!'),
        sliced.lastIndexOf('?')
      );

      if (lastDot > sliced.length * 0.48) {
        return sliced.slice(0, lastDot + 1).trim();
      }

      return sliced.replace(/[,:;—-]+$/, '').trim() + '.';
    }

    // =========================================================================
    // 2. DEBOUNCE / LOCK (БЛОКУВАННЯ ПОВТОРНИХ НАТИСКАНЬ ПІД ЧАС ВІДПОВІДІ)
    // =========================================================================
    isLocked() {
      const now = performance.now();
      if (this.activeLock) {
        this.telemetry.blockedSpamClicks++;
        return true;
      }
      if (now < this.cooldownUntil) {
        this.telemetry.blockedSpamClicks++;
        return true;
      }
      if (now - this.lastTriggerAt < 320) {
        this.telemetry.blockedSpamClicks++;
        return true;
      }
      this.lastTriggerAt = now;
      return false;
    }

    updateLockIndicatorUI(currentState = 'IDLE') {
      const lockEl = document.getElementById('lock-indicator');
      const pttBtn = document.getElementById('btn-ptt-raphael');
      const sendBtn = document.getElementById('btn-send-text');

      const busy = currentState === 'THINKING' || currentState === 'SPEAKING';

      if (lockEl) {
        if (currentState === 'DORMANT') {
          lockEl.textContent = 'LOCKED [DORMANT]';
          lockEl.style.color = '#ef4444';
        } else if (busy) {
          lockEl.textContent = `BUSY [${currentState}]`;
          lockEl.style.color = '#f59e0b';
        } else {
          lockEl.textContent = `READY (Cache: ${this.audioBufferCache.size})`;
          lockEl.style.color = '#10b981';
        }
      }

      if (pttBtn && currentState !== 'LISTENING') {
        pttBtn.disabled = busy;
        pttBtn.style.opacity = busy ? '0.55' : '1';
      }
      if (sendBtn) {
        sendBtn.disabled = busy;
      }
    }

    // =========================================================================
    // 3. КЕШ СИСТЕМНИХ АУДІОРЕПЛІК (AUDIOBUFFER 0 МС ЗАТРИМКИ)
    // =========================================================================
    normalizeCacheKey(text) {
      return String(text || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
    }

    getCachedAudioBuffer(text) {
      const key = this.normalizeCacheKey(text);
      if (!key) return null;

      if (this.audioBufferCache.has(key)) {
        this.telemetry.cacheHits++;
        const buf = this.audioBufferCache.get(key);
        // Оновлюємо позицію в LRU-кеші
        this.audioBufferCache.delete(key);
        this.audioBufferCache.set(key, buf);
        this.updateLockIndicatorUI(this.core?.getState() || 'IDLE');
        return buf;
      }
      return null;
    }

    cacheAudioBuffer(text, audioBuffer) {
      const key = this.normalizeCacheKey(text);
      if (!key || !audioBuffer) return;

      if (this.audioBufferCache.size >= LIMITS.MAX_CACHED_BUFFERS) {
        const oldestKey = this.audioBufferCache.keys().next().value;
        this.audioBufferCache.delete(oldestKey);
      }

      this.audioBufferCache.set(key, audioBuffer);
      this.updateLockIndicatorUI(this.core?.getState() || 'IDLE');
    }

    // Попередня генерація базових системних AudioBuffer для миттєвого відтворення (0 мс)
    prewarmSystemAudioCache() {
      if (this.systemCachePrewarmed) return;
      const voiceMod = window.RaphaelModules.voice;
      const ctx = voiceMod?.ensureAudioPipeline?.();
      if (!ctx) return;

      this.systemCachePrewarmed = true;

      // Синтезуємо 0-мс тактильні сигнатурні буфери для базових відповідей
      const presets = [
        { text: SYSTEM_PHRASES.LISTENING_ACK, tones: [587.33, 880.0], dur: 0.36 },
        { text: SYSTEM_PHRASES.CHANNEL_STABLE, tones: [523.25, 659.25, 987.77], dur: 0.48 },
        { text: SYSTEM_PHRASES.ANALYZING_BIO, tones: [440.0, 659.25, 880.0, 1174.66], dur: 0.54 }
      ];

      presets.forEach((p) => {
        const buf = this.createTacticalSignatureBuffer(ctx, p.tones, p.dur);
        if (buf) {
          this.cacheAudioBuffer(`__cue_${p.text}`, buf);
        }
      });

      this.updateLockIndicatorUI(this.core?.getState() || 'IDLE');
    }

    createTacticalSignatureBuffer(ctx, freqs = [660, 880], durationSec = 0.4) {
      try {
        const sr = ctx.sampleRate;
        const length = Math.floor(sr * durationSec);
        const buffer = ctx.createBuffer(1, length, sr);
        const data = buffer.getChannelData(0);

        for (let i = 0; i < length; i++) {
          const t = i / sr;
          const segIdx = Math.min(freqs.length - 1, Math.floor((t / durationSec) * freqs.length));
          const f = freqs[segIdx];
          const localT = (t % (durationSec / freqs.length));
          const env = Math.exp(-localT * 14) * Math.min(1, localT * 120);
          data[i] = (
            Math.sin(2 * Math.PI * f * t) * 0.22 +
            Math.sin(2 * Math.PI * (f * 1.5) * t) * 0.09
          ) * env;
        }
        return buffer;
      } catch (_) {
        return null;
      }
    }

    // Швидке відтворення системної фрази з 0 мс затримкою
    async playInstantSystemPhrase(phraseKey = 'CHANNEL_STABLE') {
      const phraseText = SYSTEM_PHRASES[phraseKey] || phraseKey;
      this.prewarmSystemAudioCache();

      const cueBuf = this.getCachedAudioBuffer(`__cue_${phraseText}`);
      if (cueBuf && window.RaphaelModules.voice) {
        window.RaphaelModules.voice.playAudioBufferThroughDSP(cueBuf);
      }

      if (this.core) {
        this.core.emit('logMessage', {
          author: 'РАФАЇЛЬ [0ms CACHE]',
          text: phraseText,
          type: 'ai'
        });
      }

      if (window.RaphaelModules.voice) {
        await window.RaphaelModules.voice.speak(phraseText);
      }
    }

    // =========================================================================
    // 4. ГЛІТЧ-ТРИГЕР АКТИВАЦІЇ (AETHER_SYSTEM_OVERRIDE)
    // =========================================================================
    injectGlitchAndConsoleStyles() {
      if (document.getElementById('raphael-optimizer-styles')) return;

      const style = document.createElement('style');
      style.id = 'raphael-optimizer-styles';
      style.textContent = `
        @keyframes raphaelCyberGlitch {
          0%   { transform: translate(0, 0) skew(0deg); filter: hue-rotate(0deg) contrast(1); }
          15%  { transform: translate(-6px, 3px) skew(-2deg); filter: hue-rotate(85deg) contrast(1.85) saturate(1.8); }
          30%  { transform: translate(6px, -4px) skew(2deg); filter: invert(0.28) drop-shadow(-4px 0 #ef4444); }
          45%  { transform: translate(-4px, -2px); filter: hue-rotate(190deg) contrast(1.5); }
          65%  { transform: translate(4px, 2px) skew(-1deg); filter: drop-shadow(4px 0 #22d3ee); }
          85%  { transform: translate(-2px, 1px); filter: contrast(1.2); }
          100% { transform: translate(0, 0) skew(0deg); filter: hue-rotate(0deg) contrast(1); }
        }

        body.raphael-override-glitch {
          animation: raphaelCyberGlitch 0.62s cubic-bezier(0.22, 0.61, 0.36, 1) both !important;
        }

        .gm-quick-console {
          display: flex;
          flex-direction: column;
          gap: 7px;
          margin-top: 6px;
          padding: 10px;
          border-radius: 10px;
          background: rgba(6, 22, 33, 0.72);
          border: 1px solid rgba(34, 211, 238, 0.38);
        }

        .gm-chip-row {
          display: flex;
          flex-wrap: wrap;
          gap: 5px;
        }

        .gm-chip-btn {
          background: rgba(15, 23, 42, 0.85);
          border: 1px solid rgba(34, 211, 238, 0.4);
          color: #a5f3fc;
          font-size: 10.5px;
          font-family: monospace;
          padding: 4px 8px;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .gm-chip-btn:hover {
          background: rgba(34, 211, 238, 0.24);
          box-shadow: 0 0 10px rgba(34, 211, 238, 0.35);
        }

        .gm-chip-btn.danger {
          border-color: rgba(239, 68, 68, 0.55);
          color: #fecaca;
        }

        .gm-chip-btn.emerald {
          border-color: rgba(16, 185, 129, 0.55);
          color: #a7f3d0;
        }
      `;
      document.head.appendChild(style);
    }

    executeHardwareAndVisualGlitch() {
      // 1. Тактильна вібрація на мобільних пристроях та геймпадах
      if (navigator.vibrate) {
        try { navigator.vibrate([90, 45, 160, 35, 90]); } catch (_) {}
      }

      // 2. Хроматичний CSS-глітч усього екрана
      document.body.classList.remove('raphael-override-glitch');
      void document.body.offsetWidth;
      document.body.classList.add('raphael-override-glitch');
      setTimeout(() => {
        document.body.classList.remove('raphael-override-glitch');
      }, 680);

      // 3. Глітч сфери у raphael_canvas.js
      window.RaphaelModules.canvas?.triggerGlitch?.(700);
    }

    // =========================================================================
    // 5. ПУЛЬТ МАЙСТРА (GM DIRECT ACCESS) НА ТЕСТОВОМУ СТЕНДІ ТА В «ЕТЕРІ»
    // =========================================================================
    mountGmQuickConsoleEnhancements() {
      const directivesBox = document.getElementById('gm-directives-status');
      const overrideBtn = document.getElementById('btn-system-override');
      const exportBtn = document.getElementById('btn-export-irminsul');

      // Переводимо кнопку «СЮЖЕТНИЙ ЗЛАМ» на офіційний виклик RaphaelCore.triggerSystemOverride()
      if (overrideBtn && !overrideBtn.dataset.optBound) {
        overrideBtn.dataset.optBound = 'true';
        const cleanOverride = overrideBtn.cloneNode(true);
        overrideBtn.parentNode?.replaceChild(cleanOverride, overrideBtn);
        cleanOverride.addEventListener('click', () => {
          this.core?.triggerSystemOverride('GM_OVERRIDE_BUTTON');
        });
      }

      // Переводимо кнопку експорту в Ірмінсуль на офіційний метод фіналізації сесії
      if (exportBtn && !exportBtn.dataset.optBound) {
        exportBtn.dataset.optBound = 'true';
        const cleanExport = exportBtn.cloneNode(true);
        exportBtn.parentNode?.replaceChild(cleanExport, exportBtn);
        cleanExport.addEventListener('click', () => {
          this.core?.finalizeAndExportToIrminsul(true);
        });
      }

      if (!directivesBox || document.getElementById('raphael-gm-direct-console')) return;

      const gmConsole = document.createElement('div');
      gmConsole.id = 'raphael-gm-direct-console';
      gmConsole.className = 'gm-quick-console';
      gmConsole.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:10.5px;color:#67e8f9;font-weight:700;">
          <span>👑 ПУЛЬТ МАЙСТРА (GM DIRECT ACCESS)</span>
          <span style="color:#94a3b8;font-weight:400;">Ліміт: ≤50 слів</span>
        </div>

        <div class="gm-chip-row">
          <button type="button" class="gm-chip-btn" data-gm-cmd="/silent on">🔇 /silent on</button>
          <button type="button" class="gm-chip-btn emerald" data-gm-cmd="/silent off">🔊 /silent off</button>
          <button type="button" class="gm-chip-btn danger" data-gm-cmd="/dormant">🔒 У стан DORMANT</button>
          <button type="button" class="gm-chip-btn" data-gm-cmd="/stop_session">🛑 Зупинити сесію (Ірмінсуль)</button>
        </div>

        <div style="display:flex;gap:5px;">
          <input type="text" id="gm-quick-inject-input" placeholder="/inject прихована підказка або /lock_topic тема..." style="font-size:11px;padding:6px 8px;" />
          <button type="button" id="gm-quick-inject-btn" class="gm-chip-btn emerald" style="white-space:nowrap;">⚡ Вшити</button>
        </div>

        <div style="font-size:10px;color:#94a3b8;margin-top:2px;">⚡ 0 ms Кеш системних реплік (AudioBuffer):</div>
        <div class="gm-chip-row">
          <button type="button" class="gm-chip-btn" data-cache-cue="LISTENING_ACK">▶ «Слухаю вас»</button>
          <button type="button" class="gm-chip-btn" data-cache-cue="CHANNEL_STABLE">▶ «Канал стабільний»</button>
          <button type="button" class="gm-chip-btn" data-cache-cue="ANALYZING_BIO">▶ «Аналізую біометрію»</button>
        </div>
      `;

      directivesBox.insertAdjacentElement('afterend', gmConsole);

      // Обробники швидких чіпів GM
      gmConsole.querySelectorAll('[data-gm-cmd]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const cmd = btn.getAttribute('data-gm-cmd');
          this.core?.processMasterDirective(cmd);
        });
      });

      // Швидка ін'єкція підказки / теми
      const injectInput = gmConsole.querySelector('#gm-quick-inject-input');
      const injectBtn = gmConsole.querySelector('#gm-quick-inject-btn');
      const submitQuickDirective = () => {
        const raw = (injectInput.value || '').trim();
        if (!raw) return;
        injectInput.value = '';
        const formatted = raw.startsWith('/') ? raw : `/inject ${raw}`;
        this.core?.processMasterDirective(formatted);
      };
      injectBtn.addEventListener('click', submitQuickDirective);
      injectInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          submitQuickDirective();
        }
      });

      // Перевірка миттєвого кешу системних реплік
      gmConsole.querySelectorAll('[data-cache-cue]').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.playInstantSystemPhrase(btn.getAttribute('data-cache-cue'));
        });
      });
    }

    // Якщо 5 модулів підключено безпосередньо в бойовий aether.html —
    // монтуємо кнопку [📡 Зв'язок з Рафаїлом] у вікні Етеру
    mountAetherIntegrationBridgeIfPresent() {
      if (document.getElementById('btn-ptt-raphael')) return; // Ми вже на тестовому полігоні
      const aetherChatInput = document.getElementById('chat-input');
      if (!aetherChatInput || document.getElementById('aether-raphael-ptt-dock')) return;

      const dock = document.createElement('div');
      dock.id = 'aether-raphael-ptt-dock';
      dock.style.cssText = 'margin-top:6px;display:flex;gap:5px;width:100%;';
      dock.innerHTML = `
        <button type="button" id="btn-ptt-raphael" class="small-btn" style="
          flex:1;padding:8px 10px;font-size:11px;font-weight:700;
          border-color:#22d3ee;color:#ecfeff;
          background:linear-gradient(180deg, rgba(8,51,68,0.8), rgba(6,28,40,0.92));
          cursor:pointer;border-radius:8px;
        ">
          <span>📡 Зв'язок з Рафаїлом (Утримуйте)</span>
        </button>
      `;

      aetherChatInput.parentElement?.insertAdjacentElement('afterend', dock);
      window.RaphaelModules.voice?.bindTestBenchPTTIfPresent?.();
    }
  }

  const optimizerInstance = new RaphaelOptimizer();
  window.RaphaelOptimizer = optimizerInstance;
  window.RaphaelModules.register('optimizer', optimizerInstance);
})(window);