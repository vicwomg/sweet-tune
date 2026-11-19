import React from 'react';
import { Minus, Plus, RotateCcw, X } from 'lucide-react';
import type { StrobeStyle, TemperamentPreset } from '../types/tuner';

interface SettingsSheetProps {
  a4Hz: number;
  onChangeA4: (hz: number) => void;
  activePresetName: string;
  allPresets: TemperamentPreset[];
  defaultPresetId: string;
  onChangeDefaultPresetId: (id: string) => void;
  useFlats: boolean;
  onToggleFlats: () => void;
  strobeStyle: StrobeStyle;
  onChangeStrobeStyle: (style: StrobeStyle) => void;
  noiseGate: number;
  onChangeNoiseGate: (gate: number) => void;
  inputGain: number;
  onChangeInputGain: (gain: number) => void;
  sampleRate?: number | null;
  onClose: () => void;
}

export const SettingsSheet: React.FC<SettingsSheetProps> = ({
  a4Hz,
  onChangeA4,
  activePresetName,
  allPresets,
  defaultPresetId,
  onChangeDefaultPresetId,
  useFlats,
  onToggleFlats,
  strobeStyle,
  onChangeStrobeStyle,
  noiseGate,
  onChangeNoiseGate,
  inputGain,
  onChangeInputGain,
  sampleRate,
  onClose,
}) => {
  const stepA4 = (delta: number) => {
    const next = Math.max(415, Math.min(466, Math.round((a4Hz + delta) * 10) / 10));
    onChangeA4(next);
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex flex-col w-full max-w-md max-h-[88dvh] bg-zinc-950 border border-zinc-800 rounded-3xl overflow-hidden shadow-2xl"
      >
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-zinc-800/80 bg-zinc-900/50">
          <h2 className="text-base font-bold text-zinc-100">Tuner Settings</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="p-2 rounded-full text-zinc-400 hover:text-zinc-200 active:scale-90 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-5 overflow-y-auto">
          {/* Default Preset on Launch */}
          <div className="space-y-1.5">
            <label
              htmlFor="default-preset-select"
              className="block text-xs font-semibold uppercase tracking-wider text-zinc-400"
            >
              Default Preset on Launch
            </label>
            <select
              id="default-preset-select"
              value={defaultPresetId}
              onChange={(e) => onChangeDefaultPresetId(e.target.value)}
              className="w-full rounded-xl bg-zinc-900 border border-zinc-800 px-3 py-2.5 text-xs font-semibold text-zinc-200 focus:outline-none focus:border-emerald-500"
            >
              <option value="">Unspecified (Remember last used)</option>
              {allPresets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-zinc-500">
              If unspecified, SweetTune remembers the last preset you used.
            </p>
          </div>

          {/* A4 Calibration */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Concert Pitch (A4)
              </span>
              <button
                type="button"
                onClick={() => onChangeA4(440)}
                className="flex items-center gap-1 text-xs text-emerald-400 font-medium"
              >
                <RotateCcw className="w-3 h-3" />
                <span>440 Hz</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => stepA4(-1)}
                className="p-3 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-200 active:scale-95 transition"
              >
                <Minus className="w-4 h-4" />
              </button>
              <div className="flex-1 text-center font-mono text-2xl font-bold text-zinc-100">
                {a4Hz.toFixed(1)} <span className="text-sm text-zinc-500">Hz</span>
              </div>
              <button
                type="button"
                onClick={() => stepA4(1)}
                className="p-3 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-200 active:scale-95 transition"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>

            <input
              type="range"
              min={415}
              max={466}
              step={0.5}
              value={a4Hz}
              onChange={(e) => onChangeA4(parseFloat(e.target.value))}
              className="w-full h-6 accent-emerald-500 cursor-pointer"
            />
          </div>

          {/* Strobe Style */}
          <div className="space-y-2">
            <span className="block text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Tuner View
            </span>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { id: 'circle', label: 'Circular Wheel' },
                  { id: 'horizontal', label: 'Strobe Bands' },
                  { id: 'dial', label: 'Dial (-25/+25)' },
                  { id: 'bars', label: 'LED Bars (-25/+25)' },
                ] as const
              ).map((style) => (
                <button
                  key={style.id}
                  type="button"
                  onClick={() => onChangeStrobeStyle(style.id)}
                  className={`py-2.5 rounded-xl text-xs font-semibold border transition ${
                    strobeStyle === style.id
                      ? 'bg-emerald-500 text-zinc-950 border-emerald-400'
                      : 'bg-zinc-900 text-zinc-300 border-zinc-800'
                  }`}
                >
                  {style.label}
                </button>
              ))}
            </div>
          </div>

          {/* Enharmonic Spelling (scoped to active temperament) */}
          <div className="flex items-center justify-between py-1">
            <div>
              <div className="text-sm font-medium text-zinc-200">
                Prefer Flats (♭) · <span className="text-emerald-400">{activePresetName}</span>
              </div>
              <div className="text-xs text-zinc-500">Display Db, Eb, Gb, Ab, Bb for this tuning</div>
            </div>
            <button
              type="button"
              onClick={onToggleFlats}
              className={`w-12 h-7 rounded-full p-1 transition ${
                useFlats ? 'bg-emerald-500' : 'bg-zinc-800'
              }`}
            >
              <div
                className={`w-5 h-5 rounded-full bg-white transition-transform ${
                  useFlats ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Mic Boost */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Mic Boost
              </span>
              <span className="font-mono text-xs text-zinc-400">
                {inputGain.toFixed(1)}x
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={5}
              step={0.5}
              value={inputGain}
              onChange={(e) => onChangeInputGain(parseFloat(e.target.value))}
              className="w-full h-6 accent-emerald-500 cursor-pointer"
            />
          </div>

          {/* Mic Sensitivity / Noise Gate */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Mic Noise Gate
              </span>
              <span className="font-mono text-xs text-zinc-400">
                {Math.round(noiseGate * 1000)}
              </span>
            </div>
            <input
              type="range"
              min={0.001}
              max={0.05}
              step={0.001}
              value={noiseGate}
              onChange={(e) => onChangeNoiseGate(parseFloat(e.target.value))}
              className="w-full h-6 accent-emerald-500 cursor-pointer"
            />
          </div>

          {sampleRate && (
            <div className="pt-1 border-t border-zinc-800/80 text-[11px] font-mono text-zinc-500 text-center">
              Audio Sample Rate: {sampleRate} Hz
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
