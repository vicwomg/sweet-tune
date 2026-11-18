import React from 'react';
import { Copy, Edit3, Pin, PinOff, Plus, Trash2, X } from 'lucide-react';
import type { TemperamentPreset } from '../types/tuner';

interface PresetManagerSheetProps {
  allPresets: TemperamentPreset[];
  activePresetId: string;
  onSelect: (id: string) => void;
  onTogglePin: (id: string) => void;
  onEdit: (preset: TemperamentPreset) => void;
  onClone: (preset: TemperamentPreset) => void;
  onDelete: (id: string) => void;
  onCreateNew: () => void;
  onClose: () => void;
}

export const PresetManagerSheet: React.FC<PresetManagerSheetProps> = ({
  allPresets,
  activePresetId,
  onSelect,
  onTogglePin,
  onEdit,
  onClone,
  onDelete,
  onCreateNew,
  onClose,
}) => {
  const customList = allPresets.filter((p) => !p.isBuiltIn);
  const builtInList = allPresets.filter((p) => p.isBuiltIn);
  const pinnedCount = allPresets.filter((p) => p.pinned).length;

  const renderPresetRow = (preset: TemperamentPreset) => {
    const isActive = preset.id === activePresetId;
    return (
      <div
        key={preset.id}
        className={`flex items-center justify-between gap-2 p-3 rounded-2xl border transition ${
          isActive
            ? 'bg-emerald-500/10 border-emerald-500/50'
            : 'bg-zinc-900/70 border-zinc-800/80'
        }`}
      >
        <button
          type="button"
          onClick={() => {
            onSelect(preset.id);
            onClose();
          }}
          className="flex-1 text-left min-w-0"
        >
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm text-zinc-100 truncate">
              {preset.name}
            </span>
            {preset.isKeyDependent && (
              <span className="shrink-0 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                Key
              </span>
            )}
          </div>
          {preset.description && (
            <p className="text-xs text-zinc-500 truncate mt-0.5">
              {preset.description}
            </p>
          )}
        </button>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => onTogglePin(preset.id)}
            disabled={!preset.pinned && pinnedCount >= 10}
            title={
              preset.pinned
                ? 'Unpin from Quick Bar'
                : pinnedCount >= 10
                  ? 'Max 10 pinned presets'
                  : 'Pin to Quick Bar'
            }
            className={`p-2 rounded-xl transition active:scale-90 ${
              preset.pinned
                ? 'text-emerald-400 bg-emerald-500/10'
                : pinnedCount >= 10
                  ? 'text-zinc-700 cursor-not-allowed'
                  : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {preset.pinned ? <Pin className="w-4 h-4" /> : <PinOff className="w-4 h-4" />}
          </button>

          {!preset.isBuiltIn ? (
            <>
              <button
                type="button"
                onClick={() => onEdit(preset)}
                title="Edit preset"
                className="p-2 rounded-xl text-zinc-400 hover:text-zinc-100 active:scale-90 transition"
              >
                <Edit3 className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => onDelete(preset.id)}
                title="Delete preset"
                className="p-2 rounded-xl text-zinc-400 hover:text-rose-400 active:scale-90 transition"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => onClone(preset)}
              title="Clone & customize"
              className="p-2 rounded-xl text-zinc-400 hover:text-zinc-100 active:scale-90 transition"
            >
              <Copy className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex flex-col w-full max-w-md h-[84dvh] bg-zinc-950 border border-zinc-800 rounded-3xl overflow-hidden shadow-2xl"
      >
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-zinc-800/80 bg-zinc-900/50">
          <div>
            <h2 className="text-base font-bold text-zinc-100">Temperament Presets</h2>
            <p className="text-[11px] text-zinc-500">{pinnedCount}/10 pinned to quick bar</p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onCreateNew}
              className="flex items-center gap-1 rounded-full bg-emerald-500 px-3 py-1.5 text-xs font-bold text-zinc-950 active:scale-95 transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="p-2 rounded-full text-zinc-400 hover:text-zinc-200 active:scale-90 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              My Custom Presets
            </h3>
            {customList.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-zinc-800 p-4 text-center text-xs text-zinc-500">
                No custom presets yet. Tap <strong>+ New</strong> or clone any built-in temperament.
              </div>
            ) : (
              <div className="space-y-2">{customList.map(renderPresetRow)}</div>
            )}
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Built-in Temperaments
            </h3>
            <div className="space-y-2">{builtInList.map(renderPresetRow)}</div>
          </div>
        </div>
      </div>
    </div>
  );
};
