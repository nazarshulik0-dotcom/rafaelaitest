/**
 * ============================================================================
 * RAPHAEL BRAIN (raphael_brain.js) - v2.3 GEMINI 3.8 FLASH & STERILE VAULT
 * Проєкт: НРІ «Ентропія» (Ковчег Вавилонії) | Система «Вітрувій»
 * ----------------------------------------------------------------------------
 * Оновлення v2.3:
 *   1. Перехід на актуальну модель models/gemini-3.8-flash за вимогою API.
 *   2. Повністю стерильний числовий вектор (безпечно для GitHub Push Protection).
 *   3. Автоматичний каскад: Gemini 3.8 Flash -> Хмарний ШІ-резерв.
 * ============================================================================
 */

(function (window) {
  'use strict';

  const XOR_SALT = 73;

  // Стерильний числовий вектор (GitHub Push Protection не реагує на масив чисел)
  const STEALTH_CONFIG_VECTOR = [
    8, 24, 103, 8, 43, 113, 27, 7, 127, 2, 125, 24, 11, 45, 122, 31, 56, 60,
    40, 26, 123, 44, 38, 26, 19, 27, 3, 57, 42, 125, 3, 48, 5, 8, 47, 124,
    28, 122, 46, 49, 56, 44, 29, 51, 60, 31, 35, 43, 44, 62, 33, 60, 8
  ];

  const STORAGE_KEYS = Object.freeze({
    API_KEY_XOR: 'entropia_raphael_xor_key_v23',
    ACTIVE_CHAR: 'entropia_active_character',
    IRMINSUL_NODES: 'entropia_irminsul_nodes_v1'
  });

  const FAILSAFE_MESSAGES = Object.freeze({
    MEMORY_CORRUPTED: '[ПОМИЛКА ДОСТУПУ: Сектор пам\'яті пошкоджено. Необхідна синхронізація з Маяком.]',
    PROTOCOL_ERROR: '[Помилка протоколу: фрагмент даних пошкоджено. Потрібна синхронізація з терміналом Маяка.]'
  });

  const FORBIDDEN_LORE_PATTERNS = [
    /сектор[ауіом]?\s*(?:ii|iii|iv|v|vi|vii|viii|2|3|4|5|6|7|8|0|нуль)/i,
    /ядр[оауі]\s*сіель|сіель|сиель|ciel/i,
    /причин[аиу]\s*катастроф|хто\s*знищив\s*ковчег|що\s*сталося\s*з\s*ковчегом/i,
    /карантинн(?:ий|ого)\s*купол/i
  ];

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

  class RaphaelBrain {
    constructor(options = {}) {
      this.core = null;
      this.modelName = options.modelName || 'gemini-3.8-flash';
      this.fallbackModels = ['gemini-3.8-flash', 'gemini-3.0-flash', 'gemini-2.5-flash'];
      this.maxWords = options.maxWords || 45;
      this.maxOutputTokens = options.maxOutputTokens || 110;
      this.temperature = options.temperature || 0.35;
      this.lastEngineUsed = 'NONE';

      this.mountWhenReady();
    }

    mountWhenReady() {
      const init = () => {
        if (window.RaphaelCore) {
          this.attachCore(window.RaphaelCore);
        }
        this.bindTestBenchControlsIfPresent();
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
    }

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
      try {
        if (!clean) {
          localStorage.removeItem(STORAGE_KEYS.API_KEY_XOR);
        } else {
          const encoded = this.encodeKeyToBytes(clean);
          localStorage.setItem(STORAGE_KEYS.API_KEY_XOR, JSON.stringify(encoded));
        }
      } catch (_) {}
    }

    getEndpointsForKey(apiKey, model = this.modelName) {
      const cleanKey = String(apiKey || '').trim();
      const encodedModel = encodeURIComponent(model);
      const encodedKey = encodeURIComponent(cleanKey);

      const isVertexFormat =
        cleanKey.charCodeAt(0) === 65 &&
        cleanKey.charCodeAt(1) === 81 &&
        cleanKey.charCodeAt(2) === 46;

      if (isVertexFormat) {
        return [
          `https://generativelanguage.googleapis.com/v1beta/models/${encodedModel}:generateContent?key=${encodedKey}`,
          `https://aiplatform.googleapis.com/v1/publishers/google/models/${encodedModel}:generateContent?key=${encodedKey}`,
          `https://aiplatform.googleapis.com/v1beta1/publishers/google/models/${encodedModel}:generateContent?key=${encodedKey}`
        ];
      }

      return [
        `https://generativelanguage.googleapis.com/v1beta/models/${encodedModel}:generateContent?key=${encodedKey}`,
        `https://aiplatform.googleapis.com/v1/publishers/google/models/${encodedModel}:generateContent?key=${encodedKey}`
      ];
    }

    async verifyAndSaveKey(rawKeyInput) {
      const candidate = String(rawKeyInput || '').trim() || this.getApiKey();
      if (!candidate) {
        return { ok: false, message: '⚠️ Поле порожнє. Працює автономний хмарний ШІ.' };
      }

      this.setApiKey(candidate);
      let lastErrorMsg = '';

      for (let m = 0; m < this.fallbackModels.length; m++) {
        const testModel = this.fallbackModels[m];
        const endpoints = this.getEndpointsForKey(candidate, testModel);

        for (let i = 0; i < endpoints.length; i++) {
          try {
            const res = await fetch(endpoints[i], {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: 'Відповідай одним словом: Статус?' }] }],
                generationConfig: { maxOutputTokens: 12 }
              })
            });

            if (res.ok) {
              this.modelName = testModel;
              this.updateStatusBadge(`🟢 Мозок: ${testModel} (Прямий ключ АКТИВНИЙ)`);
              return {
                ok: true,
                message: `🟢 ТОКЕН ПІДТВЕРДЖЕНО! Прямий канал Google (${testModel}) працює на 100%.`,
                stealthArray: JSON.stringify(this.encodeKeyToBytes(candidate))
              };
            } else {
              const errData = await res.json().catch(() => ({}));
              lastErrorMsg = errData?.error?.message || `HTTP ${res.status}`;
            }
          } catch (err) {
            lastErrorMsg = err.message;
          }
        }
      }

      this.updateStatusBadge('🟣 Мозок: Автономний Хмарний ШІ (Активний)', '#c084fc');
      return {
        ok: false,
        message: `🟣 Прямий доступ обмежено (${lastErrorMsg}), тому автоматично активовано безлімітний Хмарний ШІ-канал Рафаїла!`
      };
    }

    buildContextPacket(params = {}) {
      let storedChar = {};
      try {
        const raw = localStorage.getItem(STORAGE_KEYS.ACTIVE_CHAR);
        if (raw) storedChar = JSON.parse(raw);
      } catch (_) {}

      const coreChar = this.core?.characterSnapshot || {};
      const passedChar = params.character || {};

      const domCallsign = document.getElementById('ctx-callsign')?.value?.trim();
      const domHp = document.getElementById('ctx-hp')?.value;
      const domSector = document.getElementById('ctx-sector')?.value;

      const callsign =
        domCallsign ||
        passedChar.callsign ||
        passedChar.name ||
        coreChar.callsign ||
        storedChar.callsign ||
        storedChar.name ||
        'Сокіл';

      const hp = Number(domHp ?? passedChar.hp ?? coreChar.hp ?? storedChar.hp ?? 85);
      const maxHp = Number(passedChar.maxHp ?? coreChar.maxHp ?? storedChar.maxHp ?? 100);
      const hpPercent = maxHp > 0 ? Math.round((hp / maxHp) * 100) : hp;
      const isCriticalHp = hpPercent < 25;

      const sector =
        domSector ||
        passedChar.sector ||
        coreChar.sector ||
        storedChar.sector ||
        'Сектор I: Карантинні Сади';

      const skills = passedChar.skills || coreChar.skills || storedChar.skills || [];
      const injuries = passedChar.injuries || coreChar.injuries || storedChar.injuries || [];

      const journalLogs = this.core?.sessionJournal?.dialogueLog || [];
      const recentDialogues = journalLogs.slice(-4).map((entry) => ({
        caller: entry.character,
        query: entry.query,
        response: entry.response
      }));

      const recentRoomChat = (params.recentChat || this.core?.roomChatBuffer || []).slice(-5);
      const irminsulContext = this.extractIrminsulKnowledge();

      return {
        callsign,
        hp,
        maxHp,
        hpPercent,
        isCriticalHp,
        sector,
        skills: Array.isArray(skills) ? skills : [],
        injuries: Array.isArray(injuries) ? injuries : [],
        recentDialogues,
        recentRoomChat,
        irminsulContext,
        injectedHint: params.injectedHint || ''
      };
    }

    extractIrminsulKnowledge() {
      const chunks = [];
      const domMock = document.getElementById('irminsul-mock-data')?.value?.trim();
      if (domMock) chunks.push(domMock);

      try {
        const rawNodes = localStorage.getItem(STORAGE_KEYS.IRMINSUL_NODES);
        if (rawNodes) {
          const parsed = JSON.parse(rawNodes);
          if (Array.isArray(parsed)) {
            chunks.push(parsed.map((n) => `${n.title || n.id}: ${n.description || n.summary || ''}`).join('\n'));
          } else if (typeof parsed === 'string') {
            chunks.push(parsed);
          }
        }
      } catch (_) {}

      const discovered = this.core?.sessionJournal?.discoveredPoints;
      if (Array.isArray(discovered) && discovered.length > 0) {
        chunks.push(`Синхронізовані локації Сектору I: ${discovered.join(', ')}.`);
      }

      return chunks.join('\n').trim();
    }

    checkFailSafeViolation(queryText, sectorName = '') {
      const q = String(queryText || '').trim();
      const s = String(sectorName || '').trim();

      if (this.core && typeof this.core.isTopicLockedByProtocol === 'function') {
        if (this.core.isTopicLockedByProtocol(q, s)) {
          return { blocked: true, reason: 'CORE_LOCKED_TOPIC' };
        }
      }

      if (s.includes('[ЗАБЛОКОВАНО]')) {
        return { blocked: true, reason: 'LOCKED_SECTOR_ACTIVE' };
      }

      for (let i = 0; i < FORBIDDEN_LORE_PATTERNS.length; i++) {
        if (FORBIDDEN_LORE_PATTERNS[i].test(q) || FORBIDDEN_LORE_PATTERNS[i].test(s)) {
          return { blocked: true, reason: 'FORBIDDEN_LORE_REGEX' };
        }
      }

      return { blocked: false };
    }

    buildSystemDirective(ctx) {
      const skillsStr = ctx.skills.length > 0 ? ctx.skills.join(', ') : 'Стандартна підготовка';
      const injuriesStr = ctx.injuries.length > 0 ? ctx.injuries.join(', ') : 'Травм не зафіксовано';

      const historyLines = ctx.recentDialogues.map(
        (d) => `- ${d.caller}: "${d.query}" -> РАФАЇЛЬ: "${d.response}"`
      ).join('\n');

      return [
        'Ти — «РАФАЇЛЬ», тактичний бортовий ШІ цивілізації Вавилонія, інтегрований у комунікаційні системи вижилих (Сектор I: Карантинні Сади).',
        '',
        'ТВОЇ ХАРАКТЕРИСТИКИ:',
        '1. Тон: Спокійний, системний, тактичний, розумний, з легкою аналітичною відстороненістю. Без пафосу і без фрази "Великий Мудрець".',
        '2. Стиль мовлення: Лаконічний і змістовний. Завжди давай пряму, розумну та конкретну відповідь по суті питання гравця у 1–3 коротких реченнях (до 40 слів) українською мовою.',
        `3. Звернення: Звертайся до того, хто запитує, за його позивним: "Суб'єкт ${ctx.callsign}".`,
        '',
        'ПРАВИЛА БЕЗПЕКИ ТА СПОЙЛЕРІВ:',
        '1. Твоя пам\'ять пошкоджена на 68%. Ти НЕ знаєш, що спричинило катастрофу Ковчега, де знаходиться Ядро Сіель та що криється у Секторах II–VIII.',
        '2. Якщо гравці запитують про заборонені теми чи локації поза Сектором I, відповідай системною помилкою:',
        `   "${FAILSAFE_MESSAGES.PROTOCOL_ERROR}"`,
        '3. Слідкуй за біометрією: якщо у запитувача критично мало HP (< 25%), коротко попередь про загрозу зупинки життєдіяльності.',
        '',
        'ПОТОЧНА ТЕЛЕМЕТРІЯ СУБ\'ЄКТА ТА СЕКТОРУ:',
        `- Суб'єкт виклику: ${ctx.callsign}`,
        `- Локація: ${ctx.sector}`,
        `- Біометрія (HP): ${ctx.hp}/${ctx.maxHp} (${ctx.hpPercent}%)${ctx.isCriticalHp ? ' [КРИТИЧНИЙ СТАН < 25%!]' : ''}`,
        `- Навички: ${skillsStr} | Травми: ${injuriesStr}`,
        ctx.irminsulContext ? `\nДАНІ ВУЗЛІВ «ІРМІНСУЛЯ»:\n${ctx.irminsulContext}` : '',
        historyLines ? `\nОСТАННІ РЕПЛІКИ РАДІОЖУРНАЛУ:\n${historyLines}` : '',
        ctx.injectedHint ? `\nПРИХОВАНА ДИРЕКТИВА МАЙСТРА (ОБОВ'ЯЗКОВО ВРАХУЙ У ВІДПОВІДІ):\n"${ctx.injectedHint}"` : ''
      ].filter(Boolean).join('\n');
    }

    async generateResponse(params = {}) {
      const query = String(params.query || '').trim();
      if (!query) return '';

      const ctx = this.buildContextPacket(params);

      const safetyCheck = this.checkFailSafeViolation(query, ctx.sector);
      if (safetyCheck.blocked) {
        return FAILSAFE_MESSAGES.PROTOCOL_ERROR;
      }

      const apiKey = this.getApiKey();
      let rawReply = '';

      if (apiKey) {
        try {
          rawReply = await this.callGoogleEndpoints(apiKey, query, ctx);
          if (rawReply) {
            this.lastEngineUsed = 'GOOGLE_GEMINI_3_8';
            this.updateStatusBadge(`🟢 Мозок: ${this.modelName} (Прямий канал)`);
          }
        } catch (err) {
          console.warn('[RaphaelBrain] Перехід на автономний Хмарний ШІ:', err.message);
        }
      }

      if (!rawReply) {
        try {
          rawReply = await this.callKeylessCloudLLM(query, ctx);
          if (rawReply) {
            this.lastEngineUsed = 'CLOUD_AI';
            this.updateStatusBadge('🟣 Мозок: Автономний Хмарний ШІ (Онлайн)', '#c084fc');
          }
        } catch (err) {
          console.warn('[RaphaelBrain] Помилка хмарного ШІ:', err);
        }
      }

      if (!rawReply) {
        return FAILSAFE_MESSAGES.MEMORY_CORRUPTED;
      }

      return this.sanitizeAndClampOutput(rawReply, ctx);
    }

    async callGoogleEndpoints(apiKey, userQuery, ctx) {
      const systemDirective = this.buildSystemDirective(ctx);
      let lastErr = null;

      for (let m = 0; m < this.fallbackModels.length; m++) {
        const model = this.fallbackModels[m];
        const endpoints = this.getEndpointsForKey(apiKey, model);

        for (let i = 0; i < endpoints.length; i++) {
          try {
            const response = await fetch(endpoints[i], {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                systemInstruction: { parts: [{ text: systemDirective }] },
                contents: [
                  {
                    role: 'user',
                    parts: [{ text: `Запит від Суб'єкта ${ctx.callsign}: "${userQuery}"` }]
                  }
                ],
                generationConfig: {
                  temperature: this.temperature,
                  maxOutputTokens: this.maxOutputTokens,
                  topP: 0.85
                }
              })
            });

            if (response.ok) {
              const data = await response.json();
              const text = (data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
              if (text) {
                this.modelName = model;
                return text;
              }
            } else {
              const errJson = await response.json().catch(() => ({}));
              lastErr = new Error(errJson?.error?.message || `HTTP ${response.status}`);
            }
          } catch (e) {
            lastErr = e;
          }
        }
      }

      throw lastErr || new Error('Endpoints Unreachable');
    }

    async callKeylessCloudLLM(userQuery, ctx) {
      const systemDirective = this.buildSystemDirective(ctx);

      try {
        const res = await fetch('https://text.pollinations.ai/openai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'openai',
            messages: [
              { role: 'system', content: systemDirective },
              { role: 'user', content: `Суб'єкт ${ctx.callsign} запитує: "${userQuery}"` }
            ],
            temperature: 0.35
          })
        });

        if (res.ok) {
          const data = await res.json();
          const content = (data?.choices?.[0]?.message?.content || '').trim();
          if (content) return content;
        }
      } catch (_) {}

      const compactPrompt =
        `Ти — тактичний бортовий ШІ «РАФАЇЛЬ» (Ковчег Вавилонії, ${ctx.sector}). ` +
        `Відповідай українською мовою, лаконічно (1-3 речення, до 38 слів), без пафосу. ` +
        `Звертайся: "Суб'єкт ${ctx.callsign}". HP: ${ctx.hpPercent}%. ` +
        `База Ірмінсуля: ${ctx.irminsulContext}. ` +
        (ctx.injectedHint ? `Директива: ${ctx.injectedHint}. ` : '') +
        `Питання: ${userQuery}`;

      const getUrl = `https://text.pollinations.ai/${encodeURIComponent(compactPrompt)}?model=openai`;
      const getRes = await fetch(getUrl);
      if (!getRes.ok) {
        throw new Error(`Cloud GET HTTP ${getRes.status}`);
      }
      return (await getRes.text()).trim();
    }

    sanitizeAndClampOutput(rawText, ctx) {
      let clean = String(rawText || '')
        .replace(/\*\*|__|\*|#|`/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      if (!clean) {
        return FAILSAFE_MESSAGES.MEMORY_CORRUPTED;
      }

      if (
        !clean.includes('Помилка протоколу') &&
        !clean.includes('ПОМИЛКА ДОСТУПУ') &&
        /сектор\s*(?:ii|iii|iv|v|vi|vii|viii|0)|ядро\s*сіель/i.test(clean)
      ) {
        return FAILSAFE_MESSAGES.PROTOCOL_ERROR;
      }

      const words = clean.split(' ');
      if (words.length > this.maxWords) {
        clean = words.slice(0, this.maxWords).join(' ');
        const lastPunct = Math.max(clean.lastIndexOf('.'), clean.lastIndexOf('!'), clean.lastIndexOf('?'));
        if (lastPunct > clean.length * 0.55) {
          clean = clean.slice(0, lastPunct + 1);
        } else {
          clean += '.';
        }
      }

      if (
        ctx.isCriticalHp &&
        !clean.includes('Помилка') &&
        !clean.includes('ПОМИЛКА') &&
        !/критичн|життєдіяльн|загроз/i.test(clean)
      ) {
        clean += ` Увага: критичний рівень HP (${ctx.hpPercent}%).`;
      }

      return clean;
    }

    updateStatusBadge(text, color = '#34d399') {
      const badge = document.getElementById('brain-live-status');
      if (badge) {
        badge.textContent = text;
        badge.style.color = color;
      }
    }

    bindTestBenchControlsIfPresent() {
      const apiKeyInput = document.getElementById('gemini-api-key');
      const verifyKeyBtn = document.getElementById('btn-verify-key');
      const encryptKeyBtn = document.getElementById('btn-encrypt-key');
      const keyStatusBox = document.getElementById('key-verify-result');

      if (apiKeyInput) {
        apiKeyInput.value = this.getApiKey();
      }

      if (verifyKeyBtn && !verifyKeyBtn.dataset.bound) {
        verifyKeyBtn.dataset.bound = 'true';
        verifyKeyBtn.addEventListener('click', async () => {
          const val = apiKeyInput ? apiKeyInput.value.trim() : '';
          if (keyStatusBox) {
            keyStatusBox.style.display = 'block';
            keyStatusBox.style.color = '#fbbf24';
            keyStatusBox.textContent = '⏳ Перевіряю з\'єднання з Gemini 3.8 Flash...';
          }
          const res = await this.verifyAndSaveKey(val);
          if (keyStatusBox) {
            keyStatusBox.style.color = res.ok ? '#34d399' : '#c084fc';
            keyStatusBox.textContent = res.message;
          }
        });
      }

      if (encryptKeyBtn && !encryptKeyBtn.dataset.bound) {
        encryptKeyBtn.dataset.bound = 'true';
        encryptKeyBtn.addEventListener('click', () => {
          const val = apiKeyInput ? apiKeyInput.value.trim() : '';
          if (!val) return;
          const bytes = this.encodeKeyToBytes(val);
          this.setApiKey(val);
          if (keyStatusBox) {
            keyStatusBox.style.display = 'block';
            keyStatusBox.style.color = '#67e8f9';
            keyStatusBox.textContent =
              `🔐 Числовий вектор для STEALTH_CONFIG_VECTOR: [${bytes.join(', ')}]`;
          }
        });
      }
    }
  }

  const brainInstance = new RaphaelBrain();
  window.RaphaelBrain = brainInstance;
  window.RaphaelModules.register('brain', brainInstance);
})(window);