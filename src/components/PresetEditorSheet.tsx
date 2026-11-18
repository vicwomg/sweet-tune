import React, { useState } from 'react';
import { Check, RotateCcw, X } from 'lucide-react';
import {
  clampCents,
  createAllEnabledNotes,
  createZeroOffsets,
  formatNoteName,
} from '../audio/temperaments';
import {
  NOTE_NAMES,
  type EnabledNotes,
  type NoteName,
  type NoteOffsets,
  type TemperamentPreset,
} from '../types/tuner';

interface PresetEditorSheetProps {
  initialPreset?: TemperamentPreset | null;
  allPresets: TemperamentPreset[];
  onSave: (data: {
    id?: string;
    name: string;
    description: string;
    isKeyDependent: boolean;
    defaultRoot: NoteName;
    pinned: boolean;
    preferFlats: boolean;
    offsets: NoteOffsets;
    enabledNotes: EnabledNotes;
  }) => void;
  onClose: () => void;
}

export const PresetEditorSheet: React.FC<PresetEditorSheetProps> = ({
  initialPreset,
  allPresets,
  onSave,
  onClose,
}) => {
  const isEditingExistingCustom = Boolean(initialPreset && !initialPreset.isBuiltIn);

  const [name, setName] = useState(
    isEditingExistingCustom ? initialPreset!.name : initialPreset ? `${initialPreset.name} Copy` : ''
  );
  const [description, setDescription] = useState(
    initialPreset?.description || ''
  );
  const [isKeyDependent, setIsKeyDependent] = useState(
    initialPreset?.isKeyDependent ?? false
  );
  const [defaultRoot, setDefaultRoot] = useState<NoteName>(
    initialPreset?.defaultRoot ?? 'C'
  );
  const [pinned, setPinned] = useState(initialPreset?.pinned ?? true);
  const [preferFlats, setPreferFlats] = useState(initialPreset?.preferFlats ?? false);
  const [offsets, setOffsets] = useState<NoteOffsets>(() =>
    initialPreset ? { ...initialPreset.offsets } : createZeroOffsets()
  );
  const [enabledNotes, setEnabledNotes] = useState<EnabledNotes>(() =>
    initialPreset?.enabledNotes
      ? { ...createAllEnabledNotes(), ...initialPreset.enabledNotes }
      : createAllEnabledNotes()
  );
  const [expandedNote, setExpandedNote] = useState<NoteName | null>(() => {
    const firstEnabled = NOTE_NAMES.find(
      (n) => initialPreset?.enabledNotes?.[n] !== false
    );
    return firstEnabled ?? 'C';
  });
  const [draftText, setDraftText] = useState<string>(() => {
    const firstEnabled = NOTE_NAMES.find(
      (n) => initialPreset?.enabledNotes?.[n] !== false
    );
    const key = firstEnabled ?? 'C';
    return String(initialPreset?.offsets?.[key] ?? 0);
  });

  const selectNoteRow = (note: NoteName) => {
    if (expandedNote === note) {
      setExpandedNote(null);
      return;
    }
    setExpandedNote(note);
    setDraftText(String(offsets[note] ?? 0));
  };

  const updateNoteOffset = (note: NoteName, value: number, syncDraft = true) => {
    const clamped = clampCents(value);
    setOffsets((prev) => ({
      ...prev,
      [note]: clamped,
    }));
    if (syncDraft && expandedNote === note) {
      setDraftText(String(clamped));
    }
  };

  const nudgeNoteOffset = (note: NoteName, delta: number) => {
    const next = clampCents((offsets[note] ?? 0) + delta);
    setOffsets((prev) => ({
      ...prev,
      [note]: next,
    }));
    if (expandedNote === note) {
      setDraftText(String(next));
    }
  };

  const toggleNoteEnabled = (note: NoteName) => {
    setEnabledNotes((prev) => {
      const enabledCount = NOTE_NAMES.filter((n) => prev[n]).length;
      if (prev[note] && enabledCount <= 1) {
        return prev; // Keep at least one note enabled
      }
      const nextVal = !prev[note];
      if (!nextVal && expandedNote === note) {
        setExpandedNote(null);
      }
      return { ...prev, [note]: nextVal };
    });
  };

  const handleCloneFrom = (presetId: string) => {
    const found = allPresets.find((p) => p.id === presetId);
    if (!found) return;
    setOffsets({ ...found.offsets });
    setEnabledNotes(
      found.enabledNotes
        ? { ...createAllEnabledNotes(), ...found.enabledNotes }
        : createAllEnabledNotes()
    );
    setIsKeyDependent(found.isKeyDependent);
    setDefaultRoot(found.defaultRoot);
    setPreferFlats(Boolean(found.preferFlats));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim() || 'Custom Temperament';
    onSave({
      id: isEditingExistingCustom ? initialPreset!.id : undefined,
      name: trimmed,
      description: description.trim() || 'Custom cent-offset temperament',
      isKeyDependent,
      defaultRoot,
      pinned,
      preferFlats,
      offsets,
      enabledNotes,
    });
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="flex flex-col w-full max-w-md h-[86dvh] bg-zinc-950 border border-zinc-800 rounded-3xl overflow-hidden shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-zinc-800/80 bg-zinc-900/50">
          <h2 className="text-base font-bold text-zinc-100">
            {isEditingExistingCustom ? 'Edit Temperament' : 'New Temperament'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close editor"
            className="p-2 rounded-full text-zinc-400 hover:text-zinc-200 active:scale-90 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {/* Name & Clone */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1">
                Preset Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Sweetened Acoustic, Baroque D..."
                maxLength={32}
                className="w-full rounded-xl bg-zinc-900 border border-zinc-800 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1">
                Description (optional)
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Slightly flat B & G for acoustic chords"
                maxLength={80}
                className="w-full rounded-xl bg-zinc-900 border border-zinc-800 px-3.5 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1">
                  Start From
                </label>
                <select
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) handleCloneFrom(e.target.value);
                  }}
                  className="w-full rounded-xl bg-zinc-900 border border-zinc-800 px-3 py-2.5 text-xs text-zinc-200 focus:outline-none focus:border-emerald-500"
                >
                  <option value="" disabled>
                    Load template...
                  </option>
                  {allPresets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col justify-end">
                <button
                  type="button"
                  onClick={() => setOffsets(createZeroOffsets())}
                  className="flex items-center justify-center gap-1.5 rounded-xl bg-zinc-900 border border-zinc-800 px-3 py-2.5 text-xs font-medium text-zinc-300 active:scale-95 transition"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset All 0</span>
                </button>
              </div>
            </div>

            {/* Toggles */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={pinned}
                  onChange={(e) => setPinned(e.target.checked)}
                  className="w-4 h-4 rounded accent-emerald-500"
                />
                <span>Pin to Quick Bar</span>
              </label>

              <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isKeyDependent}
                  onChange={(e) => setIsKeyDependent(e.target.checked)}
                  className="w-4 h-4 rounded accent-amber-400"
                />
                <span>Key-transposable</span>
              </label>

              <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={preferFlats}
                  onChange={(e) => setPreferFlats(e.target.checked)}
                  className="w-4 h-4 rounded accent-sky-400"
                />
                <span>Prefer Flats (♭)</span>
              </label>
            </div>
          </div>

          {/* 12-Note Touch Offset Editor */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Note Cent Offsets (-50 to +50)
              </span>
              <span className="text-[11px] text-zinc-500">Tap a note to adjust</span>
            </div>

            <div className="space-y-1.5">
              {NOTE_NAMES.map((note, idx) => ({ note, idx }))
                .filter(({ note }) => enabledNotes[note] !== false)
                .map(({ note, idx }) => {
                  const val = offsets[note] ?? 0;
                  const isExpanded = expandedNote === note;
                  const displayLabel = formatNoteName(idx, preferFlats);
                  const barPercent = ((val + 50) / 100) * 100;

                  return (
                    <div
                      key={note}
                      className={`rounded-2xl border transition ${
                        isExpanded
                          ? 'bg-zinc-900 border-emerald-500/60'
                          : 'bg-zinc-900/60 border-zinc-800/80'
                      }`}
                    >
                      {/* Note Row */}
                      <div className="flex items-center pr-2.5">
                        <button
                          type="button"
                          onClick={() => selectNoteRow(note)}
                          className="flex-1 flex items-center justify-between pl-3.5 pr-2 py-3 text-left"
                        >
                          <div className="flex items-center gap-3">
                            <span className="w-8 text-base font-bold text-zinc-100">
                              {displayLabel}
                            </span>
                            <div className="relative w-20 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                              <div className="absolute left-1/2 top-0 bottom-0 w-px bg-zinc-600" />
                              <div
                                className={`absolute top-0 bottom-0 rounded-full ${
                                  Math.abs(val) < 0.05
                                    ? 'bg-zinc-500'
                                    : val > 0
                                      ? 'bg-sky-400'
                                      : 'bg-rose-400'
                                }`}
                                style={{
                                  left: val < 0 ? `${barPercent}%` : '50%',
                                  width: `${Math.abs(val)}%`,
                                }}
                              />
                            </div>
                          </div>

                          <span
                            className={`font-mono text-sm font-semibold ${
                              Math.abs(val) < 0.05
                                ? 'text-zinc-400'
                                : val > 0
                                  ? 'text-sky-400'
                                  : 'text-rose-400'
                            }`}
                          >
                            {val > 0 ? `+${val.toFixed(1)}` : val.toFixed(1)}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => toggleNoteEnabled(note)}
                          aria-label={`Exclude ${displayLabel}`}
                          title="Exclude note"
                          className="px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border bg-emerald-500/15 border-emerald-500/40 text-emerald-300 transition active:scale-95"
                        >
                          On
                        </button>
                      </div>

                      {/* Expanded Touch Controls */}
                    {isExpanded && (
                      <div className="px-3.5 pb-3.5 pt-1 space-y-3 border-t border-zinc-800/70">
                        {/* Scrubbing slider */}
                        <input
                          type="range"
                          min={-50}
                          max={50}
                          step={0.1}
                          value={val}
                          onChange={(e) =>
                            updateNoteOffset(note, parseFloat(e.target.value))
                          }
                          className="w-full h-7 accent-emerald-500 cursor-pointer"
                        />

                        {/* Ergonomic tap steppers */}
                        <div className="grid grid-cols-6 gap-1.5">
                          {[-10, -1, -0.1, 0.1, 1, 10].map((delta) => (
                            <button
                              key={delta}
                              type="button"
                              onClick={() => nudgeNoteOffset(note, delta)}
                              className="py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-mono font-bold text-zinc-200 active:scale-95 transition"
                            >
                              {delta > 0 ? `+${delta}` : delta}
                            </button>
                          ))}
                        </div>

                        {/* Direct input & Reset */}
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={draftText}
                            onChange={(e) => {
                              const raw = e.target.value;
                              if (!/^-?\d*\.?\d*$/.test(raw)) return;
                              setDraftText(raw);
                              if (raw === '' || raw === '-' || raw === '.' || raw === '-.') {
                                return;
                              }
                              const parsed = parseFloat(raw);
                              if (Number.isFinite(parsed)) {
                                updateNoteOffset(note, parsed, false);
                              }
                            }}
                            onBlur={() => {
                              const parsed = parseFloat(draftText);
                              const finalVal = Number.isFinite(parsed) ? clampCents(parsed) : 0;
                              updateNoteOffset(note, finalVal, true);
                            }}
                            className="flex-1 rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-sm font-mono text-zinc-100 focus:outline-none focus:border-emerald-500"
                          />
                          <button
                            type="button"
                            onClick={() => updateNoteOffset(note, 0)}
                            className="px-3.5 py-2 rounded-xl bg-zinc-800 text-xs font-semibold text-zinc-300 active:scale-95 transition"
                          >
                            0.0
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {NOTE_NAMES.some((n) => enabledNotes[n] === false) && (
              <div className="pt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    Excluded Notes
                  </span>
                  <span className="text-[11px] text-zinc-600">Tap to restore</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {NOTE_NAMES.map((note, idx) => ({ note, idx }))
                    .filter(({ note }) => enabledNotes[note] === false)
                    .map(({ note, idx }) => {
                      const displayLabel = formatNoteName(idx, preferFlats);
                      return (
                        <button
                          key={note}
                          type="button"
                          onClick={() => toggleNoteEnabled(note)}
                          aria-label={`Include ${displayLabel}`}
                          className="inline-flex items-center gap-1 rounded-full bg-zinc-900 border border-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-400 hover:text-zinc-100 hover:border-zinc-700 active:scale-95 transition"
                        >
                          <span className="text-emerald-400">+</span>
                          <span>{displayLabel}</span>
                        </button>
                      );
                    })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Sticky Footer */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-t border-zinc-800 bg-zinc-900/70">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3 rounded-2xl bg-zinc-800 text-sm font-semibold text-zinc-300 active:scale-95 transition"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-2xl bg-emerald-500 text-sm font-bold text-zinc-950 active:scale-95 transition"
          >
            <Check className="w-4 h-4" />
            <span>Save Preset</span>
          </button>
        </div>
      </form>
    </div>
  );
};
