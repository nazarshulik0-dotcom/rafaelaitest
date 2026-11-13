/* @ts-self-types="./raphael_wasm.d.ts" */

export class RaphaelWasmEngine {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        RaphaelWasmEngineFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_raphaelwasmengine_free(ptr, 0);
    }
    /**
     * @param {Float32Array | number[]} pcm
     * @param {number} sample_rate
     * @returns {Float32Array}
     */
    extract_voice_dna(pcm, sample_rate) {
        const val2 = +sample_rate;
        const ptr0 = passArrayF32ToWasm0(pcm, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.raphaelwasmengine_extract_voice_dna(this.__wbg_ptr, ptr0, len0, val2);
        var v3 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v3;
    }
    /**
     * @returns {Float32Array}
     */
    get_voice_dna() {
        const ret = wasm.raphaelwasmengine_get_voice_dna(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @param {Float32Array | number[]} dna
     */
    load_voice_dna(dna) {
        const ptr0 = passArrayF32ToWasm0(dna, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.raphaelwasmengine_load_voice_dna(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {number} count
     */
    constructor(count) {
        const ret = wasm.raphaelwasmengine_new(count);
        this.__wbg_ptr = ret;
        RaphaelWasmEngineFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {Float32Array | number[]} pcm
     * @param {number} frame_ms
     * @returns {number}
     */
    process_mic_vad_frame(pcm, frame_ms) {
        const val2 = +frame_ms;
        const ptr0 = passArrayF32ToWasm0(pcm, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.raphaelwasmengine_process_mic_vad_frame(this.__wbg_ptr, ptr0, len0, val2);
        return ret;
    }
    /**
     * @param {Float32Array} samples
     * @param {number} sample_rate
     */
    process_voice_dsp(samples, sample_rate) {
        const val2 = +sample_rate;
        var ptr0 = passArrayF32ToWasm0(samples, wasm.__wbindgen_malloc);
        var len0 = WASM_VECTOR_LEN;
        wasm.raphaelwasmengine_process_voice_dsp(this.__wbg_ptr, ptr0, len0, samples, val2);
    }
    reset_vad() {
        wasm.raphaelwasmengine_reset_vad(this.__wbg_ptr);
    }
    /**
     * @param {number} mode
     */
    set_activity_mode(mode) {
        wasm.raphaelwasmengine_set_activity_mode(this.__wbg_ptr, mode);
    }
    /**
     * @param {number} phase
     */
    set_awakening_phase(phase) {
        wasm.raphaelwasmengine_set_awakening_phase(this.__wbg_ptr, phase);
    }
    /**
     * @param {number} stage
     */
    set_evolution_stage(stage) {
        wasm.raphaelwasmengine_set_evolution_stage(this.__wbg_ptr, stage);
    }
    /**
     * @param {number} energy
     */
    set_voice_energy(energy) {
        wasm.raphaelwasmengine_set_voice_energy(this.__wbg_ptr, energy);
    }
    /**
     * @param {number} dt
     * @param {number} width
     * @param {number} height
     * @param {number} ptr_x
     * @param {number} ptr_y
     * @returns {Float32Array}
     */
    step_and_project(dt, width, height, ptr_x, ptr_y) {
        const ret = wasm.raphaelwasmengine_step_and_project(this.__wbg_ptr, dt, width, height, ptr_x, ptr_y);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @param {number} amount
     */
    trigger_glitch(amount) {
        wasm.raphaelwasmengine_trigger_glitch(this.__wbg_ptr, amount);
    }
}
if (Symbol.dispose) RaphaelWasmEngine.prototype[Symbol.dispose] = RaphaelWasmEngine.prototype.free;
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_copy_to_typed_array_680b191e71920dc1: function(arg0, arg1, arg2) {
            new Uint8Array(arg2.buffer, arg2.byteOffset, arg2.byteLength).set(getArrayU8FromWasm0(arg0, arg1));
        },
        __wbg___wbindgen_throw_4c88d8bf264fd984: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            table.set(0, undefined);
            table.set(1024, undefined);
            table.set(1025, null);
            table.set(1026, true);
            table.set(1027, false);
        },
    };
    return {
        __proto__: null,
        "./raphael_wasm_bg.js": import0,
    };
}

const RaphaelWasmEngineFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_raphaelwasmengine_free(ptr, 1));

function getArrayF32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passArrayF32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getFloat32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(bytes) {
    numBytesDecoded += bytes.length;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
        cachedTextDecoder.decode();
        numBytesDecoded = bytes.length;
    }
    return cachedTextDecoder.decode(bytes);
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedFloat32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

let __wbg_init_promise;
async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;
    if (__wbg_init_promise === undefined) {
        __wbg_init_promise = __wbg_init_once(module_or_path);
        __wbg_init_promise.catch(() => { __wbg_init_promise = undefined; });
    }
    return __wbg_init_promise;
}

async function __wbg_init_once(module_or_path) {

    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('raphael_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
