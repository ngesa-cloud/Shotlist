import React, { useState } from 'react';
import { Camera, Maximize2, Trash2 } from 'lucide-react';
import { PromptSet, SceneSpec } from '../types/photoshoot';
import { LIGHTING_OPTIONS } from '../data/presetSets';

interface ContactSheetGridProps {
  sets: PromptSet[];
  activeSetId: string;
  activeSceneId: string;
  onSelectSet: (setId: string) => void;
  onDeleteCustomSet: (setId: string) => void;
  onSelectScene: (sceneId: string) => void;
  onInspectScene: (scene: SceneSpec) => void;
}

const SceneVisualPlate: React.FC<{ scene: SceneSpec }> = ({ scene }) => {
  const [imgFailed, setImgFailed] = useState(false);
  const lightingLabel =
    LIGHTING_OPTIONS.find((l) => l.id === scene.lightingId)?.label ?? scene.lightingPhrase;

  if (scene.imageUrl && !imgFailed) {
    return (
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-t-xl bg-[#111215]">
        <img
          src={scene.imageUrl}
          alt={scene.imageAlt}
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
        />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent px-4 py-3">
          <span className="font-mono text-[11px] font-medium text-white/95 tabular-nums">
            {scene.focalLengthLabel} · {lightingLabel}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex aspect-[4/3] w-full flex-col justify-between overflow-hidden rounded-t-xl bg-gradient-to-br from-[#181B20] via-[#111318] to-[#0B0C0E] p-5 text-[#F4F4F5]">
      <div className="flex items-center justify-between text-xs text-[#A1A1AA]">
        <span className="font-mono tabular-nums">Frame {scene.sceneNumber}</span>
        <Camera className="h-4 w-4 text-[#71717A]" aria-hidden="true" />
      </div>
      <div>
        <p className="font-mono text-xs text-[#93C5FD]">{lightingLabel}</p>
        <p className="mt-1 font-display text-lg font-semibold text-white">{scene.title}</p>
        <p className="mt-1 line-clamp-2 text-xs text-[#A1A1AA]">{scene.contrastMotif}</p>
      </div>
      <div className="border-t border-white/10 pt-2.5 font-mono text-[11px] text-[#D4D4D8] tabular-nums">
        {scene.cameraAndLens}
      </div>
    </div>
  );
};

export const ContactSheetGrid: React.FC<ContactSheetGridProps> = ({
  sets,
  activeSetId,
  activeSceneId,
  onSelectSet,
  onDeleteCustomSet,
  onSelectScene,
  onInspectScene,
}) => {
  const activeSet = sets.find((s) => s.id === activeSetId) ?? sets[0];

  return (
    <section id="aesthetic-sets" className="border-b border-[#E2E4E9] bg-white">
      <div className="mx-auto max-w-[1440px] px-6 py-12 lg:px-10">
        {/* Aesthetic Set Switcher */}
        <div className="flex flex-col gap-4 border-b border-[#E2E4E9] pb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="font-display text-2xl font-bold tracking-tight text-[#0B0C0E]">
              Aesthetic Sets &amp; Contact Sheet
            </h2>
            <p className="mt-1 text-sm text-[#525866]">
              Select a preset aesthetic or choose any scene below to load its tokens into the live
              compiler.
            </p>
          </div>

          <div
            role="tablist"
            aria-label="Aesthetic prompt sets"
            className="flex flex-wrap items-center gap-1.5 rounded-lg bg-[#F1F3F5] p-1"
          >
            {sets.map((setItem) => {
              const isSelected = setItem.id === activeSet.id;
              return (
                <div key={setItem.id} className="flex items-center">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    onClick={() => onSelectSet(setItem.id)}
                    className={`min-h-[36px] rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB] ${
                      isSelected
                        ? 'bg-white text-[#0B0C0E] shadow-xs'
                        : 'text-[#525866] hover:text-[#0B0C0E]'
                    }`}
                  >
                    {setItem.name}
                  </button>
                  {setItem.isCustom && (
                    <button
                      type="button"
                      onClick={() => onDeleteCustomSet(setItem.id)}
                      aria-label={`Delete custom set ${setItem.name}`}
                      className="ml-0.5 flex h-8 w-8 items-center justify-center rounded-md text-[#6B7280] transition-colors hover:bg-white hover:text-[#DC2626] focus-visible:outline-2 focus-visible:outline-[#2563EB]"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 3-Scene Contact Sheet Grid */}
        <div
          id="contact-sheet"
          data-testid="contact-sheet-grid"
          className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-3"
        >
          {activeSet.scenes.map((scene) => {
            const isActive = scene.id === activeSceneId;
            return (
              <article
                key={scene.id}
                className={`group flex flex-col justify-between rounded-xl border bg-white transition-colors ${
                  isActive
                    ? 'border-[#2563EB] ring-1 ring-[#2563EB]'
                    : 'border-[#E2E4E9] hover:border-[#9CA3AF]'
                }`}
              >
                <div>
                  <SceneVisualPlate scene={scene} />
                  <div className="p-5">
                    <div className="flex items-center gap-2 text-xs text-[#6B7280] tabular-nums">
                      <span className="font-mono font-medium text-[#0B0C0E] whitespace-nowrap shrink-0">
                        Scene {scene.sceneNumber}
                      </span>
                      <span aria-hidden="true" className="shrink-0">
                        ·
                      </span>
                      <span className="whitespace-nowrap shrink-0">{scene.focalLengthLabel}</span>
                      <span aria-hidden="true" className="shrink-0">
                        ·
                      </span>
                      <span className="min-w-0 truncate">{scene.skinTextureFocus}</span>
                    </div>

                    <h3 className="mt-2 font-display text-lg font-semibold text-[#0B0C0E]">
                      {scene.title}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-[#4B5563]">
                      {scene.breakdown}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-[#F1F3F5] px-5 py-3.5">
                  <button
                    type="button"
                    onClick={() => onSelectScene(scene.id)}
                    aria-pressed={isActive}
                    className={`min-h-[40px] flex-1 rounded-lg px-4 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB] ${
                      isActive
                        ? 'bg-[#2563EB] text-white'
                        : 'bg-[#F3F4F6] text-[#0B0C0E] hover:bg-[#E5E7EB]'
                    }`}
                  >
                    {isActive ? 'Loaded in Compiler' : `Load Scene ${scene.sceneNumber}`}
                  </button>
                  <button
                    type="button"
                    onClick={() => onInspectScene(scene)}
                    aria-label={`Inspect Scene ${scene.sceneNumber}: ${scene.title}`}
                    className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-[#E2E4E9] bg-white text-[#4B5563] transition-colors hover:bg-[#F9FAFB] hover:text-[#0B0C0E] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB]"
                  >
                    <Maximize2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
};
