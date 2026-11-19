import React, { useState } from 'react';
import { Check, Plus, RotateCcw, X } from 'lucide-react';
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
    midiOffsets?: Record<number, number>;
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
  const [midiOffsets, setMidiOffsets] = useState<Record<number, number>>(() =>
    initialPreset?.midiOffsets ? { ...initialPreset.midiOffsets } : {}
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
  const [selectedOctave, setSelectedOctave] = useState<number | null>(null);
  const [showOctavePicker, setShowOctavePicker] = useState(false);
  const [draftText, setDraftText] = useState<string>(() => {
    const firstEnabled = NOTE_NAMES.find(
      (n) => initialPreset?.enabledNotes?.[n] !== false
    );
    const key = firstEnabled ?? 'C';
    return String(initialPreset?.offsets?.[key] ?? 0);
  });

  const getMidiForNoteOctave = (note: NoteName, octave: number) => {
    const pc = NOTE_NAMES.indexOf(note);
    return (octave + 1) * 12 + pc;
  };

  const getOctaveOverrides = (note: NoteName) => {
    const pc = NOTE_NAMES.indexOf(note);
    return Object.entries(midiOffsets)
      .map(([k, v]) => ({ midi: Number(k), value: v }))
      .filter(({ midi }) => Number.isFinite(midi) && ((midi % 12) + 12) % 12 === pc)
      .map(({ midi, value }) => ({
        midi,
        octave: Math.floor(midi / 12) - 1,
        value,
      }))
      .sort((a, b) => a.octave - b.octave);
  };

  const getActiveOffset = (note: NoteName, octave: number | null) => {
    if (octave === null) return offsets[note] ?? 0;
    const midi = getMidiForNoteOctave(note, octave);
    return midiOffsets[midi] ?? offsets[note] ?? 0;
  };

  const selectNoteRow = (note: NoteName) => {
    if (expandedNote === note) {
      setExpandedNote(null);
      setSelectedOctave(null);
      setShowOctavePicker(false);
      return;
    }
    setExpandedNote(note);
    setSelectedOctave(null);
    setShowOctavePicker(false);
    setDraftText(String(offsets[note] ?? 0));
  };

  const selectOctaveScope = (note: NoteName, octave: number | null) => {
    setSelectedOctave(octave);
    setShowOctavePicker(false);
    setDraftText(String(getActiveOffset(note, octave)));
  };

  const addOctaveOverride = (note: NoteName, octave: number) => {
    const midi = getMidiForNoteOctave(note, octave);
    const initialVal = midiOffsets[midi] ?? offsets[note] ?? 0;
    setMidiOffsets((prev) => ({
      ...prev,
      [midi]: prev[midi] ?? initialVal,
    }));
    setSelectedOctave(octave);
    setShowOctavePicker(false);
    setDraftText(String(initialVal));
  };

  const removeOctaveOverride = (note: NoteName, octave: number) => {
    const midi = getMidiForNoteOctave(note, octave);
    setMidiOffsets((prev) => {
      const next = { ...prev };
      delete next[midi];
      return next;
    });
    if (selectedOctave === octave) {
      setSelectedOctave(null);
      setDraftText(String(offsets[note] ?? 0));
    }
  };

  const updateNoteOffset = (note: NoteName, value: number, syncDraft = true) => {
    const clamped = clampCents(value);
    if (selectedOctave === null) {
      setOffsets((prev) => ({
        ...prev,
        [note]: clamped,
      }));
    } else {
      const midi = getMidiForNoteOctave(note, selectedOctave);
      setMidiOffsets((prev) => ({
        ...prev,
        [midi]: clamped,
      }));
    }
    if (syncDraft && expandedNote === note) {
      setDraftText(String(clamped));
    }
  };

  const nudgeNoteOffset = (note: NoteName, delta: number) => {
    const current = getActiveOffset(note, selectedOctave);
    const next = clampCents(current + delta);
    updateNoteOffset(note, next, true);
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
    setMidiOffsets(found.midiOffsets ? { ...found.midiOffsets } : {});
    setEnabledNotes(
      found.enabledNotes
        ? { ...createAllEnabledNotes(), ...found.enabledNotes }
        : createAllEnabledNotes()
    );
    setIsKeyDependent(found.isKeyDependent);
    setDefaultRoot(found.defaultRoot);
    setPreferFlats(Boolean(found.preferFlats));
    setSelectedOctave(null);
    setShowOctavePicker(false);
    if (expandedNote) {
      setDraftText(String(found.offsets[expandedNote] ?? 0));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim() || 'Custom Temperament';
    const cleanedMidiOffsets: Record<number, number> = {};
    for (const [k, v] of Object.entries(midiOffsets)) {
      const midi = Number(k);
      const pc = ((midi % 12) + 12) % 12;
      const noteName = NOTE_NAMES[pc];
      if (Number.isFinite(midi) && Number.isFinite(v) && enabledNotes[noteName] !== false) {
        cleanedMidiOffsets[midi] = clampCents(v);
      }
    }
    onSave({
      id: isEditingExistingCustom ? initialPreset!.id : undefined,
      name: trimmed,
      description: description.trim() || 'Custom cent-offset temperament',
      isKeyDependent,
      defaultRoot,
      pinned,
      preferFlats,
      offsets,
      midiOffsets: Object.keys(cleanedMidiOffsets).length > 0 ? cleanedMidiOffsets : undefined,
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
                  onClick={() => {
                    setOffsets(createZeroOffsets());
                    setMidiOffsets({});
                    setSelectedOctave(null);
                    setShowOctavePicker(false);
                    setDraftText('0');
                  }}
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
              <span className="text-[0.6875rem] text-zinc-500">Tap a note to adjust</span>
            </div>

            <div className="space-y-1.5">
              {NOTE_NAMES.map((note, idx) => ({ note, idx }))
                .filter(({ note }) => enabledNotes[note] !== false)
                .map(({ note, idx }) => {
                  const val = offsets[note] ?? 0;
                  const octaveOverrides = getOctaveOverrides(note);
                  const isExpanded = expandedNote === note;
                  const activeVal = isExpanded
                    ? getActiveOffset(note, selectedOctave)
                    : val;
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
                            {octaveOverrides.length > 0 && (
                              <span className="px-1.5 py-0.5 rounded-md bg-purple-500/15 border border-purple-500/30 text-[0.625rem] font-mono font-semibold text-purple-300">
                                {octaveOverrides
                                  .map((o) => `${displayLabel}${o.octave}`)
                                  .join(', ')}
                              </span>
                            )}
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
                          className="px-2 py-1 rounded-lg text-[0.625rem] font-bold uppercase tracking-wider border bg-emerald-500/15 border-emerald-500/40 text-emerald-300 transition active:scale-95"
                        >
                          On
                        </button>
                      </div>

                      {/* Expanded Touch Controls */}
                    {isExpanded && (
                      <div className="px-3.5 pb-3.5 pt-2.5 space-y-3 border-t border-zinc-800/70">
                        {/* Scope Selector: All Octaves (Default) + Per-Octave Overrides */}
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => selectOctaveScope(note, null)}
                              className={`px-2.5 py-1 rounded-full text-[0.6875rem] font-semibold border transition ${
                                selectedOctave === null
                                  ? 'bg-emerald-500 text-zinc-950 border-emerald-400'
                                  : 'bg-zinc-800/80 text-zinc-300 border-zinc-700/80 hover:border-zinc-600'
                              }`}
                            >
                              All ({val > 0 ? `+${val.toFixed(1)}` : val.toFixed(1)})
                            </button>

                            {octaveOverrides.map((ov) => {
                              const isSelected = selectedOctave === ov.octave;
                              return (
                                <div
                                  key={ov.midi}
                                  className={`inline-flex items-center rounded-full border transition ${
                                    isSelected
                                      ? 'bg-purple-500 text-zinc-950 border-purple-400'
                                      : 'bg-purple-500/15 text-purple-200 border-purple-500/35'
                                  }`}
                                >
                                  <button
                                    type="button"
                                    onClick={() => selectOctaveScope(note, ov.octave)}
                                    className="pl-2.5 pr-1 py-1 text-[0.6875rem] font-mono font-semibold"
                                  >
                                    {displayLabel}
                                    {ov.octave} ({ov.value > 0 ? `+${ov.value.toFixed(1)}` : ov.value.toFixed(1)})
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => removeOctaveOverride(note, ov.octave)}
                                    aria-label={`Remove ${displayLabel}${ov.octave} override`}
                                    className={`pr-2 pl-0.5 py-1 rounded-r-full transition ${
                                      isSelected
                                        ? 'text-zinc-900 hover:text-black'
                                        : 'text-purple-300/80 hover:text-purple-100'
                                    }`}
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </div>
                              );
                            })}

                            <button
                              type="button"
                              onClick={() => setShowOctavePicker((v) => !v)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[0.6875rem] font-semibold bg-zinc-900 border border-dashed border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition"
                            >
                              <Plus className="w-3 h-3" />
                              <span>Octave</span>
                            </button>
                          </div>

                          {showOctavePicker && (
                            <div className="flex flex-wrap items-center gap-1 p-2 rounded-xl bg-zinc-950/90 border border-zinc-800">
                              <span className="text-[0.625rem] font-semibold uppercase tracking-wider text-zinc-500 mr-1">
                                Add:
                              </span>
                              {[1, 2, 3, 4, 5, 6, 7].map((oct) => {
                                const exists = octaveOverrides.some((o) => o.octave === oct);
                                return (
                                  <button
                                    key={oct}
                                    type="button"
                                    disabled={exists}
                                    onClick={() => addOctaveOverride(note, oct)}
                                    className={`px-2 py-1 rounded-lg text-[0.6875rem] font-mono font-semibold transition ${
                                      exists
                                        ? 'bg-zinc-900 text-zinc-600 cursor-not-allowed'
                                        : 'bg-zinc-800 text-zinc-200 hover:bg-purple-500 hover:text-zinc-950 active:scale-95'
                                    }`}
                                  >
                                    {displayLabel}
                                    {oct}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        {/* Scrubbing slider */}
                        <input
                          type="range"
                          min={-50}
                          max={50}
                          step={0.1}
                          value={activeVal}
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
                  <span className="text-[0.6875rem] text-zinc-600">Tap to restore</span>
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
