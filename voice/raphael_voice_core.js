/**
 * ============================================================================
 * UNIVERSAL IRMINSUL VOICE CORE v3.0 (./voice/raphael_voice_core.js)
 * Автономне голосове ядро на базі:
 *  1) Локальної української нейромережі VITS (Xenova/mms-tts-ukr у WebAssembly)
 *  2) Стягування 10-вимірного ДНК голосу з репозиторію NRI_IRMINSUL
 *  3) Перековки тембру в реальному часі через Rust WASM (process_voice_dsp)
 * ============================================================================
 */

export class RaphaelVoiceCore {
  constructor(options = {}) {
    this.wasmEngine = null;
    this.audioCtx = null;
    this.activeSource = null;

    this.irminsulRepo = 'nazarshulik0-dotcom/NRI_IRMINSUL';
    this.irminsulBranch = options.irminsulBranch || 'main';

    this.currentProfile = {
      id: 'raphael_archangel_1',
      title: 'Рафаїль // Вежа Архангела I (Apex Matrix)',
      carrier_voice: 'uk-UA-OstapNeural',
      pitch_ratio: 0.94,
      dna_vector: [114.5, 4.2, 2.6, -2.1, 3.4, 2.1, -1.5, 0.22, 0.36, 1.32],
      samples: {}
    };

    // Локальний WASM-синтезатор української мови (HuggingFace Transformers.js)
    this.localVitsPipe = null;
    this.isVitsLoading = false;

    this.sampleBank = new Map();
    this.onStatusChange = options.onStatusChange || (() => {});
    this.onLog = options.onLog || (() => {});

    window.addEventListener('storage', (e) => {
      if (e.key === 'entropia_irminsul_active_voice' && e.newValue) {
        try {
          const prof = JSON.parse(e.newValue);
          this.applyVoiceProfile(prof);
          this.onLog(
            'ІРМІНСУЛЬ [LIVE SYNC]',
            `🧬 Профіль «${prof.title}» миттєво підхоплено з сусідньої вкладки Ірмінсуля!`,
            'ai'
          );
        } catch (_) {}
      }
    });
  }

  attachRustWasm(wasmEngineInstance) {
    this.wasmEngine = wasmEngineInstance;
    if (this.wasmEngine && typeof this.wasmEngine.load_voice_dna === 'function') {
      this.wasmEngine.load_voice_dna(new Float32Array(this.currentProfile.dna_vector));
    }
    this.onStatusChange(`🦀 DNA: ${this.currentProfile.id}`);
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
    this.onStatusChange(`🧬 ${this.currentProfile.id}`);
  }

  /**
   * Стягує голосовий банк із репозиторію NRI_IRMINSUL і виводить точний звіт у лог.
   */
  async pullProfileFromIrminsul(profileId = 'raphael_archangel_1') {
    const bust = `?t=${Date.now()}`;
    const candidateUrls = [
      `https://raw.githubusercontent.com/${this.irminsulRepo}/${this.irminsulBranch}/voices/irminsul_voice_bank.json${bust}`,
      `https://raw.githubusercontent.com/${this.irminsulRepo}/${this.irminsulBranch}/irminsul_voice_bank.json${bust}`,
      `https://raw.githubusercontent.com/${this.irminsulRepo}/${this.irminsulBranch}/irminsul/voices/irminsul_voice_bank.json${bust}`,
      `https://nazarshulik0-dotcom.github.io/NRI_IRMINSUL/voices/irminsul_voice_bank.json${bust}`,
      `https://nazarshulik0-dotcom.github.io/NRI_IRMINSUL/irminsul_voice_bank.json${bust}`,
      `./irminsul/voices/irminsul_voice_bank.json${bust}`,
      `./voices/irminsul_voice_bank.json${bust}`
    ];

    for (const url of candidateUrls) {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) continue;
        const bank = await res.json();
        const prof = bank?.profiles?.[profileId] || Object.values(bank?.profiles || {})[0];

        if (prof && Array.isArray(prof.dna_vector)) {
          this.applyVoiceProfile(prof);
          this.onLog(
            'ІРМІНСУЛЬ [NRI_IRMINSUL]',
            `✅ Голосовий профіль «${prof.title}» (F0: ${prof.dna_vector[0]} Hz) успішно стягнуто з NRI_IRMINSUL і завантажено в Rust WASM!`,
            'ai'
          );
          return prof;
        }
      } catch (_) {}
    }

    this.restoreSavedVoicePrint();
    this.onLog(
      'ІРМІНСУЛЬ [ЛОКАЛЬНИЙ КЕШ]',
      `ℹ️ Використовується активний профіль «${this.currentProfile.title}» (${this.currentProfile.dna_vector[0]} Hz).`,
      'ai'
    );
    return this.currentProfile;
  }

  applyVoiceProfile(profileObj) {
    if (!profileObj) return;
    this.currentProfile = {
      ...this.currentProfile,
      ...profileObj
    };

    if (this.wasmEngine && typeof this.wasmEngine.load_voice_dna === 'function') {
      this.wasmEngine.load_voice_dna(new Float32Array(this.currentProfile.dna_vector));
    }

    try {
      localStorage.setItem('entropia_irminsul_active_voice', JSON.stringify(this.currentProfile));
    } catch (_) {}

    const f0 = this.currentProfile.dna_vector?.[0] || 115;
    this.onStatusChange(`🧬 ${this.currentProfile.id} (${f0}Hz)`);
  }

  restoreSavedVoicePrint() {
    try {
      const saved =
        localStorage.getItem('entropia_irminsul_active_voice') ||
        localStorage.getItem('entropia_raphael_voice_dna');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && Array.isArray(parsed.dna_vector)) {
          this.applyVoiceProfile(parsed);
        }
      }
    } catch (_) {}
  }

  /**
   * Нормалізує числа та символи в українські слова для чистого читання локальною нейромережею VITS.
   */
  _normalizeUkrainianText(text) {
    const numMap = {
      '0': 'нуль',
      '1': 'один',
      '2': 'два',
      '3': 'три',
      '4': 'чотири',
      '5': 'пять',
      '6': 'шість',
      '7': 'сім',
      '8': 'вісім',
      '9': 'девять',
      '10': 'десять',
      '85': 'вісімдесят пять',
      '100': 'сто'
    };

    let out = String(text || '')
      .replace(/%/g, ' відсотків ')
      .replace(/\b(\d+)\b/g, (m) => numMap[m] || m)
      .replace(/[^\u0400-\u04FFa-zA-Z\s.,!?-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return out;
  }

  /**
   * Ініціалізує автономну українську нейромережу VITS (Xenova/mms-tts-ukr) прямо у браузері.
   */
  async _ensureLocalNeuralVits() {
    if (this.localVitsPipe) return this.localVitsPipe;
    if (this.isVitsLoading) {
      while (this.isVitsLoading) {
        await new Promise((r) => setTimeout(r, 200));
      }
      return this.localVitsPipe;
    }

    this.isVitsLoading = true;
    try {
      this.onStatusChange('📥 LOADING UKR VITS WASM...');
      this.onLog(
        'ГОЛОСОВЕ ЯДРО [WASM NEURAL TTS]',
        '⏳ Завантаження автономної української нейромережі голосу (Xenova/mms-tts-ukr). Перший запуск триває ~5–8 секунд, далі працює миттєво з кешу...',
        'ai'
      );

      const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');
      env.allowLocalModels = false;

      this.localVitsPipe = await pipeline('text-to-speech', 'Xenova/mms-tts-ukr', {
        quantized: false
      });

      this.onLog(
        'ГОЛОСОВЕ ЯДРО [WASM NEURAL TTS]',
        '✅ Автономну українську нейромережу завантажено в пам\'ять! Голос генерується локально і перековується через Rust WASM + ДНК Ірмінсуля.',
        'ai'
      );
      return this.localVitsPipe;
    } catch (err) {
      this.onLog(
        'ГОЛОСОВЕ ЯДРО [ПОМИЛКА VITS]',
        `⚠️ Не вдалося завантажити локальну нейромодель VITS: ${err.message}`,
        'error'
      );
      return null;
    } finally {
      this.isVitsLoading = false;
    }
  }

  /**
   * ГОЛОВНИЙ МЕТОД ОЗВУЧЕННЯ:
   * Генерує чистий український голос локальною нейромережею у браузері
   * і пропускає його крізь Rust WASM (process_voice_dsp) + 6 формант ДНК Ірмінсуля!
   */
  async speak(text, slotKey = null) {
    const cleanText = String(text || '').replace(/\[.*?\]/g, '').trim();
    if (!cleanText) return false;

    this.playCueChime();
    const ctx = this.ensureAudioContext();

    // 1. Якщо є готовий записаний семпл для цього слоту
    if (slotKey && this.sampleBank.has(slotKey)) {
      await this.playBufferThroughRustCloneDSP(this.sampleBank.get(slotKey));
      return true;
    }

    const slotUrl = slotKey && this.currentProfile.samples?.[slotKey];
    if (slotUrl) {
      try {
        const res = await fetch(slotUrl);
        if (res.ok) {
          const buf = await res.arrayBuffer();
          const decoded = await ctx.decodeAudioData(buf);
          this.sampleBank.set(slotKey, decoded);
          await this.playBufferThroughRustCloneDSP(decoded);
          return true;
        }
      } catch (_) {}
    }

    // 2. Генеруємо живу мову автономною нейромережею у браузері + перековуємо через Rust WASM
    this.onStatusChange('⏳ SYNTHESIZING IN WASM...');
    const carrierBuffer = await this._synthesizeCleanCarrierBuffer(cleanText);

    if (carrierBuffer) {
      await this.playBufferThroughRustCloneDSP(carrierBuffer);
      return true;
    }

    this.onLog(
      'ГОЛОСОВЕ ЯДРО [ДІАГНОСТИКА]',
      '⚠️ Не вдалося згенерувати аудіо-буфер. Перевір підключення до мережі або консоль (F12).',
      'error'
    );
    return false;
  }

  async _synthesizeCleanCarrierBuffer(text) {
    const ctx = this.ensureAudioContext();
    const normalizedText = this._normalizeUkrainianText(text);

    // 1. Локальна українська нейромережа VITS (100% без проксі та без лімітів!)
    const vits = await this._ensureLocalNeuralVits();
    if (vits && normalizedText) {
      try {
        this.onStatusChange('⚡ VITS + RUST DNA...');
        const output = await vits(normalizedText);
        if (output && output.audio && output.audio.length > 100) {
          const sr = output.sampling_rate || 16000;
          const audioBuffer = ctx.createBuffer(1, output.audio.length, sr);
          audioBuffer.copyToChannel(output.audio, 0);
          return audioBuffer;
        }
      } catch (err) {
        this.onLog('ГОЛОСОВЕ ЯДРО [VITS SYNTH]', `⚠️ Помилка генерації хвилі: ${err.message}`, 'error');
      }
    }

    return null;
  }

  /**
   * Пропускає AudioBuffer крізь скомпільований Rust WASM (process_voice_dsp)
   * та 6-смугову формантну матрицю ДНК із репозиторію NRI_IRMINSUL.
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

    // 1. Перековка в Rust WASM (6 Biquad-резонаторів ДНК + суб-гармоніка + Apex Stereo Doubler)
    const primary = workingBuffer.getChannelData(0);
    if (this.wasmEngine && typeof this.wasmEngine.process_voice_dsp === 'function') {
      const chunk = 2048;
      for (let i = 0; i < primary.length; i += chunk) {
        const slice = primary.subarray(i, Math.min(i + chunk, primary.length));
        this.wasmEngine.process_voice_dsp(slice, workingBuffer.sampleRate);
      }
    }

    // 2. Каскад формант WebAudio за вектором ДНК з NRI_IRMINSUL
    const dna = this.currentProfile.dna_vector || [114.5, 4.2, 2.6, -2.1, 3.4, 2.1, -1.5, 0.22, 0.36, 1.32];
    const freqs = [115, 250, 580, 1350, 2750, 4600];

    const srcNode = ctx.createBufferSource();
    srcNode.buffer = workingBuffer;
    srcNode.playbackRate.value = this.currentProfile.pitch_ratio || 0.94;

    let lastNode = srcNode;
    for (let i = 0; i < freqs.length; i++) {
      const eq = ctx.createBiquadFilter();
      eq.type = i === 0 ? 'lowshelf' : i === freqs.length - 1 ? 'highshelf' : 'peaking';
      eq.frequency.value = freqs[i];
      eq.Q.value = 1.45;
      eq.gain.value = dna[i + 1] ?? 0;
      lastNode.connect(eq);
      lastNode = eq;
    }

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    const pcmData = new Float32Array(analyser.fftSize);

    lastNode.connect(analyser);
    analyser.connect(ctx.destination);

    this.activeSource = srcNode;
    this.onStatusChange(`🔊 SPEAKING [${this.currentProfile.id}]`);
    if (this.wasmEngine) this.wasmEngine.set_activity_mode(4);

    let playing = true;
    const tickVisualizer = () => {
      if (!playing || this.activeSource !== srcNode) return;
      analyser.getFloatTimeDomainData(pcmData);
      let sum = 0;
      for (let i = 0; i < pcmData.length; i++) sum += pcmData[i] * pcmData[i];
      const rms = Math.sqrt(sum / pcmData.length);
      if (this.wasmEngine) {
        this.wasmEngine.set_voice_energy(Math.min(1.35, rms * 5.5));
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
        this.onStatusChange(`🧬 ${this.currentProfile.id}`);
        resolve(true);
      };
      srcNode.start(0);
      requestAnimationFrame(tickVisualizer);
    });
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
