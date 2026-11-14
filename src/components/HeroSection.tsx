import React, { useState } from 'react';
import { ArrowDownRight, Camera } from 'lucide-react';
import { CompilerConfig, PromptSet } from '../types/photoshoot';

interface HeroSectionProps {
  activeSet: PromptSet;
  config: CompilerConfig;
}

export const HeroSection: React.FC<HeroSectionProps> = ({ activeSet, config }) => {
  const [imgError, setImgError] = useState(false);

  return (
    <section id="top" className="border-b border-[#E2E4E9] bg-[#F8F9FA]">
      <div className="mx-auto max-w-[1440px] px-6 py-10 lg:px-10 lg:py-14">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-stretch">
          {/* Left Column: Editorial Hierarchy */}
          <div className="flex flex-col justify-between lg:col-span-6 lg:pr-6">
            <div>
              <p className="text-xs font-semibold tracking-wide text-[#2563EB]">
                Photoshoot Director · {activeSet.aestheticTag}
              </p>
              <h1
                className="mt-3 font-display text-3xl font-bold tracking-tight text-[#0B0C0E] sm:text-4xl lg:text-[2.75rem] lg:leading-[1.12]"
                style={{ textWrap: 'balance' }}
              >
                {activeSet.name}
              </h1>
              <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-[#4B5563]">
                {activeSet.subtitle}
              </p>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-4">
              <a
                href="#prompt-compiler"
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#0B0C0E] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1F2937] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB]"
              >
                Open Prompt Compiler
                <ArrowDownRight className="h-4 w-4" aria-hidden="true" />
              </a>
              <a
                href="#technical-notes"
                className="inline-flex min-h-[44px] items-center rounded-lg border border-[#D1D5DB] bg-white px-5 py-2.5 text-sm font-semibold text-[#0B0C0E] transition-colors hover:bg-[#F3F4F6] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB]"
              >
                Inspect Technical Notes
              </a>
            </div>
          </div>

          {/* Right Column: Matching-Height Visual Frame */}
          <div className="lg:col-span-6">
            <div className="relative h-64 overflow-hidden rounded-xl border border-[#E2E4E9] bg-[#141519] sm:h-80 lg:h-full lg:min-h-[300px]">
              {!imgError ? (
                <img
                  src="/src/assets/images/hero_director_desk_1794643366185.jpg"
                  alt="Overhead view of a photoshoot director desk with camera body, 85mm lens, light meter, and contact sheet"
                  referrerPolicy="no-referrer"
                  onError={() => setImgError(true)}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-gradient-to-br from-[#18181B] to-[#09090B] p-6 text-center text-[#E4E4E7]">
                  <Camera className="h-8 w-8 text-[#9CA3AF]" aria-hidden="true" />
                  <p className="font-display text-sm font-semibold">
                    Director Desk &amp; Optical Reference
                  </p>
                </div>
              )}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-4 sm:p-5">
                <p className="text-xs font-medium text-white/95 truncate">
                  Contact Sheet · 85mm f/1.8 · iPhone 14 Pro · 35mm Street
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Full-width 4-column studio specs strip */}
        <div className="mt-10 grid grid-cols-2 gap-6 border-t border-[#E2E4E9] pt-6 sm:grid-cols-4">
          <div>
            <p className="text-xs font-medium text-[#6B7280]">Scenes in Active Set</p>
            <p className="mt-1 font-mono text-2xl font-semibold text-[#0B0C0E] tabular-nums">
              0{activeSet.scenes.length}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-[#6B7280]">Subject LoRA Weight</p>
            <p className="mt-1 font-mono text-2xl font-semibold text-[#0B0C0E] tabular-nums">
              {config.loraEnabled ? config.loraWeight.toFixed(2) : 'Off'}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-[#6B7280]">Recommended CFG Scale</p>
            <p className="mt-1 font-mono text-2xl font-semibold text-[#0B0C0E] tabular-nums">
              7.0 – 9.0
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-[#6B7280]">Active Compiler Target</p>
            <p className="mt-1 font-mono text-2xl font-semibold text-[#0B0C0E] tabular-nums">
              {config.engine === 'sd'
                ? 'SD / A1111'
                : config.engine === 'midjourney'
                  ? 'Midjourney'
                  : 'ComfyUI'}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};
