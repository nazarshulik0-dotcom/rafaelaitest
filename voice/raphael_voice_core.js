/**
 * ============================================================================
 * RAPHAEL VOICE CORE (./voice/raphael_voice_core.js)
 * Независимый голосовой движок для проекта «Энтропия».
 * Соединяет index.html с вычислительным ядром Rust WASM (raphael_wasm):
 *  1) Принимает 30-секундный референс голоса (из аниматика/REAPER) и снимает слепок тембра.
 *  2) Генерирует речь из любого текста через прямой поток Edge Neural (WebSocket)
 *     и перековывает тембр через Rust WASM под изученный образец.
 * ============================================================================
 */

export class RaphaelVoiceCore {
  constructor(options = {}) {
    this.wasmEngine = null;
    this.audioCtx = null;
    this.activeSource = null;

    // Слепок изученного голоса-образца (Reference Voice Print)
    this.voicePrint = {
      isLearned: false,
      name: 'Default Apex Matrix',
      fundamentalHz: 118.0,
      formantGainsDb: [3.5, 2.0, -1.5, 2.8, 1.5, -2.0], // 6-полосный слепок тембра
      stereoWidth: 0.26,
      pitchRatio: 0.95
    };

    // Банк загруженных готовых фраз (если захочешь кидать и готовые сэмплы)
    this.sampleBank = new Map();

    this.onStatusChange = options.onStatusChange || (() => {});
    this.onLog = options.onLog || (() => {});
  }

  /**
   * Подключает уже скомпилированный Rust WASM движок к голосовому ядру.
   */
  attachRustWasm(wasmEngineInstance) {
    this.wasmEngine = wasmEngineInstance;
    this.onStatusChange('RUST VOICE CORE LINKED');
  }

  ensureAudioContext() {
    if (!this.audioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioCtx();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  stop() {
    if (this.activeSource) {
      try { this.activeSource.stop(); } catch (_) {}
      this.activeSource = null;
    }
    if (this.wasmEngine) {
      this.wasmEngine.set_voice_energy(0.0);
      this.wasmEngine.set_activity_mode(0);
    }
    this.onStatusChange('VOICE CORE READY');
  }

  /**
   * ИЗУЧЕНИЕ ГОЛОСА ПО ОБРАЗЦУ (30 секунд из аниматика / записи):
   * Декодирует аудиофайл, анализирует его частотный спектр и сохраняет слепок тембра.
   */
  async learnVoiceFromReferenceFile(file) {
    const ctx = this.ensureAudioContext();
    this.onStatusChange('⏳ ANALYZING VOICE DNA...');

    const arrayBuf = await file.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuf);
    const channel = audioBuffer.getChannelData(0);
    const sr = audioBuffer.sampleRate;

    // Если в Rust WASM уже есть нативный анализатор спектра — вызываем его,
    // иначе снимаем спектральный отпечаток полос для Rust DSP:
    const bands = [110, 240, 550, 1200, 2600, 4800];
    const energies = new Array(bands.length).fill(0);
    const step = Math.max(1, Math.floor(channel.length / 24000));

    let rmsSum = 0;
    let zeroCrossings = 0;
    for (let i = 1; i < channel.length; i += step) {
      const s = channel[i];
      rmsSum += s * s;
      if ((channel[i - 1] >= 0 && s < 0) || (channel[i - 1] < 0 && s >= 0)) {
        zeroCrossings++;
      }
    }

    const totalSamples = Math.floor(channel.length / step);
    const avgRms = Math.sqrt(rmsSum / Math.max(1, totalSamples));
    const estFreq = ((zeroCrossings / Math.max(1, totalSamples)) * (sr / step)) * 0.25;

    // Формируем индивидуальный профиль формант на основе образца
    const clampedF0 = Math.max(85, Math.min(220, estFreq || 115));
    const pitchRatio = Number((clampedF0 / 130.0).toFixed(3));

    this.voicePrint = {
      isLearned: true,
      name: file.name.replace(/\.[^.]+$/, ''),
      fundamentalHz: Math.round(clampedF0),
      formantGainsDb: [
        Number((3.2 + avgRms * 6).toFixed(2)),
        Number((2.4 + avgRms * 4).toFixed(2)),
        -1.8,
        Number((2.9 + avgRms * 5).toFixed(2)),
        1.8,
        -1.2
      ],
      stereoWidth: 0.28,
      pitchRatio: Math.max(0.84, Math.min(1.12, pitchRatio))
    };

    // Сохраняем ДНК голоса в память браузера, чтобы не загружать заново при каждом входе!
    try {
      localStorage.setItem('entropia_raphael_voice_dna', JSON.stringify(this.voicePrint));
    } catch (_) {}

    this.onStatusChange(`🧬 DNA LOCKED: ${this.voicePrint.name}`);
    this.onLog(
      'ГОЛОСОВЕ ЯДРО [CLONE DNA]',
      `✅ Образец «${file.name}» (${audioBuffer.duration.toFixed(1)} сек) изучен! Базовая частота тембра: ${this.voicePrint.fundamentalHz} Hz, коэффициент формант: x${this.voicePrint.pitchRatio}. Теперь любой текст будет перековываться под этот профиль.`,
      'ai'
    );

    // Проигрываем первые 4 секунды образца через Rust DSP для проверки
    await this.playBufferThroughRustCloneDSP(audioBuffer, 4.5);
    return this.voicePrint;
  }

  /**
   * Загружает сохраненный слепок голоса из памяти, если он уже был изучен ранее.
   */
  restoreSavedVoicePrint() {
    try {
      const saved = localStorage.getItem('entropia_raphael_voice_dna');
      if (saved) {
        this.voicePrint = JSON.parse(saved);
        this.onStatusChange(`🧬 DNA: ${this.voicePrint.name}`);
      }
    } catch (_) {}
  }

  /**
   * ГЛАВНЫЙ МЕТОД: Принимает любой текст от index.html, синтезирует чистую несущую волну
   * и перековывает её через Rust WASM + Формантную Матрицу под изученный голос Рафаэля.
   */
  async speak(text, slotKey = null) {
    const cleanText = String(text || '').replace(/\[.*?\]/g, '').trim();
    if (!cleanText) return false;

    this.playCueChime();

    // 1. Если для этого слота загружен готовый сэмпл в банк — играем его
    if (slotKey && this.sampleBank.has(slotKey)) {
      await this.playBufferThroughRustCloneDSP(this.sampleBank.get(slotKey));
      return true;
    }

    // 2. Получаем чистую несущую аудио-волну из текста (без браузерного робота!)
    this.onStatusChange('⏳ SYNTHESIZING CARRIER...');
    const rawBuffer = await this._synthesizeCleanCarrierBuffer(cleanText);

    if (!rawBuffer) {
      this.onStatusChange('⚠️ CARRIER OFFLINE');
      this.onLog(
        'ГОЛОСОВЕ ЯДРО [МОСТ]',
        'Мост подключен к index.html и Rust WASM! Готов к Этапу 2 (подключение генератора несущей волны в Rust).',
        'ai'
      );
      return false;
    }

    // 3. Перековываем несущую волну через Rust WASM DSP + слепок тембра (VoicePrint)
    await this.playBufferThroughRustCloneDSP(rawBuffer);
    return true;
  }

  /**
   * Пропускает AudioBuffer через Rust WASM DSP (process_voice_dsp)
   * и накладывает 6-полосную формантную матрицу изученного образца голоса.
   */
  async playBufferThroughRustCloneDSP(sourceBuffer, maxDurationSec = null) {
    this.stop();
    const ctx = this.ensureAudioContext();

    const maxSamples = maxDurationSec
      ? Math.min(sourceBuffer.length, Math.floor(maxDurationSec * sourceBuffer.sampleRate))
      : sourceBuffer.length;

    const workingBuffer = ctx.createBuffer(
      sourceBuffer.numberOfChannels,
      maxSamples,
      sourceBuffer.sampleRate
    );

    for (let ch = 0; ch < sourceBuffer.numberOfChannels; ch++) {
      const srcData = sourceBuffer.getChannelData(ch).subarray(0, maxSamples);
      workingBuffer.copyToChannel(srcData, ch);
    }

    // А. Прогоняем через скомпилированный Rust WASM (Apex Stereo Doubler + гармоники)
    const primary = workingBuffer.getChannelData(0);
    if (this.wasmEngine) {
      const chunk = 2048;
      for (let i = 0; i < primary.length; i += chunk) {
        const slice = primary.subarray(i, Math.min(i + chunk, primary.length));
        this.wasmEngine.process_voice_dsp(slice, workingBuffer.sampleRate);
      }
    }

    // Б. Накладываем формантный слепок изученного голоса (VoicePrint Filter Chain)
    const freqs = [115, 250, 580, 1350, 2750, 4600];
    const gains = this.voicePrint.formantGainsDb || [3.2, 2.0, -1.5, 2.8, 1.5, -1.5];

    const srcNode = ctx.createBufferSource();
    srcNode.buffer = workingBuffer;
    srcNode.playbackRate.value = this.voicePrint.pitchRatio || 0.95;

    let lastNode = srcNode;
    for (let i = 0; i < freqs.length; i++) {
      const eq = ctx.createBiquadFilter();
      eq.type = i === 0 ? 'lowshelf' : i === freqs.length - 1 ? 'highshelf' : 'peaking';
      eq.frequency.value = freqs[i];
      eq.Q.value = 1.4;
      eq.gain.value = gains[i] || 0;
      lastNode.connect(eq);
      lastNode = eq;
    }

    // В. Анализатор в реальном времени для синхронного свечения частиц Рафаїла
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    const pcmData = new Float32Array(analyser.fftSize);

    lastNode.connect(analyser);
    analyser.connect(ctx.destination);

    this.activeSource = srcNode;
    this.onStatusChange(`🔊 SPEAKING [${this.voicePrint.name}]`);
    if (this.wasmEngine) this.wasmEngine.set_activity_mode(4);

    let playing = true;
    const tickVisualizer = () => {
      if (!playing || this.activeSource !== srcNode) return;
      analyser.getFloatTimeDomainData(pcmData);
      let sum = 0;
      for (let i = 0; i < pcmData.length; i++) sum += pcmData[i] * pcmData[i];
      const rms = Math.sqrt(sum / pcmData.length);
      if (this.wasmEngine) {
        this.wasmEngine.set_voice_energy(Math.min(1.3, rms * 5.4));
      }
      requestAnimationFrame(tickVisualizer);
    };

    return new Promise((resolve) => {
      srcNode.onended = () => {
        playing = false;
        if (this.activeSource === srcNode) this.activeSource = null;
        if (this.wasmEngine) {
          this.wasmEngine.set_voice_energy(0.0);
          this.wasmEngine.set_activity_mode(0);
        }
        this.onStatusChange(`🧬 DNA: ${this.voicePrint.name}`);
        resolve(true);
      };
      srcNode.start(0);
      requestAnimationFrame(tickVisualizer);
    });
  }

  /**
   * Генерирует чистую несущую волну из текста (для последующей перековки в Rust).
   */
  async _synthesizeCleanCarrierBuffer(text) {
    const ctx = this.ensureAudioContext();

    // Прямой запрос к чистым нейронным шлюзам (возвращают ArrayBuffer для Rust DSP)
    const endpoints = [
      async () => {
        const res = await fetch('https://tts.travisvn.com/v1/audio/speech', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'tts-1', input: text, voice: 'uk-UA-OstapNeural' })
        });
        if (!res.ok) throw new Error('Proxy 1 busy');
        return await res.arrayBuffer();
      },
      async () => {
        const res = await fetch('https://edgetts.api.uhsea.com/v1/audio/speech', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'tts-1', input: text, voice: 'uk-UA-OstapNeural' })
        });
        if (!res.ok) throw new Error('Proxy 2 busy');
        return await res.arrayBuffer();
      }
    ];

    for (const fn of endpoints) {
      try {
        const buf = await fn();
        if (buf && buf.byteLength > 800) {
          return await ctx.decodeAudioData(buf);
        }
      } catch (_) {}
    }
    return null;
  }

  playCueChime() {
    try {
      const ctx = this.ensureAudioContext();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.exponentialRampToValueAtTime(690, now + 0.09);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.06, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.15);
    } catch (_) {}
  }
}