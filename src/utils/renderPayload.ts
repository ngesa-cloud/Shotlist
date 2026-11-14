import { CompilerConfig, SceneSpec } from '../types/photoshoot';
import {
  compileNegativePrompt,
  compilePositivePrompt,
  getAspectDimensions,
  sanitizeLoraName,
} from './promptCompiler';

export type LocalRenderBackend = 'a1111' | 'comfyui';
export type RenderResolutionMode = 'native' | 'fast';

export interface A1111Txt2ImgPayload {
  prompt: string;
  negative_prompt: string;
  cfg_scale: number;
  steps: number;
  seed: number;
  width: number;
  height: number;
  sampler_name: string;
  batch_size: number;
}

export function getRenderDimensions(
  aspectRatio: CompilerConfig['aspectRatio'],
  mode: RenderResolutionMode
): { width: number; height: number } {
  if (mode === 'fast') {
    switch (aspectRatio) {
      case '3:4':
        return { width: 512, height: 640 };
      case '4:3':
        return { width: 640, height: 512 };
      case '1:1':
        return { width: 512, height: 512 };
      case '9:16':
        return { width: 512, height: 768 };
      case '16:9':
        return { width: 768, height: 512 };
    }
  }
  return getAspectDimensions(aspectRatio);
}

export function normalizeSeedValue(seed?: number): number {
  if (typeof seed === 'number' && Number.isInteger(seed) && seed >= 0) {
    return seed;
  }
  return -1;
}

export function buildA1111Txt2ImgPayload(
  scene: SceneSpec,
  config: CompilerConfig,
  resolutionMode: RenderResolutionMode = 'fast'
): A1111Txt2ImgPayload {
  const sdConfig: CompilerConfig = { ...config, engine: 'sd' };
  const { width, height } = getRenderDimensions(config.aspectRatio, resolutionMode);

  return {
    prompt: compilePositivePrompt(scene, sdConfig),
    negative_prompt: compileNegativePrompt(scene, sdConfig),
    cfg_scale: Number(config.cfgScale.toFixed(1)),
    steps: config.steps,
    seed: normalizeSeedValue(config.seed),
    width,
    height,
    sampler_name: 'DPM++ 2M Karras',
    batch_size: 1,
  };
}

export function buildComfyPromptApiGraph(
  scene: SceneSpec,
  config: CompilerConfig,
  resolutionMode: RenderResolutionMode = 'native'
): Record<string, { class_type: string; inputs: Record<string, unknown> }> {
  const positive = compilePositivePrompt(scene, {
    ...config,
    engine: 'sd',
    loraEnabled: false,
  });
  const negative = compileNegativePrompt(scene, { ...config, engine: 'sd' });
  const { width, height } = getRenderDimensions(config.aspectRatio, resolutionMode);
  const safeLora = sanitizeLoraName(config.loraName);
  const loraStrength = config.loraEnabled ? Number(config.loraWeight.toFixed(2)) : 0;

  return {
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: 'sd_xl_base_1.0.safetensors' },
    },
    '2': {
      class_type: 'LoraLoader',
      inputs: {
        model: ['1', 0],
        clip: ['1', 1],
        lora_name: `${safeLora}.safetensors`,
        strength_model: loraStrength,
        strength_clip: loraStrength,
      },
    },
    '3': {
      class_type: 'CLIPTextEncode',
      inputs: {
        text: positive,
        clip: ['2', 1],
      },
    },
    '4': {
      class_type: 'CLIPTextEncode',
      inputs: {
        text: negative,
        clip: ['2', 1],
      },
    },
    '5': {
      class_type: 'EmptyLatentImage',
      inputs: {
        width,
        height,
        batch_size: 1,
      },
    },
    '6': {
      class_type: 'KSampler',
      inputs: {
        seed:
          normalizeSeedValue(config.seed) >= 0
            ? normalizeSeedValue(config.seed)
            : Math.floor(Math.random() * 1_000_000_000),
        steps: config.steps,
        cfg: Number(config.cfgScale.toFixed(1)),
        sampler_name: config.sampler || 'dpmpp_2m',
        scheduler: 'karras',
        denoise: 1,
        model: ['2', 0],
        positive: ['3', 0],
        negative: ['4', 0],
        latent_image: ['5', 0],
      },
    },
    '7': {
      class_type: 'VAEDecode',
      inputs: {
        samples: ['6', 0],
        vae: ['1', 2],
      },
    },
    '8': {
      class_type: 'SaveImage',
      inputs: {
        filename_prefix: `Framecraft_${scene.id}`,
        images: ['7', 0],
      },
    },
  };
}

export function validateEndpointUrl(rawUrl: string, fallback: string): string | null {
  const trimmed = (rawUrl || fallback).trim().replace(/\/+$/, '');
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.origin + (parsed.pathname === '/' ? '' : parsed.pathname);
  } catch {
    return null;
  }
}

export function stripDataUrlPrefix(imageBase64: string): string {
  return imageBase64.replace(/^data:image\/[\w+.-]+;base64,/, '').trim();
}

export const MAX_UPSCALE_BASE64_LENGTH = 16 * 1024 * 1024;
export const MAX_UPSCALE_INPUT_DIMENSION = 2048;

export interface UpscalePayload {
  image: string;
  upscaling_resize: number;
  upscaler_1: string;
  upscaler_2: string;
  extras_upscaler_2_visibility: number;
  gfpgan_visibility: number;
  codeformer_visibility: number;
  codeformer_weight: number;
}

export function buildUpscalePayload(
  imageBase64: string,
  upscaleMultiplier = 2,
  gfpganVisibility = 0,
  upscalerName = 'R-ESRGAN 4x+'
): UpscalePayload {
  const multiplier = Math.min(4, Math.max(1, Number(upscaleMultiplier) || 2));
  const rawGfpgan = Number(gfpganVisibility);
  const gfpgan = Number.isFinite(rawGfpgan) ? Math.min(1, Math.max(0, rawGfpgan)) : 0;

  return {
    image: stripDataUrlPrefix(imageBase64),
    upscaling_resize: multiplier,
    upscaler_1: upscalerName || 'R-ESRGAN 4x+',
    upscaler_2: 'None',
    extras_upscaler_2_visibility: 0,
    gfpgan_visibility: Number(gfpgan.toFixed(2)),
    codeformer_visibility: 0,
    codeformer_weight: 0,
  };
}

export type ImageMagicValidationResult =
  | { valid: true; format: 'png' | 'jpeg'; width: number; height: number; rawBase64: string }
  | { valid: false; status: number; error: string };

function decodeBase64Bytes(rawBase64: string): Uint8Array | null {
  try {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(rawBase64) || rawBase64.length % 4 !== 0) {
      return null;
    }
    if (typeof Buffer !== 'undefined') {
      const buf = Buffer.from(rawBase64, 'base64');
      return buf.length > 0 ? new Uint8Array(buf) : null;
    }
    const bin = atob(rawBase64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr.length > 0 ? arr : null;
  } catch {
    return null;
  }
}

function parseJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    return null;
  }
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = bytes[offset + 1];
    // Standalone markers without length
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (offset + 4 >= bytes.length) break;
    const segmentLen = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (segmentLen < 2 || offset + 2 + segmentLen > bytes.length) break;

    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSof && offset + 9 <= bytes.length) {
      const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
      const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
      return { width, height };
    }
    offset += 2 + segmentLen;
  }
  return null;
}

export function validateUpscaleImageInput(
  imageBase64: string,
  maxDimension = MAX_UPSCALE_INPUT_DIMENSION,
  maxBase64Length = MAX_UPSCALE_BASE64_LENGTH
): ImageMagicValidationResult {
  const rawBase64 = stripDataUrlPrefix(imageBase64 || '').replace(/\s+/g, '');
  if (!rawBase64) {
    return { valid: false, status: 400, error: 'Missing imageBase64 payload for upscaling.' };
  }
  if (rawBase64.length > maxBase64Length) {
    return {
      valid: false,
      status: 413,
      error: `Image payload exceeds maximum allowed base64 size (${maxBase64Length} chars).`,
    };
  }

  const bytes = decodeBase64Bytes(rawBase64);
  if (!bytes || bytes.length < 16) {
    return {
      valid: false,
      status: 400,
      error: 'Invalid base64 image encoding or truncated image buffer.',
    };
  }

  const isPng =
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a;

  if (isPng) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16, false);
    const height = view.getUint32(20, false);
    if (width === 0 || height === 0) {
      return { valid: false, status: 400, error: 'Corrupted PNG header dimensions.' };
    }
    if (width > maxDimension || height > maxDimension) {
      return {
        valid: false,
        status: 400,
        error: `Input image dimensions (${width}×${height}) exceed maximum allowed ${maxDimension}×${maxDimension}px for upscaling.`,
      };
    }
    return { valid: true, format: 'png', width, height, rawBase64 };
  }

  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (isJpeg) {
    const dims = parseJpegDimensions(bytes);
    if (!dims || dims.width === 0 || dims.height === 0) {
      return { valid: false, status: 400, error: 'Could not read valid JPEG frame dimensions.' };
    }
    if (dims.width > maxDimension || dims.height > maxDimension) {
      return {
        valid: false,
        status: 400,
        error: `Input image dimensions (${dims.width}×${dims.height}) exceed maximum allowed ${maxDimension}×${maxDimension}px for upscaling.`,
      };
    }
    return { valid: true, format: 'jpeg', width: dims.width, height: dims.height, rawBase64 };
  }

  return {
    valid: false,
    status: 400,
    error: 'Unsupported image binary: only valid PNG or JPEG magic bytes are accepted.',
  };
}

export function formatBatchUpscaledFilename(
  index: number,
  title: string,
  seed?: number
): string {
  const safeTitle =
    title
      .replace(/[^a-z0-9]+/gi, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase() || 'scene';
  const seedSuffix =
    typeof seed === 'number' && Number.isInteger(seed) && seed >= 0 ? `_s${seed}` : '';
  return `${String(index + 1).padStart(2, '0')}_${safeTitle}_upscaled${seedSuffix}.png`;
}

export type ControlNetModule = 'openpose' | 'depth_midas' | 'canny';

export const CONTROLNET_MODELS: Record<ControlNetModule, { label: string; model: string }> = {
  openpose: {
    label: 'OpenPose Skeleton',
    model: 'control_v11p_sd15_openpose [cab727d4]',
  },
  depth_midas: {
    label: 'Depth (MiDaS)',
    model: 'control_v11f1p_sd15_depth [cfd03158]',
  },
  canny: {
    label: 'Canny Edge',
    model: 'control_v11p_sd15_canny [d14c016b]',
  },
};

export interface AlwaysOnScripts {
  ADetailer?: {
    args: unknown[];
  };
  controlnet?: {
    args: Array<{
      input_image: string;
      module: ControlNetModule;
      model: string;
      weight: number;
      resize_mode: number;
      processor_res: number;
    }>;
  };
}

export function buildADetailerConfig(enabled: boolean): AlwaysOnScripts['ADetailer'] | undefined {
  if (!enabled) return undefined;
  return {
    args: [
      true,
      false,
      {
        ad_model: 'face_yolov8n.pt',
        ad_prompt: 'detailed face, perfect eyes, clear skin texture, natural pores, 8k resolution',
        ad_negative_prompt: '(worst quality, low quality:1.4), deformed, mutated, airbrushed',
        ad_confidence: 0.3,
        ad_mask_k_largest: 0,
        ad_inpaint_only_masked: true,
      },
      {
        ad_model: 'hand_yolov8n.pt',
        ad_prompt: 'natural hands, five fingers, realistic skin texture',
        ad_negative_prompt: '(worst quality, low quality:1.4), extra fingers, fused fingers, deformed',
        ad_confidence: 0.3,
        ad_mask_k_largest: 0,
        ad_inpaint_only_masked: true,
      },
    ],
  };
}

export function buildControlNetConfig(
  controlImageBase64: string,
  module: ControlNetModule = 'openpose',
  weight = 0.85
): AlwaysOnScripts['controlnet'] {
  const clampedWeight = Math.min(1.5, Math.max(0.1, Number(weight) || 0.85));
  return {
    args: [
      {
        input_image: stripDataUrlPrefix(controlImageBase64),
        module,
        model: CONTROLNET_MODELS[module].model,
        weight: Number(clampedWeight.toFixed(2)),
        resize_mode: 1,
        processor_res: 512,
      },
    ],
  };
}

export function sanitizeExportFilename(raw: string): string {
  const base = raw
    .trim()
    .replace(/[/\\]+/g, '_')
    .replace(/\.{2,}/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^[._]+/, '');
  const clean = base.length > 0 ? base : `post_${Date.now()}.png`;
  return clean.toLowerCase().endsWith('.png') ? clean : `${clean}.png`;
}

export type LoraTrainingVramProfile = 'standard_8gb' | 'compact_6gb';

export interface LoraTrainingConfig {
  triggerWord: string;
  outputName: string;
  kohyaDir: string;
  baseModelPath: string;
  outputDir: string;
  maxSteps: number;
  vramProfile: LoraTrainingVramProfile;
}

export function sanitizeLoraTrainingArg(raw: string, fallback: string): string {
  const cleaned = (raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned.length > 0 ? cleaned : fallback;
}

export function sanitizeDatasetImageFilename(raw: string): string {
  const trimmed = (raw || '').trim().replace(/[/\\]+/g, '_');
  const extMatch = trimmed.match(/\.(png|jpe?g|webp)$/i);
  const ext = extMatch ? extMatch[0].toLowerCase() : '.png';
  const stem = trimmed
    .replace(/\.(png|jpe?g|webp)$/i, '')
    .replace(/\.{2,}/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^[._]+/, '');
  return `${stem.length > 0 ? stem : `photo_${Date.now()}`}${ext}`;
}

export function buildLoraTrainingArgs(input?: Partial<LoraTrainingConfig>): {
  triggerWord: string;
  outputName: string;
  networkDim: number;
  networkAlpha: number;
  batchSize: number;
  maxSteps: number;
  kohyaDir: string;
  baseModelPath: string;
  outputDir: string;
  prepareArgs: string[];
  trainArgs: string[];
} {
  const triggerWord = sanitizeLoraTrainingArg(input?.triggerWord || '', 'ohwx_model');
  const outputName = sanitizeLoraTrainingArg(input?.outputName || '', 'yourname_lora');
  const vramProfile: LoraTrainingVramProfile =
    input?.vramProfile === 'compact_6gb' ? 'compact_6gb' : 'standard_8gb';
  const isCompact = vramProfile === 'compact_6gb';
  const networkDim = isCompact ? 16 : 32;
  const networkAlpha = isCompact ? 8 : 16;
  const batchSize = isCompact ? 1 : 2;
  const maxSteps = Math.min(5000, Math.max(200, Number(input?.maxSteps) || 1500));

  const kohyaDir = (input?.kohyaDir || 'C:/kohya_ss/sd-scripts').trim() || 'C:/kohya_ss/sd-scripts';
  const baseModelPath =
    (input?.baseModelPath || 'C:/A1111/models/Stable-diffusion/v1-5-pruned-emaonly.safetensors').trim() ||
    'C:/A1111/models/Stable-diffusion/v1-5-pruned-emaonly.safetensors';
  const outputDir = (input?.outputDir || 'C:/A1111/models/Lora').trim() || 'C:/A1111/models/Lora';

  return {
    triggerWord,
    outputName,
    networkDim,
    networkAlpha,
    batchSize,
    maxSteps,
    kohyaDir,
    baseModelPath,
    outputDir,
    prepareArgs: ['-u', 'prepare_lora.py', '--trigger-word', triggerWord],
    trainArgs: [
      '-u',
      'train_lora.py',
      '--kohya-dir',
      kohyaDir,
      '--base-model',
      baseModelPath,
      '--output-dir',
      outputDir,
      '--output-name',
      outputName,
      '--network-dim',
      String(networkDim),
      '--network-alpha',
      String(networkAlpha),
      '--batch-size',
      String(batchSize),
      '--max-steps',
      String(maxSteps),
    ],
  };
}

export interface BatchRenderSceneInput {
  sceneId: string;
  title: string;
  positivePrompt: string;
  negativePrompt: string;
  cfgScale: number;
  steps: number;
  seed?: number;
  width: number;
  height: number;
  samplerName?: string;
  engine: LocalRenderBackend;
  endpointUrl: string;
  comfyPromptGraph?: Record<string, { class_type: string; inputs: Record<string, unknown> }>;
  enableADetailer?: boolean;
  controlImageBase64?: string;
  controlModule?: ControlNetModule;
  controlWeight?: number;
}

export interface BatchUpscaleOptions {
  enabled: boolean;
  multiplier: number;
  gfpganVisibility: number;
  upscalerName: string;
  endpointUrl: string;
}

export interface BatchRenderRequest {
  scenes: BatchRenderSceneInput[];
  upscale: BatchUpscaleOptions;
}

export type BatchProgressStage = 'render' | 'upscale' | 'done' | 'error';
export type BatchJobStatus = 'queued' | 'running' | 'completed' | 'cancelled' | 'error';

export interface BatchCompletedScene {
  sceneId: string;
  title: string;
  imageBase64: string;
  width: number;
  height: number;
  seed?: number;
  kept?: boolean;
}

export interface BatchProgressEvent {
  jobId: string;
  status: BatchJobStatus;
  current: number;
  total: number;
  sceneId?: string;
  sceneTitle: string;
  stage: BatchProgressStage;
  error?: string;
  scenes?: BatchCompletedScene[];
}

export function buildBatchRenderRequest(
  scenes: SceneSpec[],
  config: CompilerConfig,
  options: {
    engine: LocalRenderBackend;
    endpointUrl: string;
    resolutionMode: RenderResolutionMode;
    enableADetailer: boolean;
    controlImageBase64?: string | null;
    controlModule?: ControlNetModule;
    controlWeight?: number;
    upscaleEnabled?: boolean;
    upscaleMultiplier?: number;
    restoreFaces?: boolean;
    gfpganVisibility?: number;
    upscaleEndpointUrl?: string;
  }
): BatchRenderRequest {
  const compiledScenes: BatchRenderSceneInput[] = scenes.map((scene) => {
    const a1111 = buildA1111Txt2ImgPayload(scene, config, options.resolutionMode);
    const hasControlNet = options.engine === 'a1111' && Boolean(options.controlImageBase64);
    const comfyGraph =
      options.engine === 'comfyui'
        ? buildComfyPromptApiGraph(scene, config, options.resolutionMode)
        : undefined;
    const comfySeed = comfyGraph ? Number(comfyGraph['6']?.inputs?.seed) : undefined;

    return {
      sceneId: scene.id,
      title: scene.title,
      positivePrompt: a1111.prompt,
      negativePrompt: a1111.negative_prompt,
      cfgScale: a1111.cfg_scale,
      steps: a1111.steps,
      seed: options.engine === 'comfyui' && Number.isInteger(comfySeed) ? comfySeed : a1111.seed,
      width: a1111.width,
      height: a1111.height,
      samplerName: a1111.sampler_name,
      engine: options.engine,
      endpointUrl: options.endpointUrl,
      ...(options.engine === 'comfyui'
        ? { comfyPromptGraph: comfyGraph }
        : {
            enableADetailer: options.enableADetailer,
            ...(hasControlNet && options.controlImageBase64
              ? {
                  controlImageBase64: options.controlImageBase64,
                  controlModule: options.controlModule || 'openpose',
                  controlWeight: options.controlWeight ?? 0.85,
                }
              : {}),
          }),
    };
  });

  const requestedGfpgan =
    options.restoreFaces === true ? Math.max(0.05, Number(options.gfpganVisibility) || 0.5) : 0;

  return {
    scenes: compiledScenes,
    upscale: {
      enabled: options.upscaleEnabled !== false,
      multiplier: Math.min(4, Math.max(1, Number(options.upscaleMultiplier) || 2)),
      gfpganVisibility: Number(Math.min(1, Math.max(0, requestedGfpgan)).toFixed(2)),
      upscalerName: 'R-ESRGAN 4x+',
      endpointUrl:
        options.upscaleEndpointUrl ||
        (options.engine === 'a1111' ? options.endpointUrl : 'http://127.0.0.1:7860'),
    },
  };
}

export function formatBatchProgressEvent(event: BatchProgressEvent): BatchProgressEvent {
  return {
    jobId: event.jobId,
    status: event.status,
    current: event.current,
    total: event.total,
    ...(event.sceneId ? { sceneId: event.sceneId } : {}),
    sceneTitle: event.sceneTitle,
    stage: event.stage,
    ...(event.error ? { error: event.error } : {}),
    ...(event.scenes ? { scenes: event.scenes } : {}),
  };
}

export function filterKeptScenes<T extends { kept?: boolean }>(scenes: T[]): T[] {
  return scenes.filter((scene) => scene.kept !== false);
}

export interface SceneCaptionInput {
  title: string;
  lighting: string;
  lens: string;
  wardrobe: string;
}

export function buildSceneCaption({
  title,
  lighting,
  lens,
  wardrobe,
}: SceneCaptionInput): string {
  const clean = (val: string) =>
    (val || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/, '');
  const t = clean(title) || 'Untitled Scene';
  const l = clean(lighting);
  const cam = clean(lens);
  const w = clean(wardrobe);

  const opticsPart = [l, cam].filter(Boolean).join(', ');
  const parts = [t, opticsPart, w].filter(Boolean);
  const raw = `${parts.join('. ')}.`.replace(/\s+/g, ' ').trim();
  if (raw.length <= 300) {
    return raw;
  }
  return `${raw.slice(0, 297).trimEnd()}...`;
}

export type PreflightCheckId = 'a1111' | 'lora' | 'upscaler' | 'comfy' | 'ig';

export interface PreflightCheckResult {
  id: PreflightCheckId;
  ok: boolean;
  skipped?: boolean;
  detail: string;
}

export function buildPreflightQuery(params: {
  a1111?: string;
  comfy?: string;
  ig?: string;
  loraName?: string;
}): string {
  const search = new URLSearchParams();
  if (params.a1111 !== undefined) search.set('a1111', params.a1111);
  if (params.comfy !== undefined) search.set('comfy', params.comfy);
  if (params.ig !== undefined) search.set('ig', params.ig);
  if (params.loraName !== undefined) search.set('loraName', params.loraName);
  return search.toString();
}

export async function runPreflightCheckWithTimeout(
  id: PreflightCheckId,
  probe: (signal: AbortSignal) => Promise<{ ok: boolean; skipped?: boolean; detail: string }>,
  timeoutMs = 2500,
  timeoutDetail = 'Connection timed out or service unreachable.'
): Promise<PreflightCheckResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('PREFLIGHT_TIMEOUT'));
      }, timeoutMs);
    });

    const result = await Promise.race([probe(controller.signal), timeoutPromise]);
    return {
      id,
      ok: Boolean(result.ok),
      ...(result.skipped ? { skipped: true } : {}),
      detail: result.detail,
    };
  } catch (err) {
    const isTimeout =
      err instanceof Error &&
      (err.message === 'PREFLIGHT_TIMEOUT' ||
        err.name === 'AbortError' ||
        err.name === 'TimeoutError');
    return {
      id,
      ok: false,
      detail: isTimeout ? timeoutDetail : timeoutDetail,
    };
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
