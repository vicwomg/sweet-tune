import {
  Activity,
  CircleDot,
  Columns3,
  Gauge,
  HelpCircle,
  ListMusic,
  Mic,
  MicOff,
  Settings,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AudioEngine } from "./audio/AudioEngine";
import {
  getEffectiveEnabledNotes,
  midiToTargetFrequency,
} from "./audio/temperaments";
import { AboutSheet } from "./components/AboutSheet";
import { MetronomeView } from "./components/MetronomeView";
import { PresetEditorSheet } from "./components/PresetEditorSheet";
import { PresetManagerSheet } from "./components/PresetManagerSheet";
import { QuickPresetBar } from "./components/QuickPresetBar";
import { SettingsSheet } from "./components/SettingsSheet";
import { StrobeDisplay } from "./components/StrobeDisplay";
import { useTunerStore } from "./store/useTunerStore";
import { isNativeApp } from "./utils/platform";
import { screenWakeManager } from "./utils/wakeLock";
import type { TemperamentPreset, TunerFrame } from "./types/tuner";

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
  const [isMetronomeMode, setIsMetronomeMode] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showManager, setShowManager] = useState(false);
  const [editingPreset, setEditingPreset] = useState<
    TemperamentPreset | null | undefined
  >(undefined);

  const frameRef = useRef<TunerFrame>({ ...INITIAL_FRAME });
  const engineRef = useRef<AudioEngine | null>(null);

  if (!engineRef.current) {
    engineRef.current = new AudioEngine((frame) => {
      frameRef.current = frame;
      if (frame.active) {
        screenWakeManager.ping();
      }
    });
  }

  // Keep screen awake for 3 minutes from launch, touch/key interaction, or detected pitch
  useEffect(() => {
    screenWakeManager.ping(true);
    const onInteract = () => screenWakeManager.ping();
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        screenWakeManager.ping(true);
      }
    };
    window.addEventListener("pointerdown", onInteract, { passive: true });
    window.addEventListener("keydown", onInteract, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pointerdown", onInteract);
      window.removeEventListener("keydown", onInteract);
      document.removeEventListener("visibilitychange", onVisibility);
      void screenWakeManager.release();
    };
  }, []);

  // Push updated config to AudioWorklet whenever preset, root, A4, or lock changes
  useEffect(() => {
    engineRef.current?.updateConfig({
      a4Hz: store.a4Hz,
      lockedMidi,
      preset: store.activePreset,
      rootNote: store.rootNote,
      noiseGate: store.noiseGate,
      inputGain: store.inputGain,
    });

    if (isRefToneOn) {
      const midi = lockedMidi ?? frameRef.current.midi ?? 69;
      const hz = midiToTargetFrequency(
        midi,
        store.a4Hz,
        store.activePreset,
        store.rootNote,
      );
      engineRef.current?.updateReferenceTone(hz);
    }
  }, [
    store.a4Hz,
    store.activePreset,
    store.rootNote,
    store.noiseGate,
    store.inputGain,
    lockedMidi,
    isRefToneOn,
  ]);

  useEffect(() => {
    if (isNativeApp()) {
      void engineRef.current
        ?.start({
          a4Hz: store.a4Hz,
          lockedMidi,
          preset: store.activePreset,
          rootNote: store.rootNote,
          noiseGate: store.noiseGate,
          inputGain: store.inputGain,
        })
        .then(() => setIsListening(true))
        .catch(() => {
          // Fall back to Start Tuner button if auto-start is blocked or permission not yet granted
        });
    }
    return () => {
      engineRef.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Automatically recover microphone stream when returning to foreground on iOS / WebApp / mobile
  useEffect(() => {
    if (!isListening) return;

    let timer1: number | null = null;
    let timer2: number | null = null;

    const clearTimers = () => {
      if (timer1 !== null) window.clearTimeout(timer1);
      if (timer2 !== null) window.clearTimeout(timer2);
      timer1 = null;
      timer2 = null;
    };

    const getConfig = () => ({
      a4Hz: store.a4Hz,
      lockedMidi,
      preset: store.activePreset,
      rootNote: store.rootNote,
      noiseGate: store.noiseGate,
      inputGain: store.inputGain,
    });

    const recoverMic = () => {
      if (document.visibilityState !== "visible") return;
      clearTimers();
      // Attempt immediate resume of the unlocked AudioContext, plus staggered retries
      // as iOS WebKit finishes re-activating the foreground AVAudioSession
      void engineRef.current?.recover(getConfig(), false);
      timer1 = window.setTimeout(() => {
        void engineRef.current?.recover(getConfig(), false);
      }, 150);
      timer2 = window.setTimeout(() => {
        void engineRef.current?.recover(getConfig(), false);
      }, 500);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        recoverMic();
      } else {
        clearTimers();
      }
    };

    const handleUserGesture = () => {
      if (document.visibilityState === "visible") {
        void engineRef.current?.recover(getConfig(), false);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pageshow", recoverMic);
    window.addEventListener("focus", recoverMic);
    window.addEventListener("pointerdown", handleUserGesture, { passive: true });

    return () => {
      clearTimers();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pageshow", recoverMic);
      window.removeEventListener("focus", recoverMic);
      window.removeEventListener("pointerdown", handleUserGesture);
    };
  }, [
    isListening,
    store.a4Hz,
    store.activePreset,
    store.rootNote,
    store.noiseGate,
    store.inputGain,
    lockedMidi,
  ]);

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
        inputGain: store.inputGain,
      });
      setIsListening(true);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Microphone permission denied or unavailable.";
      setMicError(message);
      setIsListening(false);
    }
  }, [
    isListening,
    store.a4Hz,
    store.activePreset,
    store.rootNote,
    store.noiseGate,
    store.inputGain,
    lockedMidi,
  ]);

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
      store.rootNote,
    );
    await engineRef.current?.playReferenceTone(hz);
    setIsRefToneOn(true);
  }, [isRefToneOn, lockedMidi, store.a4Hz, store.activePreset, store.rootNote]);

  const handleToggleLock = useCallback((currentMidi: number) => {
    setLockedMidi((prev) => (prev !== null ? null : currentMidi));
  }, []);

  const handleStepLockedMidi = useCallback(
    (delta: number) => {
      const enabledByPc = getEffectiveEnabledNotes(
        store.activePreset,
        store.rootNote,
      );
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
    [store.activePreset, store.rootNote],
  );

  return (
    <div
      className="fixed inset-0 flex flex-col w-full bg-zinc-950 text-zinc-100 overflow-hidden"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >
      {/* Top Header */}
      <header className="flex items-center justify-between w-full max-w-md mx-auto px-4 pt-3 pb-1.5">
        <div className="flex items-center gap-1.5">
          <div
            className={`w-2.5 h-2.5 rounded-full shrink-0 transition-colors ${
              isListening
                ? "bg-emerald-400 shadow-[0_0_8px_#34d399]"
                : "bg-zinc-700"
            }`}
          />
          <h1 className="font-['Michroma',sans-serif] text-[20px] font-bold tracking-wide text-zinc-100">
            SweetTune
          </h1>
          <button
            type="button"
            onClick={() => setShowAbout(true)}
            aria-label="About SweetTune"
            title="About SweetTune"
            className="-ml-1 p-0.5 rounded-full text-zinc-500 hover:text-zinc-200 active:scale-90 transition"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          {(isListening || isNativeApp()) && (
            <button
              type="button"
              onClick={toggleMic}
              aria-label={isListening ? "Pause Mic" : "Resume Mic"}
              title={isListening ? "Pause Mic" : "Resume Mic"}
              className={`p-2 rounded-full bg-zinc-900 border border-zinc-800 active:scale-95 transition ${
                isListening ? "text-rose-400" : "text-emerald-400"
              }`}
            >
              {isListening ? (
                <MicOff className="w-4 h-4" />
              ) : (
                <Mic className="w-4 h-4" />
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsMetronomeMode((v) => !v)}
            aria-label={isMetronomeMode ? 'Switch to Tuner' : 'Switch to Metronome'}
            title={isMetronomeMode ? 'Switch to Tuner' : 'Metronome'}
            className={`p-2 rounded-full border active:scale-95 transition ${
              isMetronomeMode
                ? 'bg-emerald-500 border-emerald-400 text-zinc-950 shadow-sm shadow-emerald-500/25'
                : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:text-zinc-100'
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-4 h-4"
            >
              <path d="M8 4h8l3 16H5L8 4z" />
              <path d="M12 17l5-10" />
              <circle cx="15" cy="11" r="1.25" fill="currentColor" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            aria-label="Settings"
            className={`p-2 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-300 active:scale-95 transition ${
              isListening || isNativeApp() ? 'opacity-100' : 'opacity-35 pointer-events-none'
            }`}
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      {isMetronomeMode ? (
        <MetronomeView
          bpm={store.metronomeBpm}
          onChangeBpm={store.setMetronomeBpm}
          beats={store.metronomeBeats}
          onChangeBeats={store.setMetronomeBeats}
          accents={store.metronomeAccents}
          onToggleAccent={store.toggleMetronomeAccent}
        />
      ) : (
        <>
          {/* Always-visible 1-tap Preset Switcher */}
      <div
        className={`transition-opacity ${
          isListening || isNativeApp()
            ? "opacity-100"
            : "opacity-35 pointer-events-none select-none"
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
        className={`w-full max-w-md mx-auto px-3 pb-3 pt-2 transition-opacity ${
          isListening || isNativeApp()
            ? "opacity-100"
            : "opacity-35 pointer-events-none select-none"
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
                ? "bg-amber-400/15 border-amber-400/50 text-amber-300"
                : "bg-zinc-900 border-zinc-800 text-zinc-400"
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
                { id: "circle", label: "Wheel", Icon: CircleDot },
                { id: "horizontal", label: "Bands", Icon: Columns3 },
                { id: "dial", label: "Dial", Icon: Gauge },
                { id: "bars", label: "LED", Icon: Activity },
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
                  className={`flex items-center gap-1 h-full rounded-full px-2.5 text-[0.6875rem] font-semibold transition active:scale-95 ${
                    selected
                      ? "bg-emerald-500 text-zinc-950 shadow-sm shadow-emerald-500/25"
                      : "text-zinc-400 hover:text-zinc-200"
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
        </>
      )}

      {/* Modals / Bottom Sheets */}
      {showAbout && <AboutSheet onClose={() => setShowAbout(false)} />}

      {showSettings && (
        <SettingsSheet
          a4Hz={store.a4Hz}
          onChangeA4={store.setA4Hz}
          activePresetName={store.activePreset.name}
          allPresets={store.allPresets}
          defaultPresetId={store.defaultPresetId}
          onChangeDefaultPresetId={store.setDefaultPresetId}
          useFlats={store.useFlats}
          onToggleFlats={store.toggleActivePresetFlats}
          strobeStyle={store.strobeStyle}
          onChangeStrobeStyle={store.setStrobeStyle}
          noiseGate={store.noiseGate}
          onChangeNoiseGate={store.setNoiseGate}
          inputGain={store.inputGain}
          onChangeInputGain={store.setInputGain}
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
