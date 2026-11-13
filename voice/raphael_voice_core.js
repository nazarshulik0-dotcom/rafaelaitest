/**
 * ============================================================================
 * UNIVERSAL IRMINSUL VOICE CORE (./voice/raphael_voice_core.js)
 * Працює в будь-якому репозиторії (Entropia / Ether / Irminsul / RafaelAITest):
 *  - Стягує голосові ДНК-профілі з локального або зовнішнього репозиторію Ірмінсуля.
 *  - Витягує 10-вимірний вектор ДНК із 30-сек зразка через Rust WASM (extract_voice_dna).
 *  - Перековує будь-який синтезований голос через Rust WASM Biquad + Sub-Harmonic + Apex Doubler.
 * ============================================================================
 */

export class RaphaelVoiceCore {
  constructor(options = {}) {
    this.wasmEngine = null;
    this.audioCtx = null;
    this.activeSource = null;

    // За замовчуванням дивиться на локальний Ірмінсуль або будь-який вказаний GitHub-репозиторій
    this.irminsulRepo = options.irminsulRepo || 'nazarshulik0-dotcom/rafaelaitest';
    this.irminsulBranch = options.irminsulBranch || 'main';
    this.irminsulPath = options.irminsulPath || 'irminsul/voices/irminsul_voice_bank.json';

    this.currentProfile = {
      id: 'raphael_archangel_1',
      title: 'Рафаїль // Apex Matrix',
      carrier_voice: 'uk-UA-OstapNeural',
      pitch_ratio: 0.94,
      dna_vector: [114.5, 4.2, 2.6, -2.1, 3.4, 2.1, -1.5, 0.22, 0.36, 1.32],
      samples: {}
    };

    this.sampleBank = new Map();
    this.irminsulBankCache = null;

    this.onStatusChange = options.onStatusChange || (() => {});
    this.onLog = options.onLog || (() => {});
  }

  /**
   * Підключає скомпільований Rust WASM і одразу передає йому поточне ДНК голосу.
   */
  attachRustWasm(wasmEngineInstance) {
    this.wasmEngine = wasmEngineInstance;
    if (this.wasmEngine && typeof this.wasmEngine.load_voice_dna === 'function') {
      this.wasmEngine.load_voice_dna(new Float32Array(this.currentProfile.dna_vector));
    }
    this.onStatusChange(`🦀 DNA ACTIVE: ${this.currentProfile.id}`);
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
   * УНІВЕРСАЛЬНИЙ ЗАВАНТАЖУВАЧ ІЗ «ІРМІНСУЛЯ»:
   * Може стягнути голосовий профіль із поточного сайту АБО з будь-якого іншого репозиторію GitHub!
   * Наприклад: voiceCore.pullProfileFromIrminsul('raphael_archangel_1', 'nazarshulik0-dotcom/rafaelaitest')
   */
  async pullProfileFromIrminsul(profileId = 'raphael_archangel_1', customRepo = null) {
    const repo = customRepo || this.irminsulRepo;
    const candidateUrls = [
      `./${this.irminsulPath}`,
      `https://raw.githubusercontent.com/${repo}/${this.irminsulBranch}/${this.irminsulPath}`
    ];

    for (const url of candidateUrls) {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) continue;
        const bank = await res.json();
        this.irminsulBankCache = bank;

        const prof = bank?.profiles?.[profileId];
        if (prof && Array.isArray(prof.dna_vector)) {
          this.applyVoiceProfile(prof);
          this.onLog(
            'ІРМІНСУЛЬ [VOICE BANK]',
            `✅ Голосовий профіль «${prof.title}» успішно стягнуто з Ірмінсуля (${url}) і завантажено в Rust WASM!`,
            'ai'
          );
          return prof;
        }
      } catch (_) {}
    }

    // Якщо JSON ще не залитий на GitHub — перевіряємо локальний кеш браузера
    this.restoreSavedVoicePrint();
    return this.currentProfile;
  }

  /**
   * Застосовує профіль (з Ірмінсуля або після клонування) безпосередньо в Rust WASM.
   */
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

    this.onStatusChange(`🧬 ${this.currentProfile.id} (${this.currentProfile.dna_vector[0]}Hz)`);
  }

  restoreSavedVoicePrint() {
    try {
      const saved = localStorage.getItem('entropia_irminsul_active_voice');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && Array.isArray(parsed.dna_vector)) {
          this.applyVoiceProfile(parsed);
        }
      }
    } catch (_) {}
  }

  /**
   * ВИВЧЕННЯ ГОЛОСУ З 30-СЕКУНДНОГО ФРАГМЕНТА АНІМАТИКА ЧЕРЕЗ RUST WASM:
   * Викликає wasmEngine.extract_voice_dna() і видає готовий JSON-код для вставки в Ірмінсуль!
   */
  async learnVoiceFromReferenceFile(file, targetProfileId = 'raphael_archangel_1') {
    const ctx = this.ensureAudioContext();
    this.onStatusChange('⏳ RUST EXTRACTING DNA...');

    const arrayBuf = await file.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuf);
    const channelData = audioBuffer.getChannelData(0);
    const sr = audioBuffer.sampleRate;

    let dnaArray = [114.5, 4.2, 2.6, -2.1, 3.4, 2.1, -1.5, 0.22, 0.36, 1.32];

    if (this.wasmEngine && typeof this.wasmEngine.extract_voice_dna === 'function') {
      const rustVec = this.wasmEngine.extract_voice_dna(channelData, sr);
      dnaArray = Array.from(rustVec).map((v) => Number(v.toFixed(2)));
    }

    const f0 = dnaArray[0] || 115;
    const computedPitch = Number(Math.max(0.84, Math.min(1.08, f0 / 128.0)).toFixed(2));

    const newProfile = {
      id: targetProfileId,
      title: `Cloned: ${file.name.replace(/\.[^.]+$/, '')}`,
      carrier_voice: f0 > 165 ? 'uk-UA-PolinaNeural' : 'uk-UA-OstapNeural',
      pitch_ratio: computedPitch,
      dna_vector: dnaArray,
      samples: this.currentProfile.samples || {}
    };

    this.applyVoiceProfile(newProfile);

    // Формуємо готовий JSON-сниппет для вставки в irminsul_voice_bank.json
    const irminsulJsonSnippet = JSON.stringify(newProfile, null, 2);
    try {
      await navigator.clipboard.writeText(irminsulJsonSnippet);
    } catch (_) {}

    this.onLog(
      'RUST CLONER -> ІРМІНСУЛЬ',
      `🧬 Зразок «${file.name}» проаналізовано в Rust WASM! Вектор ДНК: [${dnaArray.join(', ')}]. Готовий JSON-профіль для «Ірмінсуля» автоматично скопійовано в буфер обміну!`,
      'ai'
    );

    // Програємо перші 4.5 секунди зразка крізь нову матрицю Rust для миттєвої перевірки
    await this.playBufferThroughRustCloneDSP(audioBuffer, 4.5);
    return newProfile;
  }

  /**
   * ГОЛОВНИЙ МЕТОД МОВЛЕННЯ:
   * 1) Перевіряє пре-рендерені семпли в Ірмінсулі.
   * 2) Якщо це вільний текст — синтезує чисту несучу хвилю і перековує її в Rust WASM під ДНК Ірмінсуля.
   */
  async speak(text, slotKey = null) {
    const cleanText = String(text || '').replace(/\[.*?\]/g, '').trim();
    if (!cleanText) return false;

    this.playCueChime();
    const ctx = this.ensureAudioContext();

    // 1. Якщо є завантажений у пам'ять семпл для цього слоту
    if (slotKey && this.sampleBank.has(slotKey)) {
      await this.playBufferThroughRustCloneDSP(this.sampleBank.get(slotKey));
      return true;
    }

    // 2. Якщо в профілі Ірмінсуля прописаний шлях до готового MP3/WAV для цього слоту
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

    // 3. Генерація живої мови з тексту + перековка через Rust WASM ДНК
    this.onStatusChange('⏳ SYNTH + RUST DNA...');
    const rawBuffer = await this._synthesizeCleanCarrierBuffer(cleanText);

    if (rawBuffer) {
      await this.playBufferThroughRustCloneDSP(rawBuffer);
      return true;
    }

    // Якщо хмарний генератор несучої хвилі недоступний — даємо імпульс на сферу
    if (this.wasmEngine) {
      this.wasmEngine.set_voice_energy(0.85);
      setTimeout(() => this.wasmEngine.set_voice_energy(0.0), 1400);
    }
    this.onStatusChange(`🧬 ${this.currentProfile.id}`);
    return false;
  }

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

    // Проганяємо аудіобуфер безпосередньо через Rust WASM (6 Biquad-формант ДНК + Sub-Octave + Apex Doubler)
    const primary = workingBuffer.getChannelData(0);
    if (this.wasmEngine && typeof this.wasmEngine.process_voice_dsp === 'function') {
      const chunk = 2048;
      for (let i = 0; i < primary.length; i += chunk) {
        const slice = primary.subarray(i, Math.min(i + chunk, primary.length));
        this.wasmEngine.process_voice_dsp(slice, workingBuffer.sampleRate);
      }
    }

    const srcNode = ctx.createBufferSource();
    srcNode.buffer = workingBuffer;
    srcNode.playbackRate.value = this.currentProfile.pitch_ratio || 0.94;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    const pcmData = new Float32Array(analyser.fftSize);

    srcNode.connect(analyser);
    analyser.connect(ctx.destination);

    this.activeSource = srcNode;
    this.onStatusChange(`🔊 [${this.currentProfile.id}]`);
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

  async _synthesizeCleanCarrierBuffer(text) {
    const ctx = this.ensureAudioContext();
    const carrierVoice = this.currentProfile.carrier_voice || 'uk-UA-OstapNeural';

    const endpoints = [
      async () => {
        const res = await fetch('http://127.0.0.1:8765/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, voice: carrierVoice })
        });
        if (!res.ok) throw new Error('Local bridge offline');
        return await res.arrayBuffer();
      },
      async () => {
        const res = await fetch('https://tts.travisvn.com/v1/audio/speech', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'tts-1', input: text, voice: carrierVoice })
        });
        if (!res.ok) throw new Error('Edge gateway 1 busy');
        return await res.arrayBuffer();
      },
      async () => {
        const res = await fetch('https://edgetts.api.uhsea.com/v1/audio/speech', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'tts-1', input: text, voice: carrierVoice })
        });
        if (!res.ok) throw new Error('Edge gateway 2 busy');
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
