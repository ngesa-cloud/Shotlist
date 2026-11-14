import React, { useEffect, useState } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import { PromptSet } from '../types/photoshoot';

interface PivotVibeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreatedSet: (newSet: PromptSet) => void;
}

const VIBE_SUGGESTIONS = [
  '1990s Analog Motel Polaroid',
  'Rainy Tokyo Neon Rooftop',
  'Brutalist Concrete Loft Editorial',
  'Warm Film Diner Late Night',
];

export const PivotVibeModal: React.FC<PivotVibeModalProps> = ({
  isOpen,
  onClose,
  onCreatedSet,
}) => {
  const [vibe, setVibe] = useState('');
  const [subjectFocus, setSubjectFocus] = useState(
    'Black woman, medium brown skin, visible natural skin texture'
  );
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = vibe.trim();
    if (trimmed.length < 3) {
      setErrorMsg('Enter an aesthetic vibe of at least 3 characters (for example: "Rainy Tokyo Neon Rooftop").');
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);

    try {
      const response = await fetch('/api/direct-set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vibe: trimmed,
          subjectFocus: subjectFocus.trim(),
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        setErrorMsg(data.error || 'Unable to generate prompt set. Check server logs or try creating a blank set.');
        return;
      }

      if (data.set) {
        onCreatedSet(data.set);
        setVibe('');
        onClose();
      }
    } catch {
      setErrorMsg('Network error reaching the prompt director service.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateBlank = () => {
    const label = vibe.trim() || 'Custom Director Set';
    const stamp = Date.now();
    const customSet: PromptSet = {
      id: `manual-${stamp}`,
      name: label,
      subtitle: `Custom three-scene prompt blueprint tailored for ${label}.`,
      aestheticTag: 'Custom Manual Set',
      isCustom: true,
      scenes: [
        {
          id: `manual-scene-${stamp}-1`,
          sceneNumber: '01',
          title: 'Primary Establishing Frame',
          breakdown: 'Opening scene establishing key light, wardrobe texture, and camera distance.',
          imageAlt: `${label} Scene 01`,
          subjectDescriptor: subjectFocus.trim() || 'Black woman, medium brown skin',
          wardrobe: 'minimalist structured knit top, subtle metallic jewelry',
          environment: 'architectural interior with clean textured walls',
          poseAndFraming: 'eye-level medium portrait, shallow depth of field',
          lightingId: 'soft-window-left',
          recommendedLightingId: 'soft-window-left',
          lightingPhrase: 'natural window light from the left',
          cameraAndLens: 'shot on Canon EOS R5, 85mm f/1.8',
          focalLengthLabel: '85mm f/1.8',
          qualityTokens: 'visible skin pores, natural texture, photorealistic, raw photo',
          negativeTokens:
            '(worst quality, low quality:1.4), airbrushed, plastic skin, deformed hands, extra fingers, cartoon, watermark, text',
          skinTextureFocus: 'Natural pores & directional soft wrap',
          contrastMotif: 'Clean texture against architectural backdrop',
        },
        {
          id: `manual-scene-${stamp}-2`,
          sceneNumber: '02',
          title: 'Candid Environmental Mid',
          breakdown: 'Mid-distance candid perspective emphasizing posture and authentic room lighting.',
          imageAlt: `${label} Scene 02`,
          subjectDescriptor: subjectFocus.trim() || 'Black woman, natural hair',
          wardrobe: 'fitted neutral bodysuit, relaxed denim jacket',
          environment: 'candid interior doorway with natural reflections',
          poseAndFraming: 'three-quarter environmental shot, slight low angle',
          lightingId: 'overhead-fluorescent',
          recommendedLightingId: 'overhead-fluorescent',
          lightingPhrase: 'ambient overhead interior lighting',
          cameraAndLens: 'shot on 35mm lens',
          focalLengthLabel: '35mm f/2.8',
          qualityTokens: 'candid film grain, natural body proportions, raw photograph',
          negativeTokens:
            '(worst quality, low quality:1.4), distorted proportions, extra limbs, smooth skin, airbrushed, watermark, text',
          skinTextureFocus: 'Unretouched ambient grain',
          contrastMotif: 'Neutral tones against environmental depth',
        },
        {
          id: `manual-scene-${stamp}-3`,
          sceneNumber: '03',
          title: 'High-Contrast Detail Angle',
          breakdown: 'Dynamic high or low-angle crop highlighting fabric detail and directional shadow.',
          imageAlt: `${label} Scene 03`,
          subjectDescriptor: subjectFocus.trim() || 'Black woman, brown skin',
          wardrobe: 'textured denim and vibrant accent fabric detail',
          environment: 'textured stone or concrete surface with crisp shadows',
          poseAndFraming: 'high-angle crop, tight geometric framing',
          lightingId: 'harsh-midday-sun',
          recommendedLightingId: 'harsh-midday-sun',
          lightingPhrase: 'harsh directional sunlight creating sharp shadows',
          cameraAndLens: 'shot on 35mm lens',
          focalLengthLabel: '35mm f/2.0',
          qualityTokens: 'high contrast, gritty texture, photorealistic, raw candid',
          negativeTokens:
            '(worst quality, low quality:1.4), extra limbs, smooth plastic skin, anime, blurry, watermark, text',
          skinTextureFocus: 'Crisp shadow boundary',
          contrastMotif: 'Fabric accent against gritty stone',
        },
      ],
      technicalNotes: [
        {
          id: `manual-note-${stamp}-1`,
          number: '01',
          title: 'Anchor subject identity',
          summary: 'Keep your trained LoRA tag at 0.75–0.85 across all three custom scenes.',
        },
        {
          id: `manual-note-${stamp}-2`,
          number: '02',
          title: 'Preserve lighting cues',
          summary: 'Adjust texture keywords whenever you change the light source.',
        },
        {
          id: `manual-note-${stamp}-3`,
          number: '03',
          title: 'Stay within CFG 7–9',
          summary: 'Prevent plastic skin smoothing by capping CFG at 9.0.',
        },
      ],
    };

    onCreatedSet(customSet);
    setVibe('');
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pivot-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
    >
      <div className="w-full max-w-lg rounded-xl border border-[#E2E4E9] bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="pivot-modal-title" className="font-display text-xl font-bold text-[#0B0C0E]">
              Pivot to a New Aesthetic Set
            </h2>
            <p className="mt-1 text-sm text-[#525866]">
              Name any visual vibe to generate a 3-scene prompt breakdown, or start a blank custom
              set.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close pivot vibe dialog"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-[#6B7280] transition-colors hover:bg-[#F3F4F6] hover:text-[#0B0C0E] focus-visible:outline-2 focus-visible:outline-[#2563EB]"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleGenerate} className="mt-5 space-y-4">
          <div>
            <label htmlFor="vibe-input" className="block text-xs font-semibold text-[#374151]">
              Target Aesthetic Vibe
            </label>
            <input
              id="vibe-input"
              type="text"
              value={vibe}
              onChange={(e) => setVibe(e.target.value)}
              placeholder="e.g. Rainy Tokyo Neon Rooftop, 1990s Analog Motel..."
              className="mt-1.5 min-h-[42px] w-full rounded-lg border border-[#D1D5DB] bg-white px-3.5 py-2 text-sm text-[#0B0C0E] focus:border-[#2563EB] focus:outline-none"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {VIBE_SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => setVibe(suggestion)}
                  className="rounded-md border border-[#E2E4E9] bg-[#F8F9FA] px-2.5 py-1 text-xs font-medium text-[#374151] transition-colors hover:border-[#2563EB] hover:text-[#2563EB]"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label
              htmlFor="subject-baseline-input"
              className="block text-xs font-semibold text-[#374151]"
            >
              Subject Baseline Descriptor
            </label>
            <input
              id="subject-baseline-input"
              type="text"
              value={subjectFocus}
              onChange={(e) => setSubjectFocus(e.target.value)}
              className="mt-1.5 min-h-[42px] w-full rounded-lg border border-[#D1D5DB] bg-white px-3.5 py-2 text-sm text-[#0B0C0E] focus:border-[#2563EB] focus:outline-none"
            />
          </div>

          {errorMsg && (
            <div
              role="alert"
              className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs text-[#991B1B]"
            >
              {errorMsg}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E2E4E9] pt-4">
            <button
              type="button"
              onClick={handleCreateBlank}
              disabled={isLoading}
              className="inline-flex min-h-[42px] items-center gap-1.5 rounded-lg border border-[#D1D5DB] bg-white px-4 py-2 text-xs font-semibold text-[#0B0C0E] transition-colors hover:bg-[#F3F4F6] disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Create Blank Set
            </button>

            <button
              type="submit"
              disabled={isLoading}
              className="inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-[#2563EB] px-5 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#1D4ED8] disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Directing 3 Scenes...
                </>
              ) : (
                'Generate 3-Scene Set'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
