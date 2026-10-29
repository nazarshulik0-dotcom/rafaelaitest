/**
 * ============================================================================
 * RAPHAEL CORE (raphael_core.js) - v3.0 MASTER INIT & FSM ENGINE
 * Проєкт: НРІ «Ентропія» (Ковчег Вавилонії) | Система «Вітрувій»
 * ============================================================================
 */

(function (window) {
  'use strict';

  const FSM_STATES = Object.freeze({
    DORMANT: 'DORMANT',
    IDLE: 'IDLE',
    LISTENING: 'LISTENING',
    THINKING: 'THINKING',
    SPEAKING: 'SPEAKING'
  });

  const STORAGE_KEYS = Object.freeze({
    ACTIVE_CHAR: 'entropia_active_character',
    JOURNAL_BACKUP: 'entropia_raphael_session_journal_v3'
  });

  const DEFAULT_LOCKED_TOPICS = [
    'сектор ii', 'сектор iii', 'сектор iv', 'сектор v',
    'сектор vi', 'сектор vii', 'сектор viii', 'сектор 0',
    'ядро сіель', 'сіель', 'сиель', 'причина катастрофи'
  ];

  window.RaphaelModules = window.RaphaelModules || {
    core: null,
    canvas: null,
    brain: null,
    voice: null,
    optimizer: null,
    register(name, instance) {
      this[name] = instance;
      if (name === 'core' && instance) {
        // Якщо деякі модулі вже зареєструвалися раніше — негайно прив'язуємо їх до ядра!
        ['optimizer', 'canvas', 'voice', 'brain'].forEach((modName) => {
          if (this[modName] && typeof this[modName].attachCore === 'function') {
            this[modName].attachCore(instance);
          }
        });
      } else if (this.core && typeof instance?.attachCore === 'function') {
        instance.attachCore(this.core);
      }
    }
  };

  class RaphaelCore {
    constructor(options = {}) {
      this.STATES = FSM_STATES;
      this.fsmState = options.initialState || FSM_STATES.IDLE;
      this.role = options.role || 'gm';
      this.isBusy = false;

      this.gmDirectives = {
        silentMode: false,
        injectedHint: '',
        lockedTopics: [...DEFAULT_LOCKED_TOPICS]
      };

      this.characterSnapshot = {
        callsign: 'Сокіл',
        role: 'player',
        hp: 85,
        maxHp: 100,
        sector: 'Сектор I: Карантинні Сади',
        skills: [],
        injuries: []
      };

      this.roomChatBuffer = [];
      this.sessionJournal = this.loadOrInitJournal(options.sessionId);

      this.listeners = {
        stateChange: new Set(),
        overrideGlitch: new Set(),
        characterUpdated: new Set(),
        journalUpdated: new Set(),
        logMessage: new Set(),
        directivesChanged: new Set()
      };

      this.bridgeChannel = null;
      this.irminsulChannel = null;

      this.initBridgeListeners();
      this.syncCharacterFromStorage();
      this.bindTestBenchDOMIfPresent();
    }

    getState() {
      return this.fsmState;
    }

    setState(nextState, meta = {}) {
      const normalized = String(nextState || '').toUpperCase();
      if (!FSM_STATES[normalized]) return this.fsmState;

      const prevState = this.fsmState;
      this.fsmState = normalized;
      this.isBusy = (normalized === FSM_STATES.THINKING || normalized === FSM_STATES.SPEAKING);

      if (window.RaphaelModules.canvas && typeof window.RaphaelModules.canvas.setMode === 'function') {
        window.RaphaelModules.canvas.setMode(normalized, meta);
      }

      if (window.AetherRafaelBridge && typeof window.AetherRafaelBridge.setBotState === 'function' && !meta.fromAether) {
        const aetherMap = {
          DORMANT: 'Idle',
          IDLE: 'Idle',
          LISTENING: 'Listening',
          THINKING: 'Working',
          SPEAKING: 'Speaking'
        };
        window.AetherRafaelBridge.setBotState(aetherMap[normalized] || 'Idle', true);
      }

      if (!meta.fromBridge) {
        this.postBridgeEvent('RAPHAEL_FSM_CHANGED', { state: normalized, prevState });
      }

      this.emit('stateChange', { state: normalized, prevState, meta });
      return this.fsmState;
    }

    setRole(newRole) {
      this.role = String(newRole).toLowerCase() === 'gm' ? 'gm' : 'player';
      return this.role;
    }

    isGM() {
      return this.role === 'gm';
    }

    triggerSystemOverride(source = 'GM_CONSOLE') {
      const prevState = this.fsmState;
      this.gmDirectives.silentMode = false;
      this.setState(FSM_STATES.IDLE, { override: true, source });

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

    processMasterDirective(rawCommand) {
      const trimmed = String(rawCommand || '').trim();
      if (!trimmed.startsWith('/')) return { handled: false };

      if (!this.isGM()) {
        this.emit('logMessage', {
          author: 'СИСТЕМА',
          text: '[ВІДМОВА ДОСТУПУ: Директиви доступні виключно Майстру (GM)]',
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
            text: `Режим радіотиші (/silent): ${turnOn ? 'УВІМКНЕНО' : 'ВИМКНЕНО'}.`,
            type: 'ai'
          });
          return { handled: true, command: 'silent', value: turnOn };
        }
        case '/inject': {
          this.gmDirectives.injectedHint = arg;
          this.emit('directivesChanged', this.getDirectivesSnapshot());
          this.emit('logMessage', {
            author: 'GM DIRECTIVE',
            text: arg ? `Приховану підказку вшито в наступну відповідь: "${arg}"` : 'Підказку очищено.',
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
        case '/dormant': {
          this.setState(FSM_STATES.DORMANT);
          this.emit('logMessage', {
            author: 'GM DIRECTIVE',
            text: 'Ядро переведено у заблокований стан DORMANT.',
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
    // ЗАПУСК ТА ЗУПИНКА МІКРОФОНА (PTT)
    // =========================================================================
    async startListeningSession(callerCallsign = null) {
      if (this.fsmState === FSM_STATES.DORMANT) {
        this.emit('logMessage', {
          author: 'СИСТЕМА',
          text: '[ПОМИЛКА: Модуль у стані DORMANT. Натисніть «СЮЖЕТНИЙ ЗЛАМ»]',
          type: 'error'
        });
        return false;
      }

      if (this.gmDirectives.silentMode) {
        this.emit('logMessage', {
          author: 'СИСТЕМА',
          text: '[КАНАЛ ЗАБЛОКОВАНО: Увімкнено /silent on]',
          type: 'error'
        });
        return false;
      }

      // Якщо Рафаїль зараз говорить — перериваємо його мовлення, щоб вислухати гравця!
      if (this.fsmState === FSM_STATES.SPEAKING) {
        window.RaphaelModules.voice?.stopCurrentPlayback?.();
        this.isBusy = false;
      }

      if (callerCallsign) {
        this.characterSnapshot.callsign = callerCallsign;
      }

      this.setState(FSM_STATES.LISTENING);

      if (window.RaphaelModules.voice && typeof window.RaphaelModules.voice.startPTTCapture === 'function') {
        return await window.RaphaelModules.voice.startPTTCapture();
      }

      return true;
    }

    async stopListeningSession() {
      if (this.fsmState !== FSM_STATES.LISTENING) return false;

      if (window.RaphaelModules.voice && typeof window.RaphaelModules.voice.stopPTTCapture === 'function') {
        await window.RaphaelModules.voice.stopPTTCapture();
      } else {
        this.setState(FSM_STATES.IDLE);
      }
      return true;
    }

    async submitQuery(rawQuery, customContext = {}) {
      const text = String(rawQuery || '').trim();
      if (!text) return null;

      if (text.startsWith('/')) {
        return this.processMasterDirective(text);
      }

      if (this.fsmState === FSM_STATES.DORMANT) {
        this.emit('logMessage', {
          author: 'СИСТЕМА',
          text: '[МОДУЛЬ У СТАНІ DORMANT: Необхідна активація AETHER_SYSTEM_OVERRIDE]',
          type: 'error'
        });
        return null;
      }

      if (this.gmDirectives.silentMode) {
        this.emit('logMessage', {
          author: 'СИСТЕМА',
          text: '[РАДІОТИША: Модуль тимчасово заглушений Майстром]',
          type: 'error'
        });
        return null;
      }

      const snapshot = { ...this.characterSnapshot, ...customContext };
      const callsign = snapshot.callsign || 'Оперативник';

      this.emit('logMessage', { author: callsign, text, type: 'user' });
      this.setState(FSM_STATES.THINKING);

      if (this.isTopicLockedByProtocol(text, snapshot.sector)) {
        const failSafeReply = '[Помилка протоколу: фрагмент даних пошкоджено. Потрібна синхронізація з терміналом Маяка.]';
        this.recordUnresolvedQuery(`Суб'єкт ${callsign} запитував закриті дані ("${text}")`);
        this.emit('logMessage', { author: 'РАФАЇЛЬ [FAIL-SAFE]', text: failSafeReply, type: 'error' });
        await this.deliverAudioResponse(failSafeReply);
        return failSafeReply;
      }

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
          console.error('[RaphaelCore] Помилка мозку:', err);
        }
      }

      if (!responseText) {
        responseText = `Суб'єкт ${callsign}, канал синхронізовано. Життєві показники: ${snapshot.hp}%.`;
      }

      if (window.RaphaelModules.optimizer && typeof window.RaphaelModules.optimizer.enforceWordLimit === 'function') {
        responseText = window.RaphaelModules.optimizer.enforceWordLimit(responseText, 50);
      }

      this.recordDialogueEntry(callsign, text, responseText);
      this.emit('logMessage', { author: 'РАФАЇЛЬ', text: responseText, type: 'ai' });

      await this.deliverAudioResponse(responseText);
      return responseText;
    }

    async deliverAudioResponse(text) {
      this.setState(FSM_STATES.SPEAKING);

      if (window.RaphaelModules.voice && typeof window.RaphaelModules.voice.speak === 'function') {
        try {
          await window.RaphaelModules.voice.speak(text);
        } catch (_) {}
      }

      this.setState(FSM_STATES.IDLE);
    }

    initBridgeListeners() {
      if ('BroadcastChannel' in window) {
        try {
          this.bridgeChannel = new BroadcastChannel('entropia_bridge_channel');
          this.bridgeChannel.onmessage = (event) => this.handleIncomingBridgePacket(event.data);
          this.irminsulChannel = new BroadcastChannel('entropia_irminsul_channel');
        } catch (_) {}
      }

      window.addEventListener('storage', (event) => {
        if (event.key === STORAGE_KEYS.ACTIVE_CHAR && event.newValue) {
          this.syncCharacterFromStorage();
        }
      });
    }

    handleIncomingBridgePacket(packet) {
      if (!packet || !packet.type) return;
      if (packet.type === 'AETHER_SYSTEM_OVERRIDE') this.triggerSystemOverride('BRIDGE_REMOTE');
      if (packet.type === 'CHAR_UPDATED' && (packet.payload || packet.character)) {
        this.updateCharacterSnapshot(packet.payload || packet.character);
      }
    }

    postBridgeEvent(type, payload = {}) {
      const pkt = { type, ...payload, ts: Date.now() };
      if (this.bridgeChannel) {
        try { this.bridgeChannel.postMessage(pkt); } catch (_) {}
      }
    }

    syncCharacterFromStorage() {
      try {
        const raw = localStorage.getItem(STORAGE_KEYS.ACTIVE_CHAR);
        if (raw) this.updateCharacterSnapshot(JSON.parse(raw));
      } catch (_) {}
    }

    updateCharacterSnapshot(data = {}) {
      if (!data || typeof data !== 'object') return this.characterSnapshot;
      this.characterSnapshot = {
        ...this.characterSnapshot,
        callsign: data.callsign || data.name || this.characterSnapshot.callsign || 'Сокіл',
        hp: Number(data.hp ?? data.currentHp ?? this.characterSnapshot.hp),
        maxHp: Number(data.maxHp ?? data.hpMax ?? this.characterSnapshot.maxHp),
        sector: data.sector || data.location || this.characterSnapshot.sector
      };
      this.emit('characterUpdated', this.characterSnapshot);
      return this.characterSnapshot;
    }

    loadOrInitJournal(sessionId = 'entropy_session_01') {
      try {
        const saved = localStorage.getItem(STORAGE_KEYS.JOURNAL_BACKUP);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed && parsed.aiNode === 'RAPHAEL_CORE_V1') return parsed;
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

    finalizeAndExportToIrminsul(downloadFile = true) {
      const payload = JSON.parse(JSON.stringify(this.sessionJournal));
      if (this.irminsulChannel) {
        try { this.irminsulChannel.postMessage({ type: 'IRMINSUL_SESSION_IMPORT', payload }); } catch (_) {}
      }
      if (downloadFile && typeof document !== 'undefined') {
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${payload.sessionId}_irminsul.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 3000);
      }
      return payload;
    }

    on(eventName, callback) {
      const cleanName = eventName.trim();
      if (this.listeners[cleanName] && typeof callback === 'function') {
        this.listeners[cleanName].add(callback);
      }
      return () => this.listeners[cleanName]?.delete(callback);
    }

    emit(eventName, detail) {
      const cleanName = eventName.trim();
      if (!this.listeners[cleanName]) return;
      this.listeners[cleanName].forEach((cb) => {
        try { cb(detail); } catch (e) { console.error(e); }
      });
    }

    bindTestBenchDOMIfPresent() {
      const bind = () => {
        const topFsmPill = document.getElementById('top-fsm-pill');
        const irminsulBox = document.getElementById('irminsul-json-box');
        const directivesBox = document.getElementById('gm-directives-status');

        if (irminsulBox) {
          irminsulBox.textContent = JSON.stringify(this.sessionJournal, null, 2);
          this.on('journalUpdated', (journal) => {
            irminsulBox.textContent = JSON.stringify(journal, null, 2);
          });
        }

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

  const coreInstance = new RaphaelCore();
  window.RaphaelCore = coreInstance;
  window.RaphaelModules.register('core', coreInstance);
})(window);