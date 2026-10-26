/**
 * ============================================================================
 * RAPHAEL CORE (raphael_core.js) - ФАЗА 1: ЯДРО ТА СТЕЙТ-МАШИНА (FSM)
 * Проєкт: НРІ «Ентропія» (Ковчег Вавилонії) | Система «Вітрувій»
 * ----------------------------------------------------------------------------
 * Функціонал модуля:
 *   1. Керування станами FSM: DORMANT, IDLE, LISTENING, THINKING, SPEAKING.
 *   2. Контроль прав доступу (GM vs Player) та парсер директив Майстра:
 *      /silent [on/off], /inject [текст], /lock_topic [тема], /stop_session.
 *   3. Інтеграція з entropia_bridge.js, BroadcastChannel та localStorage:
 *      - прийом сигналу AETHER_SYSTEM_OVERRIDE (сюжетний злам із глітчем);
 *      - прийом сигналу CHAR_UPDATED (динамічний зліпок персонажа).
 *   4. Буферизація та експорт сесійного журналу у форматі графа «Ірмінсуль».
 * ============================================================================
 */

(function (window) {
  'use strict';

  const FSM_STATES = Object.freeze({
    DORMANT: 'DORMANT',     // Заблоковано сюжетом / вимкнено Майстром
    IDLE: 'IDLE',           // Фонове очікування, пасивний збір логів кімнати
    LISTENING: 'LISTENING', // Утримується кнопка Push-to-Talk
    THINKING: 'THINKING',   // Обробка запиту через LLM API (raphael_brain.js)
    SPEAKING: 'SPEAKING'    // Трансляція аудіопотоку в голосовий канал (raphael_voice.js)
  });

  const STORAGE_KEYS = Object.freeze({
    ACTIVE_CHAR: 'entropia_active_character',
    CORE_STATE: 'entropia_raphael_core_state_v1',
    JOURNAL_BACKUP: 'entropia_raphael_session_journal_v1'
  });

  const DEFAULT_LOCKED_TOPICS = [
    'сектор ii', 'сектор iii', 'сектор iv', 'сектор v',
    'сектор vi', 'сектор vii', 'сектор viii', 'сектор 0',
    'ядро сіель', 'сіель', 'сиель', 'причина катастрофи'
  ];

  // Глобальний реєстр підмодулів Рафаїла (Фази 1–5)
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

  class RaphaelCore {
    constructor(options = {}) {
      this.STATES = FSM_STATES;
      this.fsmState = options.initialState || FSM_STATES.IDLE;
      this.role = options.role || 'gm'; // 'gm' | 'player'
      this.isBusy = false;

      // Директиви Майстра (GM Direct Access)
      this.gmDirectives = {
        silentMode: false,
        injectedHint: '',
        lockedTopics: [...DEFAULT_LOCKED_TOPICS]
      };

      // Локальний зліпок активного персонажа (оновлюється через CHAR_UPDATED)
      this.characterSnapshot = {
        callsign: 'Сокіл',
        role: 'player',
        hp: 85,
        maxHp: 100,
        sector: 'Сектор I: Карантинні Сади',
        skills: [],
        injuries: []
      };

      // Останні репліки кімнати для контексту розмови (до 10 записів)
      this.roomChatBuffer = [];

      // Сесійний журнал для експорту в «Ірмінсуль» (п. 5 ТЗ)
      this.sessionJournal = this.loadOrInitJournal(options.sessionId);

      // Підписники на події ядра
      this.listeners = {
        stateChange: new Set(),
        overrideGlitch: new Set(),
        characterUpdated: new Set(),
        journalUpdated: new Set(),
        logMessage: new Set(),
        directivesChanged: new Set()
      };

      // Канали міжвкладкового зв'язку (Етер <-> Лист Персонажа <-> Ірмінсуль)
      this.bridgeChannel = null;
      this.irminsulChannel = null;

      this.initBridgeListeners();
      this.syncCharacterFromStorage();
      this.bindTestBenchDOMIfPresent();
    }

    // =========================================================================
    // 1. МАШИНА СТАНІВ (FSM) ТА СИНХРОНІЗАЦІЯ З «ЕТЕРОМ»
    // =========================================================================
    getState() {
      return this.fsmState;
    }

    setState(nextState, meta = {}) {
      const normalized = String(nextState || '').toUpperCase();
      if (!FSM_STATES[normalized]) {
        console.warn(`[RaphaelCore] Невідомий стан FSM: ${nextState}`);
        return this.fsmState;
      }

      const prevState = this.fsmState;
      this.fsmState = normalized;
      this.isBusy = (normalized === FSM_STATES.THINKING || normalized === FSM_STATES.SPEAKING);

      // Повідомляємо підключений візуалізатор raphael_canvas.js (Фаза 2)
      if (window.RaphaelModules.canvas && typeof window.RaphaelModules.canvas.setMode === 'function') {
        window.RaphaelModules.canvas.setMode(normalized, meta);
      }

      // Синхронізуємо стан із мостом «Етеру» (window.AetherRafaelBridge), якщо ми всередині aether.html
      if (window.AetherRafaelBridge && typeof window.AetherRafaelBridge.setBotState === 'function') {
        const aetherMap = {
          DORMANT: 'Idle',
          IDLE: 'Idle',
          LISTENING: 'Listening',
          THINKING: 'Working',
          SPEAKING: 'Speaking'
        };
        if (!meta.fromAether) {
          window.AetherRafaelBridge.setBotState(aetherMap[normalized] || 'Idle', true);
        }
      }

      // Транслюємо зміну стану через BroadcastChannel для інших вкладок
      if (!meta.fromBridge) {
        this.postBridgeEvent('RAPHAEL_FSM_CHANGED', {
          state: normalized,
          prevState
        });
      }

      this.emit('stateChange', { state: normalized, prevState, meta });
      return this.fsmState;
    }

    // =========================================================================
    // 2. СЮЖЕТНИЙ ЗЛАМ (AETHER_SYSTEM_OVERRIDE) ТА КОНТРОЛЬ РОЛЕЙ
    // =========================================================================
    setRole(newRole) {
      this.role = String(newRole).toLowerCase() === 'gm' ? 'gm' : 'player';
      this.emit(' logMessage', {
        author: 'СИСТЕМА',
        text: `Режим доступу змінено: ${this.role === 'gm' ? 'МАЙСТЕР (GM)' : 'ГРАВЕЦЬ'}.`,
        type: 'system'
      });
      return this.role;
    }

    isGM() {
      return this.role === 'gm';
    }

    triggerSystemOverride(source = 'GM_CONSOLE') {
      const prevState = this.fsmState;
      this.gmDirectives.silentMode = false;
      this.setState(FSM_STATES.IDLE, { override: true, source });

      // Transmitting AETHER_SYSTEM_OVERRIDE to all connected pages
      if (source !== 'BRIDGE_REMOTE') {
        this.postBridgeEvent('AETHER_SYSTEM_OVERRIDE', {
          timestamp: Date.now(),
          unlockedBy: this.characterSnapshot.callsign || 'Архітектор'
        });
      }

      this.emit('overrideGlitch', { prevState, timestamp: Date.now() });
      this.emit('directivesChanged', this.getDirectivesSnapshot());
      this.emit('logMessage', {
        author: 'СИСТЕМА',
        text: 'Сигнал AETHER_SYSTEM_OVERRIDE прийнято. Ядро «РАФАЇЛЬ» переведено в активний режим IDLE.',
        type: 'ai'
      });

      return true;
    }

    // =========================================================================
    // 3. ПАРСЕР КОНСОЛЬНИХ ДИРЕКТИВ МАЙСТРА (/silent, /inject, /lock_topic)
    // =========================================================================
    processMasterDirective(rawCommand) {
      const trimmed = String(rawCommand || '').trim();
      if (!trimmed.startsWith('/')) return { handled: false };

      if (!this.isGM()) {
        this.emit('logMessage', {
          author: 'СИСТЕМА',
          text: '[ВІДМОВА ДОСТУПУ: Системні директиви доступні виключно Майстру (GM)]',
          type: 'error'
        });
        return { handled: true, error: 'FORBIDDEN' };
      }

      const parts = trimmed.split(/\s+/);
      const cmd = parts[0].toLowerCase();
      const arg = parts.slice(1).join(' ').trim();

      switch (cmd) {
        case '/silent': {
          const turnOn = arg.toLowerCase() === 'on' || arg === '1' || arg.toLowerCase() === 'true';
          this.gmDirectives.silentMode = turnOn;
          this.emit('directivesChanged', this.getDirectivesSnapshot());
          this.emit('logMessage', {
            author: 'GM DIRECTIVE',
            text: `Примусове заглушення Рафаїла (/silent): ${turnOn ? 'УВІМКНЕНО' : 'ВИМКНЕНО'}.`,
            type: 'ai'
          });
          return { handled: true, command: 'silent', value: turnOn };
        }

        case '/inject': {
          this.gmDirectives.injectedHint = arg;
          this.emit('directivesChanged', this.getDirectivesSnapshot());
          this.emit('logMessage', {
            author: 'GM DIRECTIVE',
            text: arg
              ? `Приховану підказку ін'єктовано в наступну відповідь: "${arg}"`
              : 'Ін’єктовану підказку очищено.',
            type: 'ai'
          });
          return { handled: true, command: 'inject', value: arg };
        }

        case '/lock_topic': {
          if (arg) {
            const topicLow = arg.toLowerCase();
            if (!this.gmDirectives.lockedTopics.includes(topicLow)) {
              this.gmDirectives.lockedTopics.push(topicLow);
            }
            this.emit('directivesChanged', this.getDirectivesSnapshot());
            this.emit('logMessage', {
              author: 'GM DIRECTIVE',
              text: `Тему "${arg}" заблоковано протоколом карантину.`,
              type: 'ai'
            });
          }
          return { handled: true, command: 'lock_topic', value: arg };
        }

        case '/unlock_topic': {
          if (arg) {
            const topicLow = arg.toLowerCase();
            this.gmDirectives.lockedTopics = this.gmDirectives.lockedTopics.filter((t) => t !== topicLow);
            this.emit('directivesChanged', this.getDirectivesSnapshot());
            this.emit('logMessage', {
              author: 'GM DIRECTIVE',
              text: `Обмеження з теми "${arg}" знято.`,
              type: 'ai'
            });
          }
          return { handled: true, command: 'unlock_topic', value: arg };
        }

        case '/dormant': {
          this.setState(FSM_STATES.DORMANT);
          this.emit('logMessage', {
            author: 'GM DIRECTIVE',
            text: 'Ядро «РАФАЇЛЬ» переведено у заблокований стан DORMANT.',
            type: 'error'
          });
          return { handled: true, command: 'dormant' };
        }

        case '/stop_session': {
          const exported = this.finalizeAndExportToIrminsul(true);
          return { handled: true, command: 'stop_session', data: exported };
        }

        default:
          return { handled: false };
      }
    }

    consumeInjectedHint() {
      const hint = this.gmDirectives.injectedHint;
      this.gmDirectives.injectedHint = '';
      this.emit('directivesChanged', this.getDirectivesSnapshot());
      return hint;
    }

    isTopicLockedByProtocol(queryText, currentSector = '') {
      const lowQuery = String(queryText || '').toLowerCase();
      const lowSector = String(currentSector || this.characterSnapshot.sector || '').toLowerCase();

      if (lowSector.includes('[заблоковано]') || lowSector.includes('сектор ii') || lowSector.includes('сектор 0')) {
        return true;
      }

      return this.gmDirectives.lockedTopics.some((topic) => topic && lowQuery.includes(topic));
    }

    getDirectivesSnapshot() {
      return {
        silentMode: this.gmDirectives.silentMode,
        injectedHint: this.gmDirectives.injectedHint,
        lockedTopics: [...this.gmDirectives.lockedTopics]
      };
    }

    // =========================================================================
    // 4. МАРШРУТИЗАЦІЯ ЗАПИТІВ ГРАВЦІВ (PTT ТА ТЕКСТ) ДО МІЗКІВ І ГОЛОСУ
    // =========================================================================
    startListeningSession(callerCallsign = null) {
      if (this.fsmState === FSM_STATES.DORMANT) {
        this.emit('logMessage', {
          author: 'СИСТЕМА',
          text: '[ПОМИЛКА: Модуль перебуває у стані DORMANT. Потрібна активація AETHER_SYSTEM_OVERRIDE]',
          type: 'error'
        });
        return false;
      }

      if (this.gmDirectives.silentMode) {
        this.emit('logMessage', {
          author: 'СИСТЕМА',
          text: '[КАНАЛ ЗАБЛОКОВАНО: Рафаїль переведений у режим радіотиші /silent on]',
          type: 'error'
        });
        return false;
      }

      // Перевірка Debounce / Lock через raphael_optimizer.js (або внутрішній прапорець isBusy)
      if (this.isBusy || (window.RaphaelModules.optimizer?.isLocked?.())) {
        return false;
      }

      if (callerCallsign) {
        this.characterSnapshot.callsign = callerCallsign;
      }

      this.setState(FSM_STATES.LISTENING);

      if (window.RaphaelModules.voice && typeof window.RaphaelModules.voice.startPTTCapture === 'function') {
        window.RaphaelModules.voice.startPTTCapture();
      }

      return true;
    }

    stopListeningSession() {
      if (this.fsmState !== FSM_STATES.LISTENING) return false;

      if (window.RaphaelModules.voice && typeof window.RaphaelModules.voice.stopPTTCapture === 'function') {
        window.RaphaelModules.voice.stopPTTCapture();
      } else {
        this.setState(FSM_STATES.IDLE);
      }
      return true;
    }

    async submitQuery(rawQuery, customContext = {}) {
      const text = String(rawQuery || '').trim();
      if (!text) return null;

      // 1. Спочатку перевіряємо, чи це директива Майстра (/silent, /inject, /lock_topic)
      if (text.startsWith('/')) {
        return this.processMasterDirective(text);
      }

      // 2. Перевірка доступності ядра
      if (this.fsmState === FSM_STATES.DORMANT) {
        const msg = '[МОДУЛЬ У СТАНІ DORMANT: Необхідна синхронізація з Маяком або сигнал AETHER_SYSTEM_OVERRIDE]';
        this.emit('logMessage', { author: 'СИСТЕМА', text: msg, type: 'error' });
        return null;
      }

      if (this.gmDirectives.silentMode) {
        const msg = '[РАДІОТИША: Модуль тимчасово заглушений директивою Майстра]';
        this.emit('logMessage', { author: 'СИСТЕМА', text: msg, type: 'error' });
        return null;
      }

      if (this.isBusy) return null;

      const snapshot = {
        ...this.characterSnapshot,
        ...customContext
      };
      const callsign = snapshot.callsign || 'Оперативник';

      this.emit('logMessage', { author: callsign, text, type: 'user' });
      this.setState(FSM_STATES.THINKING);

      // 3. Перевірка протоколу лорного захисту (Fail-Safe Protocol)
      if (this.isTopicLockedByProtocol(text, snapshot.sector)) {
        const failSafeReply = '[ПОМИЛКА ДОСТУПУ: Сектор пам\'яті пошкоджено. Необхідна синхронізація з Маяком.]';
        this.recordUnresolvedQuery(
          `Суб'єкт ${callsign} цікавився закритими даними ("${text}") — відмовлено за протоколом карантину`
        );
        this.emit('logMessage', { author: 'РАФАЇЛЬ [FAIL-SAFE]', text: failSafeReply, type: 'error' });
        await this.deliverAudioResponse(failSafeReply);
        return failSafeReply;
      }

      // 4. Якщо підключений модуль raphael_brain.js (Фаза 3) — делегуємо запит йому
      let responseText = '';
      const injectedHint = this.consumeInjectedHint();

      if (window.RaphaelModules.brain && typeof window.RaphaelModules.brain.generateResponse === 'function') {
        try {
          responseText = await window.RaphaelModules.brain.generateResponse({
            query: text,
            character: snapshot,
            recentChat: this.roomChatBuffer.slice(-5),
            injectedHint
          });
        } catch (err) {
          console.error('[RaphaelCore] Помилка raphael_brain:', err);
        }
      }

      // 5. Якщо Фаза 3 ще не підключена або працює офлайн — використовуємо резервний тактичний синтезатор ядра
      if (!responseText) {
        responseText = await this.buildFallbackTacticalReply(text, snapshot, injectedHint);
      }

      // Обмежуємо довжину через raphael_optimizer.js (якщо підключений)
      if (window.RaphaelModules.optimizer && typeof window.RaphaelModules.optimizer.enforceWordLimit === 'function') {
        responseText = window.RaphaelModules.optimizer.enforceWordLimit(responseText, 50);
      }

      // Записуємо діалог у журнал сесії для «Ірмінсуля»
      this.recordDialogueEntry(callsign, text, responseText);
      this.emit('logMessage', { author: 'РАФАЇЛЬ', text: responseText, type: 'ai' });

      await this.deliverAudioResponse(responseText);
      return responseText;
    }

    async buildFallbackTacticalReply(query, snapshot, injectedHint) {
      await new Promise((r) => setTimeout(r, 480));
      const low = query.toLowerCase();
      const callsign = snapshot.callsign || 'Оперативник';
      const hpRatio = snapshot.maxHp > 0 ? Math.round((snapshot.hp / snapshot.maxHp) * 100) : Number(snapshot.hp || 100);

      const bioAlert = hpRatio < 25
        ? ` Попередження: життєві показники на критичній межі (${hpRatio}%), високий ризик зупинки організму.`
        : '';
      const hintPart = injectedHint ? ` Додаткова телеметрія: ${injectedHint}.` : '';

      if (low.includes('рослин') || low.includes('плющ') || low.includes('лист')) {
        return `Суб'єкт ${callsign}, аналіз біометрії: Люмінесцентний плющ Вавилонії. Контакт безпечний. Скверни не виявлено.${bioAlert}${hintPart}`;
      }
      if (low.includes('статус') || low.includes('біометр') || low.includes('стан')) {
        return `Суб'єкт ${callsign}, локація «${snapshot.sector}» стабільна. Ваша біометрія: ${hpRatio}% норми.${bioAlert}${hintPart}`;
      }
      return `Суб'єкт ${callsign}, запит у секторі «${snapshot.sector}» оброблено. Канал синхронізації з Маяком стабільний.${bioAlert}${hintPart}`;
    }

    async deliverAudioResponse(text) {
      this.setState(FSM_STATES.SPEAKING);

      // Якщо підключено raphael_voice.js (Фаза 4) — озвучуємо через Web Audio DSP / Neural TTS
      if (window.RaphaelModules.voice && typeof window.RaphaelModules.voice.speak === 'function') {
        try {
          await window.RaphaelModules.voice.speak(text);
        } catch (_) {}
        this.setState(FSM_STATES.IDLE);
        return;
      }

      // Якщо ми в Етері — передаємо через шлюз AetherRafaelBridge
      if (window.AetherRafaelBridge && window.AetherRafaelBridge.isActive?.()) {
        window.AetherRafaelBridge.speak(text, true);
      }

      this.setState(FSM_STATES.SPEAKING);
    }

    // =========================================================================
    // 5. ІНТЕГРАЦІЯ З ENTROPIA_BRIDGE.JS (CHAR_UPDATED & OVERRIDE)
    // =========================================================================
    initBridgeListeners() {
      // 1. BroadcastChannel для миттєвого обміну між вкладками (aether.html <-> character_sheet <-> irminsul)
      if ('BroadcastChannel' in window) {
        try {
          this.bridgeChannel = new BroadcastChannel('entropia_bridge_channel');
          this.bridgeChannel.onmessage = (event) => {
            this.handleIncomingBridgePacket(event.data);
          };

          this.irminsulChannel = new BroadcastChannel('entropia_irminsul_channel');
        } catch (_) {}
      }

      // 2. Підписка на window.EntropiaBridge (якщо підключений entropia_bridge.js)
      if (window.EntropiaBridge && typeof window.EntropiaBridge.on === 'function') {
        window.EntropiaBridge.on('AETHER_SYSTEM_OVERRIDE', () => {
          this.triggerSystemOverride('BRIDGE_REMOTE');
        });
        window.EntropiaBridge.on('CHAR_UPDATED', (charData) => {
          this.updateCharacterSnapshot(charData);
        });
      }

      // 3. Слухач window.addEventListener('message') та localStorage ('entropia_active_character')
      window.addEventListener('message', (event) => {
        if (event.data && typeof event.data === 'object' && event.data.type) {
          this.handleIncomingBridgePacket(event.data);
        }
      });

      window.addEventListener('storage', (event) => {
        if (event.key === STORAGE_KEYS.ACTIVE_CHAR && event.newValue) {
          this.syncCharacterFromStorage();
        }
      });
    }

    handleIncomingBridgePacket(packet) {
      if (!packet || !packet.type) return;

      switch (packet.type) {
        case 'AETHER_SYSTEM_OVERRIDE':
          this.triggerSystemOverride('BRIDGE_REMOTE');
          break;

        case 'CHAR_UPDATED':
          if (packet.payload || packet.character) {
            this.updateCharacterSnapshot(packet.payload || packet.character);
          }
          break;

        case 'POINT_DISCOVERED':
          if (packet.point) {
            this.addDiscoveredPoint(packet.point);
          }
          break;

        case 'RAPHAEL_FSM_CHANGED':
          if (packet.state && packet.state !== this.fsmState) {
            this.setState(packet.state, { fromBridge: true });
          }
          break;

        case 'ROOM_CHAT_LOG':
          if (packet.author && packet.text) {
            this.pushRoomChatLine(packet.author, packet.text);
          }
          break;
      }
    }

    postBridgeEvent(type, payload = {}) {
      const pkt = { type, ...payload, ts: Date.now() };
      if (this.bridgeChannel) {
        try { this.bridgeChannel.postMessage(pkt); } catch (_) {}
      }
      if (window.EntropiaBridge && typeof window.EntropiaBridge.emit === 'function') {
        try { window.EntropiaBridge.emit(type, pkt); } catch (_) {}
      }
    }

    syncCharacterFromStorage() {
      try {
        const raw = localStorage.getItem(STORAGE_KEYS.ACTIVE_CHAR);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        this.updateCharacterSnapshot(parsed);
      } catch (_) {}
    }

    updateCharacterSnapshot(data = {}) {
      if (!data || typeof data !== 'object') return this.characterSnapshot;

      this.characterSnapshot = {
        ...this.characterSnapshot,
        callsign: data.callsign || data.name || this.characterSnapshot.callsign || 'Сокіл',
        hp: Number(data.hp ?? data.currentHp ?? this.characterSnapshot.hp),
        maxHp: Number(data.maxHp ?? data.hpMax ?? this.characterSnapshot.maxHp),
        sector: data.sector || data.location || this.characterSnapshot.sector,
        skills: Array.isArray(data.skills) ? data.skills : this.characterSnapshot.skills,
        injuries: Array.isArray(data.injuries) ? data.injuries : this.characterSnapshot.injuries
      };

      this.emit('characterUpdated', this.characterSnapshot);
      return this.characterSnapshot;
    }

    pushRoomChatLine(author, text) {
      this.roomChatBuffer.push({ author, text, ts: Date.now() });
      if (this.roomChatBuffer.length > 12) {
        this.roomChatBuffer.shift();
      }
    }

    // =========================================================================
    // 6. СЕСІЙНИЙ ЖУРНАЛ ТА ЕКСПОРТ У ГРАФ «ІРМІНСУЛЬ» (П. 5 ТЗ)
    // =========================================================================
    loadOrInitJournal(sessionId = 'entropy_session_01') {
      try {
        const saved = localStorage.getItem(STORAGE_KEYS.JOURNAL_BACKUP);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed && parsed.aiNode === 'RAPHAEL_CORE_V1') {
            return parsed;
          }
        }
      } catch (_) {}

      return {
        sessionId,
        aiNode: 'RAPHAEL_CORE_V1',
        discoveredPoints: ['Станція метро', 'Оранжерея №3', 'Маяк Рафаїла'],
        dialogueLog: [],
        unresolvedQueries: []
      };
    }

    saveJournalBackup() {
      try {
        localStorage.setItem(STORAGE_KEYS.JOURNAL_BACKUP, JSON.stringify(this.sessionJournal));
      } catch (_) {}
      this.emit('journalUpdated', this.sessionJournal);
    }

    addDiscoveredPoint(pointName) {
      const clean = String(pointName || '').trim();
      if (!clean) return;
      if (!this.sessionJournal.discoveredPoints.includes(clean)) {
        this.sessionJournal.discoveredPoints.push(clean);
        this.saveJournalBackup();
      }
    }

    recordDialogueEntry(character, query, response) {
      this.sessionJournal.dialogueLog.push({
        character: String(character || 'Оперативник'),
        query: String(query || ''),
        response: String(response || ''),
        timestamp: Date.now()
      });
      this.saveJournalBackup();
    }

    recordUnresolvedQuery(description) {
      this.sessionJournal.unresolvedQueries.push(String(description));
      this.saveJournalBackup();
    }

    getIrminsulPayload() {
      return JSON.parse(JSON.stringify(this.sessionJournal));
    }

    finalizeAndExportToIrminsul(downloadFile = true) {
      const payload = this.getIrminsulPayload();

      // Відправляємо пакет у відкриту вкладку «Ірмінсуля» через BroadcastChannel
      if (this.irminsulChannel) {
        try {
          this.irminsulChannel.postMessage({
            type: 'IRMINSUL_SESSION_IMPORT',
            payload
          });
        } catch (_) {}
      }
      this.postBridgeEvent('IRMINSUL_SESSION_IMPORT', { payload });

      if (downloadFile && typeof document !== 'undefined') {
        try {
          const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${payload.sessionId}_irminsul.json`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 4000);
        } catch (_) {}
      }

      this.emit('logMessage', {
        author: 'СИСТЕМА',
        text: `Сесійний журнал (${payload.dialogueLog.length} записів) сформовано та передано у шлюз «Ірмінсуля».`,
        type: 'ai'
      });

      return payload;
    }

    // =========================================================================
    // 7. ПОДІЄВА ШИНА ТА АВТО-ПРИВ'ЯЗКА ДО ТЕСТОВОГО ПОЛІГОНУ (raphael_test.html)
    // =========================================================================
    on(eventName, callback) {
      if (this.listeners[eventName] && typeof callback === 'function') {
        this.listeners[eventName].add(callback);
      }
      return () => this.listeners[eventName]?.delete(callback);
    }

    emit(eventName, detail) {
      const cleanName = eventName.trim();
      if (!this.listeners[cleanName]) return;
      this.listeners[cleanName].forEach((cb) => {
        try { cb(detail); } catch (e) { console.error(e); }
      });
    }

    onSubmoduleRegistered(name, instance) {
      if (typeof instance.attachCore === 'function') {
        instance.attachCore(this);
      }
    }

    bindTestBenchDOMIfPresent() {
      const bind = () => {
        const topFsmPill = document.getElementById('top-fsm-pill');
        const irminsulBox = document.getElementById('irminsul-json-box');
        const directivesBox = document.getElementById('gm-directives-status');
        if (!topFsmPill && !irminsulBox) return;

        // Оновлюємо JSON-прев'ю Ірмінсуля при старті та кожній зміні
        if (irminsulBox) {
          irminsulBox.textContent = JSON.stringify(this.sessionJournal, null, 2);
          this.on('journalUpdated', (journal) => {
            irminsulBox.textContent = JSON.stringify(journal, null, 2);
          });
        }

        // Синхронізуємо індикатор стану FSM у шапці та на нижній панелі
        this.on('stateChange', ({ state }) => {
          if (topFsmPill) topFsmPill.textContent = state;
          document.querySelectorAll('.fsm-node').forEach((node) => {
            node.classList.toggle('active', node.dataset.state === state);
          });
        });

        this.on('directivesChanged', (dir) => {
          if (directivesBox) {
            directivesBox.textContent =
              `Silent: ${dir.silentMode ? 'ON' : 'OFF'} | Injected: ${dir.injectedHint || 'None'} | Locked: [${dir.lockedTopics.slice(0, 4).join(', ')}...]`;
          }
        });
      };

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bind);
      } else {
        bind();
      }
    }
  }

  // Ініціалізуємо та експортуємо синглтон ядра
  const coreInstance = new RaphaelCore();
  window.RaphaelCore = coreInstance;
  window.RaphaelModules.register('core', coreInstance);
})(window);