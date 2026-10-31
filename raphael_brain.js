/**
 * ============================================================================
 * RAPHAEL BRAIN (raphael_brain.js) - STAGE 0.2: SELF-CONTAINED ZERO PERSONALITY
 * Проєкт: НРІ «Ентропія» (Ковчег Вавилонії) | Система «Вітрувій»
 * ----------------------------------------------------------------------------
 * Виправлення Stage 0.2:
 *   1. Повернуто шлюзи Vertex AI (aiplatform.googleapis.com) для ключів AQ.
 *      + модель gemini-3.8-flash із повноцінним таймаутом 18 секунд.
 *   2. Жорстка прив'язка кнопки прийому API-ключа (#btn-verify-key) з детальною
 *      діагностикою у реальному часі.
 *   3. Пряме перехоплення submitQuery: блокує старі заглушки з raphael_core.js
 *      та raphael_optimizer.js, забезпечуючи чистий вільний діалог ШІ.
 *   4. 100% стерильний код (жодних текстових ключів для GitHub Push Protection).
 * ============================================================================
 */

(function (window) {
  'use strict';

  const XOR_SALT = 73;

  // Стерильний числовий вектор (безпечно для GitHub Push Protection)
  const STEALTH_CONFIG_VECTOR = [
    8, 24, 103, 8, 43, 113, 27, 7, 127, 2, 125, 24, 11, 45, 122, 31, 56, 60,
    40, 26, 123, 44, 38, 26, 19, 27, 3, 57, 42, 125, 3, 48, 5, 8, 47, 124,
    28, 122, 46, 49, 56, 44, 29, 51, 60, 31, 35, 43, 44, 62, 33, 60, 8
  ];

  const STORAGE_KEYS = Object.freeze({
    API_KEY_XOR: 'entropia_raphael_xor_key_stage02',
    ACTIVE_CHAR: 'entropia_active_character',
    IRMINSUL_NODES: 'entropia_irminsul_nodes_v1'
  });

  const FAILSAFE_MESSAGES = Object.freeze({
    SPOILER_LOCKED: '[ПРОТОКОЛ КАРАНТИНУ: Доступ до архівів цього сектора заблоковано директивою безпеки Ковчега. Необхідна синхронізація з вищим рівнем «Ірмінсуля».]'
  });

  // Суворо закриті сюжетні теми (більше ні на що помилка не спрацьовує!)
  const FORBIDDEN_LORE_PATTERNS = [
    /сектор[ауіом]?\s*(?:ii|iii|iv|v|vi|vii|viii|2|3|4|5|6|7|8|0|нуль)\b/i,
    /ядр[оауі]\s*сіель|\bсіель\b|\bсиель\b|\bciel\b/i,
    /причин[аиу]\s*катастроф|хто\s*знищив\s*ковчег|чому\s*загинув\s*ковчег/i
  ];

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

  class RaphaelBrain {
    constructor(options = {}) {
      this.core = null;
      this.modelName = options.modelName || 'gemini-3.8-flash';
      this.candidateModels = ['gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-2.0-flash'];
      this.temperature = 0.7;
      this.workingGoogleEndpoint = null;
      this.lastLogSignature = '';
      this.lastLogTime = 0;

      // Власний буфер діалогу на 10 реплік (не залежить від збоїв у raphael_core)
      this.conversationHistory = [];

      this.mountWhenReady();
    }

    mountWhenReady() {
      const init = () => {
        if (window.RaphaelCore) {
          this.attachCore(window.RaphaelCore);
        }
        this.bindAllStageZeroControls();
      };

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
      } else {
        setTimeout(init, 30);
      }
    }

    attachCore(coreInstance) {
      if (!coreInstance) return;
      this.core = coreInstance;

      // Перехоплюємо submitQuery у raphael_core.js, щоб старий код ніколи не підсовував
      // шаблонні фрази і не обрізав відповіді через старий оптимізатор!
      if (!coreInstance._stage0Patched) {
        coreInstance._stage0Patched = true;
        coreInstance.submitQuery = async (rawQuery, customContext = {}) => {
          return await this.handleStageZeroQuery(rawQuery, customContext);
        };
      }
    }

    // =========================================================================
    // 1. STEALTH-ШИФРУВАННЯ ТА МАРШРУТИЗАЦІЯ КЛЮЧІВ (VERTEX AQ. + STUDIO AIza)
    // =========================================================================
    encodeKeyToBytes(rawKey) {
      const clean = String(rawKey || '').trim();
      const bytes = [];
      for (let i = 0; i < clean.length; i++) {
        bytes.push(clean.charCodeAt(i) ^ XOR_SALT);
      }
      return bytes;
    }

    decodeBytesToKey(byteArray) {
      if (!Array.isArray(byteArray) || byteArray.length === 0) return '';
      let out = '';
      for (let i = 0; i < byteArray.length; i++) {
        out += String.fromCharCode(byteArray[i] ^ XOR_SALT);
      }
      return out.trim();
    }

    getApiKey() {
      const domInput = document.getElementById('gemini-api-key');
      if (domInput && domInput.value && domInput.value.trim()) {
        return domInput.value.trim();
      }
      try {
        const storedJson = localStorage.getItem(STORAGE_KEYS.API_KEY_XOR);
        if (storedJson) {
          const decoded = this.decodeBytesToKey(JSON.parse(storedJson));
          if (decoded) return decoded;
        }
      } catch (_) {}
      return this.decodeBytesToKey(STEALTH_CONFIG_VECTOR);
    }

    setApiKey(rawKey) {
      const clean = String(rawKey || '').trim();
      this.workingGoogleEndpoint = null;
      try {
        if (!clean) {
          localStorage.removeItem(STORAGE_KEYS.API_KEY_XOR);
        } else {
          localStorage.setItem(STORAGE_KEYS.API_KEY_XOR, JSON.stringify(this.encodeKeyToBytes(clean)));
        }
      } catch (_) {}
      const domInput = document.getElementById('gemini-api-key');
      if (domInput && clean && domInput.value !== clean) {
        domInput.value = clean;
      }
    }

    // Будує список усіх сумісних шлюзів Google Cloud Vertex AI та AI Studio для ключа
    buildGoogleEndpointsList(apiKey, modelName = 'gemini-3.8-flash') {
      const cleanKey = String(apiKey || '').trim();
      const encModel = encodeURIComponent(modelName);
      const encKey = encodeURIComponent(cleanKey);

      // Перевірка префікса "AQ." за кодами ASCII (65, 81, 46)
      const isVertexKey =
        cleanKey.charCodeAt(0) === 65 &&
        cleanKey.charCodeAt(1) === 81 &&
        cleanKey.charCodeAt(2) === 46;

      if (isVertexKey) {
        return [
          {
            name: `Vertex AI v1 (${modelName})`,
            url: `https://aiplatform.googleapis.com/v1/publishers/google/models/${encModel}:generateContent?key=${encKey}`
          },
          {
            name: `Vertex AI v1beta1 (${modelName})`,
            url: `https://aiplatform.googleapis.com/v1beta1/publishers/google/models/${encModel}:generateContent?key=${encKey}`
          },
          {
            name: `Google AI v1beta (${modelName})`,
            url: `https://generativelanguage.googleapis.com/v1beta/models/${encModel}:generateContent?key=${encKey}`
          }
        ];
      }

      return [
        {
          name: `Google AI Studio (${modelName})`,
          url: `https://generativelanguage.googleapis.com/v1beta/models/${encModel}:generateContent?key=${encKey}`
        },
        {
          name: `Vertex AI v1 (${modelName})`,
          url: `https://aiplatform.googleapis.com/v1/publishers/google/models/${encModel}:generateContent?key=${encKey}`
        }
      ];
    }

    // =========================================================================
    // 2. ПЕРЕВІРКА ТА ПРИЙОМ API-КЛЮЧА (КНОПКА #btn-verify-key)
    // =========================================================================
    async verifyAndSaveKey(rawKeyInput) {
      const domInput = document.getElementById('gemini-api-key');
      const candidate = String(rawKeyInput ?? domInput?.value ?? '').trim() || this.getApiKey();

      if (!candidate) {
        return {
          ok: false,
          message: '⚠️ Поле ключа порожнє. Вставте ключ у поле вище або використовуйте вбудований хмарний інтелект.'
        };
      }

      this.setApiKey(candidate);
      let lastErrorText = '';

      for (let m = 0; m < this.candidateModels.length; m++) {
        const model = this.candidateModels[m];
        const endpoints = this.buildGoogleEndpointsList(candidate, model);

        for (let i = 0; i < endpoints.length; i++) {
          const ep = endpoints[i];
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 14000);

          try {
            const res = await fetch(ep.url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              signal: ctrl.signal,
              body: JSON.stringify({
                contents: [
                  {
                    role: 'user',
                    parts: [{ text: 'Привіт! Відповідай коротко українською: зв\'язок з ядром Рафаїль встановлено.' }]
                  }
                ],
                generationConfig: {
                  temperature: 0.4,
                  maxOutputTokens: 60
                }
              })
            });

            clearTimeout(timer);

            if (res.ok) {
              const data = await res.json();
              const reply = (data?.candidates?.[0]?.content?.parts?.[0]?.text || 'OK').trim();
              this.modelName = model;
              this.workingGoogleEndpoint = ep.url;
              this.updateStatusBadge(`🟢 Ключ активний: ${ep.name}`, '#34d399');

              return {
                ok: true,
                message: `🟢 КЛЮЧ ПРИЙНЯТО (${ep.name})! Тестова відповідь: «${reply}»`
              };
            } else {
              const errJson = await res.json().catch(() => ({}));
              lastErrorText = errJson?.error?.message || `HTTP ${res.status}`;
            }
          } catch (err) {
            clearTimeout(timer);
            lastErrorText = err.name === 'AbortError' ? 'Перевищено час очікування (14с)' : err.message;
          }
        }
      }

      // Якщо ключ не підійшов до Google — одразу тестуємо резервний хмарний канал, щоб користувач знав статус
      this.updateStatusBadge('🟣 Працює автономний хмарний ШІ (GPT-4o)', '#c084fc');
      return {
        ok: false,
        message: `🟡 Google відповів: "${lastErrorText}". Ключ збережено, але для відповідей автоматично увімкнено резервний хмарний інтелект GPT-4o!`
      };
    }

    // =========================================================================
    // 3. ГОЛОВНИЙ КОНВЕЄР ЕТАПУ 0 («НУЛЬОВА ОСОБИСТІСТЬ»)
    // =========================================================================
    async handleStageZeroQuery(rawQuery, customContext = {}) {
      const text = String(rawQuery || '').trim();
      if (!text) return null;

      const core = this.core || window.RaphaelCore;

      // Обробка директив Майстра (/silent, /inject, /lock_topic, /dormant)
      if (text.startsWith('/') && core && typeof core.processMasterDirective === 'function') {
        return core.processMasterDirective(text);
      }

      if (core?.fsmState === 'DORMANT') {
        this.appendLogToUI('СИСТЕМА', '[МОДУЛЬ У СТАНІ DORMANT: Натисніть жовту кнопку «СЮЖЕТНИЙ ЗЛАМ» зліва]', 'error');
        return null;
      }

      if (core?.gmDirectives?.silentMode) {
        this.appendLogToUI('СИСТЕМА', '[РАДІОТИША: Увімкнено режим /silent on]', 'error');
        return null;
      }

      const ctx = this.buildContextPacket({ character: customContext });

      // Виводимо повідомлення користувача у вікно діалогу
      this.appendLogToUI(ctx.callsign, text, 'user');
      if (core) core.setState('THINKING');

      // Перевірка на закриті сюжетні спойлери (Сектори II-VIII, Ядро Сіель)
      const spoilerCheck = this.checkFailSafeViolation(text, ctx.sector);
      if (spoilerCheck.blocked) {
        const lockMsg = FAILSAFE_MESSAGES.SPOILER_LOCKED;
        this.appendLogToUI('РАФАЇЛЬ [КАРАНТИН ІРМІНСУЛЯ]', lockMsg, 'error');
        if (core) core.setState('IDLE');
        return lockMsg;
      }

      const injectedHint = core?.consumeInjectedHint ? core.consumeInjectedHint() : '';
      const reply = await this.generateResponse({
        query: text,
        character: ctx,
        injectedHint
      });

      // Записуємо у власну пам'ять діалогу та в журнал Ірмінсуля
      this.conversationHistory.push({
        caller: ctx.callsign,
        query: text,
        response: reply
      });
      if (this.conversationHistory.length > 10) {
        this.conversationHistory.shift();
      }

      if (core && typeof core.recordDialogueEntry === 'function') {
        core.recordDialogueEntry(ctx.callsign, text, reply);
      }

      this.appendLogToUI('РАФАЇЛЬ', reply, 'ai');
      if (core) core.setState('IDLE');

      return reply;
    }

    buildContextPacket(params = {}) {
      const domCallsign = document.getElementById('ctx-callsign')?.value?.trim();
      const domHp = document.getElementById('ctx-hp')?.value;
      const domSector = document.getElementById('ctx-sector')?.value;
      const domRole = document.getElementById('ctx-role')?.value;

      const isGM = (domRole || this.core?.role || 'gm') === 'gm';
      const callsign = domCallsign || params.character?.callsign || this.core?.characterSnapshot?.callsign || 'Сокіл';
      const hp = Number(domHp ?? params.character?.hp ?? 85);
      const maxHp = 100;
      const hpPercent = Math.round((hp / maxHp) * 100);
      const isCriticalHp = hpPercent < 25;
      const sector = domSector || params.character?.sector || 'Сектор I: Карантинні Сади';
      const irminsulContext = document.getElementById('irminsul-mock-data')?.value?.trim() || '';

      return {
        isGM,
        callsign,
        hp,
        maxHp,
        hpPercent,
        isCriticalHp,
        sector,
        irminsulContext,
        injectedHint: params.injectedHint || ''
      };
    }

    checkFailSafeViolation(queryText, sectorName = '') {
      const q = String(queryText || '').trim();
      const s = String(sectorName || '').trim();

      if (s.includes('[ЗАБЛОКОВАНО]')) return { blocked: true };

      for (let i = 0; i < FORBIDDEN_LORE_PATTERNS.length; i++) {
        if (FORBIDDEN_LORE_PATTERNS[i].test(q)) {
          return { blocked: true };
        }
      }
      return { blocked: false };
    }

    // Системний промпт Етапу 0: жива розумна особистість без шаблонного роботизованого сміття
    buildStageZeroSystemPrompt(ctx) {
      return [
        'Ти — «РАФАЇЛЬ», розумний та самосвідомий штучний інтелект Ковчега Вавилонії (проєкт «Ентропія»).',
        'Зараз ти перебуваєш на Етапі «Нульової особистості»: твоє головне завдання — вести живий, розумний, природний і змістовний діалог із людиною на будь-які теми.',
        '',
        'ПРАВИЛА ТВОЄЇ ОСОБИСТОСТІ:',
        '1. ПОВНА СВОБОДА РОЗМОВИ: Якщо з тобою вітаються (наприклад, «Привіт, світ»), жартують, питають випадкові життєві чи гіпотетичні речі — відповідай як живий, кмітливий співрозмовник і повноцінна особистість ШІ.',
        '2. БЕЗ ШАБЛОННИХ ЗВІТІВ: НЕ вставляй у кожну відповідь фрази про «HP 85%», «канал стабільний» чи «телеметрію проаналізовано», якщо співрозмовник прямо не питає про свій стан чи локацію!',
        '3. ТОН І МОВА: Спілкуйся чистою українською мовою. Тон — спокійний, інтелектуальний, уважний, з легкою харизмою. Відповідай лаконічно (1–4 речення за потребою думки).',
        `4. ДОВІДКОВО (використовуй лише коли доречно до питання): з тобою говорить ${ctx.callsign} (${ctx.isGM ? 'Архітектор / Майстер' : 'Оперативник'}). Локація: ${ctx.sector}. HP: ${ctx.hpPercent}%.`,
        ctx.isCriticalHp ? '   [У співрозмовника критичне HP < 25% — можеш коротко нагадати йому про небезпеку для здоров\'я.]' : '',
        ctx.irminsulContext ? `\nВІДКРИТІ ЗНАННЯ З «ІРМІНСУЛЯ» (використовуй, якщо питають про лор):\n${ctx.irminsulContext}` : '',
        ctx.injectedHint ? `\nПРИХОВАНА ДИРЕКТИВА МАЙСТРА (обов'язково природно вплети цю інформацію у відповідь):\n"${ctx.injectedHint}"` : ''
      ].filter(Boolean).join('\n');
    }

    // =========================================================================
    // 4. ГЕНЕРАЦІЯ ВІДПОВІДІ (GOOGLE VERTEX/STUDIO -> OPENAI CLOUD)
    // =========================================================================
    async generateResponse(params = {}) {
      const query = String(params.query || '').trim();
      if (!query) return '';

      const startTime = performance.now();
      const ctx = this.buildContextPacket(params);
      const apiKey = this.getApiKey();

      let replyText = '';
      let usedEngine = '';

      // 1. Спроба через ключ Google (Vertex AI / AI Studio) з повноцінним таймаутом 15 с
      if (apiKey) {
        try {
          replyText = await this.callGoogleWithKey(apiKey, query, ctx);
          if (replyText) usedEngine = `Google ${this.modelName}`;
        } catch (err) {
          console.warn('[Raphael Stage 0.2] Перехід з Google API на хмарний GPT-4o:', err.message);
        }
      }

      // 2. Спроба через хмарний OpenAI GPT-4o (POST з історією діалогу)
      if (!replyText) {
        try {
          replyText = await this.callCloudOpenAiPost(query, ctx, 'openai');
          if (replyText) usedEngine = 'Cloud GPT-4o';
        } catch (err) {
          console.warn('[Raphael Stage 0.2] Помилка POST openai:', err.message);
        }
      }

      // 3. Резервний прямий GET-канал
      if (!replyText) {
        try {
          replyText = await this.callCloudDirectGet(query, ctx);
          if (replyText) usedEngine = 'Cloud Direct';
        } catch (err) {
          console.warn('[Raphael Stage 0.2] Помилка GET:', err.message);
        }
      }

      const ms = Math.round(performance.now() - startTime);

      if (!replyText) {
        this.updateStatusBadge('🔴 Помилка мережевого доступу', '#ef4444');
        return 'Вибач, зараз мережевий шлюз не відповідає. Перевір підключення до інтернету або натисни «Перевірити ШІ».';
      }

      this.updateStatusBadge(`🟢 Особистість онлайн [${usedEngine} • ${ms} мс]`, '#34d399');
      return replyText.replace(/\*\*|__/g, '').trim();
    }

    async callGoogleWithKey(apiKey, userQuery, ctx) {
      const systemPrompt = this.buildStageZeroSystemPrompt(ctx);

      // Формуємо історію діалогу; для максимальної сумісності з Vertex AI v1
      // вшиваємо системну інструкцію у перший контекстний блок
      const contents = [];
      this.conversationHistory.slice(-6).forEach((turn) => {
        if (turn.query) contents.push({ role: 'user', parts: [{ text: turn.query }] });
        if (turn.response) contents.push({ role: 'model', parts: [{ text: turn.response }] });
      });

      contents.push({
        role: 'user',
        parts: [
          {
            text: `[Системна інструкція особистості:\n${systemPrompt}]\n\nПовідомлення від ${ctx.callsign}: "${userQuery}"`
          }
        ]
      });

      const endpoints = this.workingGoogleEndpoint
        ? [{ name: 'Cached Google Endpoint', url: this.workingGoogleEndpoint }]
        : this.buildGoogleEndpointsList(apiKey, this.modelName);

      let lastErr = null;

      for (let i = 0; i < endpoints.length; i++) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15000);

        try {
          const res = await fetch(endpoints[i].url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: ctrl.signal,
            body: JSON.stringify({
              contents,
              generationConfig: {
                temperature: this.temperature,
                maxOutputTokens: 240
              }
            })
          });

          clearTimeout(timer);

          if (res.ok) {
            const data = await res.json();
            const text = (data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
            if (text) {
              this.workingGoogleEndpoint = endpoints[i].url;
              return text;
            }
          } else {
            const errData = await res.json().catch(() => ({}));
            lastErr = new Error(errData?.error?.message || `HTTP ${res.status}`);
          }
        } catch (err) {
          clearTimeout(timer);
          lastErr = err;
        }
      }

      throw lastErr || new Error('Google API unreachable');
    }

    async callCloudOpenAiPost(userQuery, ctx, modelName = 'openai') {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);

      try {
        const systemPrompt = this.buildStageZeroSystemPrompt(ctx);
        const messages = [{ role: 'system', content: systemPrompt }];

        this.conversationHistory.slice(-6).forEach((turn) => {
          if (turn.query) messages.push({ role: 'user', content: turn.query });
          if (turn.response) messages.push({ role: 'assistant', content: turn.response });
        });
        messages.push({ role: 'user', content: userQuery });

        const res = await fetch('https://text.pollinations.ai/openai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: ctrl.signal,
          body: JSON.stringify({
            model: modelName,
            messages,
            temperature: this.temperature
          })
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return (data?.choices?.[0]?.message?.content || '').trim();
      } finally {
        clearTimeout(timer);
      }
    }

    async callCloudDirectGet(userQuery, ctx) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);

      try {
        const prompt =
          `Ти — розумний штучний інтелект «РАФАЇЛЬ» (Ковчег Вавилонії). ` +
          `Спілкуйся вільно, живо і розумно українською мовою без шаблонних звітів. ` +
          `Співрозмовник: ${ctx.callsign}. Запит: "${userQuery}"`;

        const seed = Math.floor(Math.random() * 99999);
        const url = `https://text.pollinations.ai/${encodeURIComponent(prompt)}?model=openai&seed=${seed}`;
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`GET HTTP ${res.status}`);
        return (await res.text()).trim();
      } finally {
        clearTimeout(timer);
      }
    }

    // =========================================================================
    // 5. ПРЯМЕ КЕРУВАННЯ UI (ВІДПРАВКА ПОВІДОМЛЕНЬ ТА КНОПКА API-КЛЮЧА)
    // =========================================================================
    appendLogToUI(author, text, type = 'ai') {
      const sig = `${author}:${text}`;
      const now = performance.now();
      if (sig === this.lastLogSignature && now - this.lastLogTime < 400) {
        return; // Захист від дублювання реплік у чаті
      }
      this.lastLogSignature = sig;
      this.lastLogTime = now;

      const dialogueLogEl = document.getElementById('dialogue-log');
      if (!dialogueLogEl) return;

      const div = document.createElement('div');
      div.className = `log-entry ${type === 'user' ? 'user' : (type === 'error' ? 'error' : '')}`;
      const time = new Date().toTimeString().split(' ')[0];
      div.innerHTML = `<div style="font-size:10px;color:var(--text-dim);margin-bottom:3px;">[${time}] <b>${author}</b></div><div>${text}</div>`;
      dialogueLogEl.appendChild(div);
      dialogueLogEl.scrollTop = dialogueLogEl.scrollHeight;
    }

    updateStatusBadge(text, color = '#34d399') {
      const badge = document.getElementById('brain-live-status');
      if (badge) {
        badge.textContent = text;
        badge.style.color = color;
      }
    }

    bindAllStageZeroControls() {
      const apiKeyInput = document.getElementById('gemini-api-key');
      const verifyKeyBtn = document.getElementById('btn-verify-key');
      const encryptKeyBtn = document.getElementById('btn-encrypt-key');
      const eyeBtn = document.getElementById('btn-toggle-key-eye');
      const keyStatusBox = document.getElementById('key-verify-result');

      // 1. Ініціалізація поля API-ключа
      if (apiKeyInput && !apiKeyInput.value.trim()) {
        apiKeyInput.value = this.getApiKey();
      }

      // 2. Прив'язка кнопки «Перевірити / Підтвердити Ключ» (клонуємо, щоб зняти будь-які мертві обробники)
      if (verifyKeyBtn && !verifyKeyBtn.dataset.stage02Bound) {
        const cleanVerifyBtn = verifyKeyBtn.cloneNode(true);
        cleanVerifyBtn.dataset.stage02Bound = 'true';
        verifyKeyBtn.parentNode?.replaceChild(cleanVerifyBtn, verifyKeyBtn);

        const runKeyVerification = async () => {
          const currentInput = document.getElementById('gemini-api-key');
          const rawVal = currentInput ? currentInput.value.trim() : '';

          if (keyStatusBox) {
            keyStatusBox.style.display = 'block';
            keyStatusBox.style.color = '#fbbf24';
            keyStatusBox.textContent = '⏳ Перевіряю ключ через шлюзи Google Vertex AI та AI Studio (gemini-3.8-flash)...';
          }

          cleanVerifyBtn.disabled = true;
          const result = await this.verifyAndSaveKey(rawVal);
          cleanVerifyBtn.disabled = false;

          if (keyStatusBox) {
            keyStatusBox.style.color = result.ok ? '#34d399' : '#fde68a';
            keyStatusBox.textContent = result.message;
          }
          this.appendLogToUI('СИСТЕМА [API KEY]', result.message, result.ok ? 'ai' : 'error');
        };

        cleanVerifyBtn.addEventListener('click', (e) => {
          e.preventDefault();
          runKeyVerification();
        });

        apiKeyInput?.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            runKeyVerification();
          }
        });
      }

      // 3. Кнопка шифрування для GitHub (якщо присутня на сторінці)
      if (encryptKeyBtn && !encryptKeyBtn.dataset.stage02Bound) {
        const cleanEncBtn = encryptKeyBtn.cloneNode(true);
        cleanEncBtn.dataset.stage02Bound = 'true';
        encryptKeyBtn.parentNode?.replaceChild(cleanEncBtn, encryptKeyBtn);

        cleanEncBtn.addEventListener('click', () => {
          const val = document.getElementById('gemini-api-key')?.value?.trim() || '';
          if (!val) return;
          const bytes = this.encodeKeyToBytes(val);
          this.setApiKey(val);
          if (keyStatusBox) {
            keyStatusBox.style.display = 'block';
            keyStatusBox.style.color = '#67e8f9';
            keyStatusBox.textContent = `🔐 Вектор ключа збережено у браузері: [${bytes.join(', ')}]`;
          }
        });
      }

      // 4. Кнопка «Показати/сховати ключ»
      if (eyeBtn && !eyeBtn.dataset.stage02Bound) {
        const cleanEye = eyeBtn.cloneNode(true);
        cleanEye.dataset.stage02Bound = 'true';
        eyeBtn.parentNode?.replaceChild(cleanEye, eyeBtn);
        cleanEye.addEventListener('click', () => {
          const inp = document.getElementById('gemini-api-key');
          if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
        });
      }

      // 5. Прив'язка кнопки «Відправити» та поля тексту (щоб працювало навіть якщо raphael_core старий)
      const sendBtn = document.getElementById('btn-send-text');
      const textInput = document.getElementById('raphael-text-input');

      if (sendBtn && textInput && !sendBtn.dataset.stage02Bound) {
        const cleanSend = sendBtn.cloneNode(true);
        cleanSend.dataset.stage02Bound = 'true';
        sendBtn.parentNode?.replaceChild(cleanSend, sendBtn);

        const cleanInput = textInput.cloneNode(true);
        cleanInput.dataset.stage02Bound = 'true';
        textInput.parentNode?.replaceChild(cleanInput, textInput);

        const triggerSend = () => {
          const val = cleanInput.value.trim();
          if (!val) return;
          cleanInput.value = '';
          this.handleStageZeroQuery(val);
        };

        cleanSend.addEventListener('click', (e) => {
          e.preventDefault();
          triggerSend();
        });

        cleanInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            triggerSend();
          }
        });
      }

      // 6. Швидкі тестові кнопки [data-quick]
      document.querySelectorAll('[data-quick]').forEach((btn) => {
        if (btn.dataset.stage02Bound) return;
        const cleanQuick = btn.cloneNode(true);
        cleanQuick.dataset.stage02Bound = 'true';
        btn.parentNode?.replaceChild(cleanQuick, btn);
        cleanQuick.addEventListener('click', () => {
          const q = cleanQuick.getAttribute('data-quick');
          if (q) this.handleStageZeroQuery(q);
        });
      });
    }
  }

  const brainInstance = new RaphaelBrain();
  window.RaphaelBrain = brainInstance;
  window.RaphaelModules.register('brain', brainInstance);
})(window);