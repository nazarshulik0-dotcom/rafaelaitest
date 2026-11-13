/* tslint:disable */
/* eslint-disable */

export class RaphaelWasmEngine {
    free(): void;
    [Symbol.dispose](): void;
    extract_voice_dna(pcm: Float32Array | number[], sample_rate: number): Float32Array;
    get_voice_dna(): Float32Array;
    load_voice_dna(dna: Float32Array | number[]): void;
    constructor(count: number);
    process_mic_vad_frame(pcm: Float32Array | number[], frame_ms: number): number;
    process_voice_dsp(samples: Float32Array, sample_rate: number): void;
    reset_vad(): void;
    set_activity_mode(mode: number): void;
    set_awakening_phase(phase: number): void;
    set_evolution_stage(stage: number): void;
    set_voice_energy(energy: number): void;
    step_and_project(dt: number, width: number, height: number, ptr_x: number, ptr_y: number): Float32Array;
    trigger_glitch(amount: number): void;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_raphaelwasmengine_free: (a: number, b: number) => void;
    readonly raphaelwasmengine_extract_voice_dna: (a: number, b: number, c: number, d: number) => [number, number];
    readonly raphaelwasmengine_get_voice_dna: (a: number) => [number, number];
    readonly raphaelwasmengine_load_voice_dna: (a: number, b: number, c: number) => void;
    readonly raphaelwasmengine_new: (a: number) => number;
    readonly raphaelwasmengine_process_mic_vad_frame: (a: number, b: number, c: number, d: number) => number;
    readonly raphaelwasmengine_process_voice_dsp: (a: number, b: number, c: number, d: any, e: number) => void;
    readonly raphaelwasmengine_reset_vad: (a: number) => void;
    readonly raphaelwasmengine_set_activity_mode: (a: number, b: number) => void;
    readonly raphaelwasmengine_set_awakening_phase: (a: number, b: number) => void;
    readonly raphaelwasmengine_set_evolution_stage: (a: number, b: number) => void;
    readonly raphaelwasmengine_set_voice_energy: (a: number, b: number) => void;
    readonly raphaelwasmengine_step_and_project: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly raphaelwasmengine_trigger_glitch: (a: number, b: number) => void;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
