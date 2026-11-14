import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESET_SETS } from '../data/presetSets';
import { CompilerConfig } from '../types/photoshoot';
import {
  assessCfgScale,
  buildComfyWorkflowJson,
  checkLightingConsistency,
  compileNegativePrompt,
  compilePositivePrompt,
  formatLoraTag,
  formatSceneMarkdown,
} from './promptCompiler';
import {
  buildA1111Txt2ImgPayload,
  buildADetailerConfig,
  buildBatchRenderRequest,
  buildComfyPromptApiGraph,
  buildControlNetConfig,
  buildLoraTrainingArgs,
  buildPreflightQuery,
  buildSceneCaption,
  buildUpscalePayload,
  filterKeptScenes,
  formatBatchProgressEvent,
  formatBatchUpscaledFilename,
  getRenderDimensions,
  runPreflightCheckWithTimeout,
  sanitizeDatasetImageFilename,
  sanitizeExportFilename,
  sanitizeLoraTrainingArg,
  stripDataUrlPrefix,
  validateEndpointUrl,
  validateUpscaleImageInput,
} from './renderPayload';
import {
  buildZipArchive,
  computeCrc32,
  decodeBase64ToUint8Array,
  sanitizeZipEntryFilename,
} from './zipBuilder';

const baseConfig: CompilerConfig = {
  engine: 'sd',
  loraEnabled: true,
  loraName: 'yourname',
  loraWeight: 0.8,
  cfgScale: 7.5,
  steps: 30,
  aspectRatio: '3:4',
  sampler: 'dpmpp_2m',
};

test('formatLoraTag sanitizes name and formats weight cleanly', () => {
  assert.equal(formatLoraTag('maya_v2', 0.8), '<lora:maya_v2:0.8>');
  assert.equal(formatLoraTag('  ', 0.85), '<lora:yourname:0.85>');
  assert.equal(formatLoraTag('test lora!', 2.5), '<lora:test_lora_:1.5>');
});

test('compilePositivePrompt includes LoRA tag in SD mode and omits when disabled', () => {
  const scene = PRESET_SETS[0].scenes[0];
  const withLora = compilePositivePrompt(scene, baseConfig);
  assert.ok(withLora.startsWith('<lora:yourname:0.8>, '));
  assert.ok(withLora.includes('black lace bralette'));

  const withoutLora = compilePositivePrompt(scene, { ...baseConfig, loraEnabled: false });
  assert.ok(!withoutLora.includes('<lora:'));
});

test('compilePositivePrompt formats Midjourney --style raw, --ar, and --no flags', () => {
  const scene = PRESET_SETS[0].scenes[1];
  const mjPrompt = compilePositivePrompt(scene, { ...baseConfig, engine: 'midjourney' });
  assert.ok(mjPrompt.includes('--ar 3:4 --style raw'));
  assert.ok(mjPrompt.includes('--no'));
  assert.ok(!mjPrompt.includes('<lora:'));
});

test('compileNegativePrompt formats cleanly across engines', () => {
  const scene = PRESET_SETS[0].scenes[2];
  const sdNeg = compileNegativePrompt(scene, baseConfig);
  assert.ok(sdNeg.startsWith('(worst quality, low quality:1.4)'));

  const mjNeg = compileNegativePrompt(scene, { ...baseConfig, engine: 'midjourney' });
  assert.ok(mjNeg.startsWith('--no '));
  assert.ok(!mjNeg.includes('1.4'));
});

test('assessCfgScale enforces 7-9 recommended window and flags extremes', () => {
  assert.equal(assessCfgScale(4.0, 'sd').status, 'low');
  assert.equal(assessCfgScale(7.5, 'sd').status, 'optimal');
  assert.equal(assessCfgScale(9.0, 'sd').status, 'optimal');
  assert.equal(assessCfgScale(11.5, 'sd').status, 'high');
  assert.equal(assessCfgScale(12, 'midjourney').status, 'optimal');
});

test('checkLightingConsistency detects modified lighting vs baseline motif', () => {
  const scene = PRESET_SETS[0].scenes[0];
  assert.equal(checkLightingConsistency(scene).isMatched, true);

  const swapped = { ...scene, lightingId: 'harsh-midday-sun' as const };
  assert.equal(checkLightingConsistency(swapped).isMatched, false);
});

test('buildComfyWorkflowJson produces valid JSON with LoRA, CFG, and dimensions', () => {
  const scene = PRESET_SETS[0].scenes[0];
  const rawJson = buildComfyWorkflowJson(scene, {
    ...baseConfig,
    engine: 'comfyui',
    loraName: 'studio_subject',
    loraWeight: 0.75,
    cfgScale: 8.0,
    aspectRatio: '4:3',
  });
  const parsed = JSON.parse(rawJson);
  assert.equal(parsed.nodes.length, 7);
  assert.equal(parsed.nodes[1].widgets_values[0], 'studio_subject.safetensors');
  assert.equal(parsed.nodes[1].widgets_values[1], 0.75);
  assert.equal(parsed.nodes[4].widgets_values[0], 1152);
  assert.equal(parsed.nodes[4].widgets_values[1], 896);
  assert.equal(parsed.nodes[5].widgets_values[3], 8.0);
});

test('formatSceneMarkdown outputs complete director sheet markdown', () => {
  const set = PRESET_SETS[0];
  const scene = set.scenes[0];
  const md = formatSceneMarkdown(scene, set, baseConfig);
  assert.ok(md.includes('# Boudoir & Mirror Selfie — Scene 01: Soft Light Bedroom'));
  assert.ok(md.includes('## Positive Prompt'));
  assert.ok(md.includes('## Negative Prompt'));
});

test('buildA1111Txt2ImgPayload builds SD payload with fast 4:5 dimensions and DPM++ 2M Karras', () => {
  const scene = PRESET_SETS[0].scenes[0];
  const payload = buildA1111Txt2ImgPayload(scene, baseConfig, 'fast');
  assert.ok(payload.prompt.startsWith('<lora:yourname:0.8>, '));
  assert.equal(payload.cfg_scale, 7.5);
  assert.equal(payload.steps, 30);
  assert.equal(payload.width, 512);
  assert.equal(payload.height, 640);
  assert.equal(payload.sampler_name, 'DPM++ 2M Karras');
  assert.equal(payload.batch_size, 1);
});

test('buildComfyPromptApiGraph injects prompt text, LoRA weight, and latent dimensions into nodes', () => {
  const scene = PRESET_SETS[0].scenes[1];
  const graph = buildComfyPromptApiGraph(scene, { ...baseConfig, loraName: 'maya_v2', loraWeight: 0.85 }, 'native');
  assert.equal(graph['2'].inputs.lora_name, 'maya_v2.safetensors');
  assert.equal(graph['2'].inputs.strength_model, 0.85);
  assert.ok(String(graph['3'].inputs.text).includes('tan seamless bodysuit'));
  assert.equal(graph['5'].inputs.width, 896);
  assert.equal(graph['5'].inputs.height, 1152);
  assert.equal(graph['6'].inputs.cfg, 7.5);
});

test('validateEndpointUrl accepts http/https URLs and rejects invalid protocols', () => {
  assert.equal(validateEndpointUrl('http://127.0.0.1:7860/', 'http://127.0.0.1:7860'), 'http://127.0.0.1:7860');
  assert.equal(validateEndpointUrl('https://render.example.com', 'http://127.0.0.1:7860'), 'https://render.example.com');
  assert.equal(validateEndpointUrl('ftp://127.0.0.1:7860', 'http://127.0.0.1:7860'), null);
  assert.equal(validateEndpointUrl('not a url', 'http://127.0.0.1:7860'), null);
  assert.deepEqual(getRenderDimensions('4:3', 'fast'), { width: 640, height: 512 });
});

test('buildUpscalePayload strips data URL prefix and configures R-ESRGAN 4x+ with GFPGAN', () => {
  const raw = stripDataUrlPrefix('data:image/png;base64,ABC123==');
  assert.equal(raw, 'ABC123==');

  const payload = buildUpscalePayload('data:image/png;base64,XYZ789==', 2, 0.7);
  assert.equal(payload.image, 'XYZ789==');
  assert.equal(payload.upscaling_resize, 2);
  assert.equal(payload.upscaler_1, 'R-ESRGAN 4x+');
  assert.equal(payload.gfpgan_visibility, 0.7);
  assert.equal(payload.codeformer_visibility, 0);
});

test('formatBatchUpscaledFilename pads index and sanitizes scene titles', () => {
  assert.equal(formatBatchUpscaledFilename(0, 'Soft Light Bedroom'), '01_soft_light_bedroom_upscaled.png');
  assert.equal(formatBatchUpscaledFilename(2, 'Pavement / Low-Angle!'), '03_pavement_low_angle_upscaled.png');
});

test('buildADetailerConfig configures face and hand YOLOv8 models when enabled', () => {
  assert.equal(buildADetailerConfig(false), undefined);
  const cfg = buildADetailerConfig(true);
  assert.ok(cfg);
  assert.equal(cfg.args[0], true);
  assert.equal((cfg.args[2] as { ad_model: string }).ad_model, 'face_yolov8n.pt');
  assert.equal((cfg.args[3] as { ad_model: string }).ad_model, 'hand_yolov8n.pt');
});

test('buildControlNetConfig strips data URL prefix and sets OpenPose model and weight', () => {
  const cn = buildControlNetConfig('data:image/jpeg;base64,POSEDATA==', 'openpose', 0.85);
  assert.ok(cn);
  assert.equal(cn.args[0].input_image, 'POSEDATA==');
  assert.equal(cn.args[0].module, 'openpose');
  assert.equal(cn.args[0].model, 'control_v11p_sd15_openpose [cab727d4]');
  assert.equal(cn.args[0].weight, 0.85);
});

test('sanitizeExportFilename prevents path traversal and ensures .png extension', () => {
  const traversed = sanitizeExportFilename('../../evil/path');
  assert.equal(traversed, 'evil_path.png');
  assert.ok(!traversed.includes('..') && !traversed.includes('/'));
  assert.equal(sanitizeExportFilename('soft_bedroom_01'), 'soft_bedroom_01.png');
  assert.equal(sanitizeExportFilename('render.png'), 'render.png');
});

test('sanitizeLoraTrainingArg and sanitizeDatasetImageFilename strip unsafe characters', () => {
  assert.equal(sanitizeLoraTrainingArg('valerie style; rm -rf /', 'ohwx_model'), 'valerie_style_rm_-rf');
  assert.equal(sanitizeLoraTrainingArg('   ', 'ohwx_model'), 'ohwx_model');
  assert.equal(sanitizeDatasetImageFilename('../raw/IMG 01.JPG'), 'raw_IMG_01.jpg');
  assert.equal(sanitizeDatasetImageFilename('mirror_shot.webp'), 'mirror_shot.webp');
});

test('buildLoraTrainingArgs sets 8GB standard and 6GB compact VRAM profiles cleanly', () => {
  const std = buildLoraTrainingArgs({
    triggerWord: 'maya_face',
    outputName: 'maya_v1',
    vramProfile: 'standard_8gb',
    maxSteps: 1500,
  });
  assert.equal(std.networkDim, 32);
  assert.equal(std.networkAlpha, 16);
  assert.equal(std.batchSize, 2);
  assert.ok(std.prepareArgs.includes('maya_face'));
  assert.ok(std.trainArgs.includes('maya_v1'));

  const compact = buildLoraTrainingArgs({
    vramProfile: 'compact_6gb',
    maxSteps: 99999,
  });
  assert.equal(compact.networkDim, 16);
  assert.equal(compact.networkAlpha, 8);
  assert.equal(compact.batchSize, 1);
  assert.equal(compact.maxSteps, 5000);
});

function makeTestPngBase64(width: number, height: number): string {
  const bytes = new Uint8Array(32);
  // PNG magic
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  // IHDR chunk length (13) + 'IHDR'
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13, false);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return Buffer.from(bytes).toString('base64');
}

function makeTestJpegBase64(width: number, height: number): string {
  // Minimal SOI + APP0 + SOF0 header bytes
  const bytes = new Uint8Array(24);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  bytes[3] = 0xe0;
  bytes[4] = 0x00;
  bytes[5] = 0x04;
  bytes[6] = 0x4a;
  bytes[7] = 0x46;
  // SOF0 marker
  bytes[8] = 0xff;
  bytes[9] = 0xc0;
  bytes[10] = 0x00;
  bytes[11] = 0x0b;
  bytes[12] = 0x08;
  bytes[13] = (height >> 8) & 0xff;
  bytes[14] = height & 0xff;
  bytes[15] = (width >> 8) & 0xff;
  bytes[16] = width & 0xff;
  return Buffer.from(bytes).toString('base64');
}

test('buildUpscalePayload defaults gfpgan_visibility to 0 unless explicitly requested', () => {
  const defaultPayload = buildUpscalePayload('data:image/png;base64,ABC123==', 2);
  assert.equal(defaultPayload.upscaler_1, 'R-ESRGAN 4x+');
  assert.equal(defaultPayload.extras_upscaler_2_visibility, 0);
  assert.equal(defaultPayload.gfpgan_visibility, 0);
});

test('validateUpscaleImageInput validates PNG/JPEG magic bytes, dimensions <= 2048, and base64 cap', () => {
  const validPng = validateUpscaleImageInput(`data:image/png;base64,${makeTestPngBase64(512, 640)}`);
  assert.equal(validPng.valid, true);
  if (validPng.valid) {
    assert.equal(validPng.format, 'png');
    assert.equal(validPng.width, 512);
    assert.equal(validPng.height, 640);
  }

  const validJpg = validateUpscaleImageInput(makeTestJpegBase64(1024, 1536));
  assert.equal(validJpg.valid, true);
  if (validJpg.valid) {
    assert.equal(validJpg.format, 'jpeg');
    assert.equal(validJpg.width, 1024);
    assert.equal(validJpg.height, 1536);
  }

  const badMagic = validateUpscaleImageInput(Buffer.from('NOT_AN_IMAGE_PAYLOAD_12345').toString('base64'));
  assert.equal(badMagic.valid, false);
  if (!badMagic.valid) {
    assert.equal(badMagic.status, 400);
  }

  const tooWidePng = validateUpscaleImageInput(makeTestPngBase64(2560, 1440));
  assert.equal(tooWidePng.valid, false);
  if (!tooWidePng.valid) {
    assert.equal(tooWidePng.status, 400);
  }

  const tooBigB64 = validateUpscaleImageInput(makeTestPngBase64(512, 640), 2048, 20);
  assert.equal(tooBigB64.valid, false);
  if (!tooBigB64.valid) {
    assert.equal(tooBigB64.status, 413);
  }
});

test('buildBatchRenderRequest and formatBatchProgressEvent construct sequential queue payloads and SSE frames', () => {
  const scenes = PRESET_SETS[0].scenes;
  const reqDefault = buildBatchRenderRequest(scenes, baseConfig, {
    engine: 'a1111',
    endpointUrl: 'http://127.0.0.1:7860',
    resolutionMode: 'fast',
    enableADetailer: true,
    upscaleMultiplier: 2,
  });

  assert.equal(reqDefault.scenes.length, 3);
  assert.equal(reqDefault.scenes[0].width, 512);
  assert.equal(reqDefault.scenes[0].height, 640);
  assert.equal(reqDefault.scenes[0].enableADetailer, true);
  assert.equal(reqDefault.upscale.enabled, true);
  assert.equal(reqDefault.upscale.multiplier, 2);
  assert.equal(reqDefault.upscale.gfpganVisibility, 0);

  const reqWithFace = buildBatchRenderRequest(scenes, baseConfig, {
    engine: 'a1111',
    endpointUrl: 'http://127.0.0.1:7860',
    resolutionMode: 'fast',
    enableADetailer: false,
    restoreFaces: true,
    gfpganVisibility: 0.6,
  });
  assert.equal(reqWithFace.upscale.gfpganVisibility, 0.6);

  const sseEvent = formatBatchProgressEvent({
    jobId: 'job-123',
    status: 'running',
    current: 2,
    total: 3,
    sceneId: scenes[1].id,
    sceneTitle: scenes[1].title,
    stage: 'upscale',
  });
  assert.equal(sseEvent.jobId, 'job-123');
  assert.equal(sseEvent.current, 2);
  assert.equal(sseEvent.total, 3);
  assert.equal(sseEvent.stage, 'upscale');
  assert.equal(sseEvent.sceneTitle, scenes[1].title);
});

test('buildZipArchive produces valid PKZIP headers, CRC-32, and deduplicated filenames', () => {
  const pngA = decodeBase64ToUint8Array(makeTestPngBase64(512, 640));
  const pngB = decodeBase64ToUint8Array(makeTestPngBase64(640, 512));

  assert.equal(sanitizeZipEntryFilename('../evil/scene 01'), 'evil_scene_01.png');

  const zipBytes = buildZipArchive([
    { filename: '01_soft_light_bedroom_upscaled.png', data: pngA },
    { filename: '01_soft_light_bedroom_upscaled.png', data: pngB },
  ]);

  const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  // Local file header signature PK\x03\x04
  assert.equal(view.getUint32(0, true), 0x04034b50);
  // EOCD signature PK\x05\x06 at tail (22 bytes)
  assert.equal(view.getUint32(zipBytes.length - 22, true), 0x06054b50);
  // Total entries in EOCD = 2
  assert.equal(view.getUint16(zipBytes.length - 12, true), 2);

  const text = new TextDecoder().decode(zipBytes);
  assert.ok(text.includes('01_soft_light_bedroom_upscaled.png'));
  assert.ok(text.includes('01_soft_light_bedroom_upscaled_2.png'));
  assert.equal(computeCrc32(pngA), view.getUint32(14, true));
});

test('buildA1111Txt2ImgPayload and buildComfyPromptApiGraph include seed and preserve -1 on A1111', () => {
  const scene = PRESET_SETS[0].scenes[0];

  const lockedA1111 = buildA1111Txt2ImgPayload(scene, { ...baseConfig, seed: 42 }, 'fast');
  assert.equal(lockedA1111.seed, 42);

  const randomA1111 = buildA1111Txt2ImgPayload(scene, { ...baseConfig, seed: -1 }, 'fast');
  assert.equal(randomA1111.seed, -1);

  const lockedComfy = buildComfyPromptApiGraph(scene, { ...baseConfig, seed: 42 }, 'native');
  assert.equal(lockedComfy['6'].inputs.seed, 42);

  const randomComfy = buildComfyPromptApiGraph(scene, { ...baseConfig, seed: -1 }, 'native');
  const comfySeed = Number(randomComfy['6'].inputs.seed);
  assert.equal(Number.isInteger(comfySeed) && comfySeed >= 0, true);
});

test('formatBatchUpscaledFilename keeps legacy naming without seed and appends _s{seed} for valid integer seeds', () => {
  assert.equal(
    formatBatchUpscaledFilename(0, 'Soft Light Bedroom'),
    '01_soft_light_bedroom_upscaled.png'
  );
  assert.equal(
    formatBatchUpscaledFilename(0, 'Soft Light Bedroom', -1),
    '01_soft_light_bedroom_upscaled.png'
  );
  assert.equal(
    formatBatchUpscaledFilename(0, 'Soft Light Bedroom', 42),
    '01_soft_light_bedroom_upscaled_s42.png'
  );
  assert.equal(
    formatBatchUpscaledFilename(2, 'Mirror Check', 0),
    '03_mirror_check_upscaled_s0.png'
  );
});

test('filterKeptScenes drops killed tiles while preserving order of kept tiles', () => {
  const items = [
    { sceneId: 'scene-01', title: 'First', kept: true },
    { sceneId: 'scene-02', title: 'Second', kept: false },
    { sceneId: 'scene-03', title: 'Third' },
  ];
  const kept = filterKeptScenes(items);
  assert.deepEqual(
    kept.map((item) => item.sceneId),
    ['scene-01', 'scene-03']
  );
  assert.deepEqual(filterKeptScenes([{ sceneId: 'only', kept: false }]), []);
});

test('buildSceneCaption produces deterministic editorial caption clamped to 300 characters', () => {
  const shortCaption = buildSceneCaption({
    title: 'Soft Light Bedroom',
    lighting: 'Warm north window wrap',
    lens: '85mm f/1.8',
    wardrobe: 'Black lace bralette',
  });
  assert.equal(
    shortCaption,
    'Soft Light Bedroom. Warm north window wrap, 85mm f/1.8. Black lace bralette.'
  );
  assert.ok(shortCaption.length <= 300);

  const longCaption = buildSceneCaption({
    title: 'Editorial Portrait Study',
    lighting: 'Soft directional window illumination with natural bounce fill',
    lens: 'Leica Summilux 50mm f/1.4 ASPH on Kodak Portra 400',
    wardrobe:
      'Tailored charcoal wool blazer over ribbed ivory silk camisole with subtle brushed gold jewelry, vintage leather belt, relaxed pleated trousers, and minimalist studio styling repeated '.repeat(
        2
      ),
  });
  assert.ok(longCaption.length <= 300);
  assert.ok(longCaption.endsWith('...'));
});

test('runPreflightCheckWithTimeout resolves to ok:false on timeout or error without throwing', async () => {
  const query = buildPreflightQuery({
    a1111: 'http://127.0.0.1:7860',
    loraName: 'maya_v2',
  });
  assert.ok(query.includes('a1111=http'));
  assert.ok(query.includes('loraName=maya_v2'));

  const timedOut = await runPreflightCheckWithTimeout(
    'a1111',
    (signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }),
    25,
    'A1111 unreachable.'
  );
  assert.equal(timedOut.id, 'a1111');
  assert.equal(timedOut.ok, false);
  assert.equal(timedOut.detail, 'A1111 unreachable.');

  const rejected = await runPreflightCheckWithTimeout(
    'ig',
    async () => {
      throw new Error('ECONNREFUSED');
    },
    100,
    'IG poster unreachable.'
  );
  assert.equal(rejected.id, 'ig');
  assert.equal(rejected.ok, false);
  assert.equal(rejected.detail, 'IG poster unreachable.');
});

