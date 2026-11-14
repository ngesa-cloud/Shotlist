import React from 'react';

interface HeaderProps {
  onOpenPivotModal: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onOpenPivotModal }) => {
  return (
    <header className="sticky top-0 z-40 border-b border-[#E2E4E9] bg-[#F8F9FA]/95 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-8 px-6 lg:px-10">
        {/* Zone 1: Single-element brand wordmark */}
        <a
          href="#top"
          className="font-display text-lg font-bold tracking-tight text-[#0B0C0E] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#2563EB]"
        >
          Framecraft
        </a>

        {/* Zone 2: 4 concise single-line navigation links */}
        <nav
          aria-label="Primary navigation"
          className="hidden md:flex items-center gap-6 text-sm font-medium text-[#525866]"
        >
          <a
            href="#aesthetic-sets"
            className="hover:text-[#0B0C0E] hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#2563EB]"
          >
            Aesthetic Sets
          </a>
          <a
            href="#contact-sheet"
            className="hover:text-[#0B0C0E] hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#2563EB]"
          >
            Contact Sheet
          </a>
          <a
            href="#prompt-compiler"
            className="hover:text-[#0B0C0E] hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#2563EB]"
          >
            Prompt Compiler
          </a>
          <a
            href="#technical-notes"
            className="hover:text-[#0B0C0E] hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#2563EB]"
          >
            Technical Notes
          </a>
        </nav>

        {/* Zone 3: Single primary action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onOpenPivotModal}
            className="min-h-[40px] rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#1D4ED8] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB]"
          >
            Pivot Vibe
          </button>
        </div>
      </div>
    </header>
  );
};
