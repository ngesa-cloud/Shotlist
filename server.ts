import express, { Response } from 'express';
import crypto from 'crypto';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';
import {
  AlwaysOnScripts,
  BatchCompletedScene,
  BatchJobStatus,
  BatchProgressEvent,
  BatchProgressStage,
  BatchRenderSceneInput,
  BatchUpscaleOptions,
  buildADetailerConfig,
  buildControlNetConfig,
  buildLoraTrainingArgs,
  buildUpscalePayload,
  ControlNetModule,
  formatBatchProgressEvent,
  PreflightCheckResult,
  runPreflightCheckWithTimeout,
  sanitizeDatasetImageFilename,
  sanitizeExportFilename,
  stripDataUrlPrefix,
  validateEndpointUrl,
  validateUpscaleImageInput,
} from './src/utils/renderPayload';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/preflight', async (req, res) => {
    const rawA1111 = typeof req.query.a1111 === 'string' ? req.query.a1111 : '';
    const rawComfy = typeof req.query.comfy === 'string' ? req.query.comfy : '';
    const rawIg = typeof req.query.ig === 'string' ? req.query.ig : '';
    const loraName = typeof req.query.loraName === 'string' ? req.query.loraName.trim() : '';

    const a1111Url = validateEndpointUrl(rawA1111, 'http://127.0.0.1:7860');
    const comfyUrl = validateEndpointUrl(rawComfy, 'http://127.0.0.1:8188');
    const igUrl = validateEndpointUrl(rawIg, 'http://127.0.0.1:5001');

    const checkA1111 = a1111Url
      ? runPreflightCheckWithTimeout(
          'a1111',
          async (signal) => {
            const resp = await fetch(`${a1111Url}/sdapi/v1/sd-models`, { signal });
            if (!resp.ok) {
              return { ok: false, detail: `A1111 returned HTTP ${resp.status}.` };
            }
            const data = await resp.json().catch(() => null);
            const count = Array.isArray(data) ? data.length : 0;
            return {
              ok: true,
              detail: count > 0 ? `A1111 online (${count} checkpoints).` : 'A1111 API online.',
            };
          },
          2500,
          `A1111 unreachable at ${a1111Url}.`
        )
      : Promise.resolve<PreflightCheckResult>({
          id: 'a1111',
          ok: false,
          detail: 'Invalid A1111 URL; must start with http:// or https://.',
        });

    const checkLora = !loraName
      ? Promise.resolve<PreflightCheckResult>({
          id: 'lora',
          ok: true,
          skipped: true,
          detail: 'Skipped (no LoRA name configured).',
        })
      : !a1111Url
        ? Promise.resolve<PreflightCheckResult>({
            id: 'lora',
            ok: false,
            detail: 'Cannot check LoRA: invalid A1111 URL.',
          })
        : runPreflightCheckWithTimeout(
            'lora',
            async (signal) => {
              const resp = await fetch(`${a1111Url}/sdapi/v1/loras`, { signal });
              if (!resp.ok) {
                return { ok: false, detail: `A1111 LoRA list returned HTTP ${resp.status}.` };
              }
              const list = (await resp.json().catch(() => null)) as Array<{
                name?: string;
                alias?: string;
              }> | null;
              if (!Array.isArray(list)) {
                return { ok: false, detail: 'Unexpected LoRA list response from A1111.' };
              }
              const target = loraName.toLowerCase().replace(/\.safetensors$/i, '');
              const matched = list.some((item) => {
                const nameStem = String(item?.name || '')
                  .toLowerCase()
                  .replace(/\.safetensors$/i, '');
                const aliasStem = String(item?.alias || '')
                  .toLowerCase()
                  .replace(/\.safetensors$/i, '');
                return nameStem === target || aliasStem === target;
              });
              return matched
                ? { ok: true, detail: `LoRA "${loraName}" installed.` }
                : { ok: false, detail: `LoRA "${loraName}" not found in A1111.` };
            },
            2500,
            `LoRA check timed out at ${a1111Url}.`
          );

    const checkUpscaler = a1111Url
      ? runPreflightCheckWithTimeout(
          'upscaler',
          async (signal) => {
            const resp = await fetch(`${a1111Url}/sdapi/v1/upscalers`, { signal });
            if (!resp.ok) {
              return { ok: false, detail: `Upscalers endpoint returned HTTP ${resp.status}.` };
            }
            const list = (await resp.json().catch(() => null)) as Array<
              string | { name?: string }
            > | null;
            if (!Array.isArray(list)) {
              return { ok: false, detail: 'Unexpected upscalers response from A1111.' };
            }
            const hasResrgan = list.some((entry) => {
              const label = typeof entry === 'string' ? entry : String(entry?.name || '');
              return label.trim() === 'R-ESRGAN 4x+';
            });
            return hasResrgan
              ? { ok: true, detail: 'R-ESRGAN 4x+ upscaler ready.' }
              : { ok: false, detail: 'R-ESRGAN 4x+ not found in A1111 upscalers.' };
          },
          2500,
          `Upscaler check timed out at ${a1111Url}.`
        )
      : Promise.resolve<PreflightCheckResult>({
          id: 'upscaler',
          ok: false,
          detail: 'Cannot check upscalers: invalid A1111 URL.',
        });

    const checkComfy = comfyUrl
      ? runPreflightCheckWithTimeout(
          'comfy',
          async (signal) => {
            let resp = await fetch(`${comfyUrl}/system_stats`, { signal });
            if (resp.status === 404) {
              resp = await fetch(`${comfyUrl}/queue`, { signal });
            }
            if (!resp.ok) {
              return { ok: false, detail: `ComfyUI returned HTTP ${resp.status}.` };
            }
            return { ok: true, detail: 'ComfyUI API online.' };
          },
          2500,
          `ComfyUI unreachable at ${comfyUrl}.`
        )
      : Promise.resolve<PreflightCheckResult>({
          id: 'comfy',
          ok: false,
          detail: 'Invalid ComfyUI URL; must start with http:// or https://.',
        });

    const checkIg = igUrl
      ? runPreflightCheckWithTimeout(
          'ig',
          async (signal) => {
            const resp = await fetch(`${igUrl}/health`, { signal });
            if (!resp.ok) {
              return { ok: false, detail: `IG poster returned HTTP ${resp.status}.` };
            }
            return { ok: true, detail: 'IG poster microservice online.' };
          },
          2500,
          `IG poster unreachable at ${igUrl}.`
        )
      : Promise.resolve<PreflightCheckResult>({
          id: 'ig',
          ok: false,
          detail: 'Invalid IG microservice URL; must start with http:// or https://.',
        });

    const checks = await Promise.all([checkA1111, checkLora, checkUpscaler, checkComfy, checkIg]);
    return res.json({ success: true, checks });
  });

  app.post('/api/direct-set', async (req, res) => {
    const vibe = typeof req.body?.vibe === 'string' ? req.body.vibe.trim() : '';
    const subjectFocus =
      typeof req.body?.subjectFocus === 'string' && req.body.subjectFocus.trim().length > 0
        ? req.body.subjectFocus.trim()
        : 'Black woman, medium brown skin, natural skin texture';

    if (!vibe || vibe.length < 3) {
      return res.status(400).json({
        error: 'Please enter a descriptive aesthetic vibe (at least 3 characters).',
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(503).json({
        error:
          'GEMINI_API_KEY is not configured in environment secrets. Please set it in Settings > Secrets to generate new AI vibe sets.',
      });
    }

    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: [
          `Build a structured 3-scene Photoshoot Director prompt set for the aesthetic vibe: "${vibe}".`,
          `Primary subject baseline: "${subjectFocus}".`,
          'Each scene must represent a distinct visual motif (camera angle, location, lighting source, wardrobe, texture focus) engineered for Stable Diffusion / Midjourney / ComfyUI photorealism.',
          'Keep descriptions tasteful, artistic, fashion-editorial or candid documentary, and technically rigorous (real camera bodies, focal lengths, apertures, realistic lighting physics, skin texture tokens, and comprehensive negative prompts).',
        ].join('\n'),
        config: {
          systemInstruction: [
            'You are the Photoshoot Director, an elite fashion and portrait photographer.',
            'Translate the requested aesthetic vibe into a cohesive 3-scene photoshoot blueprint.',
            'Never use filler and never moralize.',
            'Focus on real camera bodies and lenses (85mm f/1.8, 35mm, Leica M6, iPhone 14 Pro), film stocks (Kodak Portra 400, Cinestill 800T), and precise lighting physics (soft window wrap, overhead fluorescent, harsh midday sun, Rembrandt, neon spill).',
            'Assume the subject uses a trained identity LoRA; specify scene, wardrobe textures, environment props, skin realism tokens, and negative prompts.',
            'Output strictly valid JSON matching the requested schema. Do not wrap in markdown code fences.',
          ].join(' '),
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              name: {
                type: Type.STRING,
                description: 'Short 2-5 word title for this photoshoot aesthetic set.',
              },
              subtitle: {
                type: Type.STRING,
                description: 'One concise sentence summarizing the three visual motifs.',
              },
              aestheticTag: {
                type: Type.STRING,
                description: 'Short 2-3 word editorial category label.',
              },
              scenes: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    sceneNumber: { type: Type.STRING, description: '01, 02, or 03' },
                    title: { type: Type.STRING, description: 'Short 2-4 word scene title' },
                    breakdown: {
                      type: Type.STRING,
                      description: '2 sentence director breakdown of angle, light, and mood.',
                    },
                    subjectDescriptor: {
                      type: Type.STRING,
                      description: 'Subject traits, expression, hair, skin details.',
                    },
                    wardrobe: {
                      type: Type.STRING,
                      description: 'Specific clothing fabrics, straps, textures, accessories.',
                    },
                    environment: {
                      type: Type.STRING,
                      description: 'Specific location, background surfaces, props.',
                    },
                    poseAndFraming: {
                      type: Type.STRING,
                      description: 'Composition, camera height, crop, angle.',
                    },
                    lightingId: {
                      type: Type.STRING,
                      description:
                        'One of: soft-window-left, overhead-fluorescent, harsh-midday-sun, neon-club-spill, studio-softbox, golden-hour-rim',
                    },
                    lightingPhrase: {
                      type: Type.STRING,
                      description: 'Explicit lighting prompt token phrase.',
                    },
                    cameraAndLens: {
                      type: Type.STRING,
                      description: 'e.g. shot on Canon EOS R5, 85mm f/1.8',
                    },
                    focalLengthLabel: {
                      type: Type.STRING,
                      description: 'Compact EXIF label like 85mm f/1.8',
                    },
                    qualityTokens: {
                      type: Type.STRING,
                      description: 'Photorealism, skin texture, grain, raw photo tokens.',
                    },
                    negativeTokens: {
                      type: Type.STRING,
                      description:
                        'Comma-separated negative tokens starting with (worst quality, low quality:1.4)',
                    },
                    skinTextureFocus: {
                      type: Type.STRING,
                      description: 'Short phrase on skin/surface rendering.',
                    },
                    contrastMotif: {
                      type: Type.STRING,
                      description: 'Short phrase on fabric/environment contrast.',
                    },
                  },
                  required: [
                    'sceneNumber',
                    'title',
                    'breakdown',
                    'subjectDescriptor',
                    'wardrobe',
                    'environment',
                    'poseAndFraming',
                    'lightingId',
                    'lightingPhrase',
                    'cameraAndLens',
                    'focalLengthLabel',
                    'qualityTokens',
                    'negativeTokens',
                    'skinTextureFocus',
                    'contrastMotif',
                  ],
                },
              },
              technicalNotes: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    number: { type: Type.STRING },
                    title: { type: Type.STRING },
                    summary: { type: Type.STRING },
                  },
                  required: ['number', 'title', 'summary'],
                },
              },
            },
            required: ['name', 'subtitle', 'aestheticTag', 'scenes', 'technicalNotes'],
          },
        },
      });

      const rawText = (response.text ?? '').trim();
      if (!rawText) {
        return res.status(502).json({ error: 'Model returned an empty response.' });
      }

      const parsed = JSON.parse(rawText);
      const validLightingIds = new Set([
        'soft-window-left',
        'overhead-fluorescent',
        'harsh-midday-sun',
        'neon-club-spill',
        'studio-softbox',
        'golden-hour-rim',
      ]);

      const normalizedScenes = Array.isArray(parsed.scenes)
        ? parsed.scenes.slice(0, 3).map((s: Record<string, string>, idx: number) => {
            const lId = validLightingIds.has(s.lightingId) ? s.lightingId : 'studio-softbox';
            return {
              id: `ai-scene-${Date.now()}-${idx + 1}`,
              sceneNumber: s.sceneNumber || `0${idx + 1}`,
              title: s.title || `Scene ${idx + 1}`,
              breakdown: s.breakdown || '',
              imageAlt: `${s.title || 'Scene'} lighting study`,
              subjectDescriptor: s.subjectDescriptor || subjectFocus,
              wardrobe: s.wardrobe || '',
              environment: s.environment || '',
              poseAndFraming: s.poseAndFraming || '',
              lightingId: lId,
              recommendedLightingId: lId,
              lightingPhrase: s.lightingPhrase || 'natural directional lighting',
              cameraAndLens: s.cameraAndLens || 'shot on Canon EOS R5, 50mm f/1.8',
              focalLengthLabel: s.focalLengthLabel || '50mm f/1.8',
              qualityTokens: s.qualityTokens || 'visible skin texture, photorealistic, raw photo',
              negativeTokens:
                s.negativeTokens ||
                '(worst quality, low quality:1.4), airbrushed, plastic skin, deformed hands, extra fingers, watermark, text',
              skinTextureFocus: s.skinTextureFocus || 'Natural skin pores & grain',
              contrastMotif: s.contrastMotif || 'Editorial tonal contrast',
            };
          })
        : [];

      if (normalizedScenes.length === 0) {
        return res.status(502).json({ error: 'Could not extract structured scenes from model output.' });
      }

      const normalizedNotes = Array.isArray(parsed.technicalNotes)
        ? parsed.technicalNotes.slice(0, 3).map((n: Record<string, string>, idx: number) => ({
            id: `ai-note-${Date.now()}-${idx + 1}`,
            number: n.number || `0${idx + 1}`,
            title: n.title || 'Director Note',
            summary: n.summary || '',
          }))
        : [];

      return res.json({
        set: {
          id: `custom-${Date.now()}`,
          name: parsed.name || vibe,
          subtitle: parsed.subtitle || `Custom photoshoot director set for ${vibe}.`,
          aestheticTag: parsed.aestheticTag || 'Custom Vibe Set',
          isCustom: true,
          scenes: normalizedScenes,
          technicalNotes: normalizedNotes,
        },
      });
    } catch (error) {
      console.error('Gemini direct-set error:', error);
      const message =
        error instanceof Error ? error.message : 'Failed to generate aesthetic prompt set.';
      return res.status(500).json({ error: message });
    }
  });

  let gpuQueueTail: Promise<void> = Promise.resolve();

  function enqueueGpuTask<T>(task: () => Promise<T>): Promise<T> {
    const run = gpuQueueTail.then(task);
    gpuQueueTail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  function extractComfySentSeed(
    graph?: Record<string, { class_type?: string; inputs?: Record<string, unknown> }>
  ): number | undefined {
    if (!graph) return undefined;
    const node6Seed = Number(graph['6']?.inputs?.seed);
    if (Number.isInteger(node6Seed) && node6Seed >= 0) {
      return node6Seed;
    }
    for (const node of Object.values(graph)) {
      const candidate = Number(node?.inputs?.seed);
      if (Number.isInteger(candidate) && candidate >= 0) {
        return candidate;
      }
    }
    return undefined;
  }

  async function executeSingleRender(
    scene: BatchRenderSceneInput,
    abortSignal?: AbortSignal
  ): Promise<{ image: string; width: number; height: number; seed?: number }> {
    const target = scene.engine === 'comfyui' ? 'comfyui' : 'a1111';
    const defaultUrl = target === 'comfyui' ? 'http://127.0.0.1:8188' : 'http://127.0.0.1:7860';
    const validatedEndpoint = validateEndpointUrl(scene.endpointUrl || '', defaultUrl);
    if (!validatedEndpoint) {
      throw new Error('Endpoint URL must start with http:// or https://.');
    }

    if (target === 'comfyui') {
      if (!scene.comfyPromptGraph || typeof scene.comfyPromptGraph !== 'object') {
        throw new Error('Missing ComfyUI API workflow graph payload.');
      }

      const queueSignal = abortSignal
        ? AbortSignal.any([abortSignal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000);
      const queueRes = await fetch(`${validatedEndpoint}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: scene.comfyPromptGraph, client_id: 'framecraft' }),
        signal: queueSignal,
      });

      if (!queueRes.ok) {
        const text = await queueRes.text();
        throw new Error(`ComfyUI returned HTTP ${queueRes.status}: ${text || 'Failed to queue prompt.'}`);
      }

      const queueData = (await queueRes.json()) as { prompt_id?: string };
      const promptId = queueData.prompt_id;
      if (!promptId) {
        throw new Error('ComfyUI did not return a prompt_id.');
      }

      for (let attempt = 0; attempt < 45; attempt++) {
        if (abortSignal?.aborted) {
          throw new Error('Batch job cancelled.');
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (abortSignal?.aborted) {
          throw new Error('Batch job cancelled.');
        }

        const histSignal = abortSignal
          ? AbortSignal.any([abortSignal, AbortSignal.timeout(5000)])
          : AbortSignal.timeout(5000);
        const historyRes = await fetch(`${validatedEndpoint}/history/${promptId}`, {
          signal: histSignal,
        });
        if (!historyRes.ok) continue;

        const historyData = (await historyRes.json()) as Record<
          string,
          { outputs?: Record<string, { images?: Array<{ filename: string; subfolder?: string; type?: string }> }> }
        >;
        const entry = historyData[promptId];
        if (!entry?.outputs) continue;

        for (const nodeOut of Object.values(entry.outputs)) {
          const firstImg = nodeOut.images?.[0];
          if (firstImg?.filename) {
            const params = new URLSearchParams({
              filename: firstImg.filename,
              subfolder: firstImg.subfolder ?? '',
              type: firstImg.type ?? 'output',
            });
            const imgRes = await fetch(`${validatedEndpoint}/view?${params.toString()}`, {
              signal: AbortSignal.timeout(10000),
            });
            if (imgRes.ok) {
              const buf = Buffer.from(await imgRes.arrayBuffer());
              const sentSeed =
                extractComfySentSeed(scene.comfyPromptGraph) ??
                (typeof scene.seed === 'number' && Number.isInteger(scene.seed) && scene.seed >= 0
                  ? scene.seed
                  : undefined);
              return {
                image: `data:image/png;base64,${buf.toString('base64')}`,
                width: Number(scene.width) || 512,
                height: Number(scene.height) || 640,
                ...(sentSeed !== undefined ? { seed: sentSeed } : {}),
              };
            }
          }
        }
      }

      throw new Error(`ComfyUI queued prompt ${promptId}, but rendering timed out after 45s.`);
    }

    if (!scene.positivePrompt || !scene.positivePrompt.trim()) {
      throw new Error('Positive prompt cannot be empty.');
    }

    const alwaysonScripts: AlwaysOnScripts = {};
    if (scene.controlImageBase64 && scene.controlImageBase64.trim()) {
      const mod: ControlNetModule =
        scene.controlModule === 'depth_midas' || scene.controlModule === 'canny'
          ? scene.controlModule
          : 'openpose';
      alwaysonScripts.controlnet = buildControlNetConfig(
        scene.controlImageBase64,
        mod,
        Number(scene.controlWeight) || 0.85
      );
    }
    const aDetailer = buildADetailerConfig(Boolean(scene.enableADetailer));
    if (aDetailer) {
      alwaysonScripts.ADetailer = aDetailer;
    }

    const width = Number(scene.width) || 512;
    const height = Number(scene.height) || 640;
    const seedToSend =
      typeof scene.seed === 'number' && Number.isInteger(scene.seed) && scene.seed >= 0
        ? scene.seed
        : -1;
    const payload: Record<string, unknown> = {
      prompt: scene.positivePrompt,
      negative_prompt: scene.negativePrompt || '',
      cfg_scale: Number(scene.cfgScale) || 7.5,
      steps: Number(scene.steps) || 30,
      seed: seedToSend,
      width,
      height,
      sampler_name: scene.samplerName || 'DPM++ 2M Karras',
      batch_size: 1,
    };
    if (Object.keys(alwaysonScripts).length > 0) {
      payload.alwayson_scripts = alwaysonScripts;
    }

    const renderSignal = abortSignal
      ? AbortSignal.any([abortSignal, AbortSignal.timeout(90000)])
      : AbortSignal.timeout(90000);
    const a1111Res = await fetch(`${validatedEndpoint}/sdapi/v1/txt2img`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: renderSignal,
    });

    if (!a1111Res.ok) {
      const errBody = await a1111Res.text();
      throw new Error(`A1111 returned HTTP ${a1111Res.status}: ${errBody || 'txt2img failed.'}`);
    }

    const data = (await a1111Res.json()) as { images?: string[]; info?: string };
    const imageBase64 = data.images?.[0];
    if (!imageBase64) {
      throw new Error('A1111 returned no image data.');
    }

    let resolvedSeed: number | undefined = seedToSend >= 0 ? seedToSend : undefined;
    if (typeof data.info === 'string' && data.info.trim().startsWith('{')) {
      try {
        const parsedInfo = JSON.parse(data.info) as {
          seed?: unknown;
          all_seeds?: unknown[];
        };
        const infoSeed = Number(
          parsedInfo.seed !== undefined ? parsedInfo.seed : parsedInfo.all_seeds?.[0]
        );
        if (Number.isInteger(infoSeed) && infoSeed >= 0) {
          resolvedSeed = infoSeed;
        }
      } catch {
        // ignore unparseable info string
      }
    }

    return {
      image: `data:image/png;base64,${imageBase64}`,
      width,
      height,
      ...(resolvedSeed !== undefined ? { seed: resolvedSeed } : {}),
    };
  }

  async function executeSingleUpscale(
    imageBase64: string,
    options: {
      multiplier?: number;
      gfpganVisibility?: number;
      upscalerName?: string;
      endpointUrl?: string;
    },
    abortSignal?: AbortSignal
  ): Promise<string> {
    const validatedImage = validateUpscaleImageInput(imageBase64);
    if (!validatedImage.valid) {
      const err = new Error(validatedImage.error) as Error & { status?: number };
      err.status = validatedImage.status;
      throw err;
    }

    const validatedEndpoint = validateEndpointUrl(
      options.endpointUrl || '',
      'http://127.0.0.1:7860'
    );
    if (!validatedEndpoint) {
      const err = new Error('Invalid local A1111 upscaler endpoint URL.') as Error & {
        status?: number;
      };
      err.status = 400;
      throw err;
    }

    const payload = buildUpscalePayload(
      validatedImage.rawBase64,
      options.multiplier ?? 2,
      options.gfpganVisibility ?? 0,
      options.upscalerName || 'R-ESRGAN 4x+'
    );

    const upscaleSignal = abortSignal
      ? AbortSignal.any([abortSignal, AbortSignal.timeout(90000)])
      : AbortSignal.timeout(90000);
    const upscaleRes = await fetch(`${validatedEndpoint}/sdapi/v1/extra-single-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: upscaleSignal,
    });

    if (!upscaleRes.ok) {
      const errBody = await upscaleRes.text();
      throw new Error(
        `A1111 upscaler returned HTTP ${upscaleRes.status}: ${errBody || 'extra-single-image failed.'}`
      );
    }

    const data = (await upscaleRes.json()) as { image?: string };
    if (!data.image) {
      throw new Error('A1111 upscaler returned no image data.');
    }

    return `data:image/png;base64,${data.image}`;
  }

  app.post('/api/render-image', async (req, res) => {
    const target = req.body?.target === 'comfyui' ? 'comfyui' : 'a1111';
    const defaultUrl = target === 'comfyui' ? 'http://127.0.0.1:8188' : 'http://127.0.0.1:7860';
    const validatedEndpoint = validateEndpointUrl(
      typeof req.body?.endpointUrl === 'string' ? req.body.endpointUrl : '',
      defaultUrl
    );

    if (!validatedEndpoint) {
      return res.status(400).json({
        success: false,
        error: 'Invalid local WebUI endpoint URL. Must start with http:// or https://.',
      });
    }

    if (target === 'comfyui' && (!req.body?.comfyPromptGraph || typeof req.body.comfyPromptGraph !== 'object')) {
      return res.status(400).json({
        success: false,
        error: 'Missing ComfyUI API workflow graph payload.',
      });
    }

    if (target === 'a1111' && (typeof req.body?.positivePrompt !== 'string' || !req.body.positivePrompt.trim())) {
      return res.status(400).json({
        success: false,
        error: 'Positive prompt cannot be empty.',
      });
    }

    try {
      const rendered = await enqueueGpuTask(() =>
        executeSingleRender({
          sceneId: 'single',
          title: 'Single Scene',
          engine: target,
          endpointUrl: validatedEndpoint,
          comfyPromptGraph: req.body?.comfyPromptGraph,
          positivePrompt: req.body?.positivePrompt || '',
          negativePrompt: req.body?.negativePrompt || '',
          cfgScale: Number(req.body?.cfgScale) || 7.5,
          steps: Number(req.body?.steps) || 30,
          seed:
            req.body?.seed !== undefined && Number.isInteger(Number(req.body.seed))
              ? Number(req.body.seed)
              : -1,
          width: Number(req.body?.width) || 512,
          height: Number(req.body?.height) || 640,
          samplerName: req.body?.samplerName || 'DPM++ 2M Karras',
          enableADetailer: Boolean(req.body?.enableADetailer),
        })
      );

      return res.json({
        success: true,
        image: rendered.image,
        ...(rendered.seed !== undefined ? { seed: rendered.seed } : {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`${target} render failed:`, message);
      return res.status(502).json({
        success: false,
        error:
          target === 'comfyui'
            ? `ComfyUI API unreachable at ${validatedEndpoint} (${message}).`
            : `A1111 API unreachable at ${validatedEndpoint} (${message}). Ensure WebUI is running with the --api flag.`,
      });
    }
  });

  app.post('/api/render-controlled', async (req, res) => {
    const validatedEndpoint = validateEndpointUrl(
      typeof req.body?.endpointUrl === 'string' ? req.body.endpointUrl : '',
      'http://127.0.0.1:7860'
    );
    if (!validatedEndpoint) {
      return res.status(400).json({
        success: false,
        error: 'Invalid A1111 endpoint URL. URL must start with http:// or https://.',
      });
    }

    const positivePrompt =
      typeof req.body?.positivePrompt === 'string' ? req.body.positivePrompt : '';
    const controlImageBase64 =
      typeof req.body?.controlImageBase64 === 'string' ? req.body.controlImageBase64.trim() : '';

    if (!positivePrompt.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Positive prompt cannot be empty.',
      });
    }
    if (!controlImageBase64) {
      return res.status(400).json({
        success: false,
        error: 'Missing controlImageBase64 reference pose image.',
      });
    }

    const rawModule = req.body?.controlModule;
    const controlModule: ControlNetModule =
      rawModule === 'depth_midas' || rawModule === 'canny' ? rawModule : 'openpose';

    try {
      const rendered = await enqueueGpuTask(() =>
        executeSingleRender({
          sceneId: 'controlled',
          title: 'Controlled Scene',
          engine: 'a1111',
          endpointUrl: validatedEndpoint,
          positivePrompt,
          negativePrompt: typeof req.body?.negativePrompt === 'string' ? req.body.negativePrompt : '',
          cfgScale: Number(req.body?.cfgScale) || 7.5,
          steps: Number(req.body?.steps) || 30,
          seed:
            req.body?.seed !== undefined && Number.isInteger(Number(req.body.seed))
              ? Number(req.body.seed)
              : -1,
          width: Number(req.body?.width) || 512,
          height: Number(req.body?.height) || 640,
          samplerName:
            typeof req.body?.samplerName === 'string' && req.body.samplerName
              ? req.body.samplerName
              : 'DPM++ 2M Karras',
          enableADetailer: Boolean(req.body?.enableADetailer),
          controlImageBase64,
          controlModule,
          controlWeight: Number(req.body?.controlWeight) || 0.85,
        })
      );

      return res.json({
        success: true,
        image: rendered.image,
        ...(rendered.seed !== undefined ? { seed: rendered.seed } : {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('A1111 ControlNet render failed:', message);
      return res.status(502).json({
        success: false,
        error: `A1111 ControlNet API unreachable at ${validatedEndpoint}. Ensure WebUI is running with --api and the ControlNet extension.`,
      });
    }
  });

  app.post('/api/upscale-image', async (req, res) => {
    const imageBase64 =
      typeof req.body?.imageBase64 === 'string' ? req.body.imageBase64.trim() : '';
    const validation = validateUpscaleImageInput(imageBase64);
    if (!validation.valid) {
      return res.status(validation.status).json({
        success: false,
        error: validation.error,
      });
    }

    const validatedEndpoint = validateEndpointUrl(
      typeof req.body?.endpointUrl === 'string' ? req.body.endpointUrl : '',
      'http://127.0.0.1:7860'
    );
    if (!validatedEndpoint) {
      return res.status(400).json({
        success: false,
        error: 'Upscaler endpoint URL must start with http:// or https://.',
      });
    }

    const upscaleMultiplier = Math.min(4, Math.max(1, Number(req.body?.upscaleMultiplier) || 2));
    // No face restore unless explicitly requested via gfpganVisibility > 0 or restoreFaces === true
    const gfpganVisibility =
      req.body?.restoreFaces === true
        ? Math.min(1, Math.max(0.05, Number(req.body?.gfpganVisibility) || 0.5))
        : req.body?.gfpganVisibility !== undefined
          ? Math.min(1, Math.max(0, Number(req.body.gfpganVisibility) || 0))
          : 0;
    const upscalerName =
      typeof req.body?.upscalerName === 'string' && req.body.upscalerName.trim().length > 0
        ? req.body.upscalerName.trim()
        : 'R-ESRGAN 4x+';

    try {
      const upscaled = await enqueueGpuTask(() =>
        executeSingleUpscale(validation.rawBase64, {
          multiplier: upscaleMultiplier,
          gfpganVisibility,
          upscalerName,
          endpointUrl: validatedEndpoint,
        })
      );
      return res.json({
        success: true,
        image: upscaled,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('Upscale failed:', message);
      return res.status(502).json({
        success: false,
        error: `Upscaler unreachable at ${validatedEndpoint}. Check Automatic1111 console and --api flag.`,
      });
    }
  });

  interface BatchJobRecord {
    jobId: string;
    status: BatchJobStatus;
    total: number;
    current: number;
    sceneTitle: string;
    stage: BatchProgressStage;
    error?: string;
    scenes: BatchCompletedScene[];
    sceneMap: Map<string, BatchCompletedScene>;
    cancelled: boolean;
    abortController: AbortController;
    clients: Set<Response>;
    lastEvent: BatchProgressEvent;
    createdAt: number;
  }

  const batchJobs = new Map<string, BatchJobRecord>();

  function emitBatchEvent(job: BatchJobRecord, event: BatchProgressEvent, closeStreams = false) {
    const formatted = formatBatchProgressEvent(event);
    job.lastEvent = formatted;
    job.status = formatted.status;
    job.current = formatted.current;
    job.sceneTitle = formatted.sceneTitle;
    job.stage = formatted.stage;
    job.error = formatted.error;

    const frame = `data: ${JSON.stringify(formatted)}\n\n`;
    for (const client of job.clients) {
      try {
        client.write(frame);
        if (closeStreams) {
          client.end();
        }
      } catch {
        job.clients.delete(client);
      }
    }
    if (closeStreams) {
      job.clients.clear();
    }
  }

  function pruneExpiredBatchJobs() {
    const cutoff = Date.now() - 15 * 60 * 1000;
    for (const [id, job] of batchJobs.entries()) {
      if (job.createdAt < cutoff && job.clients.size === 0) {
        batchJobs.delete(id);
      }
    }
  }

  async function runSequentialBatchJob(
    job: BatchJobRecord,
    scenes: BatchRenderSceneInput[],
    upscale: BatchUpscaleOptions
  ) {
    for (let i = 0; i < scenes.length; i++) {
      if (job.cancelled) {
        return;
      }

      const scene = scenes[i];
      const current = i + 1;

      emitBatchEvent(job, {
        jobId: job.jobId,
        status: 'running',
        current,
        total: job.total,
        sceneId: scene.sceneId,
        sceneTitle: scene.title,
        stage: 'render',
      });

      try {
        const rendered = await executeSingleRender(scene, job.abortController.signal);
        if (job.cancelled) return;

        let finalImage = rendered.image;
        let outWidth = rendered.width;
        let outHeight = rendered.height;

        if (upscale.enabled) {
          emitBatchEvent(job, {
            jobId: job.jobId,
            status: 'running',
            current,
            total: job.total,
            sceneId: scene.sceneId,
            sceneTitle: scene.title,
            stage: 'upscale',
          });

          finalImage = await executeSingleUpscale(
            rendered.image,
            upscale,
            job.abortController.signal
          );
          if (job.cancelled) return;

          outWidth = rendered.width * upscale.multiplier;
          outHeight = rendered.height * upscale.multiplier;
        }

        const completed: BatchCompletedScene = {
          sceneId: scene.sceneId,
          title: scene.title,
          imageBase64: finalImage,
          width: outWidth,
          height: outHeight,
          ...(rendered.seed !== undefined ? { seed: rendered.seed } : {}),
          kept: true,
        };
        job.sceneMap.set(scene.sceneId, completed);
        job.scenes.push(completed);
      } catch (err) {
        if (job.cancelled) return;
        const message = err instanceof Error ? err.message : 'Batch scene execution failed.';
        emitBatchEvent(
          job,
          {
            jobId: job.jobId,
            status: 'error',
            current,
            total: job.total,
            sceneId: scene.sceneId,
            sceneTitle: scene.title,
            stage: 'error',
            error: message,
          },
          true
        );
        return;
      }
    }

    if (!job.cancelled) {
      emitBatchEvent(
        job,
        {
          jobId: job.jobId,
          status: 'completed',
          current: job.total,
          total: job.total,
          sceneTitle: scenes[scenes.length - 1]?.title || 'Contact Sheet',
          stage: 'done',
          scenes: job.scenes,
        },
        true
      );
    }
  }

  app.post('/api/batch-render', (req, res) => {
    pruneExpiredBatchJobs();

    const rawScenes = Array.isArray(req.body?.scenes) ? req.body.scenes : [];
    if (rawScenes.length === 0 || rawScenes.length > 12) {
      return res.status(400).json({
        success: false,
        error: 'Provide between 1 and 12 compiled scenes in the batch queue.',
      });
    }

    const validatedScenes: BatchRenderSceneInput[] = [];
    for (let idx = 0; idx < rawScenes.length; idx++) {
      const s = rawScenes[idx] as Record<string, unknown>;
      const engine = s?.engine === 'comfyui' ? 'comfyui' : 'a1111';
      const defaultUrl = engine === 'comfyui' ? 'http://127.0.0.1:8188' : 'http://127.0.0.1:7860';
      const endpointUrl = validateEndpointUrl(
        typeof s?.endpointUrl === 'string' ? s.endpointUrl : '',
        defaultUrl
      );
      if (!endpointUrl) {
        return res.status(400).json({
          success: false,
          error: `Scene ${idx + 1} has an invalid local WebUI endpoint URL.`,
        });
      }

      const positivePrompt = typeof s?.positivePrompt === 'string' ? s.positivePrompt : '';
      if (engine === 'a1111' && !positivePrompt.trim()) {
        return res.status(400).json({
          success: false,
          error: `Scene ${idx + 1} requires a non-empty positive prompt.`,
        });
      }

      const rawMod = s?.controlModule;
      const controlModule: ControlNetModule =
        rawMod === 'depth_midas' || rawMod === 'canny' ? rawMod : 'openpose';

      validatedScenes.push({
        sceneId: typeof s?.sceneId === 'string' && s.sceneId ? s.sceneId : `scene-${idx + 1}`,
        title: typeof s?.title === 'string' && s.title ? s.title : `Scene ${idx + 1}`,
        positivePrompt,
        negativePrompt: typeof s?.negativePrompt === 'string' ? s.negativePrompt : '',
        cfgScale: Number(s?.cfgScale) || 7.5,
        steps: Number(s?.steps) || 30,
        seed:
          s?.seed !== undefined && Number.isInteger(Number(s.seed)) ? Number(s.seed) : -1,
        width: Number(s?.width) || 512,
        height: Number(s?.height) || 640,
        samplerName:
          typeof s?.samplerName === 'string' && s.samplerName ? s.samplerName : 'DPM++ 2M Karras',
        engine,
        endpointUrl,
        comfyPromptGraph:
          engine === 'comfyui' && s?.comfyPromptGraph && typeof s.comfyPromptGraph === 'object'
            ? (s.comfyPromptGraph as BatchRenderSceneInput['comfyPromptGraph'])
            : undefined,
        enableADetailer: Boolean(s?.enableADetailer),
        controlImageBase64:
          typeof s?.controlImageBase64 === 'string' ? s.controlImageBase64 : undefined,
        controlModule,
        controlWeight: Number(s?.controlWeight) || 0.85,
      });
    }

    const rawUpscale = (req.body?.upscale || {}) as Record<string, unknown>;
    const upscaleEndpoint = validateEndpointUrl(
      typeof rawUpscale.endpointUrl === 'string' ? rawUpscale.endpointUrl : '',
      'http://127.0.0.1:7860'
    );
    if (!upscaleEndpoint) {
      return res.status(400).json({
        success: false,
        error: 'Invalid upscaler endpoint URL.',
      });
    }

    const upscaleOptions: BatchUpscaleOptions = {
      enabled: rawUpscale.enabled !== false,
      multiplier: Math.min(4, Math.max(1, Number(rawUpscale.multiplier) || 2)),
      gfpganVisibility:
        rawUpscale.restoreFaces === true
          ? Math.min(1, Math.max(0.05, Number(rawUpscale.gfpganVisibility) || 0.5))
          : Number(rawUpscale.gfpganVisibility) > 0
            ? Math.min(1, Math.max(0, Number(rawUpscale.gfpganVisibility)))
            : 0,
      upscalerName:
        typeof rawUpscale.upscalerName === 'string' && rawUpscale.upscalerName.trim()
          ? rawUpscale.upscalerName.trim()
          : 'R-ESRGAN 4x+',
      endpointUrl: upscaleEndpoint,
    };

    const jobId = crypto.randomUUID();
    const initialEvent: BatchProgressEvent = {
      jobId,
      status: 'queued',
      current: 0,
      total: validatedScenes.length,
      sceneId: validatedScenes[0].sceneId,
      sceneTitle: validatedScenes[0].title,
      stage: 'render',
    };

    const job: BatchJobRecord = {
      jobId,
      status: 'queued',
      total: validatedScenes.length,
      current: 0,
      sceneTitle: validatedScenes[0].title,
      stage: 'render',
      scenes: [],
      sceneMap: new Map(),
      cancelled: false,
      abortController: new AbortController(),
      clients: new Set(),
      lastEvent: initialEvent,
      createdAt: Date.now(),
    };

    batchJobs.set(jobId, job);

    // Hard concurrency = 1 across the shared GPU mutex
    enqueueGpuTask(() => runSequentialBatchJob(job, validatedScenes, upscaleOptions)).catch(
      (err) => {
        console.error('Batch worker failure:', err);
      }
    );

    return res.status(202).json({
      success: true,
      jobId,
      total: job.total,
      status: job.status,
    });
  });

  app.get('/api/batch-progress/:jobId', (req, res) => {
    const job = batchJobs.get(req.params.jobId);
    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Batch render job not found or expired.',
      });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    res.write(`data: ${JSON.stringify(job.lastEvent)}\n\n`);

    if (job.status === 'completed' || job.status === 'cancelled' || job.status === 'error') {
      res.end();
      return;
    }

    job.clients.add(res);
    req.on('close', () => {
      job.clients.delete(res);
    });
  });

  function cancelBatchJob(jobId: string) {
    const job = batchJobs.get(jobId);
    if (!job) return null;

    if (job.status !== 'completed' && job.status !== 'error' && !job.cancelled) {
      job.cancelled = true;
      job.abortController.abort();
      emitBatchEvent(
        job,
        {
          jobId: job.jobId,
          status: 'cancelled',
          current: job.current,
          total: job.total,
          sceneTitle: job.sceneTitle,
          stage: 'error',
          error: 'Batch queue cancelled by user.',
        },
        true
      );
    }
    return job;
  }

  app.post('/api/batch-cancel/:jobId', (req, res) => {
    const job = cancelBatchJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Batch job not found.',
      });
    }
    return res.json({
      success: true,
      jobId: job.jobId,
      status: job.status,
    });
  });

  app.delete('/api/batch-render/:jobId', (req, res) => {
    const job = cancelBatchJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Batch job not found.',
      });
    }
    return res.json({
      success: true,
      jobId: job.jobId,
      status: job.status,
    });
  });

  app.get('/api/batch-result/:jobId', (req, res) => {
    const job = batchJobs.get(req.params.jobId);
    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Batch job not found.',
      });
    }
    return res.json({
      jobId: job.jobId,
      status: job.status,
      scenes: job.scenes,
      ...(job.error ? { error: job.error } : {}),
    });
  });

  app.post('/api/save-local', async (req, res) => {
    const imageBase64 =
      typeof req.body?.imageBase64 === 'string' ? req.body.imageBase64.trim() : '';
    if (!imageBase64) {
      return res.status(400).json({
        success: false,
        error: 'Missing imageBase64 payload to save.',
      });
    }

    const rawBase64 = stripDataUrlPrefix(imageBase64);
    if (!rawBase64) {
      return res.status(400).json({
        success: false,
        error: 'Encoded image payload is empty.',
      });
    }

    const rawName =
      typeof req.body?.filename === 'string' && req.body.filename.trim().length > 0
        ? req.body.filename
        : `framecraft_${Date.now()}.png`;
    const safeFilename = sanitizeExportFilename(rawName);
    const exportsDir = path.join(__dirname, 'exports');
    const filePath = path.join(exportsDir, safeFilename);

    if (!filePath.startsWith(exportsDir + path.sep)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid export filename.',
      });
    }

    try {
      await fs.mkdir(exportsDir, { recursive: true });
      await fs.writeFile(filePath, Buffer.from(rawBase64, 'base64'));
      return res.json({
        success: true,
        path: filePath,
        filename: safeFilename,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to write file.';
      console.error('Local export save failed:', message);
      return res.status(500).json({
        success: false,
        error: `Could not save local export: ${message}`,
      });
    }
  });

  app.post('/api/post-ig', async (req, res) => {
    const validatedIgUrl = validateEndpointUrl(
      typeof req.body?.igEndpointUrl === 'string' ? req.body.igEndpointUrl : '',
      'http://127.0.0.1:5001'
    );
    if (!validatedIgUrl) {
      return res.status(400).json({
        success: false,
        error: 'Invalid Instagram microservice URL. Must start with http:// or https://.',
      });
    }

    const caption =
      typeof req.body?.caption === 'string' && req.body.caption.trim().length > 0
        ? req.body.caption.trim()
        : 'New shoot out now.';
    const requestedPath =
      typeof req.body?.image_path === 'string' ? req.body.image_path.trim() : '';
    const imageBase64 =
      typeof req.body?.imageBase64 === 'string' ? req.body.imageBase64.trim() : '';

    const exportsDir = path.join(__dirname, 'exports');
    let targetPath = '';

    if (requestedPath) {
      const resolved = path.resolve(requestedPath);
      if (!resolved.startsWith(exportsDir + path.sep)) {
        return res.status(400).json({
          success: false,
          error: 'image_path must point inside the Framecraft exports directory.',
        });
      }
      targetPath = resolved;
    } else if (imageBase64) {
      const rawBase64 = stripDataUrlPrefix(imageBase64);
      if (!rawBase64) {
        return res.status(400).json({
          success: false,
          error: 'Encoded image payload is empty.',
        });
      }
      const safeFilename = sanitizeExportFilename(
        typeof req.body?.filename === 'string' && req.body.filename.trim().length > 0
          ? req.body.filename
          : `ig_post_${Date.now()}.png`
      );
      targetPath = path.join(exportsDir, safeFilename);
      await fs.mkdir(exportsDir, { recursive: true });
      await fs.writeFile(targetPath, Buffer.from(rawBase64, 'base64'));
    } else {
      return res.status(400).json({
        success: false,
        error: 'Provide either image_path or imageBase64 to publish to Instagram.',
      });
    }

    try {
      const igRes = await fetch(`${validatedIgUrl}/post`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_path: targetPath,
          caption,
        }),
        signal: AbortSignal.timeout(30000),
      });

      const data = (await igRes.json().catch(() => ({}))) as {
        success?: boolean;
        url?: string;
        error?: string;
      };

      if (!igRes.ok || !data.success) {
        return res.status(502).json({
          success: false,
          error:
            data.error ||
            `Instagram poster returned HTTP ${igRes.status}. Check IG_USERNAME, IG_PASSWORD, and ig_poster.py logs.`,
        });
      }

      return res.json({
        success: true,
        url: data.url || '',
        image_path: targetPath,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('IG poster proxy failed:', message);
      return res.status(502).json({
        success: false,
        error: `Instagram poster unreachable at ${validatedIgUrl}. Start local microservice with: python ig_poster.py`,
      });
    }
  });

  const loraRawDir = path.join(__dirname, 'lora_raw');
  const loraProcessedDir = path.join(__dirname, 'lora_processed');
  const isSupportedImage = (name: string) => /\.(png|jpe?g|webp)$/i.test(name);

  async function listRawDatasetFiles(): Promise<string[]> {
    try {
      const entries = await fs.readdir(loraRawDir);
      return entries.filter(isSupportedImage).sort();
    } catch {
      return [];
    }
  }

  app.get('/api/lora-dataset', async (_req, res) => {
    const files = await listRawDatasetFiles();
    return res.json({ success: true, count: files.length, files });
  });

  app.post('/api/lora-dataset', async (req, res) => {
    const incoming = Array.isArray(req.body?.images) ? req.body.images : [];
    if (incoming.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No images provided in upload payload.',
      });
    }

    try {
      await fs.mkdir(loraRawDir, { recursive: true });
      const saved: string[] = [];

      for (const item of incoming.slice(0, 40)) {
        const filename = typeof item?.filename === 'string' ? item.filename : '';
        const dataUrl = typeof item?.dataUrl === 'string' ? item.dataUrl : '';
        const rawBase64 = stripDataUrlPrefix(dataUrl);
        if (!rawBase64) continue;

        const safeName = sanitizeDatasetImageFilename(filename || `subject_${Date.now()}.png`);
        const destPath = path.join(loraRawDir, safeName);
        if (!destPath.startsWith(loraRawDir + path.sep)) continue;

        await fs.writeFile(destPath, Buffer.from(rawBase64, 'base64'));
        saved.push(safeName);
      }

      if (saved.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Could not decode any valid image files from upload.',
        });
      }

      const files = await listRawDatasetFiles();
      return res.json({ success: true, added: saved.length, count: files.length, files });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to store raw photos.';
      return res.status(500).json({ success: false, error: message });
    }
  });

  app.delete('/api/lora-dataset', async (_req, res) => {
    try {
      await fs.rm(loraRawDir, { recursive: true, force: true });
      await fs.rm(loraProcessedDir, { recursive: true, force: true });
      return res.json({ success: true, count: 0, files: [] });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to clear dataset folders.';
      return res.status(500).json({ success: false, error: message });
    }
  });

  function runPythonStep(
    pythonBin: string,
    args: string[]
  ): Promise<{ code: number; output: string; spawnError?: NodeJS.ErrnoException }> {
    return new Promise((resolve) => {
      const proc = spawn(pythonBin, args, { cwd: __dirname });
      let output = '';

      proc.stdout.on('data', (chunk) => {
        output += chunk.toString();
      });
      proc.stderr.on('data', (chunk) => {
        output += chunk.toString();
      });
      proc.on('error', (err: NodeJS.ErrnoException) => {
        resolve({ code: -1, output: output + err.message, spawnError: err });
      });
      proc.on('close', (code) => {
        resolve({ code: code ?? 1, output });
      });
    });
  }

  async function runPythonWithFallback(
    args: string[]
  ): Promise<{ code: number; output: string }> {
    const preferred = process.env.PYTHON_BIN?.trim() || 'python3';
    const first = await runPythonStep(preferred, args);
    if (first.spawnError?.code === 'ENOENT' && preferred === 'python3') {
      const second = await runPythonStep('python', args);
      return { code: second.code, output: second.output };
    }
    return { code: first.code, output: first.output };
  }

  app.post('/api/train-lora', async (req, res) => {
    const stagedFiles = await listRawDatasetFiles();
    if (stagedFiles.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No subject photos staged in ./lora_raw. Upload 15–20 photos first.',
      });
    }

    const trainingConfig = buildLoraTrainingArgs({
      triggerWord: req.body?.triggerWord,
      outputName: req.body?.outputName,
      kohyaDir: req.body?.kohyaDir,
      baseModelPath: req.body?.baseModelPath,
      outputDir: req.body?.outputDir,
      maxSteps: req.body?.maxSteps,
      vramProfile: req.body?.vramProfile,
    });

    const prepResult = await runPythonWithFallback(trainingConfig.prepareArgs);
    if (prepResult.code !== 0) {
      return res.status(500).json({
        success: false,
        stage: 'prepare_lora',
        error:
          prepResult.output.trim() ||
          'prepare_lora.py failed. Ensure Python + Pillow + transformers + torch are installed.',
        log: prepResult.output,
      });
    }

    const trainResult = await runPythonWithFallback(trainingConfig.trainArgs);
    const combinedLog = `${prepResult.output}\n${trainResult.output}`.trim();

    if (trainResult.code !== 0) {
      return res.status(500).json({
        success: false,
        stage: 'train_lora',
        error:
          trainResult.output.trim() ||
          'train_lora.py failed. Verify kohya_ss path, base checkpoint, and accelerate environment.',
        log: combinedLog,
      });
    }

    return res.json({
      success: true,
      outputName: trainingConfig.outputName,
      triggerWord: trainingConfig.triggerWord,
      log: combinedLog,
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Framecraft Photoshoot Director running at http://localhost:${PORT}`);
  });
}

startServer();
