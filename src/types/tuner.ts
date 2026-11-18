export const NOTE_NAMES = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
] as const;

export const FLAT_NAMES = [
  'C',
  'Db',
  'D',
  'Eb',
  'E',
  'F',
  'Gb',
  'G',
  'Ab',
  'A',
  'Bb',
  'B',
] as const;

export type NoteName = (typeof NOTE_NAMES)[number];

export type NoteOffsets = Record<NoteName, number>;
export type EnabledNotes = Record<NoteName, boolean>;

export interface TemperamentPreset {
  id: string;
  name: string;
  description?: string;
  isBuiltIn: boolean;
  isKeyDependent: boolean;
  defaultRoot: NoteName;
  pinned: boolean;
  preferFlats?: boolean;
  offsets: NoteOffsets;
  midiOffsets?: Record<number, number>;
  enabledNotes?: EnabledNotes;
}

export type StrobeStyle = 'circle' | 'horizontal' | 'dial' | 'bars';

export interface TunerFrame {
  /** Whether a pitched signal above the noise gate is currently detected */
  active: boolean;
  /** Detected or locked MIDI note number (e.g. 69 for A4) */
  midi: number;
  /** Octave number (e.g. 4 for A4) */
  octave: number;
  /** Pitch class index 0..11 (0 = C) */
  pitchClass: number;
  /** Measured input frequency in Hz */
  detectedHz: number;
  /** Target frequency in Hz (incorporating A4 calibration & temperament offset) */
  targetHz: number;
  /** Error in cents relative to targetHz (-50 to +50) */
  cents: number;
  /** Phase velocity in cycles/sec (Hz) for driving the strobe rotation */
  phaseVelocityHz: number;
  /** Instantaneous quadrature phase (0..2*PI) */
  phase: number;
  /** Signal clarity (0..1) */
  clarity: number;
  /** RMS input level (0..1) */
  rms: number;
}
