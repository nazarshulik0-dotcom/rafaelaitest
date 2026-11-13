/**
 * ============================================================================
 * UNIVERSAL IRMINSUL VOICE CORE (./voice/raphael_voice_core.js)
 * Стягивает голосовое ДНК напрямую из репозитория NRI_IRMINSUL
 * или из общей памяти домена nazarshulik0-dotcom.github.io и перековывает
 * любой текстовый ответ через Rust WASM DSP (6 формант + суб-октава + Apex Doubler).
 * ============================================================================
 */

export class RaphaelVoiceCore {
  constructor(options = {}) {
    this.wasmEngine = null;
    this.audioCtx = null;
    this.activeSource = null;

    // Точный адрес твоего репозитория Ирминсуля
    this.irminsulRepo = 'nazarshulik0-dotcom/NRI_IRMINSUL';
    this.irminsulBranch = options.irminsulBranch || 'main';

    this.currentProfile = {
      id: 'raphael_archangel_1',
      title: 'Рафаїль // Вежа Архангела I (Apex Matrix)',
      carrier_voice: 'uk-UA-OstapNeural',
      pitch_ratio: 0.92,
      dna_vector: [114.5, 4.2, 2.6, -2.1, 3.4, 2.1, -1.5, 0.22, 0.36, 1.32],
      samples: {}
    };

    this.sampleBank = new Map();
    this.onStatusChange = options.onStatusChange || (() => {});
    this.onLog = options.onLog || (() => {});

    // Слушаем общую память домена на случай, если ты обновил ДНК в соседней вкладке Ирминсуля
    window.addEventListener('storage', (e) => {
      if (e.key === 'entropia_irminsul_active_voice' && e.newValue) {
        try {
          const prof = JSON.parse(e.newValue);
          this.applyVoiceProfile(prof);
          this.onLog('ІРМІНСУЛЬ [LIVE SYNC]', `🧬 Профіль «${prof.title}» миттєво підхоплено з сусідньої вкладки Ірмінсуля!`, 'ai');
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
   * Стягивает голосовой профиль из NRI_IRMINSUL (проверяет все возможные папки + общую память браузера).
   */
  async pullProfileFromIrminsul(profileId = 'raphael_archangel_1') {
    const candidateUrls = [
      `https://nazarshulik0-dotcom.github.io/NRI_IRMINSUL/voices/irminsul_voice_bank.json`,
      `https://nazarshulik0-dotcom.github.io/NRI_IRMINSUL/irminsul_voice_bank.json`,
      `https://raw.githubusercontent.com/${this.irminsulRepo}/${this.irminsulBranch}/voices/irminsul_voice_bank.json`,
      `https://raw.githubusercontent.com/${this.irminsulRepo}/${this.irminsulBranch}/irminsul_voice_bank.json`,
      `https://raw.githubusercontent.com/${this.irminsulRepo}/${this.irminsulBranch}/irminsul/voices/irminsul_voice_bank.json`,
      `./irminsul/voices/irminsul_voice_bank.json`,
      `./voices/irminsul_voice_bank.json`
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
            `✅ Голосове ДНК «${prof.title}» (${prof.dna_vector[0]} Hz) стягнуто з NRI_IRMINSUL і завантажено в Rust WASM!`,
            'ai'
          );
          return prof;
        }
      } catch (_) {}
    }

    // Если файл еще не залит в репозиторий — берем из общей памяти домена github.io
    this.restoreSavedVoicePrint();
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
        if (parsed) {
          if (!parsed.dna_vector && parsed.formantGainsDb) {
            parsed.dna_vector = [
              parsed.fundamentalHz || 115,
              ...parsed.formantGainsDb,
              0.22,
              0.36,
              1.32
            ];
          }
          if (Array.isArray(parsed.dna_vector)) {
            this.applyVoiceProfile(parsed);
          }
        }
      }
    } catch (_) {}
  }

  /**
   * ГЛАВНЫЙ МЕТОД ОЗВУЧКИ:
   * Разбивает ответ на предложения, скачивает бинарный аудио-поток (ArrayBuffer)
   * и КАЖДЫЙ сэмпл принудительно пропускает через Rust WASM + 6 формант ДНК из Ирминсуля!
   */
  async speak(text, slotKey = null) {
    const cleanText = String(text || '').replace(/\[.*?\]/g, '').trim();
    if (!cleanText) return false;

    this.playCueChime();
    const ctx = this.ensureAudioContext();

    // 1. Проверяем готовый сэмпл в слоте
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

    // 2. Разбиваем текст на предложения, чтобы озвучка стартовала быстро и никогда не обрывалась
    const sentences = cleanText.match(/[^.!?]+[.!?]*|[^.!?]+$/g) || [cleanText];
    let anyPlayed = false;

    for (const rawSentence of sentences) {
      const sentence = rawSentence.trim();
      if (!sentence) continue;

      this.onStatusChange('⏳ SYNTH + RUST DNA...');
      const carrierBuffer = await this._synthesizeCleanCarrierBuffer(sentence);
      if (carrierBuffer) {
        anyPlayed = true;
        await this.playBufferThroughRustCloneDSP(carrierBuffer);
      }
    }

    if (!anyPlayed && this.wasmEngine) {
      this.wasmEngine.set_voice_energy(0.85);
      setTimeout(() => this.wasmEngine.set_voice_energy(0.0), 1400);
    }

    this.onStatusChange(`🧬 ${this.currentProfile.id}`);
    return anyPlayed;
  }

  /**
   * Прогоняет AudioBuffer сквозь Rust WASM (process_voice_dsp) + 6-полосный Biquad слепок ДНК.
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

    // 1. Обработка внутри скомпилированного Rust WASM (Biquad DNA + Sub-Harmonic + Apex Doubler)
    const primary = workingBuffer.getChannelData(0);
    if (this.wasmEngine && typeof this.wasmEngine.process_voice_dsp === 'function') {
      const chunk = 2048;
      for (let i = 0; i < primary.length; i += chunk) {
        const slice = primary.subarray(i, Math.min(i + chunk, primary.length));
        this.wasmEngine.process_voice_dsp(slice, workingBuffer.sampleRate);
      }
    }

    // 2. Дополнительный аппаратный каскад формант WebAudio по вектору ДНК из Ирминсуля
    const dna = this.currentProfile.dna_vector || [114.5, 4.2, 2.6, -2.1, 3.4, 2.1, -1.5, 0.22, 0.36, 1.32];
    const freqs = [115, 250, 580, 1350, 2750, 4600];

    const srcNode = ctx.createBufferSource();
    srcNode.buffer = workingBuffer;
    srcNode.playbackRate.value = this.currentProfile.pitch_ratio || 0.92;

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

  /**
   * Безотказное получение бинарного AudioBuffer для последующей перековки в Rust WASM.
   */
  async _synthesizeCleanCarrierBuffer(text) {
    const ctx = this.ensureAudioContext();
    const carrierVoice = this.currentProfile.carrier_voice || 'uk-UA-OstapNeural';
    const shortText = text.slice(0, 200);
    const encoded = encodeURIComponent(shortText);
    const targetTtsUrl = `https://translate.googleapis.com/translate_tts?ie=UTF-8&client=tw-ob&tl=uk&q=${encoded}`;

    const binaryEndpoints = [
      // 1. Локальный мост (если запущен)
      async () => {
        const res = await fetch('http://127.0.0.1:8765/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: shortText, voice: carrierVoice })
        });
        if (!res.ok) throw new Error('Local offline');
        return await res.arrayBuffer();
      },
      // 2. Edge Neural шлюз 1
      async () => {
        const res = await fetch('https://tts.travisvn.com/v1/audio/speech', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'tts-1', input: shortText, voice: carrierVoice })
        });
        if (!res.ok) throw new Error('Edge 1 busy');
        return await res.arrayBuffer();
      },
      // 3. Edge Neural шлюз 2
      async () => {
        const res = await fetch('https://edgetts.api.uhsea.com/v1/audio/speech', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'tts-1', input: shortText, voice: carrierVoice })
        });
        if (!res.ok) throw new Error('Edge 2 busy');
        return await res.arrayBuffer();
      },
      // 4. Бинарный перехват потока через CORS-прокси (декодируется в AudioBuffer и идет в Rust DSP!)
      async () => {
        const res = await fetch(`https://corsproxy.io/?${encodeURIComponent(targetTtsUrl)}`);
        if (!res.ok) throw new Error('CORS proxy 1 busy');
        return await res.arrayBuffer();
      },
      // 5. Резервный бинарный CORS-мост AllOrigins Raw
      async () => {
        const res = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(targetTtsUrl)}`);
        if (!res.ok) throw new Error('CORS proxy 2 busy');
        return await res.arrayBuffer();
      }
    ];

    for (const fetchFn of binaryEndpoints) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 4500);
        const buf = await Promise.race([
          fetchFn(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4500))
        ]);
        clearTimeout(timer);

        if (buf && buf.byteLength > 600) {
          const copyBuf = buf.slice(0);
          return await ctx.decodeAudioData(copyBuf);
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
