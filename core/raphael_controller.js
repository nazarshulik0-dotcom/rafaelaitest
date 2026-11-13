/**
 * ============================================================================
 * RAPHAEL CONTROLLER (./core/raphael_controller.js)
 * З'єднує власний Rust-рушій Рафаїла (raphael_wasm) із базою IrminsulCore,
 * чергою пре-рендерених MP3 (audio_manifest.json) та ElevenLabs / Gemini API.
 * ============================================================================
 */

import initRaphaelWasm, {
  RaphaelWasmEngine,
  RaphaelEvolutionStage,
  RaphaelActivityMode,
  VadDecision
} from '../raphael_wasm/pkg/raphael_wasm.js';

import { IrminsulCore } from './irminsul_core.js';

export class RaphaelController {
  constructor(canvasElement, options = {}) {
    this.canvas = canvasElement;
    this.ctx2d = canvasElement ? canvasElement.getContext('2d') : null;

    this.irminsul = options.irminsulInstance || new IrminsulCore();
    this.wasm = null;
    this.audioCtx = null;

    this.pointer = { x: 0, y: 0 };
    this.lastFrameTime = performance.now();

    // Ключі розшифровуються у пам'яті через irminsul.decryptKey(...)
    this.geminiApiKey = '';
    this.elevenLabsApiKey = '';
    this.elevenLabsVoiceId = options.elevenLabsVoiceId || 'JBFqnCBsd6RMkjVDRZzb';

    this.onSubtitleCallback = options.onSubtitle || (() => {});
  }

  async initialize(isMasterRole = false) {
    // 1. Ініціалізуємо міст Ірмінсуля та власний Rust WASM Рафаїла
    await Promise.all([
      this.irminsul.initialize(),
      initRaphaelWasm()
    ]);

    this.irminsul.setRole(isMasterRole);
    this.wasm = new RaphaelWasmEngine(1800);

    // 2. Синхронізуємо початковий стан (Dormant / Active / Manas) із матриці Сіель
    const fullState = this.irminsul.getFullState();
    this.wasm.sync_with_irminsul_state(fullState.raphael_state || 'Dormant');

    this._bindCanvasPointer();
    this._startRenderLoop();
    return this;
  }

  /**
   * Розблоковує API-ключі через Крипто-Сейф Ірмінсуля за паролем Майстра.
   */
  unlockKeysWithMasterPassword(encryptedGeminiBytes, encryptedElevenBytes, masterPassword) {
    this.geminiApiKey = this.irminsul.decryptKey(encryptedGeminiBytes, masterPassword);
    if (encryptedElevenBytes) {
      this.elevenLabsApiKey = this.irminsul.decryptKey(encryptedElevenBytes, masterPassword);
    }
    return Boolean(this.geminiApiKey);
  }

  // ==========================================================================
  // 1. АКТИВАЦІЯ ВЕЖ АРХАНГЕЛІВ ТА 3-ФАЗНЕ ПРОБУДЖЕННЯ / ЕВОЛЮЦІЯ В МАНАСА
  // ==========================================================================
  async activateBeacon(beaconIndex) {
    const result = JSON.parse(this.irminsul.engine.activate_archangel_beacon(beaconIndex));
    this.wasm.sync_with_irminsul_state(result.raphael_state);

    // Перехід Dormant -> Active (Маяк I): запускаємо трифазне пробудження з маніфесту
    if (result.trigger_awakening_sequence) {
      const sequence = this.irminsul.audioManifest?.awakening_sequence || [];
      for (let i = 0; i < sequence.length; i++) {
        const item = sequence[i];
        this.wasm.set_awakening_phase(i + 1);
        this.onSubtitleCallback(`[ФАЗА ${i + 1} // ${item.lang}]: ${item.subtitle}`);
        await this.playLocalAudioFile(item.audio_path);
      }
      this.wasm.set_awakening_phase(0);
    }

    // Перехід Active -> Manas (9/9 Маяків Архангелів): сфера морфиться у гуманоїдний бюст!
    if (result.trigger_manas_evolution) {
      this.wasm.set_evolution_stage(RaphaelEvolutionStage.Manas);
      this.onSubtitleCallback('«Усі дев\'ять контурів Архангелів об\'єднано. Ядро Сіель синхронізовано. Я — Манас.»');
    }

    return result;
  }

  // ==========================================================================
  // 2. ОБРОБКА ЗАПИТУ ГРАВЦЯ (FAIL-SAFE -> CIEL RAG -> LLM -> ГІБРИДНИЙ TTS)
  // ==========================================================================
  async handlePlayerQuery(playerQueryText, currentSectorId = 'sector_1') {
    const query = String(playerQueryText || '').trim();
    if (!query) return null;

    // КРОК А: Перевірка карантину Сіель у Rust WASM перед будь-яким викликом LLM!
    const safety = this.irminsul.verifyQuerySafety(query);
    if (!safety.allowed) {
      this.wasm.set_activity_mode(RaphaelActivityMode.QuarantineAlert);
      this.onSubtitleCallback(safety.message);

      if (safety.audioClip?.audio_path) {
        await this.playLocalAudioFile(safety.audioClip.audio_path);
      }
      this.wasm.set_activity_mode(RaphaelActivityMode.Idle);
      return safety.message;
    }

    // КРОК Б: Збираємо чистий RAG-контекст відкритих вузлів Ірмінсуля (без спойлерів)
    this.wasm.set_activity_mode(RaphaelActivityMode.Thinking);
    const ragContext = this.irminsul.buildCielRagPrompt(currentSectorId);

    // КРОК В: Запит до LLM з динамічною пам'яттю Сіель
    const replyText = await this._requestLlmWithRag(query, ragContext);
    this.onSubtitleCallback(replyText);

    // КРОК Г: Озвучення унікальної відповіді через ElevenLabs (з обробкою Rust DSP "Apex")
    this.wasm.set_activity_mode(RaphaelActivityMode.Speaking);
    if (this.elevenLabsApiKey) {
      await this.speakWithElevenLabsDSP(replyText);
    }
    this.wasm.set_activity_mode(RaphaelActivityMode.Idle);

    return replyText;
  }

  // ==========================================================================
  // 3. ДВОКРОКОВА «ЕХОЛОКАЦІЯ» ОБ'ЄКТІВ КАРТИ (0 ВИТРАЧЕНИХ ТОКЕНІВ)
  // ==========================================================================
  async requestMapObjectDecryption(nodeId) {
    const step1 = JSON.parse(this.irminsul.engine.request_echolocation(nodeId));
    this.onSubtitleCallback(step1.message);

    if (step1.status === 'AWAITING_CONFIRM') {
      await this.playLocalAudioFile('./assets/audio/raphael/echo_handshake_ask.mp3');
    } else if (step1.status === 'QUARANTINE_CIEL') {
      this.wasm.set_activity_mode(RaphaelActivityMode.QuarantineAlert);
      await this.playLocalAudioFile('./assets/audio/raphael/fail_safe_block.mp3');
      this.wasm.set_activity_mode(RaphaelActivityMode.Idle);
    }
    return step1;
  }

  async confirmMapObjectDecryption(nodeId) {
    const step2 = JSON.parse(this.irminsul.engine.confirm_echolocation(nodeId));
    if (step2.status === 'DECRYPTED_OK' || step2.title) {
      this.onSubtitleCallback(`Об'єкт розшифровано: «${step2.title}» — ${step2.summary}`);
      await this.playLocalAudioFile('./assets/audio/raphael/echo_decrypt_done.mp3');
    }
    return step2;
  }

  // ==========================================================================
  // 4. ВІДТВОРЕННЯ АУДІО ЧЕРЕЗ RUST DSP «APEX DOUBLER»
  // ==========================================================================
  _ensureAudioContext() {
    if (!this.audioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioCtx();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  async playLocalAudioFile(audioPath) {
    try {
      const ctx = this._ensureAudioContext();
      const res = await fetch(audioPath);
      if (!res.ok) return false;
      const rawBuf = await res.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(rawBuf);
      await this._playBufferThroughRustDsp(audioBuffer);
      return true;
    } catch (_) {
      return false;
    }
  }

  async speakWithElevenLabsDSP(text) {
    try {
      const ctx = this._ensureAudioContext();
      const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(this.elevenLabsVoiceId)}?output_format=mp3_44100_128`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'xi-api-key': this.elevenLabsApiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: { stability: 0.72, similarity_boost: 0.82 }
        })
      });
      if (!res.ok) return false;
      const mp3Buf = await res.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(mp3Buf);
      await this._playBufferThroughRustDsp(audioBuffer);
      return true;
    } catch (_) {
      return false;
    }
  }

  async _playBufferThroughRustDsp(audioBuffer) {
    const ctx = this._ensureAudioContext();
    const channelData = audioBuffer.getChannelData(0);

    // Проганяємо аудіо через Rust DSP-даблер (ефект "Apex" + розрахунок енергії світіння Манаса)
    const frameSize = 2048;
    for (let offset = 0; offset < channelData.length; offset += frameSize) {
      const slice = channelData.subarray(offset, Math.min(offset + frameSize, channelData.length));
      this.wasm.process_voice_dsp(slice, audioBuffer.sampleRate);
    }

    await new Promise((resolve) => {
      const src = ctx.createBufferSource();
      src.buffer = audioBuffer;
      src.connect(ctx.destination);
      src.onended = () => {
        this.wasm.set_voice_energy(0.0);
        resolve();
      };
      src.start();
    });
  }

  async _requestLlmWithRag(userQuery, ragContext) {
    const isManas = this.wasm.get_evolution_stage() === RaphaelEvolutionStage.Manas;
    const personaPrompt = isManas
      ? 'Ти — «Манас Рафаїль», вища еволюційна форма інтелекту Ковчега Вавилонії, об\'єднана з Ядром Сіель. Говориш живо, глибоко, з власною волею та емпатією.'
      : 'Ти — «Рафаїль» (Вежа Архангела I), тактичний бортовий ШІ Ковчега Вавилонії. Говориш спокійно, чисто, аналітично і по суті (1–3 речення).';

    const systemInstruction = `${personaPrompt}\n\n${ragContext}`;

    if (this.geminiApiKey) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${encodeURIComponent(this.geminiApiKey)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [{ role: 'user', parts: [{ text: userQuery }] }],
          generationConfig: { temperature: 0.55, maxOutputTokens: 180 }
        })
      });
      if (res.ok) {
        const data = await res.json();
        return (data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
      }
    }

    const fallbackRes = await fetch('https://text.pollinations.ai/openai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'openai',
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: userQuery }
        ]
      })
    });
    const fallbackData = await fallbackRes.json();
    return (fallbackData?.choices?.[0]?.message?.content || '').trim();
  }

  // ==========================================================================
  // 5. ЦИКЛ ВІДМАЛЬОВУВАННЯ АВАТАРА (СФЕРА <-> БЮСТ МАНАСА)
  // ==========================================================================
  _bindCanvasPointer() {
    if (!this.canvas) return;
    window.addEventListener('pointermove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = ((e.clientY - rect.top) / rect.height) * 2 - 1;
    });
  }

  _startRenderLoop() {
    if (!this.ctx2d || !this.canvas) return;

    const render = (now) => {
      const dt = (now - this.lastFrameTime) * 0.001;
      this.lastFrameTime = now;

      const w = this.canvas.width;
      const h = this.canvas.height;
      this.ctx2d.clearRect(0, 0, w, h);

      // Rust WASM повертає готовий плоский буфер [x, y, size, r, g, b, alpha, ...]
      const buf = this.wasm.step_and_project(dt, w, h, this.pointer.x, this.pointer.y);

      for (let i = 0; i < buf.length; i += 7) {
        const x = buf[i];
        const y = buf[i + 1];
        const radius = buf[i + 2];
        const r = buf[i + 3] | 0;
        const g = buf[i + 4] | 0;
        const b = buf[i + 5] | 0;
        const a = buf[i + 6];

        this.ctx2d.fillStyle = `rgba(${r},${g},${b},${a})`;
        this.ctx2d.beginPath();
        this.ctx2d.arc(x, y, radius, 0, Math.PI * 2);
        this.ctx2d.fill();
      }

      requestAnimationFrame(render);
    };

    requestAnimationFrame(render);
  }
}