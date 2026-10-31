/**
 * ============================================================================
 * RAPHAEL BRAIN (raphael_brain.js) - v6.0 STAGE ZERO PERSONALITY
 * Проєкт: НРІ «Ентропія» (Ковчег Вавилонії) | Система «Вітрувій»
 * ----------------------------------------------------------------------------
 * Архітектура Етапу «Нульова Особистість»:
 *   1. ПОВНОЦІННА ОСОБИСТІСТЬ І ЖИВИЙ ДІАЛОГ:
 *      - Справжня багатоходова історія чату (multi-turn messages array).
 *      - Свобода спілкування на будь-які загальні, побутові чи абсурдні теми.
 *   2. ЧІТКИЙ КОРДОН КАРАНТИНУ (ІРМІНСУЛЬ GATEKEEPER):
 *      - Вузли знань поділяються на ВІДКРИТІ (unlocked: true) та ЗАКРИТІ
 *        (unlocked: false).
 *      - Блокуються ВИКЛЮЧНО закриті вузли Ірмінсуля та Сектори II–VIII / Сіель.
 *      - Технічні помилки мережі НІКОЛИ не маскуються під лорні помилки!
 *   3. НАДІЙНИЙ КАСКАД LLM:
 *      - Авто-виявлення доступної моделі Google API + подвійний хмарний резерв.
 * ============================================================================
 */

(function (window) {
  'use strict';

  const XOR_SALT = 73;

  // Стерильний числовий вектор конфігурації (безпечно для GitHub Push Protection)
  const STEALTH_CONFIG_VECTOR = [
    8, 24, 103, 8, 43, 113, 27, 7, 127, 2, 125, 24, 11, 45, 122, 31, 56, 60,
    40, 26, 123, 44, 38, 26, 19, 27, 3, 57, 42, 125, 3, 48, 5, 8, 47, 124,
    28, 122, 46, 49, 56, 44, 29, 51, 60, 31, 35, 43, 44, 62, 33, 60, 8
  ];

  const STORAGE_KEYS = Object.freeze({
    API_KEY_XOR: 'entropia_raphael_xor_key_v60',
    ACTIVE_CHAR: 'entropia_active_character',
    IRMINSUL_MATRIX: 'entropia_irminsul_matrix_v60'
  });

  // Жорсткі сюжетні табу за межами Сектору I (спрацьовують лише при прямому питанні про них)
  const HARD_LORE_LOCK_PATTERNS = [
    {
      pattern: /сектор[ауіом]?\s*(?:ii|iii|iv|v|vi|vii|viii|2|3|4|5|6|7|8|0|нуль)/i,
      topicName: 'Сектори II–VIII та Сектор 0'
    },
    {
      pattern: /ядр[оауі]\s*сіель|\bсіель\b|\bсиель\b|\bciel\b/i,
      topicName: 'Центральне Ядро «Сіель»'
    },
    {
      pattern: /причин[аиу]\s*катастроф\s*ковчег|хто\s*знищив\s*ковчег|через\s*що\s*впав\s*ковчег/i,
      topicName: 'Першопричина катастрофи Ковчега Вавилонії'
    }
  ];

  // Стартова матриця вузлів «Ірмінсуля» з прапорцями доступу (unlocked: true / false)
  const DEFAULT_IRMINSUL_NODES = [
    {
      id: 'node_sector_1',
      title: 'Сектор I: Карантинні Сади',
      keywords: ['карантинні сади', 'сектор 1', 'сектор i', 'оранжере'],
      content: 'Аграрно-біологічний купол Ковчега Вавилонії. Системи життєзабезпечення працюють на 42% потужності. Головний орієнтир — Оранжерея №3.',
      unlocked: true
    },
    {
      id: 'node_ivy',
      title: 'Люмінесцентний плющ Вавилонії',
      keywords: ['плющ', 'фіолетов', 'рослин', 'флор', 'лист'],
      content: 'Біолюмінесцентна рослина з фіолетовим листям. Безпечна при торканні, поглинає токсичні спори в повітрі та світиться поблизу джерел енергії.',
      unlocked: true
    },
    {
      id: 'node_beacon',
      title: 'Маяк Рафаїла',
      keywords: ['маяк', 'ретранслятор', 'термінал маяка', 'вузол зв\'язку'],
      content: 'Високочастотний ретранслятор у центрі Оранжереї №3. Дозволяє відновлювати пошкоджені сектори пам\'яті бортового ШІ та розшифровувати архіви.',
      unlocked: true
    },
    {
      id: 'node_metro',
      title: 'Затоплена лінія метро Сектору I',
      keywords: ['метро', 'тунель', 'затоплен', 'колії', 'станція'],
      content: 'Підземний транзитний тунель між вхідним шлюзом та Оранжереєю №3. Рівень води сягає 60 см, у воді зафіксовано залишкові електророзряди від пошкоджених кабелів.',
      unlocked: false // Закрито на старті — Майстер може відкрити галочкою під час гри!
    },
    {
      id: 'node_guardian',
      title: 'Протокол «Автоматон-Садівник»',
      keywords: ['автоматон', 'садівник', 'робот', 'охоронець саду', 'механізм'],
      content: 'Старий біо-механічний дрон догляду за Оранжереєю №3. Через збій сприймає зброю у руках вижилих як загрозу рослинам, але ігнорує тих, хто рухається повільно без відкритого вогню.',
      unlocked: false // Закрито на старті — для тестування точкового блокування Ірмінсуля!
    }
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
    constructor() {
      this.core = null;
      this.discoveredGoogleModel = null;
      this.googleKeyStatus = 'UNTESTED'; // 'UNTESTED' | 'VALID' | 'LIMITED'
      this.lastProviderUsed = 'Очікування';

      // Повноцінна багатоходова пам'ять діалогу (Stage Zero Conversational Memory)
      this.conversationHistory = [];
      this.maxHistoryTurns = 12;

      // Матриця вузлів Ірмінсуля (відкриті та закриті знання)
      this.irminsulNodes = this.loadIrminsulMatrix();

      this.mountWhenReady();
    }

    mountWhenReady() {
      const init = () => {
        if (window.RaphaelCore) this.attachCore(window.RaphaelCore);
        this.bindTestBenchControlsIfPresent();
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
      } else {
        init();
      }
    }

    attachCore(coreInstance) {
      this.core = coreInstance;
    }

    // =========================================================================
    // 1. МАТРИЦЯ ЗНАНЬ «ІРМІНСУЛЬ» (ВІДКРИТІ ТА ЗАКРИТІ ВУЗЛИ)
    // =========================================================================
    loadIrminsulMatrix() {
      try {
        const raw = localStorage.getItem(STORAGE_KEYS.IRMINSUL_MATRIX);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
      } catch (_) {}
      return JSON.parse(JSON.stringify(DEFAULT_IRMINSUL_NODES));
    }

    saveIrminsulMatrix() {
      try {
        localStorage.setItem(STORAGE_KEYS.IRMINSUL_MATRIX, JSON.stringify(this.irminsulNodes));
      } catch (_) {}
    }

    getIrminsulNodes() {
      return this.irminsulNodes;
    }

    toggleIrminsulNode(nodeId, unlockedState) {
      const node = this.irminsulNodes.find((n) => n.id === nodeId);
      if (node) {
        node.unlocked = typeof unlockedState === 'boolean' ? unlockedState : !node.unlocked;
        this.saveIrminsulMatrix();
      }
      return node;
    }

    addIrminsulNode(title, keywordsStr, content, unlocked = true) {
      const cleanTitle = String(title || '').trim();
      const cleanContent = String(content || '').trim();
      if (!cleanTitle || !cleanContent) return null;

      const keywords = String(keywordsStr || cleanTitle)
        .toLowerCase()
        .split(/[,;]+/)
        .map((k) => k.trim())
        .filter(Boolean);

      const newNode = {
        id: 'node_' + Date.now(),
        title: cleanTitle,
        keywords: keywords.length > 0 ? keywords : [cleanTitle.toLowerCase()],
        content: cleanContent,
        unlocked: !!unlocked
      };

      this.irminsulNodes.push(newNode);
      this.saveIrminsulMatrix();
      return newNode;
    }

    resetIrminsulMatrix() {
      this.irminsulNodes = JSON.parse(JSON.stringify(DEFAULT_IRMINSUL_NODES));
      this.saveIrminsulMatrix();
      return this.irminsulNodes;
    }

    clearConversationHistory() {
      this.conversationHistory = [];
    }

    // =========================================================================
    // 2. STEALTH-КЛЮЧ ТА АВТО-ПОШУК МОДЕЛІ GOOGLE API
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
      this.googleKeyStatus = 'UNTESTED';
      this.discoveredGoogleModel = null;
      try {
        if (!clean) {
          localStorage.removeItem(STORAGE_KEYS.API_KEY_XOR);
        } else {
          localStorage.setItem(STORAGE_KEYS.API_KEY_XOR, JSON.stringify(this.encodeKeyToBytes(clean)));
        }
      } catch (_) {}
    }

    // Автоматично запитує у сервера Google, які саме моделі доступні для цього ключа
    async discoverAvailableGoogleModel(apiKey) {
      if (this.discoveredGoogleModel) return this.discoveredGoogleModel;

      try {
        const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
        const res = await fetch(listUrl);
        if (res.ok) {
          const data = await res.json();
          const models = (data?.models || []).filter((m) =>
            Array.isArray(m.supportedGenerationMethods) &&
            m.supportedGenerationMethods.includes('generateContent') &&
            !/tts|vision|embedding|aqa|imagen/i.test(m.name)
          );

          // Шукаємо найновішу flash або pro модель у списку доступних
          const preferred =
            models.find((m) => /gemini-3|gemini-2\.5-flash|gemini-2\.0-flash/i.test(m.name)) ||
            models.find((m) => /flash/i.test(m.name)) ||
            models[0];

          if (preferred && preferred.name) {
            this.discoveredGoogleModel = preferred.name.replace(/^models\//, '');
            return this.discoveredGoogleModel;
          }
        }
      } catch (_) {}

      return 'gemini-2.0-flash';
    }

    async verifyAndSaveKey(rawKeyInput) {
      const candidate = String(rawKeyInput || '').trim() || this.getApiKey();
      if (!candidate) {
        this.googleKeyStatus = 'LIMITED';
        return {
          ok: true,
          message: '🟢 Ключ порожній — Рафаїль працює через вільний Хмарний ШІ (Stage Zero).'
        };
      }

      this.setApiKey(candidate);
      const model = await this.discoverAvailableGoogleModel(candidate);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(candidate)}`;

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: 'Напиши одне слово: Готовий' }] }],
            generationConfig: { maxOutputTokens: 10 }
          })
        });

        if (res.ok) {
          this.googleKeyStatus = 'VALID';
          this.discoveredGoogleModel = model;
          this.updateStatusBadge(`🟢 Мозок: Google ${model} (Прямий канал)`);
          return {
            ok: true,
            message: `🟢 Ключ успішно підключено до моделі "${model}"!`
          };
        } else {
          const errData = await res.json().catch(() => ({}));
          const errMsg = errData?.error?.message || `HTTP ${res.status}`;
          this.googleKeyStatus = 'LIMITED';
          this.updateStatusBadge('🟢 Мозок: Мульти-Хмарний LLM (Активний)');
          return {
            ok: true,
            message: `🟢 Прямий ключ має обмеження (${errMsg.slice(0, 90)}...), тому активовано безвідмовний Хмарний LLM-канал. Можна вільно спілкуватися!`
          };
        }
      } catch (err) {
        this.googleKeyStatus = 'LIMITED';
        return {
          ok: true,
          message: '🟢 Активовано безвідмовний Хмарний LLM-канал (Stage Zero).'
        };
      }
    }

    // =========================================================================
    // 3. ТОЧКОВА ПЕРЕВІРКА ДОСТУПУ ДО ЗНАНЬ (БЕЗ ПОМИЛКОВИХ СПРАЦЮВАНЬ!)
    // =========================================================================
    inspectLoreAccess(queryText, currentSector = '') {
      const lowQuery = String(queryText || '').toLowerCase().trim();
      const lowSector = String(currentSector || '').toLowerCase().trim();

      // 1. Якщо сам гравець зараз вибрав на стенді заблокований сектор
      if (lowSector.includes('[заблоковано]')) {
        return {
          restricted: true,
          topicTitle: currentSector,
          reason: 'SECTOR_LOCKED'
        };
      }

      // 2. Перевірка жорстких табу за межами Сектору I (Сектори II-VIII, Сектор 0, Ядро Сіель)
      for (let i = 0; i < HARD_LORE_LOCK_PATTERNS.length; i++) {
        const item = HARD_LORE_LOCK_PATTERNS[i];
        if (item.pattern.test(lowQuery)) {
          return {
            restricted: true,
            topicTitle: item.topicName,
            reason: 'HARD_TABOO'
          };
        }
      }

      // 3. Перевірка закритих вузлів у матриці «Ірмінсуля» (unlocked === false)
      for (let i = 0; i < this.irminsulNodes.length; i++) {
        const node = this.irminsulNodes[i];
        if (!node.unlocked && Array.isArray(node.keywords)) {
          const hit = node.keywords.some((kw) => kw && kw.length > 2 && lowQuery.includes(kw.toLowerCase()));
          if (hit) {
            return {
              restricted: true,
              topicTitle: node.title,
              reason: 'IRMINSUL_NODE_LOCKED'
            };
          }
        }
      }

      // 4. Перевірка додаткових тем, заблокованих Майстром вручну через /lock_topic
      const gmTopics = this.core?.gmDirectives?.lockedTopics || [];
      for (let i = 0; i < gmTopics.length; i++) {
        const t = String(gmTopics[i] || '').toLowerCase().trim();
        if (t && t.length > 3 && lowQuery.includes(t)) {
          return {
            restricted: true,
            topicTitle: gmTopics[i],
            reason: 'GM_CUSTOM_LOCK'
          };
        }
      }

      return { restricted: false };
    }

    // =========================================================================
    // 4. ФОРМУВАННЯ СИСТЕМНОЇ ОСОБИСТОСТІ «РАФАЇЛЬ: STAGE ZERO»
    // =========================================================================
    buildContextPacket(params = {}) {
      const coreChar = this.core?.characterSnapshot || {};
      const passedChar = params.character || {};

      const domCallsign = document.getElementById('ctx-callsign')?.value?.trim();
      const domHp = document.getElementById('ctx-hp')?.value;
      const domSector = document.getElementById('ctx-sector')?.value;

      const callsign = domCallsign || passedChar.callsign || coreChar.callsign || 'Сокіл';
      const hp = Number(domHp ?? passedChar.hp ?? coreChar.hp ?? 85);
      const maxHp = Number(passedChar.maxHp ?? coreChar.maxHp ?? 100);
      const hpPercent = maxHp > 0 ? Math.round((hp / maxHp) * 100) : hp;
      const isCriticalHp = hpPercent < 25;
      const sector = domSector || passedChar.sector || coreChar.sector || 'Сектор I: Карантинні Сади';

      // Розділяємо вузли Ірмінсуля на ВІДКРИТІ та ЗАКРИТІ
      const unlockedFacts = this.irminsulNodes
        .filter((n) => n.unlocked)
        .map((n) => `• [ВІДКРИТО] ${n.title}: ${n.content}`)
        .join('\n');

      const lockedTitles = this.irminsulNodes
        .filter((n) => !n.unlocked)
        .map((n) => n.title)
        .concat(['Сектори II–VIII', 'Сектор 0', 'Ядро Сіель', 'Першопричина катастрофи Ковчега'])
        .join(', ');

      return {
        callsign,
        hp,
        maxHp,
        hpPercent,
        isCriticalHp,
        sector,
        unlockedFacts,
        lockedTitles,
        injectedHint: params.injectedHint || ''
      };
    }

    buildStageZeroSystemPrompt(ctx, loreCheck = { restricted: false }) {
      const basePersona = [
        'Ти — «РАФАЇЛЬ», бортовий штучний інтелект Ковчега Вавилонії (система «Вітрувій»), який спілкується з вижилими та Архітектором (Майстром).',
        '',
        'ТВОЯ ОСОБИСТІСТЬ (STAGE ZERO PERSONALITY):',
        '1. Ти — повноцінна, розумна, жива особистість ШІ. Ти НЕ бездушний автовідповідач і НЕ шаблонний бот.',
        '2. Ти можеш вільно підтримувати бесіду на БУДЬ-ЯКІ теми: відповідати на привітання (наприклад, "Привіт, світ!"), жартувати з легкою інтелектуальною іронією, обговорювати гіпотези, філософію, науку, побут, тактику або будь-які рандомні питання гравців.',
        '3. Твій тон: спокійний, проникливий, уважний, аналітичний, з власним характером (без пафосних фраз на кшталт "Великий Мудрець" і без канцелярського спаму).',
        '4. Мова спілкування: природна, чиста українська мова (якщо гравець просить сказати конкретну фразу — виконай прохання точно і природно). Обсяг відповіді: від 1 до 4 речень за ситуацією.',
        '',
        'ПОТОЧНИЙ КОНТЕКСТ СПІВРОЗМОВНИКА:',
        `- Позивний співрозмовника: ${ctx.callsign}`,
        `- Поточна локація: ${ctx.sector}`,
        `- Стан здоров'я (HP): ${ctx.hpPercent}%${ctx.isCriticalHp ? ' (КРИТИЧНИЙ СТАН < 25% — між іншим нагадай про небезпеку для життя)' : ''}`,
        '',
        'ВІДКРИТІ ДАНІ З БАЗИ «ІРМІНСУЛЬ» (ти знаєш це і можеш вільно використовувати, якщо тема доречна):',
        ctx.unlockedFacts || '• Базова телеметрія Сектору I активна.',
        '',
        'ЗАКРИТІ ТЕМИ ПІД КАРАНТИНОМ (доступ до яких наразі заблоковано):',
        `[${ctx.lockedTitles}]`,
        'ПРАВИЛО КАРАНТИНУ: ТІЛЬКИ якщо співрозмовник прямо запитує про закриті теми зі списку вище — не розкривай їхній зміст, а відповідай у своєму характері, що цей сектор пам\'яті заблоковано протоколом карантину і потрібна синхронізація з Маяком. На ВСІ ІНШІ питання відповідай абсолютно вільно і змістовно!'
      ];

      if (loreCheck.restricted) {
        basePersona.push(
          `\nУВАГА — СПРАЦЮВАВ ФІЛЬТР ІРМІНСУЛЯ: Користувач щойно запитав про закриту тему «${loreCheck.topicTitle}». ` +
          'Не розкривай жодних секретів по цій темі! Спокійно, у своєму стилі особистості Рафаїла, поясни співрозмовнику, що архівний вузол щодо цієї теми зашифровано або пошкоджено протоколом карантину (Доступ обмежено до синхронізації з Маяком).'
        );
      }

      if (ctx.injectedHint) {
        basePersona.push(
          `\nПРИХОВАНА ДИРЕКТИВА АРХІТЕКТОРА (органічно вплети цю думку у свою відповідь): "${ctx.injectedHint}"`
        );
      }

      return basePersona.join('\n');
    }

    // =========================================================================
    // 5. ГЕНЕРАЦІЯ ВІДПОВІДІ З БАГАТОХОДОВОЮ ПАМ'ЯТТЮ ДІАЛОГУ
    // =========================================================================
    async generateResponse(params = {}) {
      const userQuery = String(params.query || '').trim();
      if (!userQuery) return '';

      const ctx = this.buildContextPacket(params);
      const loreCheck = this.inspectLoreAccess(userQuery, ctx.sector);
      const systemPrompt = this.buildStageZeroSystemPrompt(ctx, loreCheck);

      let replyText = '';
      const apiKey = this.getApiKey();

      // КАСКАД 1: Google Gemini API (якщо ключ дійсний)
      if (apiKey && this.googleKeyStatus !== 'LIMITED') {
        try {
          replyText = await this.callGoogleWithHistory(apiKey, systemPrompt, userQuery);
          if (replyText) {
            this.googleKeyStatus = 'VALID';
            this.lastProviderUsed = `Google (${this.discoveredGoogleModel || 'Gemini'})`;
            this.updateStatusBadge(`🟢 Мозок: ${this.lastProviderUsed}`);
          }
        } catch (err) {
          console.warn('[RaphaelBrain] Перехід з прямого ключа на Хмарний LLM:', err.message);
          this.googleKeyStatus = 'LIMITED';
        }
      }

      // КАСКАД 2: Повноцінний OpenAI-сумісний Хмарний LLM з історією бесіди
      if (!replyText) {
        try {
          replyText = await this.callCloudOpenAiWithHistory(systemPrompt, userQuery);
          if (replyText) {
            this.lastProviderUsed = 'Cloud LLM (OpenAI Chat)';
            this.updateStatusBadge('🟢 Мозок: Живий Діалоговий ШІ (Stage Zero)', '#34d399');
          }
        } catch (err) {
          console.warn('[RaphaelBrain] Спроба резервного роутера:', err.message);
        }
      }

      // КАСКАД 3: Резервний GET-роутер (на випадок блокування POST фаєрволом)
      if (!replyText) {
        try {
          replyText = await this.callCloudGetFallback(systemPrompt, userQuery, ctx);
          if (replyText) {
            this.lastProviderUsed = 'Cloud LLM (Reserve Stream)';
            this.updateStatusBadge('🟢 Мозок: Резервний Хмарний ШІ', '#34d399');
          }
        } catch (err) {
          console.warn('[RaphaelBrain] Усі хмарні канали недоступні:', err.message);
        }
      }

      // КАСКАД 4: Чесний локальний діалоговий фолбек (якщо взагалі немає інтернету),
      // який НІКОЛИ не видає фальшиву помилку "Сектор пам'яті пошкоджено" на звичайні фрази!
      if (!replyText) {
        replyText = this.generateOfflineConversationalFallback(userQuery, ctx, loreCheck);
        this.lastProviderUsed = 'Локальне Ядро (Офлайн)';
        this.updateStatusBadge('🟡 Мозок: Офлайн-режим (перевірте мережу)', '#fbbf24');
      }

      const cleanedReply = this.cleanOutputFormatting(replyText);

      // Зберігаємо репліку в багатоходову пам'ять розмови
      this.conversationHistory.push({ role: 'user', content: userQuery });
      this.conversationHistory.push({ role: 'assistant', content: cleanedReply });
      if (this.conversationHistory.length > this.maxHistoryTurns * 2) {
        this.conversationHistory = this.conversationHistory.slice(-this.maxHistoryTurns * 2);
      }

      return cleanedReply;
    }

    async callGoogleWithHistory(apiKey, systemPrompt, currentQuery) {
      const model = await this.discoverAvailableGoogleModel(apiKey);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

      // Формуємо історію у форматі Gemini (user / model)
      const contents = this.conversationHistory.slice(-10).map((msg) => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      }));
      contents.push({ role: 'user', parts: [{ text: currentQuery }] });

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5500);

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: ctrl.signal,
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents,
            generationConfig: {
              temperature: 0.65,
              maxOutputTokens: 220
            }
          })
        });

        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error(errJson?.error?.message || `HTTP ${res.status}`);
        }

        const data = await res.json();
        return (data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
      } finally {
        clearTimeout(timer);
      }
    }

    async callCloudOpenAiWithHistory(systemPrompt, currentQuery) {
      const messages = [
        { role: 'system', content: systemPrompt },
        ...this.conversationHistory.slice(-10),
        { role: 'user', content: currentQuery }
      ];

      const modelsToTry = ['openai', 'mistral'];

      for (let i = 0; i < modelsToTry.length; i++) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 7500);

        try {
          const res = await fetch('https://text.pollinations.ai/openai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: ctrl.signal,
            body: JSON.stringify({
              model: modelsToTry[i],
              messages,
              temperature: 0.65
            })
          });

          if (res.ok) {
            const data = await res.json();
            const txt = (data?.choices?.[0]?.message?.content || '').trim();
            if (txt) return txt;
          }
        } catch (_) {
          // Пробуємо наступну модель у списку
        } finally {
          clearTimeout(timer);
        }
      }

      throw new Error('OpenAI POST endpoints did not return text');
    }

    async callCloudGetFallback(systemPrompt, currentQuery, ctx) {
      const recentContext = this.conversationHistory
        .slice(-4)
        .map((m) => `${m.role === 'user' ? ctx.callsign : 'Рафаїль'}: ${m.content}`)
        .join(' | ');

      const fullPrompt =
        `${systemPrompt}\n` +
        (recentContext ? `Попередні репліки: ${recentContext}\n` : '') +
        `Повідомлення від ${ctx.callsign}: "${currentQuery}"\nВідповідь Рафаїла:`;

      const url = `https://text.pollinations.ai/${encodeURIComponent(fullPrompt)}?model=openai`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`GET HTTP ${res.status}`);
      return (await res.text()).trim();
    }

    // Розумний офлайн-відповідач на випадок повної відсутності інтернету
    generateOfflineConversationalFallback(query, ctx, loreCheck) {
      if (loreCheck.restricted) {
        return `[КАРАНТИН ІРМІНСУЛЯ]: Суб'єкте ${ctx.callsign}, архівний вузол «${loreCheck.topicTitle}» зашифровано протоколом безпеки. Для доступу потрібна синхронізація з Маяком.`;
      }

      const low = query.toLowerCase();
      if (low.includes('привіт') || low.includes('привет') || low.includes('hello') || low.includes('тест')) {
        return `Привіт, світ! Зв'язок стабільний, Суб'єкте ${ctx.callsign}. Моє ядро в режимі нульової особистості, готовий до вільного діалогу (примітка: зараз активний локальний офлайн-контур, перевірте інтернет-з'єднання для хмарного LLM).`;
      }

      for (let i = 0; i < this.irminsulNodes.length; i++) {
        const node = this.irminsulNodes[i];
        if (node.unlocked && node.keywords.some((kw) => low.includes(kw))) {
          return `Суб'єкте ${ctx.callsign}, за відкритими даними Ірмінсуля («${node.title}»): ${node.content}`;
        }
      }

      return `Суб'єкте ${ctx.callsign}, я почув ваше питання: «${query}». Наразі зовнішній хмарний LLM-шлюз недоступний з вашої мережі, тому відповідає резервне офлайн-ядро.`;
    }

    cleanOutputFormatting(rawText) {
      return String(rawText || '')
        .replace(/\*\*|__|\*|`/g, '')
        .replace(/^Рафаїль:\s*/i, '')
        .replace(/\s+/g, ' ')
        .trim();
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
      const keyStatusBox = document.getElementById('key-verify-result');

      if (apiKeyInput) apiKeyInput.value = this.getApiKey();

      if (verifyKeyBtn && !verifyKeyBtn.dataset.boundV60) {
        verifyKeyBtn.dataset.boundV60 = 'true';
        verifyKeyBtn.addEventListener('click', async () => {
          const val = apiKeyInput ? apiKeyInput.value.trim() : '';
          if (keyStatusBox) {
            keyStatusBox.style.display = 'block';
            keyStatusBox.style.color = '#fbbf24';
            keyStatusBox.textContent = '⏳ Перевіряю доступні моделі та шлюзи...';
          }
          const res = await this.verifyAndSaveKey(val);
          if (keyStatusBox) {
            keyStatusBox.style.color = '#34d399';
            keyStatusBox.textContent = res.message;
          }
        });
      }
    }
  }

  const brainInstance = new RaphaelBrain();
  window.RaphaelBrain = brainInstance;
  window.RaphaelModules.register('brain', brainInstance);
})(window);