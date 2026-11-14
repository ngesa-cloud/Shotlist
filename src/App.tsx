import { useEffect, useMemo, useState } from 'react';
import { PRESET_SETS } from './data/presetSets';
import { CompilerConfig, PromptSet, SceneSpec } from './types/photoshoot';
import { Header } from './components/Header';
import { HeroSection } from './components/HeroSection';
import { ContactSheetGrid } from './components/ContactSheetGrid';
import { PromptCompilerWorkbench } from './components/PromptCompilerWorkbench';
import { TechnicalNotesSection } from './components/TechnicalNotesSection';
import { PivotVibeModal } from './components/PivotVibeModal';
import { SceneLightboxModal } from './components/SceneLightboxModal';

const STORAGE_KEY_SETS = 'framecraft_sets_v1';
const STORAGE_KEY_CONFIG = 'framecraft_config_v1';
const STORAGE_KEY_SELECTION = 'framecraft_selection_v1';

const DEFAULT_CONFIG: CompilerConfig = {
  engine: 'sd',
  loraEnabled: true,
  loraName: 'yourname',
  loraWeight: 0.8,
  cfgScale: 7.5,
  steps: 30,
  seed: -1,
  seedLocked: false,
  aspectRatio: '3:4',
  sampler: 'dpmpp_2m',
};

function loadStoredSets(): PromptSet[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SETS);
    if (!raw) return PRESET_SETS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch {
    // ignore storage errors
  }
  return PRESET_SETS;
}

function loadStoredConfig(): CompilerConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CONFIG);
    if (!raw) return DEFAULT_CONFIG;
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function loadStoredSelection(sets: PromptSet[]): { setId: string; sceneId: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SELECTION);
    if (raw) {
      const parsed = JSON.parse(raw);
      const foundSet = sets.find((s) => s.id === parsed.setId);
      if (foundSet) {
        const foundScene = foundSet.scenes.find((sc) => sc.id === parsed.sceneId);
        return {
          setId: foundSet.id,
          sceneId: foundScene ? foundScene.id : foundSet.scenes[0].id,
        };
      }
    }
  } catch {
    // ignore
  }
  return {
    setId: sets[0].id,
    sceneId: sets[0].scenes[0].id,
  };
}

export default function App() {
  const [sets, setSets] = useState<PromptSet[]>(() => loadStoredSets());
  const [config, setConfig] = useState<CompilerConfig>(() => loadStoredConfig());
  const [selection, setSelection] = useState<{ setId: string; sceneId: string }>(() =>
    loadStoredSelection(sets)
  );
  const [isPivotModalOpen, setIsPivotModalOpen] = useState(false);
  const [lightboxScene, setLightboxScene] = useState<SceneSpec | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_SETS, JSON.stringify(sets));
    } catch {
      // ignore storage quota errors
    }
  }, [sets]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(config));
    } catch {
      // ignore
    }
  }, [config]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_SELECTION, JSON.stringify(selection));
    } catch {
      // ignore
    }
  }, [selection]);

  const activeSet = useMemo(
    () => sets.find((s) => s.id === selection.setId) ?? sets[0],
    [sets, selection.setId]
  );

  const activeScene = useMemo(
    () => activeSet.scenes.find((sc) => sc.id === selection.sceneId) ?? activeSet.scenes[0],
    [activeSet, selection.sceneId]
  );

  const handleSelectSet = (setId: string) => {
    const nextSet = sets.find((s) => s.id === setId);
    if (!nextSet) return;
    setSelection({
      setId: nextSet.id,
      sceneId: nextSet.scenes[0].id,
    });
  };

  const handleSelectScene = (sceneId: string) => {
    setSelection((prev) => ({ ...prev, sceneId }));
  };

  const handleChangeConfig = (patch: Partial<CompilerConfig>) => {
    setConfig((prev) => ({ ...prev, ...patch }));
  };

  const handleUpdateScene = (sceneId: string, patch: Partial<SceneSpec>) => {
    setSets((prevSets) =>
      prevSets.map((setItem) => {
        if (setItem.id !== activeSet.id) return setItem;
        return {
          ...setItem,
          scenes: setItem.scenes.map((scene) =>
            scene.id === sceneId ? { ...scene, ...patch } : scene
          ),
        };
      })
    );
  };

  const handleResetScene = (sceneId: string) => {
    const originalSet = PRESET_SETS.find((s) => s.id === activeSet.id);
    const originalScene = originalSet?.scenes.find((sc) => sc.id === sceneId);
    if (!originalScene) return;

    setSets((prevSets) =>
      prevSets.map((setItem) => {
        if (setItem.id !== activeSet.id) return setItem;
        return {
          ...setItem,
          scenes: setItem.scenes.map((sc) => (sc.id === sceneId ? originalScene : sc)),
        };
      })
    );
  };

  const handleCreatedSet = (newSet: PromptSet) => {
    setSets((prev) => [newSet, ...prev]);
    setSelection({
      setId: newSet.id,
      sceneId: newSet.scenes[0].id,
    });
  };

  const handleDeleteCustomSet = (setId: string) => {
    setSets((prev) => {
      const next = prev.filter((s) => s.id !== setId);
      if (next.length === 0) return PRESET_SETS;
      if (selection.setId === setId) {
        setSelection({ setId: next[0].id, sceneId: next[0].scenes[0].id });
      }
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#0B0C0E]">
      <Header onOpenPivotModal={() => setIsPivotModalOpen(true)} />

      <main>
        <HeroSection activeSet={activeSet} config={config} />

        <ContactSheetGrid
          sets={sets}
          activeSetId={activeSet.id}
          activeSceneId={activeScene.id}
          onSelectSet={handleSelectSet}
          onDeleteCustomSet={handleDeleteCustomSet}
          onSelectScene={handleSelectScene}
          onInspectScene={(scene) => setLightboxScene(scene)}
        />

        <PromptCompilerWorkbench
          activeSet={activeSet}
          activeScene={activeScene}
          config={config}
          onChangeConfig={handleChangeConfig}
          onUpdateScene={handleUpdateScene}
          onResetScene={handleResetScene}
        />

        <TechnicalNotesSection
          activeSet={activeSet}
          activeSceneId={activeScene.id}
          onSelectScene={(sceneId) => {
            handleSelectScene(sceneId);
            document.getElementById('prompt-compiler')?.scrollIntoView({ behavior: 'smooth' });
          }}
        />
      </main>

      <footer className="border-t border-[#E2E4E9] bg-[#F8F9FA]">
        <div className="mx-auto flex max-w-[1440px] flex-col items-start justify-between gap-4 px-6 py-8 text-xs text-[#6B7280] sm:flex-row sm:items-center lg:px-10">
          <p>Framecraft Photoshoot Director · Structured Prompt Engineering Workbench</p>
          <div className="flex items-center gap-6">
            <a href="#contact-sheet" className="hover:text-[#0B0C0E] transition-colors">
              Contact Sheet
            </a>
            <a href="#prompt-compiler" className="hover:text-[#0B0C0E] transition-colors">
              Compiler
            </a>
            <button
              type="button"
              onClick={() => setIsPivotModalOpen(true)}
              className="hover:text-[#0B0C0E] transition-colors"
            >
              Pivot Vibe
            </button>
          </div>
        </div>
      </footer>

      <PivotVibeModal
        isOpen={isPivotModalOpen}
        onClose={() => setIsPivotModalOpen(false)}
        onCreatedSet={handleCreatedSet}
      />

      <SceneLightboxModal
        scene={lightboxScene}
        config={config}
        onClose={() => setLightboxScene(null)}
        onLoadIntoCompiler={(sceneId) => {
          handleSelectScene(sceneId);
          document.getElementById('prompt-compiler')?.scrollIntoView({ behavior: 'smooth' });
        }}
      />
    </div>
  );
}
