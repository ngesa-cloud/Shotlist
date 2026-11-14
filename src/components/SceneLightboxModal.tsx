import React, { useEffect, useState } from 'react';
import { Camera, Check, Copy, X } from 'lucide-react';
import { CompilerConfig, SceneSpec } from '../types/photoshoot';
import { compileNegativePrompt, compilePositivePrompt } from '../utils/promptCompiler';
import { LIGHTING_OPTIONS } from '../data/presetSets';

interface SceneLightboxModalProps {
  scene: SceneSpec | null;
  config: CompilerConfig;
  onClose: () => void;
  onLoadIntoCompiler: (sceneId: string) => void;
}

export const SceneLightboxModal: React.FC<SceneLightboxModalProps> = ({
  scene,
  config,
  onClose,
  onLoadIntoCompiler,
}) => {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!scene) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [scene, onClose]);

  if (!scene) return null;

  const positive = compilePositivePrompt(scene, config);
  const negative = compileNegativePrompt(scene, config);
  const lightingLabel =
    LIGHTING_OPTIONS.find((opt) => opt.id === scene.lightingId)?.label ?? scene.lightingPhrase;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(positive);
    } catch {
      // ignore fallback
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="lightbox-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs"
    >
      <div className="grid w-full max-w-4xl grid-cols-1 overflow-hidden rounded-xl border border-[#27272A] bg-[#111215] text-[#F4F4F5] shadow-2xl md:grid-cols-12">
        <div className="relative bg-[#090A0C] md:col-span-6">
          {scene.imageUrl ? (
            <img
              src={scene.imageUrl}
              alt={scene.imageAlt}
              referrerPolicy="no-referrer"
              className="h-64 w-full object-cover md:h-full"
            />
          ) : (
            <div className="flex h-64 w-full flex-col items-center justify-center gap-3 p-6 text-center md:h-full">
              <Camera className="h-8 w-8 text-[#9CA3AF]" aria-hidden="true" />
              <p className="font-display text-lg font-semibold text-white">{scene.title}</p>
              <p className="text-xs text-[#9CA3AF]">{scene.contrastMotif}</p>
            </div>
          )}
        </div>

        <div className="flex flex-col justify-between p-6 md:col-span-6">
          <div>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-mono text-xs text-[#60A5FA] tabular-nums">
                  Scene {scene.sceneNumber} · {scene.focalLengthLabel}
                </p>
                <h2 id="lightbox-title" className="mt-1 font-display text-xl font-bold text-white">
                  {scene.title}
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close scene study"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-[#9CA3AF] transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-[#60A5FA]"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <p className="mt-3 text-sm leading-relaxed text-[#D4D4D8]">{scene.breakdown}</p>

            <div className="mt-4 space-y-1.5 border-y border-white/10 py-3 text-xs text-[#A1A1AA]">
              <div>
                <span className="font-semibold text-white">Lighting:</span> {lightingLabel}
              </div>
              <div>
                <span className="font-semibold text-white">Optics:</span> {scene.cameraAndLens}
              </div>
              <div>
                <span className="font-semibold text-white">Contrast:</span> {scene.contrastMotif}
              </div>
            </div>

            <div className="mt-4">
              <p className="text-xs font-semibold text-[#D4D4D8]">Compiled Positive</p>
              <p className="mt-1.5 max-h-28 overflow-auto rounded-lg bg-[#090A0C] p-3 font-mono text-xs leading-relaxed text-[#E4E4E7]">
                {positive}
              </p>
            </div>

            <div className="mt-3">
              <p className="text-xs font-semibold text-[#D4D4D8]">Negative</p>
              <p className="mt-1.5 max-h-20 overflow-auto rounded-lg bg-[#090A0C] p-3 font-mono text-xs leading-relaxed text-[#A1A1AA]">
                {negative}
              </p>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-white/15 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/10 whitespace-nowrap shrink-0"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-[#4ADE80]" aria-hidden="true" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  Copy Positive
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                onLoadIntoCompiler(scene.id);
                onClose();
              }}
              className="inline-flex min-h-[40px] items-center rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#1D4ED8] whitespace-nowrap shrink-0"
            >
              Edit in Compiler
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
