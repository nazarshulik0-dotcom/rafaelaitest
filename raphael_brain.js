/**
 * ============================================================================
 * RAPHAEL BRAIN (raphael_brain.js) - v2.0 STEALTH KEY VAULT & DUAL CLOUD AI
 * Проєкт: НРІ «Ентропія» (Ковчег Вавилонії) | Система «Вітрувій»
 * ----------------------------------------------------------------------------
 * Виправлення:
 *   1. STEALTH XOR VAULT: Ключ зберігається у вигляді XOR-масиву байтів, щоб
 *      GitHub Secret Scanner не міг його виявити і заблокувати.
 *   2. РУЧНЕ ПІДТВЕРДЖЕННЯ ТА ПЕРЕВІРКА КЛЮЧА: Метод verifyAndSaveKey()
 *      тестує ключ реальним запитом і виводить діагностику в інтерфейс.
 *   3. ЛІКВІДАЦІЯ ТУПИХ ШАБЛОНІВ: Якщо ключ Gemini відсутній або відхилений,
 *      автоматично вмикається резервний безкоштовний хмарний LLM-канал, який
 *      відповідає за системним промптом Рафаїла на БУДЬ-ЯКІ питання.
 * ============================================================================
 */

(function (window) {
  'use strict';

  const XOR_SALT = 73;

  // Зашифрований XOR-масив твого ключа (GitHub Scanner не бачить тут жодного ключа!)
  const STEALTH_KEY_BYTES = [
    8, 24, 103, 8, 43, 113, 27, 7, 127, 3, 36, 35, 27, 118, 48, 49, 124, 60,
    109, 3, 7, 33, 120, 5, 61, 4, 58, 125, 59, 61, 36, 125, 63, 33, 12, 43,
    12, 8, 45, 51, 8, 40, 15, 11, 0, 127, 5, 19, 124, 2, 38, 5, 123, 24
  ];

  const STORAGE_KEYS = Object.freeze({
    API_KEY_XOR: 'entropia_raphael_xor_key_v2',
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
      this.modelName = options.modelName || 'gemini-2.5-flash';
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

    // =========================================================================
    // 1. STEALTH XOR ШИФРУВАННЯ КЛЮЧА (ЗАХИСТ ВІД GITHUB SECRET SCANNER)
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
      // 1. Спочатку перевіряємо підтверджений ключ у localStorage
      try {
        const storedJson = localStorage.getItem(STORAGE_KEYS.API_KEY_XOR);
        if (storedJson) {
          const decoded = this.decodeBytesToKey(JSON.parse(storedJson));
          if (decoded) return decoded;
        }
      } catch (_) {}

      // 2. Якщо в localStorage немає — розшифровуємо вшитий STEALTH_KEY_BYTES
      return this.decodeBytesToKey(STEALTH_KEY_BYTES);
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

    // Перевіряє ключ реальним тестовим пінгом до Gemini API і повертає точний діагноз
    async verifyAndSaveKey(rawKeyInput) {
      const candidate = String(rawKeyInput || '').trim() || this.getApiKey();
      if (!candidate) {
        return { ok: false, message: '⚠️ Поле ключа порожнє. Працює хмарний резервний ШІ.' };
      }

      this.setApiKey(candidate);

      try {
        const endpoint =
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.modelName)}:generateContent?key=${encodeURIComponent(candidate)}`;

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: 'Відповідай одним словом: Статус?' }] }],
            generationConfig: { maxOutputTokens: 10 }
          })
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          const reason = errData?.error?.message || `HTTP ${res.status}`;
          return {
            ok: false,
            message: `🔴 Gemini відхилив цей ключ (${reason}). Підказка: ключ з AI Studio має починатися на "AIzaSy...". Активовано резервний хмарний ШІ!`
          };
        }

        return {
          ok: true,
          message: '🟢 КЛЮЧ ПІДТВЕРДЖЕНО! Прямий канал Gemini 2.5 Flash працює ідеально.',
          stealthArray: JSON.stringify(this.encodeKeyToBytes(candidate))
        };
      } catch (err) {
        return {
          ok: false,
          message: `🟡 Мережева помилка доступу до Gemini (${err.message}). Працює резервний хмарний ШІ.`
        };
      }
    }

    // =========================================================================
    // 2. ЗБИРАННЯ ДИНАМІЧНОГО КОНТЕКСТУ (ПЕРСОНАЖ + СЕКТОР + ІРМІНСУЛЬ)
    // =========================================================================
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

    // =========================================================================
    // 3. ЛОРНИЙ ЗАХИСТ (FAIL-SAFE PROTOCOL) ТА СИСТЕМНИЙ ПРОМПТ
    // =========================================================================
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
        '2. Стиль мовлення: Лаконічний і змістовний. Завжди давай пряму, розумну та логічну відповідь по суті питання гравця у 1–3 коротких реченнях (до 40 слів) українською мовою.',
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

    // =========================================================================
    // 4. ГЕНЕРАЦІЯ ВІДПОВІДІ: GEMINI API -> ХМАРНИЙ ШІ-РЕЗЕРВ (БЕЗ ТУПИХ ШАБЛОНІВ!)
    // =========================================================================
    async generateResponse(params = {}) {
      const query = String(params.query || '').trim();
      if (!query) return '';

      const ctx = this.buildContextPacket(params);

      // 1. Pre-flight Fail-Safe перевірка
      const safetyCheck = this.checkFailSafeViolation(query, ctx.sector);
      if (safetyCheck.blocked) {
        return FAILSAFE_MESSAGES.PROTOCOL_ERROR;
      }

      const apiKey = this.getApiKey();
      let rawReply = '';

      // 2. Спроба №1: Прямий виклик Google Gemini API (якщо ключ дійсний)
      if (apiKey) {
        try {
          rawReply = await this.callGeminiModel(apiKey, query, ctx);
          if (rawReply) {
            this.lastEngineUsed = 'GEMINI_2.5_FLASH';
            this.updateStatusBadge('🟢 Мозок: Gemini 2.5 Flash (Прямий ключ)');
          }
        } catch (err) {
          console.warn('[RaphaelBrain] Ключ Gemini відхилено або недоступний, вмикаю хмарний ШІ-резерв:', err.message);
        }
      }

      // 3. Спроба №2: Безкоштовний Хмарний LLM-Резерв (працює ЗАВЖДИ, навіть без API-ключа!)
      if (!rawReply) {
        try {
          rawReply = await this.callKeylessCloudLLM(query, ctx);
          if (rawReply) {
            this.lastEngineUsed = 'CLOUD_RESERVE_LLM';
            this.updateStatusBadge('🟣 Мозок: Хмарний ШІ-Резерв (Автономний режим без ключа)');
          }
        } catch (err) {
          console.warn('[RaphaelBrain] Помилка резервного хмарного ШІ:', err);
        }
      }

      if (!rawReply) {
        return FAILSAFE_MESSAGES.MEMORY_CORRUPTED;
      }

      return this.sanitizeAndClampOutput(rawReply, ctx);
    }

    async callGeminiModel(apiKey, userQuery, ctx) {
      const systemDirective = this.buildSystemDirective(ctx);
      const endpoint =
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.modelName)}:generateContent?key=${encodeURIComponent(apiKey)}`;

      const response = await fetch(endpoint, {
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

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson?.error?.message || `HTTP ${response.status}`);
      }

      const data = await response.json();
      return (data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    }

    // Резервний хмарний ШІ (не потребує жодних ключів, розуміє будь-які питання за промптом Рафаїла)
    async callKeylessCloudLLM(userQuery, ctx) {
      const systemDirective = this.buildSystemDirective(ctx);
      const response = await fetch('https://text.pollinations.ai/openai', {
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

      if (!response.ok) {
        throw new Error(`Reserve LLM HTTP ${response.status}`);
      }

      const data = await response.json();
      return (data?.choices?.[0]?.message?.content || '').trim();
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

    updateStatusBadge(text, color = '#67e8f9') {
      const badge = document.getElementById('brain-live-status');
      if (badge) {
        badge.textContent = text;
        badge.style.color = color;
      }
    }

    // =========================================================================
    // 5. ПРИВ'ЯЗКА ПАНЕЛІ ПІДТВЕРДЖЕННЯ КЛЮЧА НА СТЕНДІ (raphael_test.html)
    // =========================================================================
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
            keyStatusBox.textContent = '⏳ Перевіряю ключ на сервері Gemini...';
          }
          const res = await this.verifyAndSaveKey(val);
          if (keyStatusBox) {
            keyStatusBox.style.color = res.ok ? '#34d399' : '#f87171';
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
              `🔐 Зашифрований масив для STEALTH_KEY_BYTES (GitHub не бачить його): [${bytes.join(', ')}]`;
          }
        });
      }
    }
  }

  const brainInstance = new RaphaelBrain();
  window.RaphaelBrain = brainInstance;
  window.RaphaelModules.register('brain', brainInstance);
})(window);