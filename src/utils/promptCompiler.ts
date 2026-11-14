import {
  CfgAssessment,
  CompilerConfig,
  EngineFormat,
  LightingConsistency,
  PromptSet,
  SceneSpec,
} from '../types/photoshoot';
import { LIGHTING_OPTIONS } from '../data/presetSets';

export function sanitizeLoraName(raw: string): string {
  const cleaned = raw.trim().replace(/[^\w.-]/g, '_');
  return cleaned.length > 0 ? cleaned : 'yourname';
}

export function formatLoraTag(name: string, weight: number): string {
  const safeName = sanitizeLoraName(name);
  const clamped = Math.min(1.5, Math.max(0.1, Number(weight) || 0.8));
  return `<lora:${safeName}:${clamped.toFixed(2).replace(/0$/, '')}>`;
}

export function buildBasePromptBody(scene: SceneSpec): string {
  const parts = [
    scene.poseAndFraming,
    scene.subjectDescriptor,
    scene.wardrobe,
    scene.environment,
    scene.lightingPhrase,
    scene.cameraAndLens,
    scene.qualityTokens,
  ]
    .map((segment) => segment.trim().replace(/,\s*$/, ''))
    .filter((segment) => segment.length > 0);

  return parts.join(', ');
}

export function compilePositivePrompt(scene: SceneSpec, config: CompilerConfig): string {
  const body = buildBasePromptBody(scene);

  if (config.engine === 'midjourney') {
    const cleanNegatives = scene.negativeTokens
      .replace(/\([^)]*\)/g, '')
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0 && !t.includes(':'))
      .slice(0, 8)
      .join(', ');

    const noFlag = cleanNegatives.length > 0 ? ` --no ${cleanNegatives}` : '';
    const loraNote = config.loraEnabled
      ? ` --cref [subject-reference-${sanitizeLoraName(config.loraName)}] --cw ${Math.round(
          Math.min(100, Math.max(10, config.loraWeight * 100))
        )}`
      : '';

    return `${body} --ar ${config.aspectRatio} --style raw${noFlag}${loraNote}`;
  }

  if (config.loraEnabled) {
    const loraTag = formatLoraTag(config.loraName, config.loraWeight);
    return `${loraTag}, ${body}`;
  }

  return body;
}

export function compileNegativePrompt(scene: SceneSpec, config: CompilerConfig): string {
  if (config.engine === 'midjourney') {
    const tokens = scene.negativeTokens
      .replace(/\([^)]*\)/g, '')
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0 && !t.includes(':'));
    return `--no ${tokens.join(', ')}`;
  }

  return scene.negativeTokens.trim();
}

export function getAspectDimensions(ratio: CompilerConfig['aspectRatio']): {
  width: number;
  height: number;
} {
  switch (ratio) {
    case '3:4':
      return { width: 896, height: 1152 };
    case '4:3':
      return { width: 1152, height: 896 };
    case '1:1':
      return { width: 1024, height: 1024 };
    case '9:16':
      return { width: 768, height: 1344 };
    case '16:9':
      return { width: 1344, height: 768 };
  }
}

export function buildComfyWorkflowJson(scene: SceneSpec, config: CompilerConfig): string {
  const positive = compilePositivePrompt(scene, {
    ...config,
    engine: 'sd',
    loraEnabled: false,
  });
  const negative = compileNegativePrompt(scene, { ...config, engine: 'sd' });
  const { width, height } = getAspectDimensions(config.aspectRatio);
  const safeLora = sanitizeLoraName(config.loraName);

  const workflow = {
    last_node_id: 7,
    last_link_id: 7,
    nodes: [
      {
        id: 1,
        type: 'CheckpointLoaderSimple',
        widgets_values: ['sd_xl_base_1.0.safetensors'],
      },
      {
        id: 2,
        type: 'LoraLoader',
        widgets_values: [
          `${safeLora}.safetensors`,
          config.loraEnabled ? Number(config.loraWeight.toFixed(2)) : 0,
          config.loraEnabled ? Number(config.loraWeight.toFixed(2)) : 0,
        ],
      },
      {
        id: 3,
        type: 'CLIPTextEncode',
        title: 'Positive Prompt',
        widgets_values: [positive],
      },
      {
        id: 4,
        type: 'CLIPTextEncode',
        title: 'Negative Prompt',
        widgets_values: [negative],
      },
      {
        id: 5,
        type: 'EmptyLatentImage',
        widgets_values: [width, height, 1],
      },
      {
        id: 6,
        type: 'KSampler',
        widgets_values: [
          4289012,
          'randomize',
          config.steps,
          Number(config.cfgScale.toFixed(1)),
          config.sampler,
          'karras',
          1,
        ],
      },
      {
        id: 7,
        type: 'VAEDecode',
      },
    ],
    meta: {
      sceneTitle: scene.title,
      lightingId: scene.lightingId,
    },
  };

  return JSON.stringify(workflow, null, 2);
}

export function assessCfgScale(cfgScale: number, engine: EngineFormat): CfgAssessment {
  if (engine === 'midjourney') {
    return {
      status: 'optimal',
      label: 'Midjourney --style raw active',
      detail: 'Midjourney ignores Stable Diffusion CFG; raw style preserves photographic skin grain.',
    };
  }

  if (cfgScale < 5) {
    return {
      status: 'low',
      label: 'Under-guided (< 5.0)',
      detail: 'Too low: model ignores wardrobe straps, fabric contrast, and scene framing.',
    };
  }

  if (cfgScale > 9.5) {
    return {
      status: 'high',
      label: 'Over-baked risk (> 9.5)',
      detail: 'Too high: skin texture turns plastic and over-sharpened above CFG 9.',
    };
  }

  return {
    status: 'optimal',
    label: 'Recommended 7–9 range',
    detail: 'Sweet spot for Stable Diffusion: preserves natural pores and garment fidelity.',
  };
}

export function checkLightingConsistency(scene: SceneSpec): LightingConsistency {
  if (scene.lightingId === scene.recommendedLightingId) {
    const matched = LIGHTING_OPTIONS.find((opt) => opt.id === scene.lightingId);
    return {
      isMatched: true,
      label: 'Lighting lock matched',
      detail: matched ? matched.note : 'Scene lighting aligns with original director breakdown.',
    };
  }

  const target = LIGHTING_OPTIONS.find((opt) => opt.id === scene.recommendedLightingId);
  return {
    isMatched: false,
    label: 'Lighting modified from baseline',
    detail: `Original motif specifies "${target?.label ?? scene.recommendedLightingId}". Verify skin texture and shadow keywords match the new light source.`,
  };
}

export function formatSceneMarkdown(
  scene: SceneSpec,
  set: PromptSet,
  config: CompilerConfig
): string {
  const positive = compilePositivePrompt(scene, config);
  const negative = compileNegativePrompt(scene, config);

  return [
    `# ${set.name} — Scene ${scene.sceneNumber}: ${scene.title}`,
    '',
    `**Breakdown:** ${scene.breakdown}`,
    `**Engine:** ${config.engine.toUpperCase()} · **Aspect:** ${config.aspectRatio} · **CFG:** ${config.cfgScale} · **Steps:** ${config.steps}`,
    `**Camera & Lens:** ${scene.cameraAndLens}`,
    `**Lighting:** ${scene.lightingPhrase}`,
    '',
    '## Positive Prompt',
    '```text',
    positive,
    '```',
    '',
    '## Negative Prompt',
    '```text',
    negative,
    '```',
  ].join('\n');
}
