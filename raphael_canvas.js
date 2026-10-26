/**
 * ============================================================================
 * RAPHAEL QUANTUM AVATAR (raphael_canvas.js) - ФАЗА 2: КВАНТОВА СФЕРА 60 FPS
 * Проєкт: НРІ «Ентропія» (Ковчег Вавилонії) | Система «Вітрувій»
 * ----------------------------------------------------------------------------
 * Візуальний інтерфейс у стилі Tensura / Jarvis на <canvas id="raphael-sphere">:
 *   1. Центральне ядро з подвійною гексагональною геометрією та телеметрією.
 *   2. Подвійне зовнішнє кільце зі 110 часток (#22d3ee та #10b981) і синапсами.
 *   3. Плавна інтерполяція (Lerp) між станами FSM:
 *      - DORMANT   : Згасле багряно-темне ядро з мінімальним дрейфом.
 *      - IDLE      : Плавне орбітальне обертання часток із низькою швидкістю.
 *      - LISTENING : Стиснення часток до центру (ефект фокусування уваги).
 *      - THINKING  : Прискорене мерехтіння з інтерференційними хвилями.
 *      - SPEAKING  : 60 FPS пульсація радіуса й амплітуди від AnalyserNode.
 *   4. Кібернетичний глітч-ефект при сигналі AETHER_SYSTEM_OVERRIDE.
 * ============================================================================
 */

(function (window) {
  'use strict';

  const PALETTE = Object.freeze({
    CYAN: '#22d3ee',
    EMERALD: '#10b981',
    CRIMSON: '#ef4444',
    AMBER: '#f59e0b',
    WHITE_CORE: '#ecfeff'
  });

  // Конфігурація цільових параметрів фізики сфери для кожного стану FSM
  const STATE_PROFILES = Object.freeze({
    DORMANT: {
      rotSpeed: 0.0018,
      radiusScale: 0.68,
      ringSeparation: 0.08,
      chaosAmp: 0.015,
      hexScale: 0.72,
      hexAlpha: 0.16,
      synapseAlpha: 0.12,
      primaryRGB: [239, 68, 68],
      secondaryRGB: [153, 27, 27]
    },
    IDLE: {
      rotSpeed: 0.0065,
      radiusScale: 1.0,
      ringSeparation: 0.22,
      chaosAmp: 0.035,
      hexScale: 1.0,
      hexAlpha: 0.42,
      synapseAlpha: 0.36,
      primaryRGB: [34, 211, 238],
      secondaryRGB: [16, 185, 129]
    },
    LISTENING: {
      rotSpeed: 0.014,
      radiusScale: 0.76, // Частки звужуються до центру (фокусування уваги)
      ringSeparation: 0.10,
      chaosAmp: 0.025,
      hexScale: 1.18,
      hexAlpha: 0.75,
      synapseAlpha: 0.58,
      primaryRGB: [16, 185, 129],
      secondaryRGB: [34, 211, 238]
    },
    THINKING: {
      rotSpeed: 0.042, // Прискорене обертання та інтерференційні хвилі
      radiusScale: 0.94,
      ringSeparation: 0.28,
      chaosAmp: 0.145,
      hexScale: 1.10,
      hexAlpha: 0.85,
      synapseAlpha: 0.62,
      primaryRGB: [56, 189, 248],
      secondaryRGB: [34, 211, 238]
    },
    SPEAKING: {
      rotSpeed: 0.018,
      radiusScale: 1.04,
      ringSeparation: 0.25,
      chaosAmp: 0.075,
      hexScale: 1.15,
      hexAlpha: 0.78,
      synapseAlpha: 0.68,
      primaryRGB: [34, 211, 238],
      secondaryRGB: [16, 185, 129]
    }
  });

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

  class RaphaelQuantumCanvas {
    constructor(options = {}) {
      this.canvasId = options.canvasId || 'raphael-sphere';
      this.canvas = null;
      this.ctx = null;
      this.core = null;

      this.mode = 'IDLE';
      this.rafId = null;
      this.width = 420;
      this.height = 420;
      this.dpr = Math.min(2, window.devicePixelRatio || 1);

      // Аудіо-аналізатор для стану SPEAKING (60 FPS реакція на звукові хвилі)
      this.analyserNode = null;
      this.freqBuffer = null;
      this.timeBuffer = null;
      this.manualVoiceEnergy = 0;
      this.smoothedAudioEnergy = 0;
      this.bassEnergy = 0;
      this.trebleEnergy = 0;

      // Плавна інтерполяція фізичних параметрів між станами
      this.liveParams = {
        rotSpeed: STATE_PROFILES.IDLE.rotSpeed,
        radiusScale: STATE_PROFILES.IDLE.radiusScale,
        ringSeparation: STATE_PROFILES.IDLE.ringSeparation,
        chaosAmp: STATE_PROFILES.IDLE.chaosAmp,
        hexScale: STATE_PROFILES.IDLE.hexScale,
        hexAlpha: STATE_PROFILES.IDLE.hexAlpha,
        synapseAlpha: STATE_PROFILES.IDLE.synapseAlpha,
        primaryRGB: [...STATE_PROFILES.IDLE.primaryRGB],
        secondaryRGB: [...STATE_PROFILES.IDLE.secondaryRGB]
      };

      // Кути обертання 3D-сфери та гексагонального ядра
      this.angleY = 0;
      this.angleX = 0.25;
      this.innerRingAngle = 0;
      this.outerRingAngle = 0;
      this.hexCoreAngle = 0;

      // Хвилі інтерференції (THINKING / SPEAKING) та ефект глітчу
      this.interferenceRipples = [];
      this.glitchUntil = 0;

      // Масив часток подвійного кільця (110 часток: 50 внутрішнє кільце + 60 зовнішнє)
      this.particles = [];
      this.initDoubleRingParticles(110);

      this.mountWhenReady();
    }

    // =========================================================================
    // 1. ІНІЦІАЛІЗАЦІЯ ПОДВІЙНОГО КІЛЬЦЯ ЧАСТОК ТА ПОЛОТНА CANVAS
    // =========================================================================
    initDoubleRingParticles(totalCount = 110) {
      this.particles = [];
      const goldenRatio = (1 + Math.sqrt(5)) / 2;

      for (let i = 0; i < totalCount; i++) {
        // Розподіл Фібоначчі на внутрішню (ringIndex = 0) та зовнішню (ringIndex = 1) оболонки
        const isOuterRing = i >= 50;
        const theta = (2 * Math.PI * i) / goldenRatio;
        const phi = Math.acos(1 - (2 * (i + 0.5)) / totalCount);

        const ux = Math.sin(phi) * Math.cos(theta);
        const uy = Math.sin(phi) * Math.sin(theta);
        const uz = Math.cos(phi);

        this.particles.push({
          ux,
          uy,
          uz,
          ringIndex: isOuterRing ? 1 : 0,
          colorHex: i % 3 === 0 ? PALETTE.EMERALD : PALETTE.CYAN,
          isEmerald: i % 3 === 0,
          phase: Math.random() * Math.PI * 2,
          freqBand: i % 32,
          baseSize: isOuterRing ? (1.35 + (i % 3) * 0.55) : (1.75 + (i % 3) * 0.65)
        });
      }
    }

    mountWhenReady() {
      const mount = () => {
        this.attachToCanvasElement(this.canvasId);
        if (window.RaphaelCore) {
          this.attachCore(window.RaphaelCore);
        }
        this.startRenderLoop();
      };

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mount);
      } else {
        mount();
      }
    }

    attachToCanvasElement(canvasId = 'raphael-sphere') {
      const existing = document.getElementById(canvasId);
      if (!existing) return false;

      // Замінюємо вузол чистим клоном, щоб автоматично відсікти демо-рендерер із raphael_test.html
      // і взяти 100% керування полотном на себе без конфлікту кадрів
      let targetCanvas = existing;
      if (!existing.dataset.raphaelCanvasMounted) {
        const clone = existing.cloneNode(false);
        clone.dataset.raphaelCanvasMounted = 'true';
        existing.parentNode?.replaceChild(clone, existing);
        targetCanvas = clone;
      }

      this.canvas = targetCanvas;
      this.ctx = this.canvas.getContext('2d');
      this.setupHiDPICanvas();

      window.addEventListener('resize', () => this.setupHiDPICanvas());
      return true;
    }

    setupHiDPICanvas() {
      if (!this.canvas || !this.ctx) return;
      const rect = this.canvas.getBoundingClientRect();
      this.width = Math.max(240, rect.width || 380);
      this.height = Math.max(240, rect.height || 380);
      this.dpr = Math.min(2, window.devicePixelRatio || 1);

      this.canvas.width = Math.round(this.width * this.dpr);
      this.canvas.height = Math.round(this.height * this.dpr);
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    // =========================================================================
    // 2. ІНТЕГРАЦІЯ З RAPHAEL_CORE ТА АУДІО-АНАЛІЗАТОРОМ (ANALYSERNODE)
    // =========================================================================
    attachCore(coreInstance) {
      if (!coreInstance || this.core === coreInstance) return;
      this.core = coreInstance;

      this.setMode(coreInstance.getState());

      coreInstance.on('stateChange', ({ state }) => {
        this.setMode(state);
      });

      coreInstance.on('overrideGlitch', () => {
        this.triggerGlitch(680);
        this.spawnInterferenceRipple(1.3);
      });
    }

    setMode(newState) {
      const normalized = String(newState || 'IDLE').toUpperCase();
      if (!STATE_PROFILES[normalized]) return;

      const prev = this.mode;
      this.mode = normalized;

      if (normalized === 'THINKING' || (normalized === 'SPEAKING' && prev !== 'SPEAKING')) {
        this.spawnInterferenceRipple(1.0);
      }
    }

    // Підключення Web Audio API AnalyserNode із raphael_voice.js (Фаза 4)
    bindAnalyser(analyserNode) {
      if (!analyserNode) return;
      this.analyserNode = analyserNode;
      this.analyserNode.fftSize = 128;
      this.analyserNode.smoothingTimeConstant = 0.72;
      this.freqBuffer = new Uint8Array(this.analyserNode.frequencyBinCount);
      this.timeBuffer = new Uint8Array(this.analyserNode.frequencyBinCount);
    }

    setVoiceEnergy(energyRatio) {
      this.manualVoiceEnergy = Math.max(0, Math.min(1.5, Number(energyRatio) || 0));
    }

    triggerGlitch(durationMs = 600) {
      this.glitchUntil = performance.now() + durationMs;
    }

    spawnInterferenceRipple(intensity = 1.0) {
      this.interferenceRipples.push({
        progress: 0.08,
        intensity
      });
      if (this.interferenceRipples.length > 5) {
        this.interferenceRipples.shift();
      }
    }

    // =========================================================================
    // 3. ЗЧИТУВАННЯ АУДІОСПЕКТРА ТА ПЛАВНА ІНТЕРПОЛЯЦІЯ СТАНІВ (LERP)
    // =========================================================================
    sampleAudioMetrics(now) {
      let rawEnergy = this.manualVoiceEnergy;
      let bass = 0;
      let treble = 0;

      if (this.analyserNode && this.freqBuffer) {
        this.analyserNode.getByteFrequencyData(this.freqBuffer);
        let lowSum = 0;
        let midHighSum = 0;

        for (let i = 1; i <= 10; i++) lowSum += this.freqBuffer[i];
        for (let i = 11; i < 36; i++) midHighSum += this.freqBuffer[i];

        bass = (lowSum / 10) / 255;
        treble = (midHighSum / 25) / 255;
        rawEnergy = Math.max(rawEnergy, bass * 0.65 + treble * 0.55);
      }

      // Якщо ми в режимі SPEAKING, але зовнішній AnalyserNode ще не передав потік —
      // синтезуємо органічну голосову огинаючу, щоб сфера живо реагувала на відповідь
      if (this.mode === 'SPEAKING' && rawEnergy < 0.05) {
        const t = now * 0.001;
        const syllableWave =
          Math.abs(Math.sin(t * 11.5)) * 0.45 +
          Math.abs(Math.cos(t * 19.2)) * 0.35 +
          Math.sin(t * 4.2) * 0.15;
        rawEnergy = Math.max(0.18, Math.min(0.95, syllableWave));
        bass = rawEnergy * 0.85;
        treble = rawEnergy * 0.65;
      }

      const attackRelease = rawEnergy > this.smoothedAudioEnergy ? 0.32 : 0.14;
      this.smoothedAudioEnergy += (rawEnergy - this.smoothedAudioEnergy) * attackRelease;
      this.bassEnergy += (bass - this.bassEnergy) * 0.28;
      this.trebleEnergy += (treble - this.trebleEnergy) * 0.28;
    }

    interpolateStateParameters() {
      const target = STATE_PROFILES[this.mode] || STATE_PROFILES.IDLE;
      const lp = this.liveParams;
      const k = 0.085;

      lp.rotSpeed += (target.rotSpeed - lp.rotSpeed) * k;
      lp.radiusScale += (target.radiusScale - lp.radiusScale) * k;
      lp.ringSeparation += (target.ringSeparation - lp.ringSeparation) * k;
      lp.chaosAmp += (target.chaosAmp - lp.chaosAmp) * k;
      lp.hexScale += (target.hexScale - lp.hexScale) * k;
      lp.hexAlpha += (target.hexAlpha - lp.hexAlpha) * k;
      lp.synapseAlpha += (target.synapseAlpha - lp.synapseAlpha) * k;

      for (let c = 0; c < 3; c++) {
        lp.primaryRGB[c] += (target.primaryRGB[c] - lp.primaryRGB[c]) * k;
        lp.secondaryRGB[c] += (target.secondaryRGB[c] - lp.secondaryRGB[c]) * k;
      }
    }

    // =========================================================================
    // 4. ГОЛОВНИЙ 60 FPS КОНВЕЄР РЕНДЕРИНГУ КВАНТОВОЇ СФЕРИ
    // =========================================================================
    startRenderLoop() {
      if (this.rafId) cancelAnimationFrame(this.rafId);

      const tick = (now) => {
        if (!document.hidden && this.ctx) {
          this.sampleAudioMetrics(now);
          this.interpolateStateParameters();
          this.renderFrame(now);
        }
        this.rafId = requestAnimationFrame(tick);
      };

      this.rafId = requestAnimationFrame(tick);
    }

    renderFrame(now) {
      const ctx = this.ctx;
      const W = this.width;
      const H = this.height;
      const cx = W / 2;
      const cy = H / 2;
      const t = now * 0.001;

      ctx.clearRect(0, 0, W, H);

      const lp = this.liveParams;
      const audioBoost = this.mode === 'SPEAKING' ? this.smoothedAudioEnergy : 0;
      const isGlitching = now < this.glitchUntil;

      const r1 = Math.round(lp.primaryRGB[0]);
      const g1 = Math.round(lp.primaryRGB[1]);
      const b1 = Math.round(lp.primaryRGB[2]);

      const r2 = Math.round(lp.secondaryRGB[0]);
      const g2 = Math.round(lp.secondaryRGB[1]);
      const b2 = Math.round(lp.secondaryRGB[2]);

      const baseSphereRadius = Math.min(W, H) * 0.31;
      const activeRadius =
        baseSphereRadius * lp.radiusScale * (1 + audioBoost * 0.28 + Math.sin(t * 2.1) * 0.025);

      // Оновлюємо кути орбітального руху
      const effectiveSpeed = lp.rotSpeed + audioBoost * 0.022;
      this.angleY += effectiveSpeed;
      this.angleX += effectiveSpeed * 0.58;
      this.innerRingAngle += effectiveSpeed * 1.25;
      this.outerRingAngle -= effectiveSpeed * 0.85;
      this.hexCoreAngle += effectiveSpeed * (this.mode === 'THINKING' ? 2.4 : 1.15);

      ctx.save();
      if (isGlitching) {
        const shiftX = (Math.random() - 0.5) * 10;
        const shiftY = (Math.random() - 0.5) * 6;
        ctx.translate(shiftX, shiftY);
      }

      // 1. Внутрішнє об'ємне сяйво квантового ядра
      const glowRadius = activeRadius * (1.15 + audioBoost * 0.25);
      const radialGlow = ctx.createRadialGradient(cx, cy, 4, cx, cy, glowRadius);
      radialGlow.addColorStop(0, `rgba(236, 254, 255, ${0.42 + audioBoost * 0.45})`);
      radialGlow.addColorStop(0.32, `rgba(${r1}, ${g1}, ${b1}, ${0.26 + audioBoost * 0.28})`);
      radialGlow.addColorStop(0.68, `rgba(${r2}, ${g2}, ${b2}, ${0.10 + audioBoost * 0.14})`);
      radialGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.fillStyle = radialGlow;
      ctx.beginPath();
      ctx.arc(cx, cy, glowRadius, 0, Math.PI * 2);
      ctx.fill();

      // 2. Рендеринг центрального Гексагонального Ядра
      this.drawHexagonalCore(ctx, cx, cy, activeRadius, r1, g1, b1, r2, g2, b2, audioBoost, t);

      // 3. Рендеринг інтерференційних хвиль (THINKING / SPEAKING)
      this.drawInterferenceWaves(ctx, cx, cy, activeRadius, r1, g1, b1, audioBoost, t);

      // 4. Проєкція та рендеринг подвійного кільця часток (80–120 вузлів)
      this.drawDoubleParticleRing(ctx, cx, cy, activeRadius, r1, g1, b1, r2, g2, b2, audioBoost, t);

      // 5. Хроматичні зрізи при сюжетному глітчі AETHER_SYSTEM_OVERRIDE
      if (isGlitching) {
        this.drawGlitchSlices(ctx, W, H);
      }

      ctx.restore();
    }

    drawHexagonalCore(ctx, cx, cy, activeRadius, r1, g1, b1, r2, g2, b2, audioBoost, t) {
      const lp = this.liveParams;
      const coreRadius = activeRadius * 0.34 * lp.hexScale * (1 + this.bassEnergy * 0.38);

      ctx.save();
      ctx.translate(cx, cy);

      // Зовнішній тактичний гексагон
      ctx.save();
      ctx.rotate(this.hexCoreAngle);
      ctx.strokeStyle = `rgba(${r1}, ${g1}, ${b1}, ${Math.min(1, lp.hexAlpha + audioBoost * 0.3)})`;
      ctx.lineWidth = 1.5 + audioBoost * 1.2;
      this.traceHexagonPath(ctx, coreRadius);
      ctx.stroke();

      // Кутові вузлові точки гексагона
      ctx.fillStyle = `rgba(236, 254, 255, ${Math.min(1, lp.hexAlpha + 0.25)})`;
      for (let i = 0; i < 6; i++) {
        const ang = (Math.PI / 3) * i;
        const vx = coreRadius * Math.cos(ang);
        const vy = coreRadius * Math.sin(ang);
        ctx.beginPath();
        ctx.arc(vx, vy, 2.1 + audioBoost * 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // Внутрішній контр-обертовий гексагон (#10b981)
      ctx.save();
      ctx.rotate(-this.hexCoreAngle * 1.35);
      ctx.strokeStyle = `rgba(${r2}, ${g2}, ${b2}, ${Math.min(1, lp.hexAlpha * 0.85 + audioBoost * 0.25)})`;
      ctx.lineWidth = 1.1;
      this.traceHexagonPath(ctx, coreRadius * 0.62);
      ctx.stroke();
      ctx.restore();

      // Аналітичне кільце фокусування (особливо виразне у стані LISTENING та THINKING)
      const ringRadius = coreRadius * (1.28 + Math.sin(t * 4) * 0.04);
      ctx.strokeStyle = `rgba(${r1}, ${g1}, ${b1}, ${lp.hexAlpha * 0.55})`;
      ctx.lineWidth = 1.0;
      for (let seg = 0; seg < 3; seg++) {
        const startAng = this.innerRingAngle + seg * ((Math.PI * 2) / 3);
        ctx.beginPath();
        ctx.arc(0, 0, ringRadius, startAng, startAng + 1.15);
        ctx.stroke();
      }

      ctx.restore();
    }

    traceHexagonPath(ctx, radius) {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const ang = (Math.PI / 3) * i;
        const x = radius * Math.cos(ang);
        const y = radius * Math.sin(ang);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    }

    drawInterferenceWaves(ctx, cx, cy, activeRadius, r1, g1, b1, audioBoost, t) {
      // У режимі THINKING або гучного SPEAKING періодично генеруємо нові хвилі
      if (this.mode === 'THINKING' && Math.random() < 0.08) {
        this.spawnInterferenceRipple(0.85);
      } else if (this.mode === 'SPEAKING' && audioBoost > 0.45 && Math.random() < 0.14) {
        this.spawnInterferenceRipple(audioBoost);
      }

      for (let i = this.interferenceRipples.length - 1; i >= 0; i--) {
        const rip = this.interferenceRipples[i];
        rip.progress += this.mode === 'THINKING' ? 0.028 : 0.022;

        if (rip.progress >= 1.0) {
          this.interferenceRipples.splice(i, 1);
          continue;
        }

        const alpha = (1 - rip.progress) * 0.48 * rip.intensity;
        const waveR = activeRadius * (0.25 + rip.progress * 0.95);

        ctx.strokeStyle = `rgba(${r1}, ${g1}, ${b1}, ${alpha.toFixed(3)})`;
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.arc(cx, cy, waveR, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Додаткова стояча хвиля інтерференції у режимі THINKING
      if (this.mode === 'THINKING') {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.strokeStyle = `rgba(${r1}, ${g1}, ${b1}, 0.28)`;
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        const points = 72;
        for (let i = 0; i <= points; i++) {
          const ang = (i / points) * Math.PI * 2;
          const ripple = Math.sin(ang * 6 + t * 16) * 7 + Math.cos(ang * 4 - t * 12) * 5;
          const r = activeRadius * 0.82 + ripple;
          const x = r * Math.cos(ang);
          const y = r * Math.sin(ang);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      }
    }

    drawDoubleParticleRing(ctx, cx, cy, activeRadius, r1, g1, b1, r2, g2, b2, audioBoost, t) {
      const lp = this.liveParams;
      const cosY = Math.cos(this.angleY);
      const sinY = Math.sin(this.angleY);
      const cosX = Math.cos(this.angleX);
      const sinX = Math.sin(this.angleX);

      const cosOuter = Math.cos(this.outerRingAngle);
      const sinOuter = Math.sin(this.outerRingAngle);

      const projected = [];

      for (let i = 0; i < this.particles.length; i++) {
        const p = this.particles[i];

        // Індивідуальна реакція частки на свою частотну смугу AnalyserNode під час SPEAKING
        let bandEnergy = audioBoost;
        if (this.mode === 'SPEAKING' && this.freqBuffer) {
          bandEnergy = (this.freqBuffer[p.freqBand] / 255) * 0.85 + audioBoost * 0.35;
        }

        // Подвійне кільце: внутрішня оболонка та зовнішня орбітальна оболонка
        const shellMultiplier = p.ringIndex === 1
          ? (1.0 + lp.ringSeparation * 0.45)
          : (1.0 - lp.ringSeparation * 0.45);

        // Хаотична інтерференція у режимі THINKING або звукова вібрація у SPEAKING
        const waveOffset =
          Math.sin(t * (this.mode === 'THINKING' ? 14 : 3.4) + p.phase) * lp.chaosAmp +
          bandEnergy * (p.ringIndex === 1 ? 0.28 : 0.16);

        const rScale = shellMultiplier * (1 + waveOffset);
        let x0 = p.ux * rScale;
        let y0 = p.uy * rScale;
        let z0 = p.uz * rScale;

        // Зовнішнє кільце має власну протилежну прецесію
        if (p.ringIndex === 1) {
          const rx = x0 * cosOuter - z0 * sinOuter;
          const rz = z0 * cosOuter + x0 * sinOuter;
          x0 = rx;
          z0 = rz;
        }

        // 3D-обертання всієї сфери
        const x1 = x0 * cosY - z0 * sinY;
        const z1 = z0 * cosY + x0 * sinY;
        const y2 = y0 * cosX - z1 * sinX;
        const z2 = z1 * cosX + y0 * sinX;

        const perspective = 2.55 / (2.55 - z2 * 0.78);
        const px = cx + x1 * activeRadius * perspective;
        const py = cy + y2 * activeRadius * perspective;

        projected.push({
          px,
          py,
          z: z2,
          ringIndex: p.ringIndex,
          isEmerald: p.isEmerald,
          size: p.baseSize * perspective * (1 + bandEnergy * 0.65)
        });
      }

      // 1. Малюємо тонкі синаптичні лінії між близькими частками
      const maxLinkDistSq = (activeRadius * 0.36) ** 2;
      ctx.lineWidth = 0.75;

      for (let i = 0; i < projected.length; i++) {
        const a = projected[i];
        let linksCount = 0;

        for (let j = i + 1; j < projected.length; j++) {
          const b = projected[j];
          const dx = a.px - b.px;
          const dy = a.py - b.py;
          const distSq = dx * dx + dy * dy;

          if (distSq < maxLinkDistSq) {
            const proximity = 1 - distSq / maxLinkDistSq;
            const alpha = proximity * (lp.synapseAlpha + audioBoost * 0.25);
            ctx.strokeStyle = a.isEmerald
              ? `rgba(${r2}, ${g2}, ${b2}, ${alpha.toFixed(3)})`
              : `rgba(${r1}, ${g1}, ${b1}, ${alpha.toFixed(3)})`;
            ctx.beginPath();
            ctx.moveTo(a.px, a.py);
            ctx.lineTo(b.px, b.py);
            ctx.stroke();

            if (++linksCount >= 3) break;
          }
        }
      }

      // 2. Малюємо самі квантові частки (#22d3ee та #10b981)
      for (let i = 0; i < projected.length; i++) {
        const pt = projected[i];
        const depthAlpha = Math.max(0.22, Math.min(1, (pt.z + 1.25) / 2.05));

        if (pt.z > 0.42 && (this.mode === 'SPEAKING' || this.mode === 'THINKING')) {
          ctx.fillStyle = `rgba(236, 254, 255, ${depthAlpha.toFixed(2)})`;
        } else if (pt.isEmerald) {
          ctx.fillStyle = `rgba(${r2}, ${g2}, ${b2}, ${depthAlpha.toFixed(2)})`;
        } else {
          ctx.fillStyle = `rgba(${r1}, ${g1}, ${b1}, ${depthAlpha.toFixed(2)})`;
        }

        ctx.beginPath();
        ctx.arc(pt.px, pt.py, pt.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    drawGlitchSlices(ctx, W, H) {
      ctx.save();
      ctx.fillStyle = 'rgba(34, 211, 238, 0.22)';
      for (let i = 0; i < 4; i++) {
        const y = Math.random() * H;
        const h = 2 + Math.random() * 8;
        ctx.fillRect(0, y, W, h);
      }
      ctx.restore();
    }
  }

  // Експортуємо та реєструємо модуль у системі Рафаїла
  const canvasInstance = new RaphaelQuantumCanvas();
  window.RaphaelCanvas = canvasInstance;
  window.RaphaelModules.register('canvas', canvasInstance);
})(window);