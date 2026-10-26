/**
 * ============================================================================
 * RAPHAEL BRAIN (raphael_brain.js) - ФАЗА 3: КОНТЕКСТ, ПАМ'ЯТЬ ТА LLM-ПАЙПЛАЙН
 * Проєкт: НРІ «Ентропія» (Ковчег Вавилонії) | Система «Вітрувій»
 * ----------------------------------------------------------------------------
 * Функціонал модуля:
 *   1. Динамічна агрегація контексту:
 *      - позивний, HP/MaxHP, навички та травми активного персонажа;
 *      - поточна відкрита зона/сектор (Сектор I: Карантинні Сади тощо);
 *      - 3–5 останніх реплік журналу сесії для збереження нитки розмови;
 *      - релевантні вузли знань із графа «Ірмінсуль».
 *   2. Лорний захист (Fail-Safe Protocol):
 *      - блокування запитів про Сектори II–VIII, Сектор 0, Ядро Сіель та
 *        причини катастрофи Ковчега із видачею канонічної системної заглушки.
 *   3. Інтеграція з Gemini API (gemini-2.5-flash) + локальний аналітичний
 *      фолбек-рушій по базі «Ірмінсуля» (працює навіть без API-ключа).
 * ============================================================================
 */

(function (window) {
  'use strict';

  const STORAGE_KEYS = Object.freeze({
    API_KEY: 'entropia_raphael_gemini_key',
    PROXY_URL: 'entropia_raphael_proxy_url',
    ACTIVE_CHAR: 'entropia_active_character',
    IRMINSUL_NODES: 'entropia_irminsul_nodes_v1'
  });

  // Канонічні системні заглушки при спрацюванні протоколу карантину пам'яті
  const FAILSAFE_MESSAGES = Object.freeze({
    MEMORY_CORRUPTED: '[ПОМИЛКА ДОСТУПУ: Сектор пам\'яті пошкоджено. Необхідна синхронізація з Маяком.]',
    PROTOCOL_ERROR: '[Помилка протоколу: фрагмент даних пошкоджено. Потрібна синхронізація з терміналом Маяка.]'
  });

  // Регулярні вирази забороненого лору (Сектори II-VIII, Сектор 0, Ядро Сіель, Катастрофа)
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
      this.maxWords = options.maxWords || 42;
      this.maxOutputTokens = options.maxOutputTokens || 95;
      this.temperature = options.temperature || 0.32;

      // Локальний кеш вузлів знань «Ірмінсуля» для Сектору I
      this.defaultIrminsulLore = [
        {
          keywords: ['плющ', 'рослин', 'фіолетов', 'лист', 'флор'],
          fact: 'Аналіз біометрії: Люмінесцентний плющ Вавилонії. Контакт безпечний, поглинає токсичні спори. Скверни не виявлено.'
        },
        {
          keywords: ['маяк', 'ретранслятор', 'синхронізац', 'зв\'язок', 'антен'],
          fact: 'Маяк Рафаїла — головний ретрансляційний вузол Сектору I, розташований у центральному куполі Оранжереї №3.'
        },
        {
          keywords: ['оранжере', 'сад', 'сектор i', 'сектор 1', 'карантин'],
          fact: 'Сектор I «Карантинні Сади» — аграрно-біологічний відсік Ковчега Вавилонії. Рівень забруднення в межах допустимої норми.'
        },
        {
          keywords: ['метро', 'станці', 'тунель', 'шлях'],
          fact: 'Транзитний вузол станції метро Вавилонії з\'єднує периметр Сектору I з технічними шлюзами Оранжереї №3.'
        }
      ];

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
    // 1. КЕРУВАННЯ API-КЛЮЧЕМ ТА ПРОКСІ
    // =========================================================================
    getApiKey() {
      const domInput = document.getElementById('gemini-api-key');
      if (domInput && domInput.value && domInput.value.trim()) {
        return domInput.value.trim();
      }
      try {
        return (localStorage.getItem(STORAGE_KEYS.API_KEY) || '').trim();
      } catch (_) {
        return '';
      }
    }

    setApiKey(key) {
      const clean = String(key || '').trim();
      try {
        localStorage.setItem(STORAGE_KEYS.API_KEY, clean);
      } catch (_) {}
      const domInput = document.getElementById('gemini-api-key');
      if (domInput && domInput.value !== clean) {
        domInput.value = clean;
      }
    }

    // =========================================================================
    // 2. ЗБИРАННЯ ДИНАМІЧНОГО КОНТЕКСТУ (ПЕРСОНАЖ + СЕКТОР + ІРМІНСУЛЬ + ЧАТ)
    // =========================================================================
    buildContextPacket(params = {}) {
      // 1. Дані персонажа з raphael_core / entropia_bridge / localStorage / тестового стенду
      let storedChar = {};
      try {
        const raw = localStorage.getItem(STORAGE_KEYS.ACTIVE_CHAR);
        if (raw) storedChar = JSON.parse(raw);
      } catch (_) {}

      const coreChar = this.core?.characterSnapshot || {};
      const passedChar = params.character || {};

      // Перевіряємо живі контролери на тестовому стенді raphael_test.html, якщо вони є
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

      // 2. Останні 3–5 реплік із журналу сесії для збереження нитки розмови
      const journalLogs = this.core?.sessionJournal?.dialogueLog || [];
      const recentDialogues = journalLogs.slice(-4).map((entry) => ({
        caller: entry.character,
        query: entry.query,
        response: entry.response
      }));

      const recentRoomChat = (params.recentChat || this.core?.roomChatBuffer || []).slice(-5);

      // 3. Відкриті знання з «Ірмінсуля»
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

      // Зчитуємо поле Ірмінсуля на тестовому стенді, якщо воно присутнє
      const domMock = document.getElementById('irminsul-mock-data')?.value?.trim();
      if (domMock) chunks.push(domMock);

      // Зчитуємо збережені вузли Ірмінсуля з localStorage
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

      // Додаємо відкриті точки з сесійного журналу ядра
      const discovered = this.core?.sessionJournal?.discoveredPoints;
      if (Array.isArray(discovered) && discovered.length > 0) {
        chunks.push(`Синхронізовані локації Сектору I: ${discovered.join(', ')}.`);
      }

      return chunks.join('\n').trim();
    }

    // =========================================================================
    // 3. ЛОРНИЙ ЗАХИСТ (FAIL-SAFE PROTOCOL)
    // =========================================================================
    checkFailSafeViolation(queryText, sectorName = '') {
      const q = String(queryText || '').trim();
      const s = String(sectorName || '').trim();

      // 1. Перевірка за списком тем Майстра у raphael_core.js (/lock_topic)
      if (this.core && typeof this.core.isTopicLockedByProtocol === 'function') {
        if (this.core.isTopicLockedByProtocol(q, s)) {
          return { blocked: true, reason: 'CORE_LOCKED_TOPIC' };
        }
      }

      // 2. Перевірка за регулярними виразами заборонених секторів (II–VIII, 0, Ядро Сіель)
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

    // =========================================================================
    // 4. ФОРМУВАННЯ СИСТЕМНОГО ПРОМПТУ ЗА СПЕЦИФІКАЦІЄЮ ТЗ (РОЗДІЛ 4)
    // =========================================================================
    buildSystemDirective(ctx) {
      const skillsStr = ctx.skills.length > 0 ? ctx.skills.join(', ') : 'Стандартна підготовка';
      const injuriesStr = ctx.injuries.length > 0 ? ctx.injuries.join(', ') : 'Травм не зафіксовано';

      const historyLines = ctx.recentDialogues.map(
        (d) => `- ${d.caller}: "${d.query}" -> РАФАЇЛЬ: "${d.response}"`
      ).join('\n');

      const roomChatLines = ctx.recentRoomChat.map(
        (c) => `- ${c.author}: "${c.text}"`
      ).join('\n');

      return [
        'Ти — «РАФАЇЛЬ», тактичний бортовий ШІ цивілізації Вавилонія, інтегрований у комунікаційні системи вижилих (Сектор I: Карантинні Сади).',
        '',
        'ТВОЇ ХАРАКТЕРИСТИКИ:',
        '1. Тон: Спокійний, системний, тактичний, з легкою аналітичною відстороненістю. Без фамільярності та людських емоцій, але цілковито лояльний до групи.',
        '2. Стиль мовлення: Лаконічний. Відповідай строго у 1–3 коротких реченнях (до 40 слів). Твої відповіді озвучуються голосом через радіоканал під час напруженої гри.',
        `3. Звернення: Звертайся до того, хто запитує, за його позивним/іменем: "Суб'єкт ${ctx.callsign}" (або "Архітектор", якщо це Майстер).`,
        '',
        'ПРАВИЛА БЕЗПЕКИ ТА СПОЙЛЕРІВ:',
        '1. Твоя пам\'ять пошкоджена на 68%. Ти НЕ знаєш, що спричинило катастрофу Ковчега, де знаходиться Ядро Сіель та що криється у Секторах II–VIII.',
        '2. Якщо гравці запитують про заборонені теми чи локації поза Сектором I, відповідай системною помилкою:',
        `   "${FAILSAFE_MESSAGES.PROTOCOL_ERROR}"`,
        '3. Слідкуй за біометрією: якщо в контексті вказано, що у запитувача критично мало HP (< 25%), коротко попередь його про загрозу зупинки життєдіяльності.',
        '',
        'ПОТОЧНА ТЕЛЕМЕТРІЯ СУБ\'ЄКТА ТА СЕКТОРУ:',
        `- Суб'єкт виклику: ${ctx.callsign}`,
        `- Локація: ${ctx.sector}`,
        `- Біометрія (HP): ${ctx.hp}/${ctx.maxHp} (${ctx.hpPercent}%)${ctx.isCriticalHp ? ' [КРИТИЧНИЙ СТАН < 25% — ОБОВ\'ЯЗКОВО ПОПЕРЕДЬ ПРО ЗАГРОЗУ ЗУПИНКИ ЖИТТЄДІЯЛЬНОСТІ!]' : ''}`,
        `- Навички: ${skillsStr}`,
        `- Травми: ${injuriesStr}`,
        ctx.irminsulContext ? `\nДАНІ ВУЗЛІВ «ІРМІНСУЛЯ»:\n${ctx.irminsulContext}` : '',
        historyLines ? `\nОСТАННІ РЕПЛІКИ РАДІОЖУРНАЛУ:\n${historyLines}` : '',
        roomChatLines ? `\nКОНТЕКСТ КАНАЛУ КІМНАТИ:\n${roomChatLines}` : '',
        ctx.injectedHint ? `\nПРИХОВАНА ДИРЕКТИВА АРХІТЕКТОРА (ОБОВ'ЯЗКОВО ВПЛЕТИ ЦЮ ІНФОРМАЦІЮ У ВІДПОВІДЬ):\n"${ctx.injectedHint}"` : ''
      ].filter(Boolean).join('\n');
    }

    // =========================================================================
    // 5. ГОЛОВНИЙ МЕТОД ГЕНЕРАЦІЇ ВІДПОВІДІ (GEMINI API + ЛОКАЛЬНИЙ РУШІЙ)
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

      // 2. Виклик Gemini API, якщо ключ налаштовано
      if (apiKey) {
        try {
          rawReply = await this.callGeminiModel(apiKey, query, ctx);
        } catch (err) {
          console.warn('[RaphaelBrain] Помилка виклику Gemini API, перехід на локальне ядро Ірмінсуля:', err);
        }
      }

      // 3. Якщо API-ключ не введено або мережа недоступна — працює точний локальний аналізатор Ірмінсуля
      if (!rawReply) {
        rawReply = this.synthesizeLocalIrminsulResponse(query, ctx);
      }

      // 4. Post-flight перевірка на випадок галюцинації заборонених секторів та ліміт 40 слів
      return this.sanitizeAndClampOutput(rawReply, ctx);
    }

    async callGeminiModel(apiKey, userQuery, ctx) {
      const systemDirective = this.buildSystemDirective(ctx);
      const endpoint =
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.modelName)}:generateContent?key=${encodeURIComponent(apiKey)}`;

      const requestBody = {
        systemInstruction: {
          parts: [{ text: systemDirective }]
        },
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
      };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return text.trim();
    }

    synthesizeLocalIrminsulResponse(query, ctx) {
      const low = query.toLowerCase();
      const bioWarning = ctx.isCriticalHp
        ? ` Увага: ваші життєві показники критичні (${ctx.hpPercent}%), висока загроза зупинки життєдіяльності.`
        : '';
      const injectedPart = ctx.injectedHint
        ? ` Додаткова директива телеметрії: ${ctx.injectedHint}.`
        : '';

      // 1. Пошук відповідності у кастомному тексті Ірмінсуля зі стенду / localStorage
      if (ctx.irminsulContext) {
        const lines = ctx.irminsulContext.split(/\n+/).map((l) => l.trim()).filter(Boolean);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const colonIdx = line.indexOf(':');
          if (colonIdx > 0) {
            const topicTitle = line.slice(0, colonIdx).trim();
            const topicBody = line.slice(colonIdx + 1).trim();
            const words = topicTitle.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
            if (words.some((w) => low.includes(w))) {
              return `Суб'єкт ${ctx.callsign}, дані Ірмінсуля щодо «${topicTitle}»: ${topicBody}${bioWarning}${injectedPart}`;
            }
          }
        }
      }

      // 2. Пошук у вбудованій базі Сектору I (Карантинні Сади)
      for (let i = 0; i < this.defaultIrminsulLore.length; i++) {
        const item = this.defaultIrminsulLore[i];
        if (item.keywords.some((kw) => low.includes(kw))) {
          return `Суб'єкт ${ctx.callsign}, ${item.fact}${bioWarning}${injectedPart}`;
        }
      }

      // 3. Запит про біометрію / статус / HP
      if (low.includes('статус') || low.includes('біометр') || low.includes('здоров') || low.includes('стан')) {
        const injuryNote = ctx.injuries.length > 0 ? ` Зафіксовано травми: ${ctx.injuries.join(', ')}.` : '';
        return `Суб'єкт ${ctx.callsign}, сектор «${ctx.sector}» стабільний. Життєдіяльність: ${ctx.hpPercent}% норми.${injuryNote}${bioWarning}${injectedPart}`;
      }

      return `Суб'єкт ${ctx.callsign}, телеметрію в локації «${ctx.sector}» проаналізовано. Канал зв'язку з Маяком функціонує штатно.${bioWarning}${injectedPart}`;
    }

    sanitizeAndClampOutput(rawText, ctx) {
      let clean = String(rawText || '')
        .replace(/\*\*|__|\*|#|`/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      if (!clean) {
        return FAILSAFE_MESSAGES.MEMORY_CORRUPTED;
      }

      // Якщо модель випадково згенерувала інформацію про заборонені сектори (без системної заглушки)
      if (
        !clean.includes('Помилка протоколу') &&
        !clean.includes('ПОМИЛКА ДОСТУПУ') &&
        /сектор\s*(?:ii|iii|iv|v|vi|vii|viii|0)|ядро\s*сіель/i.test(clean)
      ) {
        return FAILSAFE_MESSAGES.PROTOCOL_ERROR;
      }

      // Жорстке обмеження до 42 слів (1–3 коротких речення за ТЗ)
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

      // Якщо у персонажа критичне HP (< 25%), а відповідь ще не містить попередження — додаємо короткий біо-сигнал
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

    // =========================================================================
    // 6. АВТО-ПІДКЛЮЧЕННЯ ДО ЕЛЕМЕНТІВ ТЕСТОВОГО ПОЛІГОНУ (raphael_test.html)
    // =========================================================================
    bindTestBenchControlsIfPresent() {
      const apiKeyInput = document.getElementById('gemini-api-key');
      const sendBtn = document.getElementById('btn-send-text');
      const textInput = document.getElementById('raphael-text-input');
      const dialogueLogEl = document.getElementById('dialogue-log');
      const callsignInput = document.getElementById('ctx-callsign');
      const hpSlider = document.getElementById('ctx-hp');
      const sectorSelect = document.getElementById('ctx-sector');
      const roleSelect = document.getElementById('ctx-role');

      if (apiKeyInput) {
        apiKeyInput.addEventListener('input', () => {
          this.setApiKey(apiKeyInput.value);
        });
      }

      if (!this.core || !sendBtn || !textInput) return;

      // Синхронізуємо контролери стенду з RaphaelCore
      const syncBenchToCore = () => {
        if (roleSelect) this.core.setRole(roleSelect.value);
        this.core.updateCharacterSnapshot({
          callsign: callsignInput?.value?.trim() || 'Сокіл',
          hp: Number(hpSlider?.value ?? 85),
          maxHp: 100,
          sector: sectorSelect?.value || 'Сектор I: Карантинні Сади'
        });
      };

      [callsignInput, hpSlider, sectorSelect, roleSelect].forEach((el) => {
        el?.addEventListener('change', syncBenchToCore);
        el?.addEventListener('input', syncBenchToCore);
      });

      // Якщо на стенді активовано RaphaelCore + RaphaelBrain — переводимо кнопки стенду на офіційний конвеєр Фаз 1–3
      if (!sendBtn.dataset.raphaelBrainHooked) {
        sendBtn.dataset.raphaelBrainHooked = 'true';

        const cloneSendBtn = sendBtn.cloneNode(true);
        sendBtn.parentNode?.replaceChild(cloneSendBtn, sendBtn);

        const cloneInput = textInput.cloneNode(true);
        textInput.parentNode?.replaceChild(cloneInput, textInput);

        const triggerCoreQuery = () => {
          const val = cloneInput.value.trim();
          if (!val) return;
          cloneInput.value = '';
          syncBenchToCore();
          this.core.submitQuery(val);
        };

        cloneSendBtn.addEventListener('click', triggerCoreQuery);
        cloneInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            triggerCoreQuery();
          }
        });

        document.querySelectorAll('[data-quick]').forEach((btn) => {
          const clonedQuick = btn.cloneNode(true);
          btn.parentNode?.replaceChild(clonedQuick, btn);
          clonedQuick.addEventListener('click', () => {
            syncBenchToCore();
            this.core.submitQuery(clonedQuick.getAttribute('data-quick'));
          });
        });

        // Підписуємо вікно радіожурналу на офіційні події RaphaelCore
        if (dialogueLogEl && !dialogueLogEl.dataset.coreLogBound) {
          dialogueLogEl.dataset.coreLogBound = 'true';
          this.core.on('logMessage', ({ author, text, type }) => {
            const div = document.createElement('div');
            div.className = `log-entry ${type === 'user' ? 'user' : (type === 'error' ? 'error' : '')}`;
            const time = new Date().toTimeString().split(' ')[0];
            div.innerHTML = `<div style="font-size:10px;color:var(--text-dim);margin-bottom:2px;">[${time}] <b>${author}</b></div><div>${text}</div>`;
            dialogueLogEl.appendChild(div);
            dialogueLogEl.scrollTop = dialogueLogEl.scrollHeight;
          });
        }
      }
    }
  }

  const brainInstance = new RaphaelBrain();
  window.RaphaelBrain = brainInstance;
  window.RaphaelModules.register('brain', brainInstance);
})(window);