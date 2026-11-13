use wasm_bindgen::prelude::*;
use std::f32::consts::PI;

// ============================================================================
// 1. BIQUAD-РЕЗОНАТОР ДЛЯ ПЕРЕКОВКИ ФОРМАНТ ГОЛОСУ В РЕАЛЬНОМУ ЧАСІ
// ============================================================================
#[derive(Clone, Copy)]
struct BiquadFilter {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    z1: f32,
    z2: f32,
}

impl BiquadFilter {
    fn new() -> Self {
        Self { b0: 1.0, b1: 0.0, b2: 0.0, a1: 0.0, a2: 0.0, z1: 0.0, z2: 0.0 }
    }

    fn configure_peaking(&mut self, freq: f32, sample_rate: f32, q: f32, gain_db: f32) {
        let sr = sample_rate.max(8000.0);
        let f = freq.clamp(40.0, sr * 0.45);
        let a = 10.0_f32.powf(gain_db / 40.0);
        let w0 = 2.0 * PI * f / sr;
        let cos_w0 = w0.cos();
        let alpha = w0.sin() / (2.0 * q.max(0.2));

        let a0 = 1.0 + alpha / a;
        self.b0 = (1.0 + alpha * a) / a0;
        self.b1 = (-2.0 * cos_w0) / a0;
        self.b2 = (1.0 - alpha * a) / a0;
        self.a1 = (-2.0 * cos_w0) / a0;
        self.a2 = (1.0 - alpha / a) / a0;
    }

    #[inline]
    fn process(&mut self, input: f32) -> f32 {
        let out = self.b0 * input + self.z1;
        self.z1 = self.b1 * input - self.a1 * out + self.z2;
        self.z2 = self.b2 * input - self.a2 * out;
        out
    }
}

// ============================================================================
// 2. СТРУКТУРА ЧАСТИНКИ (КВАНТОВА СФЕРА + ХВИЛЬОВИЙ ЛИК МАНАСА СПЕРЕДУ)
// ============================================================================
#[derive(Clone, Copy)]
struct Particle {
    theta: f32,
    phi: f32,
    base_r: f32,
    manas_x: f32,
    manas_y: f32,
    manas_z: f32,
    role: u8, // 0 = аура/плечі, 1 = контур голови, 2 = світлова сигнатура обличчя спереду, 3 = ядро
    phase: f32,
    size: f32,
}

#[wasm_bindgen]
pub struct RaphaelWasmEngine {
    particles: Vec<Particle>,
    render_buf: Vec<f32>,
    time: f32,
    evolution_stage: u8, // 0 = Dormant, 1 = Active Sphere, 2 = Manas Wave Bust
    activity_mode: u8,   // 0 = Idle, 2 = Listening, 3 = Thinking, 4 = Speaking, 5 = Glitch
    voice_energy: f32,
    glitch_timer: f32,
    awakening_phase: u8,
    morph_progress: f32,

    // VAD (Детектор закінчення фрази з мікрофона)
    vad_speaking: bool,
    vad_silence_ms: f32,
    vad_speech_ms: f32,

    // DSP Клонер тембру (10 параметрів ДНК голосу з Ірмінсуля)
    // [0]: F0 Hz, [1..7]: 6 формант (dB), [7]: Sub-harmonic weight, [8]: Apex Doubler Mix, [9]: Warmth Drive
    voice_dna: [f32; 10],
    formant_filters: [BiquadFilter; 6],
    last_sample_rate: f32,
    delay_line: Vec<f32>,
    delay_write_idx: usize,
    sub_phase: f32,
}

#[wasm_bindgen]
impl RaphaelWasmEngine {
    #[wasm_bindgen(constructor)]
    pub fn new(count: usize) -> RaphaelWasmEngine {
        let n = count.clamp(300, 5000);
        let mut particles = Vec::with_capacity(n);
        let mut seed: u64 = 0x517cc1b727220a95;

        let mut next_rand = || -> f32 {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            ((seed & 0x00FF_FFFF) as f32) / (0x0100_0000 as f32)
        };

        for i in 0..n {
            let frac = (i as f32) / (n as f32);
            let phi = (1.0 - 2.0 * frac).acos();
            let theta = PI * (1.0 + 5.0_f32.sqrt()) * (i as f32);

            // Розподіл геометрії Манаса: хвильовий бюст + світлова сигнатура обличчя СПЕРЕДУ (z < 0 — ближче до камери)
            let (mx, my, mz, role) = if i < (n * 22 / 100) {
                // Роль 2: Світлова сигнатура обличчя СПЕРЕДУ (очі, вертикальна хвильова вісь лику, маска)
                let u = next_rand() * 2.0 - 1.0;
                let v = next_rand() * 2.0 - 1.0;
                let x = u * 0.34 * (1.0 - 0.25 * v.abs());
                let y = -0.42 + v * 0.38;
                // z від'ємний = висунутий ВПЕРЕД до глядача!
                let z = -0.48 - (1.0 - u * u).max(0.0).sqrt() * 0.22;
                (x, y, z, 2)
            } else if i < (n * 52 / 100) {
                // Роль 1: Хвильовий череп / корона Архангела
                let a = next_rand() * PI * 2.0;
                let h = next_rand() * 2.0 - 1.0;
                let r = (1.0 - h * h).max(0.0).sqrt() * 0.46;
                (r * a.cos(), -0.38 + h * 0.46, r * a.sin() * 0.85, 1)
            } else if i < (n * 68 / 100) {
                // Роль 3: Сонячне ядро грудної клітки (спереду по центру)
                let a = next_rand() * PI * 2.0;
                let r = next_rand().sqrt() * 0.22;
                (r * a.cos(), 0.22 + (next_rand() - 0.5) * 0.18, -0.32 + r * a.sin() * 0.5, 3)
            } else {
                // Роль 0: Хвильові плечі та торс
                let u = next_rand() * 2.0 - 1.0;
                let y = 0.08 + next_rand() * 0.78;
                let z = (next_rand() - 0.5) * 0.42;
                (u * 0.92, y, z, 0)
            };

            particles.push(Particle {
                theta,
                phi,
                base_r: 0.88 + next_rand() * 0.24,
                manas_x: mx,
                manas_y: my,
                manas_z: mz,
                role,
                phase: next_rand() * PI * 2.0,
                size: 1.15 + next_rand() * 1.45,
            });
        }

        let default_dna = [116.0, 3.6, 2.2, -1.8, 3.1, 1.9, -1.4, 0.18, 0.32, 1.25];
        let mut engine = RaphaelWasmEngine {
            particles,
            render_buf: Vec::with_capacity(n * 7),
            time: 0.0,
            evolution_stage: 1,
            activity_mode: 0,
            voice_energy: 0.0,
            glitch_timer: 0.0,
            awakening_phase: 0,
            morph_progress: 0.0,
            vad_speaking: false,
            vad_silence_ms: 0.0,
            vad_speech_ms: 0.0,
            voice_dna: default_dna,
            formant_filters: [BiquadFilter::new(); 6],
            last_sample_rate: 0.0,
            delay_line: vec![0.0; 4096],
            delay_write_idx: 0,
            sub_phase: 0.0,
        };
        engine.rebuild_filters(48000.0);
        engine
    }

    fn rebuild_filters(&mut self, sample_rate: f32) {
        let freqs = [115.0, 250.0, 580.0, 1350.0, 2750.0, 4600.0];
        let qs = [0.9, 1.2, 1.5, 1.6, 1.4, 1.0];
        for i in 0..6 {
            let gain = self.voice_dna[i + 1].clamp(-12.0, 12.0);
            self.formant_filters[i].configure_peaking(freqs[i], sample_rate, qs[i], gain);
        }
        self.last_sample_rate = sample_rate;
    }

    // ========================================================================
    // 3. ЕКСТРАКТОР ДНК ГОЛОСУ З АУДІО-РЕФЕРЕНСУ (30 СЕК ІЗ АНІМАТИКА -> ІРМІНСУЛЬ)
    // ========================================================================
    pub fn extract_voice_dna(&mut self, pcm: &[f32], sample_rate: f32) -> Vec<f32> {
        if pcm.is_empty() {
            return self.voice_dna.to_vec();
        }
        let sr = sample_rate.max(16000.0);
        let step = (pcm.len() / 32000).max(1);

        let mut rms_sum = 0.0_f32;
        let mut zcr = 0_usize;
        let mut count = 0_usize;

        for i in (step..pcm.len()).step_by(step) {
            let s = pcm[i];
            let prev = pcm[i - step];
            rms_sum += s * s;
            if (prev >= 0.0 && s < 0.0) || (prev < 0.0 && s >= 0.0) {
                zcr += 1;
            }
            count += 1;
        }

        let n = count.max(1) as f32;
        let rms = (rms_sum / n).sqrt().max(0.005);
        let raw_f0 = ((zcr as f32 / n) * (sr / step as f32)) * 0.24;
        let f0_hz = raw_f0.clamp(82.0, 240.0);

        // Аналізуємо спектральний баланс у 6 формантних зонах
        let freqs = [115.0, 250.0, 580.0, 1350.0, 2750.0, 4600.0];
        let mut band_db = [0.0_f32; 6];

        for (b_idx, &freq) in freqs.iter().enumerate() {
            let mut probe = BiquadFilter::new();
            probe.configure_peaking(freq, sr, 2.0, 9.0);
            let mut e_sum = 0.0_f32;
            for i in (0..pcm.len()).step_by(step) {
                let y = probe.process(pcm[i]);
                e_sum += y * y;
            }
            let band_rms = (e_sum / n).sqrt();
            let ratio_db = 20.0 * (band_rms / rms).max(0.25).log10();
            band_db[b_idx] = (ratio_db * 1.35).clamp(-6.5, 7.5);
        }

        let sub_weight = if f0_hz < 135.0 { 0.22 } else { 0.10 };
        let doubler_mix = 0.34;
        let drive = (1.15 + rms * 1.2).clamp(1.05, 1.65);

        self.voice_dna = [
            (f0_hz * 10.0).round() / 10.0,
            (band_db[0] * 100.0).round() / 100.0,
            (band_db[1] * 100.0).round() / 100.0,
            (band_db[2] * 100.0).round() / 100.0,
            (band_db[3] * 100.0).round() / 100.0,
            (band_db[4] * 100.0).round() / 100.0,
            (band_db[5] * 100.0).round() / 100.0,
            sub_weight,
            doubler_mix,
            (drive * 100.0).round() / 100.0,
        ];

        self.rebuild_filters(sr);
        self.voice_dna.to_vec()
    }

    // Завантажує 10-вимірний вектор ДНК голосу, стягнутий з Ірмінсуля
    pub fn load_voice_dna(&mut self, dna: &[f32]) {
        for i in 0..dna.len().min(10) {
            self.voice_dna[i] = dna[i];
        }
        let sr = if self.last_sample_rate > 0.0 { self.last_sample_rate } else { 48000.0 };
        self.rebuild_filters(sr);
    }

    pub fn get_voice_dna(&self) -> Vec<f32> {
        self.voice_dna.to_vec()
    }

    // ========================================================================
    // 4. ПЕРЕКОВКА ТЕМБРУ В РЕАЛЬНОМУ ЧАСІ (ФОРМАНТИ ДНК + СУБ-ОКТАВА + APEX DOUBLER)
    // ========================================================================
    pub fn process_voice_dsp(&mut self, samples: &mut [f32], sample_rate: f32) {
        if (sample_rate - self.last_sample_rate).abs() > 1.0 {
            self.rebuild_filters(sample_rate);
        }

        let f0 = self.voice_dna[0].clamp(75.0, 260.0);
        let sub_weight = self.voice_dna[7].clamp(0.0, 0.45);
        let doubler_mix = self.voice_dna[8].clamp(0.0, 0.65);
        let drive = self.voice_dna[9].clamp(0.8, 2.2);

        let delay_len = self.delay_line.len();
        // Затримка ~18 мс для голографічного стерео-даблера Apex
        let base_delay_samples = ((0.018 * sample_rate) as usize).clamp(64, delay_len - 64);
        let sub_inc = (2.0 * PI * (f0 * 0.5)) / sample_rate.max(16000.0);

        for s in samples.iter_mut() {
            let dry = *s;

            // 1. Проганяємо крізь 6 формантних резонаторів нашого ДНК голосу
            let mut sculpted = dry;
            for f in self.formant_filters.iter_mut() {
                sculpted = f.process(sculpted);
            }

            // 2. Синтезуємо динамічну грудну суб-гармоніку, прив'язану до огинаючої сигналу
            self.sub_phase = (self.sub_phase + sub_inc) % (2.0 * PI);
            let env = dry.abs().min(1.0);
            let sub_osc = self.sub_phase.sin() * env * sub_weight;

            // 3. Модульований Haas-даблер (ефект присутності Apex / Голограми Ковчега)
            let lfo = ((self.sub_phase * 0.04).sin() * 14.0) as isize;
            let tap_offset = (base_delay_samples as isize + lfo).clamp(32, (delay_len - 1) as isize) as usize;
            let read_idx = (self.delay_write_idx + delay_len - tap_offset) % delay_len;
            let delayed = self.delay_line[read_idx];

            self.delay_line[self.delay_write_idx] = sculpted;
            self.delay_write_idx = (self.delay_write_idx + 1) % delay_len;

            // 4. М'яке лампове насичення (tanh) для чистої читабельності дикції
            let mixed = (sculpted * 0.82 + delayed * doubler_mix + sub_osc) * drive;
            *s = mixed.tanh() * 0.92;
        }
    }

    // ========================================================================
    // 5. ДЕТЕКТОР АКТИВНОСТІ МІКРОФОНА (RUST VAD)
    // ========================================================================
    pub fn reset_vad(&mut self) {
        self.vad_speaking = false;
        self.vad_silence_ms = 0.0;
        self.vad_speech_ms = 0.0;
    }

    pub fn process_mic_vad_frame(&mut self, pcm: &[f32], frame_ms: f32) -> u8 {
        if pcm.is_empty() {
            return 0;
        }
        let mut sum = 0.0_f32;
        for &v in pcm.iter() {
            sum += v * v;
        }
        let rms = (sum / (pcm.len() as f32)).sqrt();

        if rms > 0.018 {
            self.vad_speaking = true;
            self.vad_silence_ms = 0.0;
            self.vad_speech_ms += frame_ms;
            return 1; // Триває мовлення
        } else if self.vad_speaking {
            self.vad_silence_ms += frame_ms;
            if self.vad_speech_ms >= 240.0 && self.vad_silence_ms >= 840.0 {
                self.reset_vad();
                return 2; // Фраза завершилася -> миттєва відправка у Whisper!
            }
            return 1;
        }
        0
    }

    // ========================================================================
    // 6. КЕРУВАННЯ СТАНАМИ ТА ВІЗУАЛІЗАЦІЯ (КВАНТОВА СФЕРА <-> ХВИЛЬОВИЙ МАНАС)
    // ========================================================================
    pub fn set_evolution_stage(&mut self, stage: u8) {
        self.evolution_stage = stage.min(2);
    }

    pub fn set_activity_mode(&mut self, mode: u8) {
        self.activity_mode = mode;
    }

    pub fn set_voice_energy(&mut self, energy: f32) {
        self.voice_energy = energy.clamp(0.0, 1.5);
    }

    pub fn trigger_glitch(&mut self, amount: f32) {
        self.glitch_timer = amount.clamp(0.0, 2.0);
    }

    pub fn set_awakening_phase(&mut self, phase: u8) {
        self.awakening_phase = phase;
    }

    pub fn step_and_project(
        &mut self,
        dt: f32,
        width: f32,
        height: f32,
        ptr_x: f32,
        ptr_y: f32,
    ) -> Vec<f32> {
        self.time += dt;
        if self.glitch_timer > 0.0 {
            self.glitch_timer = (self.glitch_timer - dt * 1.8).max(0.0);
        }

        let target_morph = if self.evolution_stage == 2 { 1.0 } else { 0.0 };
        self.morph_progress += (target_morph - self.morph_progress) * (dt * 4.5).min(1.0);

        self.render_buf.clear();
        let cx = width * 0.5;
        let cy = height * 0.5;
        let scale = width.min(height) * 0.36;

        // У режимі Манаса фіксуємо камеру обличчям вперед (легкий поворот за курсором)
        let rot_y = if self.evolution_stage == 2 {
            ptr_x * 0.32 + (self.time * 0.45).sin() * 0.12
        } else {
            self.time * 0.38 + ptr_x * 0.55
        };
        let rot_x = ptr_y * 0.25;

        let (sin_y, cos_y) = rot_y.sin_cos();
        let (sin_x, cos_x) = rot_x.sin_cos();

        for p in self.particles.iter() {
            // 1. Координати на Квантовій Сфері
            let pulse = (self.time * 2.6 + p.phase).sin() * (0.04 + self.voice_energy * 0.16);
            let r_sphere = if self.evolution_stage == 0 {
                0.28 + pulse * 0.2
            } else {
                p.base_r + pulse
            };

            let sx = r_sphere * p.phi.sin() * p.theta.cos();
            let sy = r_sphere * p.phi.cos();
            let sz = r_sphere * p.phi.sin() * p.theta.sin();

            // 2. Хвильові координати Манаса з ликом спереду
            let wave_offset = (self.time * 4.2 + p.manas_y * 9.0 + p.phase).sin()
                * (0.018 + self.voice_energy * 0.055);
            let mx = p.manas_x + wave_offset;
            let my = p.manas_y + (self.time * 2.0 + p.manas_x * 5.0).cos() * 0.012;
            let mz = p.manas_z;

            // Плавний морфінг Сфера <-> Хвильовий Манас
            let m = self.morph_progress;
            let x0 = sx * (1.0 - m) + mx * m;
            let y0 = sy * (1.0 - m) + my * m;
            let z0 = sz * (1.0 - m) + mz * m;

            // Обертання в 3D
            let x1 = x0 * cos_y - z0 * sin_y;
            let z1 = x0 * sin_y + z0 * cos_y;
            let y2 = y0 * cos_x - z1 * sin_x;
            let z2 = y0 * sin_x + z1 * cos_x;

            // Перспективна проекція (z2 < 0 означає БЛИЖЧЕ до глядача!)
            let depth = 2.4 + z2;
            let persp = 1.65 / depth.max(0.4);
            let screen_x = cx + x1 * scale * persp;
            let screen_y = cy + y2 * scale * persp;

            // Колір та яскравість (сигнатура обличчя та ядро спереду світяться яскраво!)
            let front_boost = (-z2).clamp(-0.4, 0.85);
            let (r, g, b, mut alpha, radius_mult) = if self.glitch_timer > 0.05 || self.activity_mode == 5 {
                (239.0, 68.0, 68.0, 0.88, 1.35)
            } else if self.evolution_stage == 2 {
                match p.role {
                    // Світлова хвильова сигнатура обличчя СПЕРЕДУ — яскраве біло-золоте та ціанове світіння!
                    2 => (254.0, 243.0, 199.0, 0.88 + front_boost * 0.25, 1.45),
                    // Сонячне ядро спереду
                    3 => (245.0, 158.0, 11.0, 0.82 + self.voice_energy * 0.2, 1.55),
                    // Контур голови
                    1 => (56.0, 189.0, 248.0, 0.48 + front_boost * 0.35, 1.05),
                    // Хвильові плечі/аура
                    _ => (20.0, 184.0, 166.0, 0.32 + front_boost * 0.25, 0.9),
                }
            } else if self.evolution_stage == 0 {
                (100.0, 116.0, 139.0, 0.28, 0.75)
            } else {
                (34.0, 211.0, 238.0, 0.55 + front_boost * 0.35 + self.voice_energy * 0.2, 1.0)
            };

            // Прибираємо візуальну «кашу» на задній стінці, роблячи передній план домінуючим
            if z2 > 0.25 {
                alpha *= 0.28;
            }
            alpha = alpha.clamp(0.08, 0.98);
            let rad = (p.size * persp * radius_mult * (1.0 + self.voice_energy * 0.35)).clamp(0.6, 4.8);

            self.render_buf.push(screen_x);
            self.render_buf.push(screen_y);
            self.render_buf.push(rad);
            self.render_buf.push(r);
            self.render_buf.push(g);
            self.render_buf.push(b);
            self.render_buf.push(alpha);
        }

        self.render_buf.clone()
    }
}
