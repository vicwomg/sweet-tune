import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  CircleDot,
  Columns3,
  Gauge,
  HelpCircle,
  ListMusic,
  MicOff,
  Settings,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { AudioEngine } from './audio/AudioEngine';
import { getEffectiveEnabledNotes, midiToTargetFrequency } from './audio/temperaments';
import { AboutSheet } from './components/AboutSheet';
import { PresetEditorSheet } from './components/PresetEditorSheet';
import { PresetManagerSheet } from './components/PresetManagerSheet';
import { QuickPresetBar } from './components/QuickPresetBar';
import { SettingsSheet } from './components/SettingsSheet';
import { StrobeDisplay } from './components/StrobeDisplay';
import { useTunerStore } from './store/useTunerStore';
import type { TemperamentPreset, TunerFrame } from './types/tuner';

const INITIAL_FRAME: TunerFrame = {
  active: false,
  midi: 69,
  octave: 4,
  pitchClass: 9,
  detectedHz: 0,
  targetHz: 440,
  cents: 0,
  phaseVelocityHz: 0,
  phase: 0,
  clarity: 0,
  rms: 0,
};

export function App() {
  const store = useTunerStore();

  const [isListening, setIsListening] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [lockedMidi, setLockedMidi] = useState<number | null>(null);
  const [isRefToneOn, setIsRefToneOn] = useState(false);

  const [showAbout, setShowAbout] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showManager, setShowManager] = useState(false);
  const [editingPreset, setEditingPreset] = useState<TemperamentPreset | null | undefined>(
    undefined
  );

  const frameRef = useRef<TunerFrame>({ ...INITIAL_FRAME });
  const engineRef = useRef<AudioEngine | null>(null);

  if (!engineRef.current) {
    engineRef.current = new AudioEngine((frame) => {
      frameRef.current = frame;
    });
  }

  // Push updated config to AudioWorklet whenever preset, root, A4, or lock changes
  useEffect(() => {
    engineRef.current?.updateConfig({
      a4Hz: store.a4Hz,
      lockedMidi,
      preset: store.activePreset,
      rootNote: store.rootNote,
      noiseGate: store.noiseGate,
    });

    if (isRefToneOn) {
      const midi = lockedMidi ?? frameRef.current.midi ?? 69;
      const hz = midiToTargetFrequency(
        midi,
        store.a4Hz,
        store.activePreset,
        store.rootNote
      );
      engineRef.current?.updateReferenceTone(hz);
    }
  }, [
    store.a4Hz,
    store.activePreset,
    store.rootNote,
    store.noiseGate,
    lockedMidi,
    isRefToneOn,
  ]);

  useEffect(() => {
    return () => {
      engineRef.current?.stop();
    };
  }, []);

  const toggleMic = useCallback(async () => {
    if (isListening) {
      engineRef.current?.stop();
      setIsListening(false);
      setIsRefToneOn(false);
      frameRef.current = { ...INITIAL_FRAME };
      return;
    }

    setMicError(null);
    try {
      await engineRef.current?.start({
        a4Hz: store.a4Hz,
        lockedMidi,
        preset: store.activePreset,
        rootNote: store.rootNote,
        noiseGate: store.noiseGate,
      });
      setIsListening(true);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Microphone permission denied or unavailable.';
      setMicError(message);
      setIsListening(false);
    }
  }, [isListening, store.a4Hz, store.activePreset, store.rootNote, store.noiseGate, lockedMidi]);

  const toggleRefTone = useCallback(async () => {
    if (isRefToneOn) {
      engineRef.current?.stopReferenceTone();
      setIsRefToneOn(false);
      return;
    }

    const midi = lockedMidi ?? frameRef.current.midi ?? 69;
    const hz = midiToTargetFrequency(
      midi,
      store.a4Hz,
      store.activePreset,
      store.rootNote
    );
    await engineRef.current?.playReferenceTone(hz);
    setIsRefToneOn(true);
  }, [isRefToneOn, lockedMidi, store.a4Hz, store.activePreset, store.rootNote]);

  const handleToggleLock = useCallback(
    (currentMidi: number) => {
      setLockedMidi((prev) => (prev !== null ? null : currentMidi));
    },
    []
  );

  const handleStepLockedMidi = useCallback(
    (delta: number) => {
      const enabledByPc = getEffectiveEnabledNotes(store.activePreset, store.rootNote);
      const dir = delta >= 0 ? 1 : -1;
      setLockedMidi((prev) => {
        let next = prev ?? 69;
        for (let i = 0; i < 12; i++) {
          next = Math.max(21, Math.min(108, next + dir));
          const pc = ((next % 12) + 12) % 12;
          if (enabledByPc[pc]) return next;
        }
        return Math.max(21, Math.min(108, (prev ?? 69) + delta));
      });
    },
    [store.activePreset, store.rootNote]
  );

  return (
    <div className="flex flex-col h-[100dvh] w-full bg-zinc-950 text-zinc-100 overflow-hidden">
      {/* Top Header */}
      <header className="flex items-center justify-between w-full max-w-md mx-auto px-4 pt-3 pb-1.5">
        <div className="flex items-center gap-2">
          <div
            className={`w-2.5 h-2.5 rounded-full transition-colors ${
              isListening ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-zinc-700'
            }`}
          />
          <h1 className="font-['Michroma',sans-serif] text-xl font-bold tracking-wide text-zinc-100">
            SweetTune
          </h1>
          <button
            type="button"
            onClick={() => setShowAbout(true)}
            aria-label="About SweetTune"
            title="About SweetTune"
            className="p-1 rounded-full text-zinc-500 hover:text-zinc-200 active:scale-90 transition"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
        </div>

        <div
          className={`flex items-center gap-2 transition-opacity ${
            isListening ? 'opacity-100' : 'opacity-35 pointer-events-none'
          }`}
        >
          {isListening && (
            <button
              type="button"
              onClick={toggleMic}
              aria-label="Pause Mic"
              title="Pause Mic"
              className="flex items-center gap-1 rounded-full bg-zinc-900 border border-zinc-800 px-2.5 py-1.5 text-xs font-medium text-rose-400 active:scale-95 transition"
            >
              <MicOff className="w-3.5 h-3.5" />
              <span>Pause</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            aria-label="Settings"
            className="p-2 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-300 active:scale-95 transition"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Always-visible 1-tap Preset Switcher */}
      <div
        className={`transition-opacity ${
          isListening ? 'opacity-100' : 'opacity-35 pointer-events-none select-none'
        }`}
      >
        <QuickPresetBar
          quickPresets={store.quickPresets}
          activePreset={store.activePreset}
          rootNote={store.rootNote}
          useFlats={store.useFlats}
          onSelectPreset={store.selectPreset}
          onEditPreset={(preset) => setEditingPreset(preset)}
          onSelectRoot={store.setRootNote}
          onOpenNewPreset={() => setShowManager(true)}
        />
      </div>

      {/* Mic Error Banner */}
      {micError && (
        <div className="w-full max-w-md mx-auto px-4">
          <div className="rounded-xl bg-rose-500/15 border border-rose-500/40 px-3 py-2 text-xs text-rose-300">
            {micError}
          </div>
        </div>
      )}

      {/* Center Hero: Strobe Display */}
      <StrobeDisplay
        frameRef={frameRef}
        isListening={isListening}
        onStartTuner={toggleMic}
        strobeStyle={store.strobeStyle}
        lockedMidi={lockedMidi}
        onToggleLock={handleToggleLock}
        onStepLockedMidi={handleStepLockedMidi}
        useFlats={store.useFlats}
        activePreset={store.activePreset}
        rootNote={store.rootNote}
        a4Hz={store.a4Hz}
        onOpenSettings={() => setShowSettings(true)}
      />

      {/* Bottom Action Bar */}
      <footer
        className={`w-full max-w-md mx-auto px-3 pb-5 pt-2 transition-opacity ${
          isListening ? 'opacity-100' : 'opacity-35 pointer-events-none select-none'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={toggleRefTone}
            aria-label="Reference Tone"
            title="Reference Tone"
            className={`flex items-center justify-center w-10 h-10 rounded-full border active:scale-95 transition shrink-0 ${
              isRefToneOn
                ? 'bg-amber-400/15 border-amber-400/50 text-amber-300'
                : 'bg-zinc-900 border-zinc-800 text-zinc-400'
            }`}
          >
            {isRefToneOn ? (
              <Volume2 className="w-4 h-4" />
            ) : (
              <VolumeX className="w-4 h-4" />
            )}
          </button>

          <div
            role="tablist"
            aria-label="Tuner view"
            className="flex items-center gap-0.5 h-10 rounded-full bg-zinc-900 border border-zinc-800 p-1"
          >
            {(
              [
                { id: 'circle', label: 'Wheel', Icon: CircleDot },
                { id: 'horizontal', label: 'Bands', Icon: Columns3 },
                { id: 'dial', label: 'Dial', Icon: Gauge },
                { id: 'bars', label: 'LED', Icon: Activity },
              ] as const
            ).map(({ id, label, Icon }) => {
              const selected = store.strobeStyle === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => store.setStrobeStyle(id)}
                  title={label}
                  className={`flex items-center gap-1 h-full rounded-full px-2.5 text-[11px] font-semibold transition active:scale-95 ${
                    selected
                      ? 'bg-emerald-500 text-zinc-950 shadow-sm shadow-emerald-500/25'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span className="hidden xs:inline sm:inline">{label}</span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setShowManager(true)}
            aria-label="Temperament Presets"
            title="Temperament Presets"
            className="flex items-center justify-center w-10 h-10 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-300 active:scale-95 transition shrink-0"
          >
            <ListMusic className="w-4 h-4 text-emerald-400" />
          </button>
        </div>
      </footer>

      {/* Modals / Bottom Sheets */}
      {showAbout && <AboutSheet onClose={() => setShowAbout(false)} />}

      {showSettings && (
        <SettingsSheet
          a4Hz={store.a4Hz}
          onChangeA4={store.setA4Hz}
          activePresetName={store.activePreset.name}
          useFlats={store.useFlats}
          onToggleFlats={store.toggleActivePresetFlats}
          strobeStyle={store.strobeStyle}
          onChangeStrobeStyle={store.setStrobeStyle}
          noiseGate={store.noiseGate}
          onChangeNoiseGate={store.setNoiseGate}
          sampleRate={engineRef.current?.getSampleRate()}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showManager && (
        <PresetManagerSheet
          allPresets={store.allPresets}
          activePresetId={store.activePresetId}
          onSelect={store.selectPreset}
          onTogglePin={store.togglePinPreset}
          onEdit={(preset) => {
            setShowManager(false);
            setEditingPreset(preset);
          }}
          onClone={(preset) => {
            setShowManager(false);
            setEditingPreset(preset);
          }}
          onDelete={store.deleteCustomPreset}
          onCreateNew={() => {
            setShowManager(false);
            setEditingPreset(null);
          }}
          onClose={() => setShowManager(false)}
        />
      )}

      {editingPreset !== undefined && (
        <PresetEditorSheet
          initialPreset={editingPreset}
          allPresets={store.allPresets}
          onSave={(data) => {
            store.saveCustomPreset(data);
            setEditingPreset(undefined);
          }}
          onClose={() => setEditingPreset(undefined)}
        />
      )}
    </div>
  );
}

export default App;
