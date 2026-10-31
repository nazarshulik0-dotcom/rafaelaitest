/**
 * ============================================================================
 * RAPHAEL BRAIN (raphael_brain.js) - ЕТАП 0: НУЛЬОВА ОСОБИСТІСТЬ
 * Проєкт: НРІ «Ентропія» (Ковчег Вавилонії) | Система «Вітрувій»
 * ----------------------------------------------------------------------------
 * Зміни етапу 0:
 *   1. ПОВНЕ ЗНЯТТЯ ОБМЕЖЕНЬ НА ЗВИЧАЙНІ ДІАЛОГИ: Рафаїль більше не лягає в
 *      помилку на привітання чи житейські питання. Тепер він веде вільний,
 *      розумний діалог як повноцінна особистість ШІ.
 *   2. Точковий Fail-Safe: помилка «Пошкоджені дані» спрацьовує виключно на
 *      реальні закриті сектори сюжету (II-VIII, Ядро Сіель) або блок Майстра.
 *   3. Швидкий текстовий конвеєр (Gemini 3.8 Flash + Хмарний ШІ-резерв).
 * ============================================================================
 */

(function (window) {
  'use strict';

  const XOR_SALT = 73;
  const STEALTH_CONFIG_VECTOR = [
    8, 24, 103, 8, 43, 113, 27, 7, 127, 2, 125, 24, 11, 45, 122, 31, 56, 60,
    40, 26, 123, 44, 38, 26, 19, 27, 3, 57, 42, 125, 3, 48, 5, 8, 47, 124,
    28, 122, 46, 49, 56, 44, 29, 51, 60, 31, 35, 43, 44, 62, 33, 60, 8
  ];

  const STORAGE_KEYS = Object.freeze({
    API_KEY_XOR: 'entropia_raphael_xor_key_stage0',
    ACTIVE_CHAR: 'entropia_active_character',
    IRMINSUL_NODES: 'entropia_irminsul_nodes_v1'
  });

  const FAILSAFE_MESSAGES = Object.freeze({
    PROTOCOL_ERROR: '[ПОМИЛКА ДОСТУПУ: Дані сектора пошкоджені або заблоковані протоколом безпеки Ковчега.]'
  });

  // Суворі заборонені теми сюжети (тільки те, що реально має бути закрите на нульовому етапі)
  const FORBIDDEN_LORE_PATTERNS = [
    /сектор[ауіом]?\s*(?:ii|iii|iv|v|vi|vii|viii|2|3|4|5|6|7|8|0|нуль)/i,
    /ядр[оауі]\s*сіель|сіель|сиель|ciel/i,
    /причин[аиу]\s*катастроф[и]?|хто\s*знищив\s*ковчег|що\s*сталося\s*з\s*ковчегом/i
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
      this.maxWords = options.maxWords || 60;
      this.maxOutputTokens = options.maxOutputTokens || 140;
      this.temperature = options.temperature || 0.65; // Живіший, гнучкіший діалог

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
          localStorage.setItem(STORAGE_KEYS.API_KEY_XOR, JSON.stringify(this.encodeKeyToBytes(clean)));
        }
      } catch (_) {}
    }

    getPrimaryEndpoint(apiKey, model = 'gemini-3.8-flash') {
      const cleanKey = String(apiKey || '').trim();
      return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(cleanKey)}`;
    }

    async verifyAndSaveKey(rawKeyInput) {
      const candidate = String(rawKeyInput || '').trim() || this.getApiKey();
      if (!candidate) {
        return { ok: false, message: '🟣 Поле ключа порожнє. Активовано швидкий хмарний ШІ.' };
      }

      this.setApiKey(candidate);
      const url = this.get