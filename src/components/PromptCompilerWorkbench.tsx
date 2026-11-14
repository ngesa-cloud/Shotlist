import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Archive,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  Cpu,
  Download,
  Image as ImageIcon,
  Layers,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  Shuffle,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  AspectRatioOption,
  CompilerConfig,
  EngineFormat,
  LightingId,
  PromptSet,
  SceneSpec,
} from '../types/photoshoot';
import { CAMERA_PRESETS, LIGHTING_OPTIONS } from '../data/presetSets';
import {
  assessCfgScale,
  buildComfyWorkflowJson,
  checkLightingConsistency,
  compileNegativePrompt,
  compilePositivePrompt,
  formatSceneMarkdown,
} from '../utils/promptCompiler';
import {
  BatchCompletedScene,
  BatchProgressEvent,
  BatchProgressStage,
  buildA1111Txt2ImgPayload,
  buildBatchRenderRequest,
  buildComfyPromptApiGraph,
  buildPreflightQuery,
  buildSceneCaption,
  CONTROLNET_MODELS,
  ControlNetModule,
  filterKeptScenes,
  formatBatchUpscaledFilename,
  getRenderDimensions,
  LocalRenderBackend,
  LoraTrainingVramProfile,
  PreflightCheckResult,
  RenderResolutionMode,
  sanitizeExportFilename,
} from '../utils/renderPayload';
import { buildZipArchive, decodeBase64ToUint8Array } from '../utils/zipBuilder';

const STORAGE_KEY_BATCH_RECOVERY = 'framecraft_last_batch_sheet_v1';

interface StoredBatchContactSheet {
  jobId: string;
  setId: string;
  setName: string;
  completedAt: string;
  caption?: string;
  scenes: BatchCompletedScene[];
}

interface PromptCompilerWorkbenchProps {
  activeSet: PromptSet;
  activeScene: SceneSpec;
  config: CompilerConfig;
  onChangeConfig: (next: Partial<CompilerConfig>) => void;
  onUpdateScene: (sceneId: string, patch: Partial<SceneSpec>) => void;
  onResetScene: (sceneId: string) => void;
}

export const PromptCompilerWorkbench: React.FC<PromptCompilerWorkbenchProps> = ({
  activeSet,
  activeScene,
  config,
  onChangeConfig,
  onUpdateScene,
  onResetScene,
}) => {
  const [copiedTarget, setCopiedTarget] = useState<'positive' | 'negative' | 'comfy' | null>(null);
  const [renderBackend, setRenderBackend] = useState<LocalRenderBackend>('a1111');
  const [endpointUrl, setEndpointUrl] = useState<string>('http://127.0.0.1:7860');
  const [resolutionMode, setResolutionMode] = useState<RenderResolutionMode>('fast');
  const [upscaleMultiplier, setUpscaleMultiplier] = useState<number>(2);
  const [restoreFaces, setRestoreFaces] = useState<boolean>(false);
  const [gfpganVisibility, setGfpganVisibility] = useState<number>(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isUpscaling, setIsUpscaling] = useState(false);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState<BatchProgressEvent | null>(null);
  const [sceneStageMap, setSceneStageMap] = useState<
    Record<string, 'pending' | BatchProgressStage>
  >({});
  const [contactSheetResult, setContactSheetResult] = useState<StoredBatchContactSheet | null>(
    null
  );
  const [recoverableSheet, setRecoverableSheet] = useState<StoredBatchContactSheet | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const [batchStatus, setBatchStatus] = useState<{
    tone: 'progress' | 'success' | 'error';
    message: string;
  } | null>(null);
  const [renderedImage, setRenderedImage] = useState<string | null>(null);
  const [renderedSeed, setRenderedSeed] = useState<number | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [rerollingSceneId, setRerollingSceneId] = useState<string | null>(null);
  const [preflightChecks, setPreflightChecks] = useState<PreflightCheckResult[] | null>(null);
  const [isCheckingPreflight, setIsCheckingPreflight] = useState<boolean>(false);

  // ControlNet & ADetailer state
  const [enableADetailer, setEnableADetailer] = useState<boolean>(true);
  const [controlImageBase64, setControlImageBase64] = useState<string | null>(null);
  const [controlModule, setControlModule] = useState<ControlNetModule>('openpose');
  const [controlWeight, setControlWeight] = useState<number>(0.85);
  const [isDragOverPose, setIsDragOverPose] = useState<boolean>(false);
  const poseInputRef = useRef<HTMLInputElement | null>(null);

  // Local Export & Instagram Distribution state
  const [igCaption, setIgCaption] = useState<string>('New shoot out now.');
  const [igEndpointUrl, setIgEndpointUrl] = useState<string>('http://127.0.0.1:5001');
  const [isSavingLocal, setIsSavingLocal] = useState<boolean>(false);
  const [isSavingBatchLocal, setIsSavingBatchLocal] = useState<boolean>(false);
  const [isPostingIg, setIsPostingIg] = useState<boolean>(false);
  const [distributionStatus, setDistributionStatus] = useState<{
    tone: 'success' | 'error';
    message: string;
    url?: string;
  } | null>(null);

  // Automated LoRA Training state
  const [stagedPhotos, setStagedPhotos] = useState<string[]>([]);
  const [isUploadingDataset, setIsUploadingDataset] = useState<boolean>(false);
  const [loraTriggerWord, setLoraTriggerWord] = useState<string>('ohwx_model');
  const [loraOutputName, setLoraOutputName] = useState<string>('yourname_lora');
  const [loraVramProfile, setLoraVramProfile] = useState<LoraTrainingVramProfile>('standard_8gb');
  const [loraMaxSteps, setLoraMaxSteps] = useState<number>(1500);
  const [kohyaDir, setKohyaDir] = useState<string>('C:/kohya_ss/sd-scripts');
  const [sdBaseModelPath, setSdBaseModelPath] = useState<string>(
    'C:/A1111/models/Stable-diffusion/v1-5-pruned-emaonly.safetensors'
  );
  const [loraOutputDir, setLoraOutputDir] = useState<string>('C:/A1111/models/Lora');
  const [showAdvancedLoraPaths, setShowAdvancedLoraPaths] = useState<boolean>(false);
  const [isTrainingLora, setIsTrainingLora] = useState<boolean>(false);
  const [loraTrainStatus, setLoraTrainStatus] = useState<{
    tone: 'success' | 'error';
    message: string;
    log?: string;
  } | null>(null);
  const datasetInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/lora-dataset')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { files?: string[] } | null) => {
        if (!cancelled && Array.isArray(data?.files)) {
          setStagedPhotos(data.files);
        }
      })
      .catch(() => {
        // ignore initial status fetch errors
      });

    try {
      const savedRaw = localStorage.getItem(STORAGE_KEY_BATCH_RECOVERY);
      if (savedRaw) {
        const parsed = JSON.parse(savedRaw) as StoredBatchContactSheet;
        if (parsed && Array.isArray(parsed.scenes) && parsed.scenes.length > 0) {
          setRecoverableSheet(parsed);
        }
      }
    } catch {
      // ignore corrupted localStorage entry
    }

    return () => {
      cancelled = true;
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
  }, []);

  const positivePrompt = useMemo(
    () => compilePositivePrompt(activeScene, config),
    [activeScene, config]
  );

  const negativePrompt = useMemo(
    () => compileNegativePrompt(activeScene, config),
    [activeScene, config]
  );

  const comfyJson = useMemo(
    () => buildComfyWorkflowJson(activeScene, config),
    [activeScene, config]
  );

  const cfgAssessment = useMemo(
    () => assessCfgScale(config.cfgScale, config.engine),
    [config.cfgScale, config.engine]
  );

  const lightingCheck = useMemo(() => checkLightingConsistency(activeScene), [activeScene]);

  const handleCopy = async (text: string, target: 'positive' | 'negative' | 'comfy') => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for restricted clipboard environments
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopiedTarget(target);
    window.setTimeout(() => {
      setCopiedTarget((prev) => (prev === target ? null : prev));
    }, 1800);
  };

  const handleDownloadFile = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleLightingSelect = (lightingId: LightingId) => {
    const option = LIGHTING_OPTIONS.find((opt) => opt.id === lightingId);
    onUpdateScene(activeScene.id, {
      lightingId,
      lightingPhrase: option ? option.phrase : activeScene.lightingPhrase,
    });
  };

  const handleBackendChange = (nextBackend: LocalRenderBackend) => {
    setRenderBackend(nextBackend);
    setRenderError(null);
    if (nextBackend === 'a1111' && endpointUrl === 'http://127.0.0.1:8188') {
      setEndpointUrl('http://127.0.0.1:7860');
    } else if (nextBackend === 'comfyui' && endpointUrl === 'http://127.0.0.1:7860') {
      setEndpointUrl('http://127.0.0.1:8188');
    }
  };

  const handlePoseFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setRenderError('Reference pose file must be an image (PNG, JPG, or WEBP).');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setControlImageBase64(reader.result);
        setRenderError(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const clearPoseReference = () => {
    setControlImageBase64(null);
    if (poseInputRef.current) {
      poseInputRef.current.value = '';
    }
  };

  const persistContactSheet = (sheet: StoredBatchContactSheet) => {
    try {
      localStorage.setItem(STORAGE_KEY_BATCH_RECOVERY, JSON.stringify(sheet));
    } catch {
      setStorageWarning(
        'Contact sheet exceeds browser localStorage quota (~5MB) and could not be cached across page reloads. Download PNGs or ZIP now.'
      );
    }
  };

  const handleCheckPipeline = async () => {
    setIsCheckingPreflight(true);
    try {
      const query = buildPreflightQuery({
        a1111: renderBackend === 'a1111' ? endpointUrl : 'http://127.0.0.1:7860',
        comfy: renderBackend === 'comfyui' ? endpointUrl : 'http://127.0.0.1:8188',
        ig: igEndpointUrl,
        loraName: config.loraEnabled ? config.loraName : '',
      });
      const res = await fetch(`/api/preflight?${query}`);
      const data = (await res.json()) as { success?: boolean; checks?: PreflightCheckResult[] };
      if (res.ok && Array.isArray(data.checks)) {
        setPreflightChecks(data.checks);
      } else {
        setPreflightChecks([
          { id: 'a1111', ok: false, detail: 'Preflight endpoint failed to respond.' },
        ]);
      }
    } catch {
      setPreflightChecks([
        { id: 'a1111', ok: false, detail: 'Network error reaching /api/preflight.' },
      ]);
    } finally {
      setIsCheckingPreflight(false);
    }
  };

  const handleRenderScene = async () => {
    setIsGenerating(true);
    setRenderError(null);
    setDistributionStatus(null);

    try {
      const useControlNet = renderBackend === 'a1111' && Boolean(controlImageBase64);
      const targetRoute = useControlNet ? '/api/render-controlled' : '/api/render-image';
      const activeSeed =
        typeof config.seed === 'number' && Number.isInteger(config.seed) && config.seed >= 0
          ? config.seed
          : -1;

      const requestBody =
        renderBackend === 'comfyui'
          ? {
              target: 'comfyui',
              endpointUrl,
              seed: activeSeed,
              comfyPromptGraph: buildComfyPromptApiGraph(activeScene, config, resolutionMode),
            }
          : (() => {
              const p = buildA1111Txt2ImgPayload(activeScene, config, resolutionMode);
              return {
                target: 'a1111',
                endpointUrl,
                positivePrompt: p.prompt,
                negativePrompt: p.negative_prompt,
                cfgScale: p.cfg_scale,
                steps: p.steps,
                seed: p.seed,
                width: p.width,
                height: p.height,
                samplerName: p.sampler_name,
                enableADetailer,
                ...(useControlNet
                  ? {
                      controlImageBase64,
                      controlModule,
                      controlWeight,
                    }
                  : {}),
              };
            })();

      const res = await fetch(targetRoute, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const data = (await res.json()) as {
        success?: boolean;
        image?: string;
        seed?: number;
        error?: string;
      };
      if (res.ok && data.success && data.image) {
        setRenderedImage(data.image);
        setRenderedSeed(typeof data.seed === 'number' ? data.seed : null);
      } else {
        setRenderError(
          data.error ||
            'Local render failed. Verify Automatic1111 (--api) or ComfyUI is running and reachable.'
        );
      }
    } catch {
      setRenderError('Network error communicating with the local render proxy.');
    } finally {
      setIsGenerating(false);
    }
  };

  const downloadDataUrl = (base64Data: string, filename: string) => {
    const link = document.createElement('a');
    link.href = base64Data;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleUpscalePreview = async () => {
    if (!renderedImage) return;
    setIsUpscaling(true);
    setRenderError(null);

    try {
      const upscaleEndpoint =
        renderBackend === 'a1111' ? endpointUrl : 'http://127.0.0.1:7860';
      const activeGfpgan = restoreFaces ? Math.max(0.05, gfpganVisibility || 0.5) : 0;
      const res = await fetch('/api/upscale-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: renderedImage,
          upscaleMultiplier,
          restoreFaces,
          gfpganVisibility: activeGfpgan,
          upscalerName: 'R-ESRGAN 4x+',
          endpointUrl: upscaleEndpoint,
        }),
      });
      const data = (await res.json()) as { success?: boolean; image?: string; error?: string };
      if (res.ok && data.success && data.image) {
        setRenderedImage(data.image);
      } else {
        setRenderError(data.error || 'Upscaler failed. Check A1111 console.');
      }
    } catch {
      setRenderError('Network error reaching /api/upscale-image.');
    } finally {
      setIsUpscaling(false);
    }
  };

  const handleBatchRender = async (scenes: SceneSpec[]) => {
    if (scenes.length === 0) return;
    eventSourceRef.current?.close();
    eventSourceRef.current = null;

    setIsBatchRunning(true);
    setRenderError(null);
    setStorageWarning(null);
    setContactSheetResult(null);

    const initialStages: Record<string, 'pending' | BatchProgressStage> = {};
    for (const sc of scenes) {
      initialStages[sc.id] = 'pending';
    }
    setSceneStageMap(initialStages);
    setBatchProgress({
      jobId: 'pending',
      status: 'queued',
      current: 0,
      total: scenes.length,
      sceneTitle: scenes[0].title,
      stage: 'render',
    });
    setBatchStatus({
      tone: 'progress',
      message: `Queueing ${scenes.length} scenes on local GPU (concurrency = 1)...`,
    });

    try {
      const requestPayload = buildBatchRenderRequest(scenes, config, {
        engine: renderBackend,
        endpointUrl,
        resolutionMode,
        enableADetailer,
        controlImageBase64,
        controlModule,
        controlWeight,
        upscaleEnabled: true,
        upscaleMultiplier,
        restoreFaces,
        gfpganVisibility,
        upscaleEndpointUrl: renderBackend === 'a1111' ? endpointUrl : 'http://127.0.0.1:7860',
      });

      const res = await fetch('/api/batch-render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload),
      });
      const data = (await res.json()) as {
        success?: boolean;
        jobId?: string;
        total?: number;
        error?: string;
      };

      if (!res.ok || !data.success || !data.jobId) {
        throw new Error(data.error || 'Failed to enqueue batch render job.');
      }

      const jobId = data.jobId;
      setActiveJobId(jobId);

      const source = new EventSource(`/api/batch-progress/${jobId}`);
      eventSourceRef.current = source;

      source.onmessage = (msg) => {
        try {
          const ev = JSON.parse(msg.data) as BatchProgressEvent;
          setBatchProgress(ev);

          if (ev.status === 'running') {
            const nextMap: Record<string, 'pending' | BatchProgressStage> = {};
            scenes.forEach((sc, idx) => {
              if (idx < ev.current - 1) {
                nextMap[sc.id] = 'done';
              } else if (sc.id === ev.sceneId || idx === ev.current - 1) {
                nextMap[sc.id] = ev.stage;
              } else {
                nextMap[sc.id] = 'pending';
              }
            });
            setSceneStageMap(nextMap);
            setBatchStatus({
              tone: 'progress',
              message: `${ev.stage === 'upscale' ? 'Upscaling (R-ESRGAN 4x+)' : 'Rendering'} ${ev.current} / ${ev.total}: ${ev.sceneTitle}`,
            });
          } else if (ev.status === 'completed' && Array.isArray(ev.scenes)) {
            source.close();
            eventSourceRef.current = null;
            setIsBatchRunning(false);
            setActiveJobId(null);

            const doneMap: Record<string, 'pending' | BatchProgressStage> = {};
            scenes.forEach((sc) => {
              doneMap[sc.id] = 'done';
            });
            setSceneStageMap(doneMap);

            const sheet: StoredBatchContactSheet = {
              jobId: ev.jobId,
              setId: activeSet.id,
              setName: activeSet.name,
              completedAt: new Date().toISOString(),
              caption: igCaption,
              scenes: ev.scenes.map((sc) => ({ ...sc, kept: sc.kept !== false })),
            };
            setContactSheetResult(sheet);
            setRecoverableSheet(null);

            if (ev.scenes.length > 0) {
              const lastScene = ev.scenes[ev.scenes.length - 1];
              setRenderedImage(lastScene.imageBase64);
              setRenderedSeed(typeof lastScene.seed === 'number' ? lastScene.seed : null);
            }

            // Persist completed base64 contact sheet, seeds, keep flags, and caption for reload recovery.
            // Note: ~5MB localStorage browser quota can be exceeded by large high-res base64 sheets.
            persistContactSheet(sheet);

            setBatchStatus({
              tone: 'success',
              message: `Contact sheet ready: ${ev.scenes.length} upscaled renders complete.`,
            });
          } else if (ev.status === 'error' || ev.status === 'cancelled') {
            source.close();
            eventSourceRef.current = null;
            setIsBatchRunning(false);
            setActiveJobId(null);

            setSceneStageMap((prev) => {
              const updated = { ...prev };
              if (ev.sceneId) {
                updated[ev.sceneId] = 'error';
              }
              return updated;
            });

            setBatchStatus({
              tone: 'error',
              message: ev.error || 'Batch job stopped before completion.',
            });
          }
        } catch {
          // ignore malformed SSE frame
        }
      };

      source.onerror = () => {
        if (source.readyState === EventSource.CLOSED) return;
        source.close();
        eventSourceRef.current = null;
        setIsBatchRunning(false);
        setActiveJobId(null);
        setBatchStatus({
          tone: 'error',
          message: 'Lost SSE progress connection to /api/batch-progress.',
        });
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Batch execution failed.';
      setIsBatchRunning(false);
      setActiveJobId(null);
      setBatchStatus({
        tone: 'error',
        message: msg,
      });
    }
  };

  const handleCancelBatch = async () => {
    const jobToCancel = activeJobId;
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setIsBatchRunning(false);
    setActiveJobId(null);
    setBatchStatus({
      tone: 'error',
      message: 'Cancelling batch job and dropping remaining queue...',
    });

    if (jobToCancel) {
      try {
        await fetch(`/api/batch-cancel/${jobToCancel}`, { method: 'POST' });
      } catch {
        // ignore cancel request error after local SSE abort
      }
    }
    setBatchStatus({
      tone: 'error',
      message: 'Batch job cancelled. Remaining queued scenes dropped.',
    });
  };

  const keptContactScenes = useMemo(
    () => (contactSheetResult ? filterKeptScenes(contactSheetResult.scenes) : []),
    [contactSheetResult]
  );
  const allContactTilesKilled = Boolean(
    contactSheetResult && contactSheetResult.scenes.length > 0 && keptContactScenes.length === 0
  );

  const handleToggleTileKeep = (sceneId: string, kept: boolean) => {
    if (!contactSheetResult) return;
    const updatedSheet: StoredBatchContactSheet = {
      ...contactSheetResult,
      caption: igCaption,
      scenes: contactSheetResult.scenes.map((sc) =>
        sc.sceneId === sceneId ? { ...sc, kept } : sc
      ),
    };
    setContactSheetResult(updatedSheet);
    persistContactSheet(updatedSheet);
  };

  const handleRerollTile = async (tile: BatchCompletedScene, index: number) => {
    if (isBatchRunning || isGenerating || rerollingSceneId) return;

    setRerollingSceneId(tile.sceneId);
    setRenderError(null);
    setBatchStatus({
      tone: 'progress',
      message: `Rerolling ${tile.title} through ${renderBackend === 'comfyui' ? 'ComfyUI' : 'A1111'} + R-ESRGAN 4x+...`,
    });

    try {
      const sceneSpec =
        activeSet.scenes.find((s) => s.id === tile.sceneId) ??
        activeSet.scenes[index] ??
        activeScene;

      const rerollConfig: CompilerConfig =
        config.seedLocked && typeof config.seed === 'number' && config.seed >= 0
          ? config
          : { ...config, seed: -1 };

      const useControlNet = renderBackend === 'a1111' && Boolean(controlImageBase64);
      const targetRoute = useControlNet ? '/api/render-controlled' : '/api/render-image';
      const requestBody =
        renderBackend === 'comfyui'
          ? {
              target: 'comfyui',
              endpointUrl,
              comfyPromptGraph: buildComfyPromptApiGraph(sceneSpec, rerollConfig, resolutionMode),
            }
          : (() => {
              const p = buildA1111Txt2ImgPayload(sceneSpec, rerollConfig, resolutionMode);
              return {
                target: 'a1111',
                endpointUrl,
                positivePrompt: p.prompt,
                negativePrompt: p.negative_prompt,
                cfgScale: p.cfg_scale,
                steps: p.steps,
                seed: p.seed,
                width: p.width,
                height: p.height,
                samplerName: p.sampler_name,
                enableADetailer,
                ...(useControlNet
                  ? {
                      controlImageBase64,
                      controlModule,
                      controlWeight,
                    }
                  : {}),
              };
            })();

      const renderRes = await fetch(targetRoute, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      const renderData = (await renderRes.json()) as {
        success?: boolean;
        image?: string;
        seed?: number;
        error?: string;
      };
      if (!renderRes.ok || !renderData.success || !renderData.image) {
        throw new Error(renderData.error || `Reroll render failed for ${tile.title}.`);
      }

      const upscaleEndpoint =
        renderBackend === 'a1111' ? endpointUrl : 'http://127.0.0.1:7860';
      const activeGfpgan = restoreFaces ? Math.max(0.05, gfpganVisibility || 0.5) : 0;
      const upscaleRes = await fetch('/api/upscale-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: renderData.image,
          upscaleMultiplier,
          restoreFaces,
          gfpganVisibility: activeGfpgan,
          upscalerName: 'R-ESRGAN 4x+',
          endpointUrl: upscaleEndpoint,
        }),
      });
      const upscaleData = (await upscaleRes.json()) as {
        success?: boolean;
        image?: string;
        error?: string;
      };
      if (!upscaleRes.ok || !upscaleData.success || !upscaleData.image) {
        throw new Error(upscaleData.error || `Reroll upscale failed for ${tile.title}.`);
      }

      const nextSeed = typeof renderData.seed === 'number' ? renderData.seed : tile.seed;
      const baseDims = getRenderDimensions(config.aspectRatio, resolutionMode);
      const nextWidth = baseDims.width * upscaleMultiplier;
      const nextHeight = baseDims.height * upscaleMultiplier;

      setContactSheetResult((prev) => {
        if (!prev) return prev;
        const updatedSheet: StoredBatchContactSheet = {
          ...prev,
          caption: igCaption,
          scenes: prev.scenes.map((sc) =>
            sc.sceneId === tile.sceneId
              ? {
                  ...sc,
                  imageBase64: upscaleData.image!,
                  width: nextWidth,
                  height: nextHeight,
                  ...(nextSeed !== undefined ? { seed: nextSeed } : {}),
                }
              : sc
          ),
        };
        persistContactSheet(updatedSheet);
        return updatedSheet;
      });

      setBatchStatus({
        tone: 'success',
        message: `Rerolled ${tile.title}${nextSeed !== undefined ? ` (seed ${nextSeed})` : ''}.`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : `Reroll failed for ${tile.title}.`;
      setBatchStatus({
        tone: 'error',
        message: msg,
      });
    } finally {
      setRerollingSceneId(null);
    }
  };

  const handleDownloadContactSheetZip = () => {
    if (!contactSheetResult || contactSheetResult.scenes.length === 0) return;
    const kept = filterKeptScenes(contactSheetResult.scenes);
    if (kept.length === 0) return;

    const entries = kept.map((sc) => {
      const origIdx = contactSheetResult.scenes.findIndex((x) => x.sceneId === sc.sceneId);
      const idx = origIdx >= 0 ? origIdx : 0;
      return {
        filename: formatBatchUpscaledFilename(idx, sc.title, sc.seed),
        data: decodeBase64ToUint8Array(sc.imageBase64),
      };
    });
    const zipBytes = buildZipArchive(entries);
    const blob = new Blob([zipBytes.buffer as ArrayBuffer], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const slug =
      contactSheetResult.setName
        .replace(/[^a-z0-9]+/gi, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase() || 'framecraft';
    const link = document.createElement('a');
    link.href = url;
    link.download = `${slug}_contact_sheet.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleSaveBatchSceneLocal = async (sc: BatchCompletedScene, index: number) => {
    try {
      const filename = formatBatchUpscaledFilename(index, sc.title, sc.seed);
      const res = await fetch('/api/save-local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: sc.imageBase64,
          filename,
        }),
      });
      const data = (await res.json()) as { success?: boolean; filename?: string; error?: string };
      if (res.ok && data.success) {
        setDistributionStatus({
          tone: 'success',
          message: `Saved ${data.filename || filename} to ./exports/.`,
        });
      } else {
        setDistributionStatus({
          tone: 'error',
          message: data.error || 'Could not save scene to ./exports/.',
        });
      }
    } catch {
      setDistributionStatus({
        tone: 'error',
        message: 'Network error reaching /api/save-local.',
      });
    }
  };

  const handleSaveAllBatchLocal = async () => {
    if (!contactSheetResult || contactSheetResult.scenes.length === 0) return;
    const kept = filterKeptScenes(contactSheetResult.scenes);
    if (kept.length === 0) return;

    setIsSavingBatchLocal(true);
    setDistributionStatus(null);

    try {
      const savedNames: string[] = [];
      for (const sc of kept) {
        const origIdx = contactSheetResult.scenes.findIndex((x) => x.sceneId === sc.sceneId);
        const idx = origIdx >= 0 ? origIdx : 0;
        const filename = formatBatchUpscaledFilename(idx, sc.title, sc.seed);
        const res = await fetch('/api/save-local', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: sc.imageBase64,
            filename,
          }),
        });
        const data = (await res.json()) as { success?: boolean; filename?: string; error?: string };
        if (!res.ok || !data.success) {
          throw new Error(data.error || `Failed saving ${filename} to ./exports/.`);
        }
        savedNames.push(data.filename || filename);
      }

      setDistributionStatus({
        tone: 'success',
        message: `Saved ${savedNames.length} upscaled PNGs to ./exports/ (${savedNames.join(', ')}).`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed saving contact sheet to ./exports/.';
      setDistributionStatus({
        tone: 'error',
        message: msg,
      });
    } finally {
      setIsSavingBatchLocal(false);
    }
  };

  const handleRestoreRecoveredSheet = () => {
    if (!recoverableSheet) return;
    const normalized: StoredBatchContactSheet = {
      ...recoverableSheet,
      scenes: recoverableSheet.scenes.map((sc) => ({ ...sc, kept: sc.kept !== false })),
    };
    setContactSheetResult(normalized);
    if (normalized.scenes.length > 0) {
      const last = normalized.scenes[normalized.scenes.length - 1];
      setRenderedImage(last.imageBase64);
      setRenderedSeed(typeof last.seed === 'number' ? last.seed : null);
    }
    if (typeof normalized.caption === 'string' && normalized.caption.trim().length > 0) {
      setIgCaption(normalized.caption);
    }
    setRecoverableSheet(null);
  };

  const handleDiscardRecoveredSheet = () => {
    setRecoverableSheet(null);
    try {
      localStorage.removeItem(STORAGE_KEY_BATCH_RECOVERY);
    } catch {
      // ignore
    }
  };

  const handleCaptionChange = (nextCaption: string) => {
    setIgCaption(nextCaption);
    if (contactSheetResult) {
      const updated = { ...contactSheetResult, caption: nextCaption };
      setContactSheetResult(updated);
      persistContactSheet(updated);
    }
  };

  const handleCaptionFromScene = () => {
    const generated = buildSceneCaption({
      title: activeScene.title,
      lighting: activeScene.lightingPhrase,
      lens: activeScene.focalLengthLabel || activeScene.cameraAndLens,
      wardrobe: activeScene.wardrobe,
    });
    handleCaptionChange(generated);
  };

  const handleSaveLocalExport = async () => {
    if (!renderedImage) return;
    setIsSavingLocal(true);
    setDistributionStatus(null);

    try {
      const filename = sanitizeExportFilename(`${activeScene.id}_render.png`);
      const res = await fetch('/api/save-local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: renderedImage,
          filename,
        }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        path?: string;
        filename?: string;
        error?: string;
      };
      if (res.ok && data.success && data.path) {
        setDistributionStatus({
          tone: 'success',
          message: `Saved to exports/${data.filename || filename}.`,
        });
      } else {
        setDistributionStatus({
          tone: 'error',
          message: data.error || 'Could not save PNG into exports/.',
        });
      }
    } catch {
      setDistributionStatus({
        tone: 'error',
        message: 'Network error reaching /api/save-local.',
      });
    } finally {
      setIsSavingLocal(false);
    }
  };

  const handlePostToIg = async () => {
    if (!renderedImage) return;
    setIsPostingIg(true);
    setDistributionStatus(null);

    try {
      const filename = sanitizeExportFilename(`${activeScene.id}_ig.png`);
      const saveRes = await fetch('/api/save-local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: renderedImage,
          filename,
        }),
      });
      const saveData = (await saveRes.json()) as {
        success?: boolean;
        path?: string;
        error?: string;
      };

      if (!saveRes.ok || !saveData.success || !saveData.path) {
        setDistributionStatus({
          tone: 'error',
          message: saveData.error || 'Failed to save render to exports/ before posting.',
        });
        return;
      }

      const postRes = await fetch('/api/post-ig', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_path: saveData.path,
          caption: igCaption,
          igEndpointUrl,
        }),
      });
      const postData = (await postRes.json()) as {
        success?: boolean;
        url?: string;
        error?: string;
      };

      if (postRes.ok && postData.success) {
        setDistributionStatus({
          tone: 'success',
          message: 'Published to Instagram via ig_poster.py.',
          url: postData.url,
        });
      } else {
        setDistributionStatus({
          tone: 'error',
          message:
            postData.error ||
            'Instagram microservice unreachable. Run python ig_poster.py on port 5001.',
        });
      }
    } catch {
      setDistributionStatus({
        tone: 'error',
        message: 'Network error communicating with /api/post-ig.',
      });
    } finally {
      setIsPostingIg(false);
    }
  };

  const handleDatasetUpload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setIsUploadingDataset(true);
    setLoraTrainStatus(null);

    try {
      const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
      if (files.length === 0) {
        setLoraTrainStatus({
          tone: 'error',
          message: 'Select PNG, JPG, or WEBP subject photos for LoRA dataset prep.',
        });
        return;
      }

      const encoded = await Promise.all(
        files.map(
          (file) =>
            new Promise<{ filename: string; dataUrl: string }>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () =>
                resolve({
                  filename: file.name,
                  dataUrl: typeof reader.result === 'string' ? reader.result : '',
                });
              reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
              reader.readAsDataURL(file);
            })
        )
      );

      const res = await fetch('/api/lora-dataset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: encoded }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        files?: string[];
        added?: number;
        error?: string;
      };

      if (res.ok && data.success && Array.isArray(data.files)) {
        setStagedPhotos(data.files);
      } else {
        setLoraTrainStatus({
          tone: 'error',
          message: data.error || 'Could not stage dataset photos into ./lora_raw.',
        });
      }
    } catch {
      setLoraTrainStatus({
        tone: 'error',
        message: 'Network error uploading training photos.',
      });
    } finally {
      setIsUploadingDataset(false);
      if (datasetInputRef.current) {
        datasetInputRef.current.value = '';
      }
    }
  };

  const handleClearDataset = async () => {
    try {
      const res = await fetch('/api/lora-dataset', { method: 'DELETE' });
      if (res.ok) {
        setStagedPhotos([]);
        setLoraTrainStatus(null);
      }
    } catch {
      // ignore network failure on clear
    }
  };

  const handleTrainIdentity = async () => {
    setIsTrainingLora(true);
    setLoraTrainStatus(null);

    try {
      const res = await fetch('/api/train-lora', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          triggerWord: loraTriggerWord,
          outputName: loraOutputName,
          kohyaDir,
          baseModelPath: sdBaseModelPath,
          outputDir: loraOutputDir,
          maxSteps: loraMaxSteps,
          vramProfile: loraVramProfile,
        }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        outputName?: string;
        log?: string;
        error?: string;
      };

      if (res.ok && data.success) {
        const trainedName = data.outputName || loraOutputName;
        onChangeConfig({ loraName: trainedName, loraEnabled: true });
        setLoraTrainStatus({
          tone: 'success',
          message: `Training complete: ${trainedName}.safetensors ready and loaded into LoRA Trigger.`,
          log: data.log,
        });
      } else {
        setLoraTrainStatus({
          tone: 'error',
          message: data.error || 'LoRA training failed. Check Python & kohya_ss setup.',
          log: data.log,
        });
      }
    } catch {
      setLoraTrainStatus({
        tone: 'error',
        message: 'Network error communicating with /api/train-lora.',
      });
    } finally {
      setIsTrainingLora(false);
    }
  };

  const renderDims = getRenderDimensions(config.aspectRatio, resolutionMode);
  const upscaledWidth = renderDims.width * upscaleMultiplier;
  const upscaledHeight = renderDims.height * upscaleMultiplier;

  return (
    <section id="prompt-compiler" className="border-b border-[#E2E4E9] bg-[#F8F9FA]">
      <div className="mx-auto max-w-[1440px] px-6 py-12 lg:px-10">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold text-[#2563EB]">
              Scene {activeScene.sceneNumber} Active
            </p>
            <h2 className="mt-1 font-display text-2xl font-bold tracking-tight text-[#0B0C0E]">
              Prompt Compiler &amp; Parameter Deck
            </h2>
          </div>

          <button
            type="button"
            onClick={() => onResetScene(activeScene.id)}
            className="inline-flex min-h-[40px] items-center gap-2 self-start rounded-lg border border-[#D1D5DB] bg-white px-4 py-2 text-xs font-semibold text-[#0B0C0E] transition-colors hover:bg-[#F3F4F6] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB]"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Reset Scene {activeScene.sceneNumber}
          </button>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-start">
          {/* Left Column: Controls & Scene Token Editor */}
          <div className="space-y-6 rounded-xl border border-[#E2E4E9] bg-white p-6 lg:col-span-6">
            {/* LoRA & Identity Block */}
            <div>
              <div className="flex items-center justify-between gap-4">
                <h3 className="font-display text-base font-semibold text-[#0B0C0E]">
                  01. Subject LoRA &amp; Sampler Parameters
                </h3>
                <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-[#374151]">
                  <input
                    type="checkbox"
                    checked={config.loraEnabled}
                    onChange={(e) => onChangeConfig({ loraEnabled: e.target.checked })}
                    className="h-4 w-4 rounded border-[#D1D5DB] text-[#2563EB] focus:ring-[#2563EB]"
                  />
                  Include Subject LoRA
                </label>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="lora-name-input"
                    className="block text-xs font-medium text-[#4B5563]"
                  >
                    LoRA Trigger / File Name
                  </label>
                  <input
                    id="lora-name-input"
                    type="text"
                    value={config.loraName}
                    disabled={!config.loraEnabled}
                    onChange={(e) => onChangeConfig({ loraName: e.target.value })}
                    placeholder="yourname"
                    className="mt-1.5 min-h-[40px] w-full rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 font-mono text-sm text-[#0B0C0E] disabled:bg-[#F3F4F6] disabled:text-[#9CA3AF] focus:border-[#2563EB] focus:outline-none"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="lora-weight-slider"
                      className="text-xs font-medium text-[#4B5563]"
                    >
                      LoRA Strength
                    </label>
                    <span className="font-mono text-xs font-semibold text-[#0B0C0E] tabular-nums">
                      {config.loraWeight.toFixed(2)}
                    </span>
                  </div>
                  <input
                    id="lora-weight-slider"
                    type="range"
                    min="0.1"
                    max="1.2"
                    step="0.05"
                    disabled={!config.loraEnabled}
                    value={config.loraWeight}
                    onChange={(e) => onChangeConfig({ loraWeight: parseFloat(e.target.value) })}
                    className="mt-3 w-full accent-[#2563EB] disabled:opacity-50"
                  />
                </div>
              </div>

              {/* CFG Scale + Steps + Aspect Ratio */}
              <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <div className="flex items-center justify-between">
                    <label htmlFor="cfg-scale-slider" className="text-xs font-medium text-[#4B5563]">
                      CFG Scale
                    </label>
                    <span className="font-mono text-xs font-semibold text-[#0B0C0E] tabular-nums">
                      {config.cfgScale.toFixed(1)}
                    </span>
                  </div>
                  <input
                    id="cfg-scale-slider"
                    type="range"
                    min="1"
                    max="15"
                    step="0.5"
                    value={config.cfgScale}
                    onChange={(e) => onChangeConfig({ cfgScale: parseFloat(e.target.value) })}
                    className="mt-3 w-full accent-[#2563EB]"
                  />
                </div>

                <div>
                  <label htmlFor="steps-input" className="block text-xs font-medium text-[#4B5563]">
                    Sampling Steps
                  </label>
                  <input
                    id="steps-input"
                    type="number"
                    min={10}
                    max={80}
                    value={config.steps}
                    onChange={(e) =>
                      onChangeConfig({
                        steps: Math.min(80, Math.max(10, Number(e.target.value) || 30)),
                      })
                    }
                    className="mt-1.5 min-h-[40px] w-full rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 font-mono text-sm text-[#0B0C0E] tabular-nums focus:border-[#2563EB] focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="aspect-select" className="block text-xs font-medium text-[#4B5563]">
                    Aspect Ratio
                  </label>
                  <select
                    id="aspect-select"
                    value={config.aspectRatio}
                    onChange={(e) =>
                      onChangeConfig({ aspectRatio: e.target.value as AspectRatioOption })
                    }
                    className="mt-1.5 min-h-[40px] w-full rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 font-mono text-sm text-[#0B0C0E] focus:border-[#2563EB] focus:outline-none"
                  >
                    <option value="3:4">3:4 Portrait</option>
                    <option value="4:3">4:3 Editorial</option>
                    <option value="1:1">1:1 Square</option>
                    <option value="9:16">9:16 Vertical</option>
                    <option value="16:9">16:9 Cinema</option>
                  </select>
                </div>
              </div>

              {/* Seed Lock Row */}
              <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-[#E2E4E9] bg-[#F8F9FA] p-3">
                <div className="min-w-[140px] flex-1">
                  <label htmlFor="seed-input" className="block text-xs font-medium text-[#4B5563]">
                    Seed (−1 = Random)
                  </label>
                  <input
                    id="seed-input"
                    type="number"
                    min={-1}
                    step={1}
                    value={config.seed ?? -1}
                    onChange={(e) => {
                      const raw = parseInt(e.target.value, 10);
                      const nextSeed = Number.isNaN(raw) ? -1 : Math.max(-1, raw);
                      onChangeConfig({
                        seed: nextSeed,
                        ...(nextSeed < 0 ? { seedLocked: false } : {}),
                      });
                    }}
                    className="mt-1 min-h-[36px] w-full rounded-lg border border-[#D1D5DB] bg-white px-3 py-1.5 font-mono text-xs text-[#0B0C0E] tabular-nums focus:border-[#2563EB] focus:outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => onChangeConfig({ seed: -1, seedLocked: false })}
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-[#D1D5DB] bg-white px-3 py-1.5 text-xs font-semibold text-[#0B0C0E] transition-colors hover:bg-[#F3F4F6] whitespace-nowrap shrink-0"
                >
                  <Shuffle className="h-3.5 w-3.5 text-[#2563EB]" aria-hidden="true" />
                  Randomize (−1)
                </button>
                <label className="inline-flex min-h-[36px] cursor-pointer items-center gap-2 rounded-lg border border-[#E2E4E9] bg-white px-3 py-1.5 text-xs font-medium text-[#374151] whitespace-nowrap shrink-0">
                  <input
                    id="lock-seed-checkbox"
                    type="checkbox"
                    checked={Boolean(config.seedLocked)}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      if (checked && (config.seed ?? -1) < 0) {
                        const chosen =
                          renderedSeed !== null && renderedSeed >= 0
                            ? renderedSeed
                            : Math.floor(Math.random() * 1_000_000_000);
                        onChangeConfig({ seed: chosen, seedLocked: true });
                      } else {
                        onChangeConfig({ seedLocked: checked });
                      }
                    }}
                    className="h-4 w-4 rounded border-[#D1D5DB] text-[#2563EB] focus:ring-[#2563EB]"
                  />
                  Lock seed
                </label>
              </div>

              {/* CFG Guardrail Feedback (explicit icon + label, not color alone) */}
              <div
                data-testid="cfg-guardrail"
                className={`mt-4 flex items-start gap-2.5 rounded-lg border p-3 text-xs ${
                  cfgAssessment.status === 'optimal'
                    ? 'border-[#BBF7D0] bg-[#F0FDF4] text-[#166534]'
                    : cfgAssessment.status === 'low'
                      ? 'border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]'
                      : 'border-[#FECACA] bg-[#FEF2F2] text-[#991B1B]'
                }`}
              >
                {cfgAssessment.status === 'optimal' ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                )}
                <div>
                  <span className="font-semibold">{cfgAssessment.label}: </span>
                  <span>{cfgAssessment.detail}</span>
                </div>
              </div>

              {/* Automated Identity LoRA Factory */}
              <div
                data-testid="lora-trainer-panel"
                className="mt-5 rounded-lg border border-[#E2E4E9] bg-[#F8F9FA] p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="font-display text-sm font-semibold text-[#0B0C0E]">
                      Identity LoRA Trainer
                    </h4>
                    <p className="mt-0.5 text-xs text-[#4B5563]">
                      Stage 15–20 subject photos in <span className="font-mono">./lora_raw</span>,
                      BLIP-caption at 1024px, and launch Kohya training.
                    </p>
                  </div>
                  <span
                    data-testid="staged-dataset-count"
                    className="font-mono text-xs font-semibold text-[#0B0C0E] tabular-nums"
                  >
                    {stagedPhotos.length} photos staged
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    ref={datasetInputRef}
                    id="lora-dataset-file-input"
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(e) => handleDatasetUpload(e.target.files)}
                    className="sr-only"
                  />
                  <label
                    htmlFor="lora-dataset-file-input"
                    className="inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-lg border border-[#D1D5DB] bg-white px-3 py-1.5 text-xs font-semibold text-[#0B0C0E] transition-colors hover:bg-[#F3F4F6] whitespace-nowrap shrink-0"
                  >
                    <Upload className="h-3.5 w-3.5 text-[#2563EB]" aria-hidden="true" />
                    {isUploadingDataset ? 'Staging Photos...' : 'Upload Subject Photos'}
                  </label>
                  {stagedPhotos.length > 0 && (
                    <button
                      type="button"
                      onClick={handleClearDataset}
                      disabled={isTrainingLora}
                      className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-[#D1D5DB] bg-white px-2.5 py-1.5 text-xs font-medium text-[#4B5563] hover:bg-[#F3F4F6] hover:text-[#0B0C0E] disabled:opacity-50 whitespace-nowrap shrink-0"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Clear Dataset
                    </button>
                  )}
                </div>

                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="lora-trigger-word-input"
                      className="block text-[11px] font-medium text-[#4B5563]"
                    >
                      Unique Trigger Word
                    </label>
                    <input
                      id="lora-trigger-word-input"
                      type="text"
                      value={loraTriggerWord}
                      onChange={(e) => setLoraTriggerWord(e.target.value)}
                      placeholder="ohwx_model"
                      className="mt-1 min-h-[36px] w-full rounded-lg border border-[#D1D5DB] bg-white px-2.5 py-1.5 font-mono text-xs text-[#0B0C0E] focus:border-[#2563EB] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="lora-output-name-input"
                      className="block text-[11px] font-medium text-[#4B5563]"
                    >
                      Output .safetensors Name
                    </label>
                    <input
                      id="lora-output-name-input"
                      type="text"
                      value={loraOutputName}
                      onChange={(e) => setLoraOutputName(e.target.value)}
                      placeholder="yourname_lora"
                      className="mt-1 min-h-[36px] w-full rounded-lg border border-[#D1D5DB] bg-white px-2.5 py-1.5 font-mono text-xs text-[#0B0C0E] focus:border-[#2563EB] focus:outline-none"
                    />
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="lora-vram-select"
                      className="block text-[11px] font-medium text-[#4B5563]"
                    >
                      GPU VRAM Profile
                    </label>
                    <select
                      id="lora-vram-select"
                      value={loraVramProfile}
                      onChange={(e) =>
                        setLoraVramProfile(e.target.value as LoraTrainingVramProfile)
                      }
                      className="mt-1 min-h-[36px] w-full rounded-lg border border-[#D1D5DB] bg-white px-2.5 py-1.5 text-xs text-[#0B0C0E] focus:border-[#2563EB] focus:outline-none"
                    >
                      <option value="standard_8gb">8–12 GB VRAM (Batch 2 · Dim 32)</option>
                      <option value="compact_6gb">6 GB VRAM (Batch 1 · Dim 16)</option>
                    </select>
                  </div>
                  <div>
                    <label
                      htmlFor="lora-max-steps-input"
                      className="block text-[11px] font-medium text-[#4B5563]"
                    >
                      Max Training Steps
                    </label>
                    <input
                      id="lora-max-steps-input"
                      type="number"
                      min={200}
                      max={5000}
                      step={100}
                      value={loraMaxSteps}
                      onChange={(e) =>
                        setLoraMaxSteps(
                          Math.min(5000, Math.max(200, Number(e.target.value) || 1500))
                        )
                      }
                      className="mt-1 min-h-[36px] w-full rounded-lg border border-[#D1D5DB] bg-white px-2.5 py-1.5 font-mono text-xs text-[#0B0C0E] tabular-nums focus:border-[#2563EB] focus:outline-none"
                    />
                  </div>
                </div>

                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => setShowAdvancedLoraPaths((prev) => !prev)}
                    aria-expanded={showAdvancedLoraPaths}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#4B5563] hover:text-[#0B0C0E]"
                  >
                    <ChevronDown
                      className={`h-3.5 w-3.5 transition-transform ${
                        showAdvancedLoraPaths ? 'rotate-180' : ''
                      }`}
                      aria-hidden="true"
                    />
                    Local Kohya &amp; Checkpoint Paths
                  </button>

                  {showAdvancedLoraPaths && (
                    <div className="mt-2.5 space-y-2.5 rounded-lg border border-[#E2E4E9] bg-white p-3">
                      <div>
                        <label
                          htmlFor="kohya-dir-input"
                          className="block text-[11px] font-medium text-[#4B5563]"
                        >
                          Kohya sd-scripts Directory
                        </label>
                        <input
                          id="kohya-dir-input"
                          type="text"
                          value={kohyaDir}
                          onChange={(e) => setKohyaDir(e.target.value)}
                          className="mt-1 min-h-[34px] w-full rounded-md border border-[#D1D5DB] px-2.5 py-1 font-mono text-xs text-[#0B0C0E] focus:border-[#2563EB] focus:outline-none"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="sd-base-model-input"
                          className="block text-[11px] font-medium text-[#4B5563]"
                        >
                          Base Checkpoint (.safetensors)
                        </label>
                        <input
                          id="sd-base-model-input"
                          type="text"
                          value={sdBaseModelPath}
                          onChange={(e) => setSdBaseModelPath(e.target.value)}
                          className="mt-1 min-h-[34px] w-full rounded-md border border-[#D1D5DB] px-2.5 py-1 font-mono text-xs text-[#0B0C0E] focus:border-[#2563EB] focus:outline-none"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="lora-output-dir-input"
                          className="block text-[11px] font-medium text-[#4B5563]"
                        >
                          A1111 LoRA Output Directory
                        </label>
                        <input
                          id="lora-output-dir-input"
                          type="text"
                          value={loraOutputDir}
                          onChange={(e) => setLoraOutputDir(e.target.value)}
                          className="mt-1 min-h-[34px] w-full rounded-md border border-[#D1D5DB] px-2.5 py-1 font-mono text-xs text-[#0B0C0E] focus:border-[#2563EB] focus:outline-none"
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2.5">
                  <button
                    type="button"
                    onClick={handleTrainIdentity}
                    disabled={isTrainingLora || isUploadingDataset || isBatchRunning}
                    className="inline-flex min-h-[38px] items-center gap-2 rounded-lg bg-[#0B0C0E] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#1F2937] disabled:opacity-60 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB]"
                  >
                    {isTrainingLora ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        Preparing &amp; Training...
                      </>
                    ) : (
                      <>
                        <Cpu className="h-3.5 w-3.5" aria-hidden="true" />
                        Train Identity
                      </>
                    )}
                  </button>
                  <span className="text-[11px] text-[#4B5563]">
                    Prepares 1024px dataset + runs <span className="font-mono">train_lora.py</span>
                  </span>
                </div>

                {loraTrainStatus && (
                  <div
                    role="status"
                    data-testid="lora-train-status-banner"
                    className={`mt-3 rounded-lg border p-3 text-xs ${
                      loraTrainStatus.tone === 'success'
                        ? 'border-[#BBF7D0] bg-[#F0FDF4] text-[#166534]'
                        : 'border-[#FECACA] bg-[#FEF2F2] text-[#991B1B]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2">
                        {loraTrainStatus.tone === 'success' ? (
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                        ) : (
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                        )}
                        <p className="leading-relaxed">{loraTrainStatus.message}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setLoraTrainStatus(null)}
                        aria-label="Dismiss LoRA training status"
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-black/5"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                    {loraTrainStatus.log && (
                      <pre className="mt-2 max-h-28 overflow-auto rounded bg-white/80 p-2 font-mono text-[11px] text-[#1F2937]">
                        {loraTrainStatus.log}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            </div>

            <hr className="border-[#E2E4E9]" />

            {/* Lighting & Optics */}
            <div>
              <h3 className="font-display text-base font-semibold text-[#0B0C0E]">
                02. Lighting Physics &amp; Camera Optics
              </h3>

              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="lighting-select"
                    className="block text-xs font-medium text-[#4B5563]"
                  >
                    Lighting Setup
                  </label>
                  <select
                    id="lighting-select"
                    value={activeScene.lightingId}
                    onChange={(e) => handleLightingSelect(e.target.value as LightingId)}
                    className="mt-1.5 min-h-[40px] w-full rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#0B0C0E] focus:border-[#2563EB] focus:outline-none"
                  >
                    {LIGHTING_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="camera-select" className="block text-xs font-medium text-[#4B5563]">
                    Camera &amp; Lens Body
                  </label>
                  <select
                    id="camera-select"
                    value={
                      CAMERA_PRESETS.some((p) => p.value === activeScene.cameraAndLens)
                        ? activeScene.cameraAndLens
                        : '__custom__'
                    }
                    onChange={(e) => {
                      const chosen = CAMERA_PRESETS.find((p) => p.value === e.target.value);
                      if (chosen) {
                        onUpdateScene(activeScene.id, {
                          cameraAndLens: chosen.value,
                          focalLengthLabel: chosen.focal,
                        });
                      }
                    }}
                    className="mt-1.5 min-h-[40px] w-full rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#0B0C0E] focus:border-[#2563EB] focus:outline-none"
                  >
                    {CAMERA_PRESETS.map((preset) => (
                      <option key={preset.value} value={preset.value}>
                        {preset.label}
                      </option>
                    ))}
                    {!CAMERA_PRESETS.some((p) => p.value === activeScene.cameraAndLens) && (
                      <option value="__custom__">{activeScene.cameraAndLens}</option>
                    )}
                  </select>
                </div>
              </div>

              <div
                data-testid="lighting-consistency"
                className={`mt-3 flex items-start gap-2.5 rounded-lg border p-3 text-xs ${
                  lightingCheck.isMatched
                    ? 'border-[#E2E4E9] bg-[#F8F9FA] text-[#374151]'
                    : 'border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]'
                }`}
              >
                {lightingCheck.isMatched ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#2563EB]" aria-hidden="true" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                )}
                <div>
                  <span className="font-semibold">{lightingCheck.label}: </span>
                  <span>{lightingCheck.detail}</span>
                </div>
              </div>
            </div>

            <hr className="border-[#E2E4E9]" />

            {/* Editable Prompt Clauses */}
            <div>
              <h3 className="font-display text-base font-semibold text-[#0B0C0E]">
                03. Scene Token Breakdown
              </h3>

              <div className="mt-4 space-y-4">
                <div>
                  <label
                    htmlFor="field-framing"
                    className="block text-xs font-medium text-[#4B5563]"
                  >
                    Pose &amp; Camera Framing
                  </label>
                  <input
                    id="field-framing"
                    type="text"
                    value={activeScene.poseAndFraming}
                    onChange={(e) =>
                      onUpdateScene(activeScene.id, { poseAndFraming: e.target.value })
                    }
                    className="mt-1.5 min-h-[40px] w-full rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#0B0C0E] focus:border-[#2563EB] focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="field-subject"
                    className="block text-xs font-medium text-[#4B5563]"
                  >
                    Subject &amp; Expression
                  </label>
                  <input
                    id="field-subject"
                    type="text"
                    value={activeScene.subjectDescriptor}
                    onChange={(e) =>
                      onUpdateScene(activeScene.id, { subjectDescriptor: e.target.value })
                    }
                    className="mt-1.5 min-h-[40px] w-full rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#0B0C0E] focus:border-[#2563EB] focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="field-wardrobe"
                    className="block text-xs font-medium text-[#4B5563]"
                  >
                    Wardrobe &amp; Styling
                  </label>
                  <textarea
                    id="field-wardrobe"
                    rows={2}
                    value={activeScene.wardrobe}
                    onChange={(e) => onUpdateScene(activeScene.id, { wardrobe: e.target.value })}
                    className="mt-1.5 w-full rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#0B0C0E] focus:border-[#2563EB] focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="field-environment"
                    className="block text-xs font-medium text-[#4B5563]"
                  >
                    Environment &amp; Props
                  </label>
                  <input
                    id="field-environment"
                    type="text"
                    value={activeScene.environment}
                    onChange={(e) =>
                      onUpdateScene(activeScene.id, { environment: e.target.value })
                    }
                    className="mt-1.5 min-h-[40px] w-full rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#0B0C0E] focus:border-[#2563EB] focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="field-quality"
                    className="block text-xs font-medium text-[#4B5563]"
                  >
                    Skin Texture &amp; Film Realism Tokens
                  </label>
                  <input
                    id="field-quality"
                    type="text"
                    value={activeScene.qualityTokens}
                    onChange={(e) =>
                      onUpdateScene(activeScene.id, { qualityTokens: e.target.value })
                    }
                    className="mt-1.5 min-h-[40px] w-full rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#0B0C0E] focus:border-[#2563EB] focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="field-negative"
                    className="block text-xs font-medium text-[#4B5563]"
                  >
                    Negative Prompt Tokens
                  </label>
                  <textarea
                    id="field-negative"
                    rows={3}
                    value={activeScene.negativeTokens}
                    onChange={(e) =>
                      onUpdateScene(activeScene.id, { negativeTokens: e.target.value })
                    }
                    className="mt-1.5 w-full rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 font-mono text-xs leading-relaxed text-[#0B0C0E] focus:border-[#2563EB] focus:outline-none"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Jet Darkroom Live Compiled Readout */}
          <div className="rounded-xl bg-[#111215] p-6 text-[#F4F4F5] lg:sticky lg:top-24 lg:col-span-6">
            <div className="flex flex-col gap-4 border-b border-white/10 pb-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-medium text-[#9CA3AF]">
                  {activeSet.name} · Scene {activeScene.sceneNumber}
                </p>
                <h3 className="mt-0.5 font-display text-lg font-semibold text-white">
                  {activeScene.title}
                </h3>
              </div>

              {/* Engine Target Switch */}
              <div
                role="tablist"
                aria-label="Target generation engine"
                className="inline-flex rounded-lg bg-[#1C1E24] p-1"
              >
                {(
                  [
                    { id: 'sd', label: 'Stable Diffusion' },
                    { id: 'midjourney', label: 'Midjourney' },
                    { id: 'comfyui', label: 'ComfyUI JSON' },
                  ] as { id: EngineFormat; label: string }[]
                ).map((tab) => {
                  const selected = config.engine === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      onClick={() => onChangeConfig({ engine: tab.id })}
                      className={`min-h-[34px] rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#60A5FA] ${
                        selected
                          ? 'bg-[#2563EB] text-white'
                          : 'text-[#A1A1AA] hover:text-white'
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {config.engine === 'comfyui' ? (
              <div className="mt-5">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-xs font-semibold text-[#D4D4D8]">
                    ComfyUI API / Graph Workflow JSON
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleCopy(comfyJson, 'comfy')}
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/20 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#60A5FA]"
                    >
                      {copiedTarget === 'comfy' ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-[#4ADE80]" aria-hidden="true" />
                          Copied JSON
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                          Copy JSON
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleDownloadFile(
                          comfyJson,
                          `${activeScene.id}-comfyui.json`,
                          'application/json'
                        )
                      }
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-[#2563EB] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#1D4ED8] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#60A5FA]"
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      Download JSON
                    </button>
                  </div>
                </div>
                <pre
                  data-testid="compiled-comfy-output"
                  className="mt-3 max-h-[420px] overflow-auto rounded-lg bg-[#090A0C] p-4 font-mono text-xs leading-relaxed text-[#E4E4E7]"
                >
                  {comfyJson}
                </pre>
              </div>
            ) : (
              <div className="mt-5 space-y-5">
                {/* Positive Prompt Readout */}
                <div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-xs font-semibold text-[#D4D4D8]">
                      Positive Prompt
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopy(positivePrompt, 'positive')}
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-[#2563EB] px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#1D4ED8] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#60A5FA]"
                    >
                      {copiedTarget === 'positive' ? (
                        <>
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                          Copy Positive
                        </>
                      )}
                    </button>
                  </div>
                  <div
                    data-testid="compiled-positive-output"
                    className="mt-2.5 rounded-lg bg-[#090A0C] p-4 font-mono text-[13px] leading-relaxed text-[#F4F4F5] select-all"
                  >
                    {positivePrompt}
                  </div>
                </div>

                {/* Negative Prompt Readout */}
                <div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-xs font-semibold text-[#D4D4D8]">
                      {config.engine === 'midjourney'
                        ? 'Extracted Midjourney --no Parameters'
                        : 'Negative Prompt'}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopy(negativePrompt, 'negative')}
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-white/10 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/20 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#60A5FA]"
                    >
                      {copiedTarget === 'negative' ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-[#4ADE80]" aria-hidden="true" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                          Copy Negative
                        </>
                      )}
                    </button>
                  </div>
                  <div
                    data-testid="compiled-negative-output"
                    className="mt-2.5 rounded-lg bg-[#090A0C] p-4 font-mono text-[13px] leading-relaxed text-[#A1A1AA] select-all"
                  >
                    {negativePrompt}
                  </div>
                </div>
              </div>
            )}

            {/* Pipeline Preflight Strip */}
            <div className="mt-6 border-t border-white/10 pt-5">
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <div>
                  <p className="text-xs font-semibold text-white">Pipeline Preflight</p>
                  <p className="mt-0.5 text-[11px] text-[#9CA3AF]">
                    Verify A1111, LoRA, R-ESRGAN 4x+, ComfyUI, and IG endpoints before rendering
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCheckPipeline}
                  disabled={isCheckingPreflight}
                  className="inline-flex min-h-[32px] items-center gap-1.5 rounded-md border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-white/15 disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  {isCheckingPreflight ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      Checking...
                    </>
                  ) : (
                    <>
                      <Activity className="h-3.5 w-3.5 text-[#60A5FA]" aria-hidden="true" />
                      Check pipeline
                    </>
                  )}
                </button>
              </div>

              <div
                data-testid="preflight-strip"
                className="mt-2.5 flex flex-wrap items-center gap-2"
              >
                {(
                  [
                    { id: 'a1111', label: 'A1111' },
                    { id: 'lora', label: 'LoRA' },
                    { id: 'upscaler', label: 'Upscaler' },
                    { id: 'comfy', label: 'Comfy' },
                    { id: 'ig', label: 'IG' },
                  ] as const
                ).map((meta) => {
                  const found = preflightChecks?.find((c) => c.id === meta.id);
                  const chipTone = !found
                    ? 'border-white/15 bg-[#090A0C] text-[#9CA3AF]'
                    : found.skipped
                      ? 'border-white/15 bg-[#18181B] text-[#A1A1AA]'
                      : found.ok
                        ? 'border-[#4ADE80]/35 bg-[#14532D]/35 text-[#BBF7D0]'
                        : 'border-[#F87171]/40 bg-[#7F1D1D]/35 text-[#FECACA]';
                  const chipValue = !found
                    ? 'Unchecked'
                    : found.skipped
                      ? 'Skipped'
                      : found.ok
                        ? 'OK'
                        : found.detail;

                  return (
                    <div
                      key={meta.id}
                      data-testid={`preflight-chip-${meta.id}`}
                      title={found?.detail || `${meta.label} not checked yet`}
                      className={`inline-flex max-w-full items-center gap-1.5 rounded border px-2 py-1 text-[11px] ${chipTone}`}
                    >
                      <span className="font-semibold text-white">{meta.label}:</span>
                      <span className="truncate">{chipValue}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Direct Local Render Execution */}
            <div className="mt-5 border-t border-white/10 pt-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-semibold text-white">Direct Local Execution</p>
                  <p className="mt-0.5 text-xs text-[#9CA3AF]">
                    Send compiled prompt to Automatic1111 (<span className="font-mono">--api</span>)
                    or ComfyUI (<span className="font-mono">/prompt</span>)
                  </p>
                </div>

                <div
                  role="tablist"
                  aria-label="Local render backend"
                  className="inline-flex self-start rounded-lg bg-[#1C1E24] p-1"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={renderBackend === 'a1111'}
                    onClick={() => handleBackendChange('a1111')}
                    className={`min-h-[32px] rounded-md px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                      renderBackend === 'a1111'
                        ? 'bg-white text-[#0B0C0E]'
                        : 'text-[#A1A1AA] hover:text-white'
                    }`}
                  >
                    A1111 WebUI
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={renderBackend === 'comfyui'}
                    onClick={() => handleBackendChange('comfyui')}
                    className={`min-h-[32px] rounded-md px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                      renderBackend === 'comfyui'
                        ? 'bg-white text-[#0B0C0E]'
                        : 'text-[#A1A1AA] hover:text-white'
                    }`}
                  >
                    ComfyUI API
                  </button>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-12">
                <div className="sm:col-span-7">
                  <label
                    htmlFor="render-endpoint-input"
                    className="block text-[11px] font-medium text-[#9CA3AF]"
                  >
                    Local Endpoint URL
                  </label>
                  <input
                    id="render-endpoint-input"
                    type="url"
                    value={endpointUrl}
                    onChange={(e) => setEndpointUrl(e.target.value)}
                    placeholder="http://127.0.0.1:7860"
                    className="mt-1 min-h-[38px] w-full rounded-lg border border-white/15 bg-[#090A0C] px-3 py-1.5 font-mono text-xs text-white placeholder-[#71717A] focus:border-[#60A5FA] focus:outline-none"
                  />
                </div>

                <div className="sm:col-span-5">
                  <label
                    htmlFor="render-resolution-select"
                    className="block text-[11px] font-medium text-[#9CA3AF]"
                  >
                    Output Size ({renderDims.width}×{renderDims.height})
                  </label>
                  <select
                    id="render-resolution-select"
                    value={resolutionMode}
                    onChange={(e) => setResolutionMode(e.target.value as RenderResolutionMode)}
                    className="mt-1 min-h-[38px] w-full rounded-lg border border-white/15 bg-[#090A0C] px-2.5 py-1.5 font-mono text-xs text-white focus:border-[#60A5FA] focus:outline-none"
                  >
                    <option value="fast">SD 1.5 Fast (512px)</option>
                    <option value="native">SDXL Native (1024px)</option>
                  </select>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-12">
                <div className="sm:col-span-6">
                  <label
                    htmlFor="upscale-multiplier-select"
                    className="block text-[11px] font-medium text-[#9CA3AF]"
                  >
                    R-ESRGAN 4x+ Upscale ({upscaledWidth}×{upscaledHeight})
                  </label>
                  <select
                    id="upscale-multiplier-select"
                    value={upscaleMultiplier}
                    onChange={(e) => setUpscaleMultiplier(Number(e.target.value) || 2)}
                    className="mt-1 min-h-[38px] w-full rounded-lg border border-white/15 bg-[#090A0C] px-2.5 py-1.5 font-mono text-xs text-white focus:border-[#60A5FA] focus:outline-none"
                  >
                    <option value={2}>2× IG-Ready ({renderDims.width * 2}×{renderDims.height * 2})</option>
                    <option value={3}>3× High-Res ({renderDims.width * 3}×{renderDims.height * 3})</option>
                    <option value={4}>4× Print ({renderDims.width * 4}×{renderDims.height * 4})</option>
                  </select>
                </div>

                <div className="sm:col-span-6">
                  <div className="flex items-center justify-between gap-2">
                    <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-medium text-[#9CA3AF]">
                      <input
                        id="restore-faces-toggle"
                        type="checkbox"
                        checked={restoreFaces}
                        onChange={(e) => {
                          const next = e.target.checked;
                          setRestoreFaces(next);
                          if (next && gfpganVisibility === 0) {
                            setGfpganVisibility(0.5);
                          } else if (!next) {
                            setGfpganVisibility(0);
                          }
                        }}
                        className="h-3.5 w-3.5 rounded border-white/25 bg-[#111215] text-[#2563EB]"
                      />
                      Face Restore (GFPGAN)
                    </label>
                    <span className="font-mono text-[11px] text-white tabular-nums">
                      {restoreFaces ? gfpganVisibility.toFixed(2) : 'Off'}
                    </span>
                  </div>
                  <input
                    id="gfpgan-visibility-slider"
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    disabled={!restoreFaces}
                    value={restoreFaces ? gfpganVisibility : 0}
                    onChange={(e) => setGfpganVisibility(parseFloat(e.target.value))}
                    className="mt-2.5 w-full accent-[#2563EB] disabled:opacity-40"
                  />
                </div>
              </div>

              {/* ADetailer & ControlNet Reference Pose */}
              <div className="mt-4 space-y-3 rounded-lg border border-white/10 bg-[#090A0C] p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-[#E4E4E7]">
                    <input
                      id="adetailer-toggle"
                      type="checkbox"
                      checked={enableADetailer}
                      onChange={(e) => setEnableADetailer(e.target.checked)}
                      className="h-4 w-4 rounded border-white/25 bg-[#111215] text-[#2563EB] focus:ring-[#60A5FA]"
                    />
                    Enable ADetailer (face_yolov8n + hand_yolov8n)
                  </label>
                  <span className="font-mono text-[11px] text-[#9CA3AF]">
                    {renderBackend === 'comfyui'
                      ? 'A1111 WebUI feature'
                      : controlImageBase64
                        ? 'ControlNet Active'
                        : 'Optional Pose Lock'}
                  </span>
                </div>

                {!controlImageBase64 ? (
                  <div
                    data-testid="controlnet-dropzone"
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragOverPose(true);
                    }}
                    onDragLeave={() => setIsDragOverPose(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDragOverPose(false);
                      handlePoseFile(e.dataTransfer.files?.[0]);
                    }}
                    className={`rounded-lg border border-dashed px-3.5 py-3 transition-colors ${
                      isDragOverPose
                        ? 'border-[#60A5FA] bg-[#1E3A8A]/20'
                        : 'border-white/20 bg-[#111215] hover:border-white/35'
                    }`}
                  >
                    <input
                      ref={poseInputRef}
                      id="controlnet-file-input"
                      type="file"
                      accept="image/*"
                      onChange={(e) => handlePoseFile(e.target.files?.[0])}
                      className="sr-only"
                    />
                    <label
                      htmlFor="controlnet-file-input"
                      className="flex cursor-pointer items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/10 text-[#60A5FA]">
                          <Upload className="h-4 w-4" aria-hidden="true" />
                        </div>
                        <div>
                          <p className="text-xs font-medium text-white">
                            Drop Reference Pose Image (ControlNet)
                          </p>
                          <p className="text-[11px] text-[#9CA3AF]">
                            Lock mirror arm angle or stance via {CONTROLNET_MODELS[controlModule].label}
                          </p>
                        </div>
                      </div>
                      <span className="rounded-md border border-white/15 px-2.5 py-1 text-[11px] font-semibold text-white whitespace-nowrap shrink-0">
                        Browse Image
                      </span>
                    </label>
                  </div>
                ) : (
                  <div
                    data-testid="controlnet-active-card"
                    className="flex flex-col gap-3 rounded-lg border border-[#60A5FA]/35 bg-[#111215] p-3 sm:flex-row sm:items-center"
                  >
                    <img
                      src={controlImageBase64}
                      alt="ControlNet reference pose"
                      className="h-16 w-16 shrink-0 rounded-md border border-white/15 object-cover"
                    />
                    <div className="grid flex-1 grid-cols-1 gap-2.5 sm:grid-cols-2">
                      <div>
                        <label
                          htmlFor="controlnet-module-select"
                          className="block text-[11px] font-medium text-[#9CA3AF]"
                        >
                          Preprocessor
                        </label>
                        <select
                          id="controlnet-module-select"
                          value={controlModule}
                          onChange={(e) => setControlModule(e.target.value as ControlNetModule)}
                          className="mt-1 min-h-[34px] w-full rounded-md border border-white/15 bg-[#090A0C] px-2 py-1 font-mono text-xs text-white focus:border-[#60A5FA] focus:outline-none"
                        >
                          {(Object.keys(CONTROLNET_MODELS) as ControlNetModule[]).map((modKey) => (
                            <option key={modKey} value={modKey}>
                              {CONTROLNET_MODELS[modKey].label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <div className="flex items-center justify-between">
                          <label
                            htmlFor="controlnet-weight-slider"
                            className="text-[11px] font-medium text-[#9CA3AF]"
                          >
                            Control Weight
                          </label>
                          <span className="font-mono text-[11px] text-white tabular-nums">
                            {controlWeight.toFixed(2)}
                          </span>
                        </div>
                        <input
                          id="controlnet-weight-slider"
                          type="range"
                          min="0.1"
                          max="1.5"
                          step="0.05"
                          value={controlWeight}
                          onChange={(e) => setControlWeight(parseFloat(e.target.value))}
                          className="mt-2 w-full accent-[#2563EB]"
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={clearPoseReference}
                      className="inline-flex min-h-[34px] items-center gap-1 self-start rounded-md border border-white/15 px-2.5 py-1 text-xs font-medium text-[#D4D4D8] hover:bg-white/10 hover:text-white whitespace-nowrap shrink-0 sm:self-center"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                      Clear Pose
                    </button>
                  </div>
                )}
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    onClick={handleRenderScene}
                    disabled={isGenerating || isBatchRunning}
                    className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#1D4ED8] disabled:opacity-60 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#60A5FA]"
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        Rendering...
                      </>
                    ) : (
                      <>
                        <Play className="h-3.5 w-3.5" aria-hidden="true" />
                        {renderBackend === 'a1111' && controlImageBase64
                          ? 'Render Controlled Scene'
                          : 'Render Scene'}
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleBatchRender(activeSet.scenes)}
                    disabled={isGenerating || isBatchRunning}
                    className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/15 disabled:opacity-60 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#60A5FA]"
                  >
                    {isBatchRunning ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        Batch Queue Active...
                      </>
                    ) : (
                      <>
                        <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                        Render Full Contact Sheet ({activeSet.scenes.length})
                      </>
                    )}
                  </button>

                  {isBatchRunning && (
                    <button
                      type="button"
                      onClick={handleCancelBatch}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[#F87171]/40 bg-[#7F1D1D]/40 px-3.5 py-2 text-xs font-semibold text-[#FECACA] transition-colors hover:bg-[#991B1B]/60 whitespace-nowrap shrink-0"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                      Cancel Queue
                    </button>
                  )}
                </div>

                <span className="font-mono text-[11px] text-[#9CA3AF] tabular-nums">
                  {renderBackend === 'a1111' ? 'DPM++ 2M Karras' : 'KSampler + LoraLoader'} ·{' '}
                  {renderDims.width}×{renderDims.height} → {upscaledWidth}×{upscaledHeight}
                </span>
              </div>

              <p className="mt-2.5 text-[11px] leading-relaxed text-[#9CA3AF]">
                Sequential GPU queue (concurrency = 1): renders + R-ESRGAN 4x+ upscales all{' '}
                {activeSet.scenes.length} scenes, streams live SSE progress, and packages a ZIP
                contact sheet.
              </p>

              {/* Recovery Banner on Reload */}
              {recoverableSheet && !contactSheetResult && !isBatchRunning && (
                <div
                  role="status"
                  data-testid="batch-recovery-banner"
                  className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#60A5FA]/35 bg-[#1E3A8A]/25 p-3 text-xs text-[#DBEAFE]"
                >
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 shrink-0 text-[#60A5FA]" aria-hidden="true" />
                    <span>
                      Last contact sheet cached locally ({recoverableSheet.setName} ·{' '}
                      {recoverableSheet.scenes.length} renders).
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleRestoreRecoveredSheet}
                      className="rounded-md bg-[#2563EB] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#1D4ED8] whitespace-nowrap shrink-0"
                    >
                      Restore Contact Sheet
                    </button>
                    <button
                      type="button"
                      onClick={handleDiscardRecoveredSheet}
                      className="rounded-md px-2 py-1 text-xs font-medium text-[#BFDBFE] hover:bg-white/10 whitespace-nowrap shrink-0"
                    >
                      Discard
                    </button>
                  </div>
                </div>
              )}

              {/* Live SSE Progress Bar & Per-Scene Status Grid */}
              {(isBatchRunning || (batchProgress && batchProgress.status === 'running')) && (
                <div
                  data-testid="batch-sse-progress"
                  className="mt-3 rounded-lg border border-white/15 bg-[#090A0C] p-3.5"
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-white">
                      {batchProgress?.stage === 'upscale'
                        ? 'R-ESRGAN 4x+ Upscaling'
                        : 'GPU Render Queue'}{' '}
                      · Scene {batchProgress?.current ?? 0} of {batchProgress?.total ?? activeSet.scenes.length}
                    </span>
                    <span className="font-mono text-[11px] text-[#9CA3AF] tabular-nums">
                      {batchProgress && batchProgress.total > 0
                        ? Math.round(
                            (((Math.max(0, batchProgress.current - 1) +
                              (batchProgress.stage === 'upscale' ? 0.5 : 0.15)) /
                              batchProgress.total) *
                              100)
                          )
                        : 0}
                      %
                    </span>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full bg-[#2563EB] transition-all duration-300"
                      style={{
                        width: `${
                          batchProgress && batchProgress.total > 0
                            ? Math.min(
                                100,
                                Math.round(
                                  ((Math.max(0, batchProgress.current - 1) +
                                    (batchProgress.stage === 'upscale' ? 0.65 : 0.25)) /
                                    batchProgress.total) *
                                    100
                                )
                              )
                            : 5
                        }%`,
                      }}
                    />
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {activeSet.scenes.map((sc) => {
                      const st = sceneStageMap[sc.id] || 'pending';
                      return (
                        <div
                          key={sc.id}
                          data-testid={`batch-scene-status-${sc.id}`}
                          className="flex items-center justify-between gap-2 rounded border border-white/10 bg-[#111215] px-2.5 py-1.5 text-[11px]"
                        >
                          <span className="truncate font-medium text-[#E4E4E7]">
                            {sc.sceneNumber} · {sc.title}
                          </span>
                          <span
                            className={`font-mono font-semibold whitespace-nowrap shrink-0 ${
                              st === 'done'
                                ? 'text-[#4ADE80]'
                                : st === 'error'
                                  ? 'text-[#F87171]'
                                  : st === 'render' || st === 'upscale'
                                    ? 'text-[#60A5FA]'
                                    : 'text-[#71717A]'
                            }`}
                          >
                            {st === 'render'
                              ? 'Rendering'
                              : st === 'upscale'
                                ? 'Upscaling'
                                : st === 'done'
                                  ? 'Done'
                                  : st === 'error'
                                    ? 'Error'
                                    : 'Queued'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {batchStatus && (
                <div
                  role="status"
                  data-testid="batch-status-banner"
                  className={`mt-3 flex items-start justify-between gap-3 rounded-lg border p-3 text-xs ${
                    batchStatus.tone === 'success'
                      ? 'border-[#4ADE80]/35 bg-[#14532D]/35 text-[#BBF7D0]'
                      : batchStatus.tone === 'error'
                        ? 'border-[#F87171]/35 bg-[#7F1D1D]/30 text-[#FECACA]'
                        : 'border-[#60A5FA]/35 bg-[#1E3A8A]/30 text-[#DBEAFE]'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {batchStatus.tone === 'progress' ? (
                      <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
                    ) : batchStatus.tone === 'success' ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#4ADE80]" aria-hidden="true" />
                    ) : (
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#FCA5A5]" aria-hidden="true" />
                    )}
                    <p className="leading-relaxed">{batchStatus.message}</p>
                  </div>
                  {!isBatchRunning && (
                    <button
                      type="button"
                      onClick={() => setBatchStatus(null)}
                      aria-label="Dismiss batch status"
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white/75 hover:bg-white/10 hover:text-white"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  )}
                </div>
              )}

              {storageWarning && (
                <div
                  role="status"
                  data-testid="storage-quota-warning"
                  className="mt-2.5 flex items-start justify-between gap-3 rounded-lg border border-[#FBBF24]/35 bg-[#78350F]/30 p-3 text-xs text-[#FDE68A]"
                >
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#FBBF24]" aria-hidden="true" />
                    <p className="leading-relaxed">{storageWarning}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setStorageWarning(null)}
                    aria-label="Dismiss storage warning"
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[#FDE68A] hover:bg-white/10"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              )}

              {/* 3-Up Completed Contact Sheet Preview + ZIP Download */}
              {contactSheetResult && contactSheetResult.scenes.length > 0 && (
                <div
                  data-testid="contact-sheet-results"
                  className="mt-4 rounded-lg border border-white/15 bg-[#090A0C] p-3.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
                    <div>
                      <p className="text-xs font-semibold text-white">
                        Completed Contact Sheet · {contactSheetResult.setName}
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] text-[#9CA3AF]">
                        {keptContactScenes.length} / {contactSheetResult.scenes.length} kept · Job{' '}
                        {contactSheetResult.jobId.slice(0, 8)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handleSaveAllBatchLocal}
                        disabled={isSavingBatchLocal || allContactTilesKilled || isBatchRunning}
                        className="inline-flex min-h-[34px] items-center gap-1.5 rounded-md border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/15 disabled:opacity-50 whitespace-nowrap shrink-0"
                      >
                        {isSavingBatchLocal ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <Save className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        {isSavingBatchLocal ? 'Saving...' : 'Save All to ./exports/'}
                      </button>
                      <button
                        type="button"
                        onClick={handleDownloadContactSheetZip}
                        disabled={allContactTilesKilled}
                        className="inline-flex min-h-[34px] items-center gap-1.5 rounded-md bg-[#2563EB] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50 whitespace-nowrap shrink-0"
                      >
                        <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                        Download ZIP
                      </button>
                      <button
                        type="button"
                        onClick={() => setContactSheetResult(null)}
                        aria-label="Close contact sheet preview"
                        className="rounded-md px-2 py-1 text-xs font-medium text-[#A1A1AA] hover:bg-white/10 hover:text-white"
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  {allContactTilesKilled && (
                    <div
                      role="status"
                      data-testid="all-killed-banner"
                      className="mt-3 flex items-center gap-2 rounded-md border border-[#FBBF24]/35 bg-[#78350F]/30 px-3 py-2 text-xs text-[#FDE68A]"
                    >
                      <AlertTriangle className="h-4 w-4 shrink-0 text-[#FBBF24]" aria-hidden="true" />
                      <span>
                        All tiles are marked Kill. Switch at least one tile to Keep to enable
                        Download ZIP or Save All to ./exports/.
                      </span>
                    </div>
                  )}

                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {contactSheetResult.scenes.map((sc, idx) => {
                      const isKept = sc.kept !== false;
                      const isRerollingThis = rerollingSceneId === sc.sceneId;
                      return (
                        <div
                          key={sc.sceneId}
                          data-testid={`contact-sheet-tile-${idx}`}
                          className={`overflow-hidden rounded-md border bg-[#111215] transition-opacity ${
                            isKept ? 'border-white/10' : 'border-[#F87171]/35 opacity-60'
                          }`}
                        >
                          <img
                            src={sc.imageBase64}
                            alt={`${sc.title} upscaled render`}
                            className="aspect-[4/5] w-full bg-[#090A0C] object-cover"
                          />
                          <div className="p-2.5">
                            <p className="truncate text-xs font-semibold text-white">{sc.title}</p>
                            <p className="mt-0.5 font-mono text-[10px] text-[#9CA3AF] tabular-nums">
                              {sc.width}×{sc.height}
                              {typeof sc.seed === 'number' && sc.seed >= 0
                                ? ` · Seed ${sc.seed}`
                                : ''}
                            </p>

                            {/* Keep / Kill + Reroll controls */}
                            <div className="mt-2 flex items-center justify-between gap-1.5">
                              <div
                                role="group"
                                aria-label={`Select status for ${sc.title}`}
                                className="inline-flex rounded border border-white/15 bg-[#090A0C] p-0.5"
                              >
                                <button
                                  type="button"
                                  aria-pressed={isKept}
                                  aria-label={`Keep ${sc.title}`}
                                  onClick={() => handleToggleTileKeep(sc.sceneId, true)}
                                  className={`rounded px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                                    isKept
                                      ? 'bg-[#16A34A] text-white'
                                      : 'text-[#9CA3AF] hover:text-white'
                                  }`}
                                >
                                  Keep
                                </button>
                                <button
                                  type="button"
                                  aria-pressed={!isKept}
                                  aria-label={`Kill ${sc.title}`}
                                  onClick={() => handleToggleTileKeep(sc.sceneId, false)}
                                  className={`rounded px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                                    !isKept
                                      ? 'bg-[#DC2626] text-white'
                                      : 'text-[#9CA3AF] hover:text-white'
                                  }`}
                                >
                                  Kill
                                </button>
                              </div>

                              <button
                                type="button"
                                onClick={() => handleRerollTile(sc, idx)}
                                disabled={isBatchRunning || isGenerating || rerollingSceneId !== null}
                                aria-label={`Reroll ${sc.title}`}
                                className="inline-flex items-center gap-1 rounded border border-white/15 px-2 py-0.5 text-[10px] font-semibold text-[#E4E4E7] hover:bg-white/10 disabled:opacity-45 whitespace-nowrap shrink-0"
                              >
                                {isRerollingThis ? (
                                  <Loader2 className="h-2.5 w-2.5 animate-spin" aria-hidden="true" />
                                ) : (
                                  <RefreshCw className="h-2.5 w-2.5" aria-hidden="true" />
                                )}
                                Reroll
                              </button>
                            </div>

                            <div className="mt-2 flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() =>
                                  downloadDataUrl(
                                    sc.imageBase64,
                                    formatBatchUpscaledFilename(idx, sc.title, sc.seed)
                                  )
                                }
                                className="inline-flex flex-1 items-center justify-center gap-1 rounded border border-white/15 px-2 py-1 text-[11px] font-medium text-white hover:bg-white/10 whitespace-nowrap"
                              >
                                <Download className="h-3 w-3" aria-hidden="true" />
                                Download PNG
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSaveBatchSceneLocal(sc, idx)}
                                title="Save PNG to ./exports/"
                                aria-label={`Save ${sc.title} to exports`}
                                className="inline-flex items-center justify-center rounded border border-white/15 px-2 py-1 text-[11px] font-medium text-[#D4D4D8] hover:bg-white/10 hover:text-white"
                              >
                                <Save className="h-3 w-3" aria-hidden="true" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {renderError && (
                <div
                  role="alert"
                  data-testid="render-error-alert"
                  className="mt-3 flex items-start justify-between gap-3 rounded-lg border border-[#F87171]/35 bg-[#7F1D1D]/30 p-3 text-xs text-[#FECACA]"
                >
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#FCA5A5]" aria-hidden="true" />
                    <div>
                      <p className="font-semibold text-white">Local render unavailable</p>
                      <p className="mt-0.5 leading-relaxed">{renderError}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setRenderError(null)}
                    aria-label="Dismiss render error"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#FCA5A5] hover:bg-white/10 hover:text-white"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              )}

              {renderedImage && (
                <div
                  data-testid="rendered-image-preview"
                  className="mt-4 overflow-hidden rounded-lg border border-white/15 bg-[#090A0C]"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2 text-xs text-[#D4D4D8]">
                    <span className="inline-flex items-center gap-1.5 font-medium">
                      <ImageIcon className="h-3.5 w-3.5 text-[#60A5FA]" aria-hidden="true" />
                      Rendered Output · Scene {activeScene.sceneNumber}
                      {renderedSeed !== null && renderedSeed >= 0 ? ` · Seed ${renderedSeed}` : ''}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleUpscalePreview}
                        disabled={isUpscaling || isGenerating || isBatchRunning}
                        className="inline-flex items-center gap-1 rounded bg-[#2563EB] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50"
                      >
                        {isUpscaling ? (
                          <>
                            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                            Upscaling...
                          </>
                        ) : (
                          <>
                            <Sparkles className="h-3 w-3" aria-hidden="true" />
                            Upscale {upscaleMultiplier}×
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => downloadDataUrl(renderedImage, `${activeScene.id}-render.png`)}
                        className="rounded px-2 py-1 text-xs font-medium text-white hover:bg-white/10 whitespace-nowrap shrink-0"
                      >
                        Download PNG
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveLocalExport}
                        disabled={isSavingLocal || isPostingIg}
                        className="inline-flex items-center gap-1 rounded border border-white/15 px-2.5 py-1 text-xs font-medium text-white hover:bg-white/10 disabled:opacity-50 whitespace-nowrap shrink-0"
                      >
                        <Save className="h-3 w-3" aria-hidden="true" />
                        {isSavingLocal ? 'Saving...' : 'Save to Exports'}
                      </button>
                      <button
                        type="button"
                        onClick={handlePostToIg}
                        disabled={isPostingIg || isSavingLocal}
                        className="inline-flex items-center gap-1 rounded bg-[#16A34A] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#15803D] disabled:opacity-50 whitespace-nowrap shrink-0"
                      >
                        {isPostingIg ? (
                          <>
                            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                            Posting...
                          </>
                        ) : (
                          <>
                            <Send className="h-3 w-3" aria-hidden="true" />
                            Post to IG
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => setRenderedImage(null)}
                        className="rounded px-2 py-1 text-xs font-medium text-[#A1A1AA] hover:bg-white/10 hover:text-white"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                  <img
                    src={renderedImage}
                    alt={`Rendered output for ${activeScene.title}`}
                    referrerPolicy="no-referrer"
                    className="h-auto w-full object-contain"
                  />
                </div>
              )}

              {/* Distribution: Local Exports & Instagram Microservice */}
              <div
                data-testid="distribution-panel"
                className="mt-4 rounded-lg border border-white/10 bg-[#090A0C] p-3.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-white">
                    Distribution · Exports &amp; Instagram Auto-Poster
                  </p>
                  <span className="font-mono text-[11px] text-[#9CA3AF]">
                    ./exports/ + ig_poster.py
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-12">
                  <div className="sm:col-span-7">
                    <div className="flex items-center justify-between gap-2">
                      <label
                        htmlFor="ig-caption-input"
                        className="block text-[11px] font-medium text-[#9CA3AF]"
                      >
                        Instagram Caption
                      </label>
                      <button
                        type="button"
                        onClick={handleCaptionFromScene}
                        className="text-[11px] font-semibold text-[#60A5FA] hover:text-[#93C5FD]"
                      >
                        Caption from scene
                      </button>
                    </div>
                    <input
                      id="ig-caption-input"
                      type="text"
                      value={igCaption}
                      onChange={(e) => handleCaptionChange(e.target.value)}
                      placeholder="New shoot out now."
                      className="mt-1 min-h-[36px] w-full rounded-md border border-white/15 bg-[#111215] px-3 py-1.5 text-xs text-white placeholder-[#71717A] focus:border-[#60A5FA] focus:outline-none"
                    />
                  </div>
                  <div className="sm:col-span-5">
                    <label
                      htmlFor="ig-endpoint-input"
                      className="block text-[11px] font-medium text-[#9CA3AF]"
                    >
                      IG Microservice URL
                    </label>
                    <input
                      id="ig-endpoint-input"
                      type="url"
                      value={igEndpointUrl}
                      onChange={(e) => setIgEndpointUrl(e.target.value)}
                      placeholder="http://127.0.0.1:5001"
                      className="mt-1 min-h-[36px] w-full rounded-md border border-white/15 bg-[#111215] px-3 py-1.5 font-mono text-xs text-white placeholder-[#71717A] focus:border-[#60A5FA] focus:outline-none"
                    />
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleSaveLocalExport}
                      disabled={!renderedImage || isSavingLocal || isPostingIg}
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/10 disabled:opacity-45 whitespace-nowrap shrink-0"
                    >
                      <Save className="h-3.5 w-3.5" aria-hidden="true" />
                      {isSavingLocal ? 'Saving...' : 'Save to Exports'}
                    </button>
                    <button
                      type="button"
                      onClick={handlePostToIg}
                      disabled={!renderedImage || isPostingIg || isSavingLocal}
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md bg-[#16A34A] px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#15803D] disabled:opacity-45 whitespace-nowrap shrink-0"
                    >
                      {isPostingIg ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                          Posting...
                        </>
                      ) : (
                        <>
                          <Send className="h-3.5 w-3.5" aria-hidden="true" />
                          Post to IG
                        </>
                      )}
                    </button>
                  </div>
                  {!renderedImage && (
                    <span className="text-[11px] text-[#9CA3AF]">
                      Render a scene first to enable export &amp; IG posting
                    </span>
                  )}
                </div>

                {distributionStatus && (
                  <div
                    role="status"
                    data-testid="distribution-status-banner"
                    className={`mt-3 flex items-start justify-between gap-3 rounded-md border p-2.5 text-xs ${
                      distributionStatus.tone === 'success'
                        ? 'border-[#4ADE80]/35 bg-[#14532D]/35 text-[#BBF7D0]'
                        : 'border-[#F87171]/35 bg-[#7F1D1D]/30 text-[#FECACA]'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {distributionStatus.tone === 'success' ? (
                        <CheckCircle2
                          className="mt-0.5 h-4 w-4 shrink-0 text-[#4ADE80]"
                          aria-hidden="true"
                        />
                      ) : (
                        <AlertTriangle
                          className="mt-0.5 h-4 w-4 shrink-0 text-[#FCA5A5]"
                          aria-hidden="true"
                        />
                      )}
                      <div>
                        <p className="leading-relaxed">{distributionStatus.message}</p>
                        {distributionStatus.url && (
                          <a
                            href={distributionStatus.url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 inline-block font-mono text-[11px] text-[#86EFAC] underline"
                          >
                            {distributionStatus.url}
                          </a>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setDistributionStatus(null)}
                      aria-label="Dismiss distribution status"
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-white/75 hover:bg-white/10 hover:text-white"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Footer Specs & Markdown Export */}
            <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-5 text-xs text-[#9CA3AF]">
              <div className="font-mono tabular-nums">
                CFG {config.cfgScale.toFixed(1)} · Steps {config.steps} · {config.aspectRatio}
              </div>
              <button
                type="button"
                onClick={() =>
                  handleDownloadFile(
                    formatSceneMarkdown(activeScene, activeSet, config),
                    `${activeScene.id}-director-sheet.md`,
                    'text/markdown'
                  )
                }
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-white/15 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/10 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#60A5FA]"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                Export Director Sheet (.md)
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
