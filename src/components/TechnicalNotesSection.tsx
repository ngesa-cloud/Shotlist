import React from 'react';
import { PromptSet } from '../types/photoshoot';
import { LIGHTING_OPTIONS } from '../data/presetSets';

interface TechnicalNotesSectionProps {
  activeSet: PromptSet;
  activeSceneId: string;
  onSelectScene: (sceneId: string) => void;
}

export const TechnicalNotesSection: React.FC<TechnicalNotesSectionProps> = ({
  activeSet,
  activeSceneId,
  onSelectScene,
}) => {
  return (
    <section id="technical-notes" className="bg-white">
      <div className="mx-auto max-w-[1440px] px-6 py-14 lg:px-10">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold text-[#2563EB]">Production Guardrails</p>
          <h2 className="mt-1 font-display text-2xl font-bold tracking-tight text-[#0B0C0E]">
            Technical Field Notes
          </h2>
          <p className="mt-2 text-sm text-[#525866]">
            Core lighting, LoRA, and guidance rules governing the {activeSet.name} prompt set.
          </p>
        </div>

        {/* 3-Column Editorial Notes */}
        <div className="mt-8 grid grid-cols-1 gap-8 border-t border-[#E2E4E9] pt-8 md:grid-cols-3">
          {activeSet.technicalNotes.map((note) => (
            <div key={note.id}>
              <h3 className="font-display text-base font-semibold text-[#0B0C0E]">
                <span className="mr-2 font-mono text-sm text-[#2563EB] tabular-nums">
                  {note.number}.
                </span>
                {note.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-[#4B5563]">{note.summary}</p>
            </div>
          ))}
        </div>

        {/* Scene Technical Matrix Table */}
        <div className="mt-12 overflow-x-auto rounded-xl border border-[#E2E4E9]">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[#E2E4E9] bg-[#F8F9FA] text-xs font-semibold text-[#525866]">
                <th className="px-4 py-3">Scene</th>
                <th className="px-4 py-3">Lighting Source</th>
                <th className="px-4 py-3">Optics</th>
                <th className="px-4 py-3">Skin Texture Strategy</th>
                <th className="px-4 py-3">Contrast Motif</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E4E9] bg-white">
              {activeSet.scenes.map((scene) => {
                const isSelected = scene.id === activeSceneId;
                const lightingLabel =
                  LIGHTING_OPTIONS.find((l) => l.id === scene.lightingId)?.label ??
                  scene.lightingPhrase;

                return (
                  <tr
                    key={scene.id}
                    className={isSelected ? 'bg-[#EFF6FF]/60' : 'hover:bg-[#F9FAFB]'}
                  >
                    <td className="px-4 py-3.5 font-medium text-[#0B0C0E]">
                      <button
                        type="button"
                        onClick={() => onSelectScene(scene.id)}
                        className="text-left hover:text-[#2563EB] hover:underline focus-visible:outline-2 focus-visible:outline-[#2563EB]"
                      >
                        <span className="mr-2 font-mono text-xs text-[#6B7280] tabular-nums">
                          {scene.sceneNumber}
                        </span>
                        {scene.title}
                      </button>
                    </td>
                    <td className="px-4 py-3.5 text-[#374151]">{lightingLabel}</td>
                    <td className="px-4 py-3.5 font-mono text-xs text-[#374151] tabular-nums">
                      {scene.focalLengthLabel}
                    </td>
                    <td className="px-4 py-3.5 text-[#4B5563]">{scene.skinTextureFocus}</td>
                    <td className="px-4 py-3.5 text-[#4B5563]">{scene.contrastMotif}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
};
