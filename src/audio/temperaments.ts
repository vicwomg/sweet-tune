import {
  FLAT_NAMES,
  NOTE_NAMES,
  type EnabledNotes,
  type NoteName,
  type NoteOffsets,
  type TemperamentPreset,
} from "../types/tuner";

export function createAllEnabledNotes(): EnabledNotes {
  return {
    C: true,
    "C#": true,
    D: true,
    "D#": true,
    E: true,
    F: true,
    "F#": true,
    G: true,
    "G#": true,
    A: true,
    "A#": true,
    B: true,
  };
}

function enabledOnly(notes: readonly NoteName[]): EnabledNotes {
  const allowed = new Set<NoteName>(notes);
  const out = createAllEnabledNotes();
  NOTE_NAMES.forEach((n) => {
    out[n] = allowed.has(n);
  });
  return out;
}

export function createZeroOffsets(): NoteOffsets {
  return {
    C: 0,
    "C#": 0,
    D: 0,
    "D#": 0,
    E: 0,
    F: 0,
    "F#": 0,
    G: 0,
    "G#": 0,
    A: 0,
    "A#": 0,
    B: 0,
  };
}

function offsetsFromArray(arr: readonly number[]): NoteOffsets {
  const out = createZeroOffsets();
  NOTE_NAMES.forEach((n, i) => {
    out[n] = Math.round((arr[i] ?? 0) * 10) / 10;
  });
  return out;
}

export const BUILTIN_PRESETS: TemperamentPreset[] = [
  {
    id: "builtin-12tet",
    name: "Equal",
    description: "Standard 12-tone equal temperament (all 0.0 ¢)",
    isBuiltIn: true,
    isKeyDependent: false,
    defaultRoot: "C",
    pinned: true,
    offsets: createZeroOffsets(),
  },
  {
    id: "builtin-just",
    name: "Just Intonation",
    description: "5-limit pure harmonic intervals relative to root key",
    isBuiltIn: true,
    isKeyDependent: true,
    defaultRoot: "C",
    pinned: true,
    offsets: offsetsFromArray([
      0.0, 11.7, 3.9, 15.6, -13.7, -2.0, -9.8, 2.0, 13.7, -15.6, 17.6, -11.7,
    ]),
  },
  {
    id: "builtin-pythagorean",
    name: "Pythagorean",
    description: "Pure 3:2 fifths stacked from the root key",
    isBuiltIn: true,
    isKeyDependent: true,
    defaultRoot: "C",
    pinned: true,
    offsets: offsetsFromArray([
      0.0, -9.8, 3.9, -5.9, 7.8, -2.0, 11.7, 2.0, -7.8, 5.9, -3.9, 9.8,
    ]),
  },
  {
    id: "builtin-meantone",
    name: "1/4 Meantone",
    description: "Quarter-comma meantone with pure major thirds",
    isBuiltIn: true,
    isKeyDependent: true,
    defaultRoot: "C",
    pinned: true,
    offsets: offsetsFromArray([
      0.0, -24.0, -6.8, 10.3, -13.7, 3.4, -20.5, -3.4, -27.4, -10.3, 6.8, -17.1,
    ]),
  },
  {
    id: "builtin-werckmeister3",
    name: "Werckmeister III",
    description: "Baroque well-temperament for all keys",
    isBuiltIn: true,
    isKeyDependent: true,
    defaultRoot: "C",
    pinned: false,
    offsets: offsetsFromArray([
      0.0, -9.8, -7.8, -5.9, -9.8, -2.0, -11.7, -3.9, -7.8, -11.7, -3.9, -7.8,
    ]),
  },
  {
    id: "builtin-kirnberger3",
    name: "Kirnberger III",
    description: "18th-century well-temperament with pure C-E third",
    isBuiltIn: true,
    isKeyDependent: true,
    defaultRoot: "C",
    pinned: false,
    offsets: offsetsFromArray([
      0.0, -9.8, -6.8, -5.9, -13.7, -2.0, -9.8, -3.4, -7.8, -10.3, -3.9, -11.7,
    ]),
  },
  {
    id: "builtin-vallotti",
    name: "Vallotti",
    description: "Smooth Italian well-temperament (6 fifths narrowed)",
    isBuiltIn: true,
    isKeyDependent: true,
    defaultRoot: "C",
    pinned: false,
    offsets: offsetsFromArray([
      0.0, -5.9, -3.9, -2.0, -7.8, 2.0, -7.8, -2.0, -3.9, -5.9, 0.0, -9.8,
    ]),
  },
  {
    id: "builtin-guitar-equal",
    name: "Guitar",
    description: "Standard EADGBE equal temperament (all 0.0)",
    isBuiltIn: true,
    isKeyDependent: false,
    defaultRoot: "C",
    pinned: true,
    offsets: createZeroOffsets(),
    enabledNotes: enabledOnly(["E", "A", "D", "G", "B"]),
  },
  {
    id: "builtin-jt-acoustic",
    name: "JT Acoustic",
    description: "James Taylor guitar (E2-12, A-10, D-8, G-4, B-6, E4-3)",
    isBuiltIn: true,
    isKeyDependent: false,
    defaultRoot: "C",
    pinned: true,
    offsets: {
      ...createZeroOffsets(),
      E: -3,
      A: -10,
      D: -8,
      G: -4,
      B: -6,
    },
    midiOffsets: {
      40: -12, // Low E2
      64: -3, // High E4
    },
    enabledNotes: enabledOnly(["E", "A", "D", "G", "B"]),
  },
  {
    id: "builtin-ely-c13th",
    name: "Ely C13th",
    description: "John Ely C13th lap steel (C+4, Bb-6, E-6, G+6, A-6)",
    isBuiltIn: true,
    isKeyDependent: false,
    defaultRoot: "C",
    pinned: false,
    preferFlats: true,
    offsets: {
      ...createZeroOffsets(),
      C: 4,
      "A#": -6,
      E: -6,
      G: 6,
      A: -6,
    },
    enabledNotes: enabledOnly(["C", "E", "G", "A", "A#"]),
  },
  {
    id: "builtin-ely-a6th",
    name: "Ely A6th",
    description: "John Ely A6th lap steel (A+4, C#-6, E+6, F#-6)",
    isBuiltIn: true,
    isKeyDependent: false,
    defaultRoot: "C",
    pinned: false,
    offsets: {
      ...createZeroOffsets(),
      A: 4,
      "C#": -6,
      E: 6,
      "F#": -6,
    },
    enabledNotes: enabledOnly(["A", "C#", "E", "F#"]),
  },
  {
    id: "builtin-ely-e13th",
    name: "Ely E13th",
    description: "John Ely E13th lap steel (E+4, C#-6, B+4, G#-6, F#+4, D+4)",
    isBuiltIn: true,
    isKeyDependent: false,
    defaultRoot: "C",
    pinned: false,
    offsets: {
      ...createZeroOffsets(),
      E: 4,
      "C#": -6,
      B: 4,
      "G#": -6,
      "F#": 4,
      D: 4,
    },
    enabledNotes: enabledOnly(["D", "E", "F#", "G#", "B", "C#"]),
  },
  {
    id: "builtin-ely-b11th",
    name: "Ely B11th",
    description: "John Ely B11th lap steel (B, D#, F#, A, C#, E)",
    isBuiltIn: true,
    isKeyDependent: false,
    defaultRoot: "C",
    pinned: false,
    offsets: createZeroOffsets(),
    enabledNotes: enabledOnly(["B", "D#", "F#", "A", "C#", "E"]),
  },
];

export function formatNoteName(pitchClass: number, useFlats: boolean): string {
  const idx = ((pitchClass % 12) + 12) % 12;
  return useFlats ? FLAT_NAMES[idx] : NOTE_NAMES[idx];
}

export function getEffectiveOffsetCents(
  pitchClass: number,
  preset: TemperamentPreset,
  rootNote: NoteName,
): number {
  const normalizedPc = ((pitchClass % 12) + 12) % 12;
  if (!preset.isKeyDependent) {
    return preset.offsets[NOTE_NAMES[normalizedPc]] ?? 0;
  }
  const rootIdx = NOTE_NAMES.indexOf(rootNote);
  const relativeIdx = (normalizedPc - (rootIdx === -1 ? 0 : rootIdx) + 12) % 12;
  return preset.offsets[NOTE_NAMES[relativeIdx]] ?? 0;
}

export function getEffectiveEnabledNotes(
  preset: TemperamentPreset,
  rootNote: NoteName,
): boolean[] {
  if (!preset.enabledNotes) {
    return NOTE_NAMES.map(() => true);
  }
  const rootIdx = NOTE_NAMES.indexOf(rootNote);
  return NOTE_NAMES.map((_, pc) => {
    const idx = preset.isKeyDependent
      ? (pc - (rootIdx === -1 ? 0 : rootIdx) + 12) % 12
      : pc;
    return preset.enabledNotes![NOTE_NAMES[idx]] !== false;
  });
}

export function findNearestEnabledMidi(
  floatMidi: number,
  enabledByPc: readonly boolean[],
): number {
  const rounded = Math.round(floatMidi);
  let bestMidi = rounded;
  let bestDist = Infinity;

  for (let delta = -12; delta <= 12; delta++) {
    const candidate = rounded + delta;
    const pc = ((candidate % 12) + 12) % 12;
    if (!enabledByPc[pc]) continue;
    const dist = Math.abs(floatMidi - candidate);
    if (dist < bestDist) {
      bestDist = dist;
      bestMidi = candidate;
    }
  }

  return bestDist === Infinity ? rounded : bestMidi;
}

export function midiToTargetFrequency(
  midi: number,
  a4Hz: number,
  preset: TemperamentPreset,
  rootNote: NoteName,
): number {
  const equalHz = a4Hz * Math.pow(2, (midi - 69) / 12);
  const midiOverride = preset.midiOffsets?.[midi];
  const offsetCents =
    typeof midiOverride === "number"
      ? midiOverride
      : getEffectiveOffsetCents(midi % 12, preset, rootNote);
  return equalHz * Math.pow(2, offsetCents / 1200);
}

export function frequencyToNearestMidi(hz: number, a4Hz: number): number {
  if (hz <= 0) return 69;
  return Math.round(69 + 12 * Math.log2(hz / a4Hz));
}

export function frequencyToCentsError(
  measuredHz: number,
  targetHz: number,
): number {
  if (measuredHz <= 0 || targetHz <= 0) return 0;
  return 1200 * Math.log2(measuredHz / targetHz);
}

export function clampCents(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const clamped = Math.max(-50, Math.min(50, value));
  return Math.round(clamped * 10) / 10;
}
