export type EngineFormat = 'sd' | 'midjourney' | 'comfyui';

export type LightingId =
  | 'soft-window-left'
  | 'overhead-fluorescent'
  | 'harsh-midday-sun'
  | 'neon-club-spill'
  | 'studio-softbox'
  | 'golden-hour-rim';

export type AspectRatioOption = '3:4' | '4:3' | '1:1' | '9:16' | '16:9';

export interface SceneSpec {
  id: string;
  sceneNumber: string;
  title: string;
  breakdown: string;
  imageUrl?: string;
  imageAlt: string;
  subjectDescriptor: string;
  wardrobe: string;
  environment: string;
  poseAndFraming: string;
  lightingId: LightingId;
  recommendedLightingId: LightingId;
  lightingPhrase: string;
  cameraAndLens: string;
  focalLengthLabel: string;
  qualityTokens: string;
  negativeTokens: string;
  skinTextureFocus: string;
  contrastMotif: string;
}

export interface TechnicalNote {
  id: string;
  number: string;
  title: string;
  summary: string;
}

export interface PromptSet {
  id: string;
  name: string;
  subtitle: string;
  aestheticTag: string;
  isCustom?: boolean;
  scenes: SceneSpec[];
  technicalNotes: TechnicalNote[];
}

export interface CompilerConfig {
  engine: EngineFormat;
  loraEnabled: boolean;
  loraName: string;
  loraWeight: number;
  cfgScale: number;
  steps: number;
  seed?: number;
  seedLocked?: boolean;
  aspectRatio: AspectRatioOption;
  sampler: string;
}

export interface CfgAssessment {
  status: 'low' | 'optimal' | 'high';
  label: string;
  detail: string;
}

export interface LightingConsistency {
  isMatched: boolean;
  label: string;
  detail: string;
}
