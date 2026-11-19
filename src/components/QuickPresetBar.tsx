import React, { useState } from 'react';
import { ChevronDown, Edit3 } from 'lucide-react';
import { NOTE_NAMES, type NoteName, type TemperamentPreset } from '../types/tuner';
import { formatNoteName } from '../audio/temperaments';

interface QuickPresetBarProps {
  quickPresets: TemperamentPreset[];
  activePreset: TemperamentPreset;
  rootNote: NoteName;
  useFlats: boolean;
  onSelectPreset: (id: string) => void;
  onEditPreset: (preset: TemperamentPreset) => void;
  onSelectRoot: (root: NoteName) => void;
}

export const QuickPresetBar: React.FC<QuickPresetBarProps> = ({
  quickPresets,
  activePreset,
  rootNote,
  useFlats,
  onSelectPreset,
  onEditPreset,
  onSelectRoot,
}) => {
  const [showKeyPicker, setShowKeyPicker] = useState(false);

  return (
    <div className="w-full max-w-md mx-auto px-3 pt-1 pb-2 space-y-2">
      {/* Wrapping 1-tap preset grid/strip */}
      <div className="flex flex-wrap items-center gap-2 py-0.5">
        {quickPresets.map((preset) => {
          const isActive = preset.id === activePreset.id;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                setShowKeyPicker(false);
                if (isActive) {
                  onEditPreset(preset);
                } else {
                  onSelectPreset(preset.id);
                }
              }}
              title={isActive ? 'Tap to edit preset' : `Switch to ${preset.name}`}
              className={`inline-flex items-center gap-1 rounded-full px-3.5 py-1.5 text-xs font-semibold transition active:scale-95 border ${
                isActive
                  ? 'bg-emerald-500 text-zinc-950 border-emerald-400 shadow-sm shadow-emerald-500/25'
                  : 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:border-zinc-700'
              }`}
            >
              <span>{preset.name}</span>
              {!preset.isBuiltIn && (
                <span
                  className={`inline-block w-1.5 h-1.5 rounded-full ${
                    isActive ? 'bg-zinc-950' : 'bg-emerald-400'
                  }`}
                />
              )}
              {isActive && <Edit3 className="w-3 h-3 opacity-75 ml-0.5" />}
            </button>
          );
        })}
      </div>

      {/* Centered temperament info + Key/Root transposition underneath */}
      <div className="flex flex-col items-center gap-1.5 px-1">
        <span className="text-xs text-zinc-400 text-center">
          {activePreset.description || 'Custom temperament'}
        </span>

        {activePreset.isKeyDependent && (
          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={() => setShowKeyPicker((v) => !v)}
              className="flex items-center gap-1 rounded-lg bg-zinc-900 border border-zinc-800 px-2.5 py-1 text-xs font-semibold text-amber-300 active:scale-95 transition"
            >
              <span>Key: {formatNoteName(NOTE_NAMES.indexOf(rootNote), useFlats)}</span>
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform ${
                  showKeyPicker ? 'rotate-180' : ''
                }`}
              />
            </button>
          </div>
        )}
      </div>

      {/* Quick 12-note grid for root key transposition */}
      {activePreset.isKeyDependent && showKeyPicker && (
        <div className="grid grid-cols-6 gap-1.5 p-2 rounded-2xl bg-zinc-900/95 border border-zinc-800">
          {NOTE_NAMES.map((note, idx) => {
            const selected = note === rootNote;
            return (
              <button
                key={note}
                type="button"
                onClick={() => {
                  onSelectRoot(note);
                  setShowKeyPicker(false);
                }}
                className={`py-2 rounded-xl text-xs font-bold transition active:scale-95 ${
                  selected
                    ? 'bg-amber-400 text-zinc-950'
                    : 'bg-zinc-800/80 text-zinc-200 hover:bg-zinc-700'
                }`}
              >
                {formatNoteName(idx, useFlats)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
