import { describe, expect, it } from 'vitest';
import { detectPitchMPM } from '../src/audio/AudioEngine';
import {
  BUILTIN_PRESETS,
  clampCents,
  createAllEnabledNotes,
  createZeroOffsets,
  findNearestEnabledMidi,
  formatNoteName,
  frequencyToCentsError,
  frequencyToNearestMidi,
  getEffectiveEnabledNotes,
  getEffectiveOffsetCents,
  midiToTargetFrequency,
} from '../src/audio/temperaments';

describe('temperaments & pitch math', () => {
  const equal = BUILTIN_PRESETS.find((p) => p.id === 'builtin-12tet')!;
  const just = BUILTIN_PRESETS.find((p) => p.id === 'builtin-just')!;

  it('computes exact A4 = 440 Hz and A4 = 415 Hz in 12-TET', () => {
    expect(midiToTargetFrequency(69, 440, equal, 'C')).toBeCloseTo(440, 5);
    expect(midiToTargetFrequency(69, 415, equal, 'C')).toBeCloseTo(415, 5);
    expect(midiToTargetFrequency(57, 440, equal, 'C')).toBeCloseTo(220, 5);
  });

  it('transposes key-dependent temperaments relative to rootNote', () => {
    // In Just Intonation rooted at C, E (pc 4) is -13.7 cents
    expect(getEffectiveOffsetCents(4, just, 'C')).toBeCloseTo(-13.7, 1);

    // In Just Intonation rooted at D (pc 2), F# (pc 6) is the major third -> -13.7 cents
    expect(getEffectiveOffsetCents(6, just, 'D')).toBeCloseTo(-13.7, 1);
    // And D itself (pc 2) is 0.0 cents
    expect(getEffectiveOffsetCents(2, just, 'D')).toBeCloseTo(0.0, 1);
  });

  it('applies cent offsets to target frequency accurately', () => {
    // E4 (midi 64) in 12-TET is ~329.628 Hz; in Just C (-13.7c) it is ~327.03 Hz (5/4 * C4)
    const e4Equal = midiToTargetFrequency(64, 440, equal, 'C');
    const e4Just = midiToTargetFrequency(64, 440, just, 'C');
    const diffCents = frequencyToCentsError(e4Just, e4Equal);
    expect(diffCents).toBeCloseTo(-13.7, 1);
  });

  it('maps frequencies to nearest MIDI note and clamps cents', () => {
    expect(frequencyToNearestMidi(440, 440)).toBe(69);
    expect(frequencyToNearestMidi(261.63, 440)).toBe(60);
    expect(clampCents(75.4)).toBe(50);
    expect(clampCents(-62.1)).toBe(-50);
    expect(clampCents(-13.68)).toBe(-13.7);
  });

  it('formats sharp and flat note names properly', () => {
    expect(formatNoteName(1, false)).toBe('C#');
    expect(formatNoteName(1, true)).toBe('Db');
    expect(formatNoteName(10, true)).toBe('Bb');
  });

  it('filters and snaps to enabled notes only', () => {
    const enabled = createAllEnabledNotes();
    // Standard guitar pitch classes: E, A, D, G, B
    enabled['C'] = false;
    enabled['C#'] = false;
    enabled['D#'] = false;
    enabled['F'] = false;
    enabled['F#'] = false;
    enabled['G#'] = false;
    enabled['A#'] = false;

    const guitarPreset = {
      id: 'custom-guitar',
      name: 'Guitar',
      isBuiltIn: false,
      isKeyDependent: false,
      defaultRoot: 'C' as const,
      pinned: true,
      offsets: createZeroOffsets(),
      enabledNotes: enabled,
    };

    const enabledByPc = getEffectiveEnabledNotes(guitarPreset, 'C');
    // 70 cents flat of E2 (midi 40) -> floatMidi 39.3 -> normally D#2 (39), should snap to E2 (40)
    expect(findNearestEnabledMidi(39.3, enabledByPc)).toBe(40);
    // 60 cents sharp of A2 (midi 45) -> floatMidi 45.6 -> normally A#2 (46), should snap to A2 (45)
    expect(findNearestEnabledMidi(45.6, enabledByPc)).toBe(45);
  });

  it('applies James Taylor acoustic guitar preset offsets including Low E2 vs High E4', () => {
    const jt = BUILTIN_PRESETS.find((p) => p.id === 'builtin-jt-acoustic')!;
    const e2Equal = midiToTargetFrequency(40, 440, equal, 'C');
    const e2Jt = midiToTargetFrequency(40, 440, jt, 'C');
    expect(frequencyToCentsError(e2Jt, e2Equal)).toBeCloseTo(-12, 1);

    const e4Equal = midiToTargetFrequency(64, 440, equal, 'C');
    const e4Jt = midiToTargetFrequency(64, 440, jt, 'C');
    expect(frequencyToCentsError(e4Jt, e4Equal)).toBeCloseTo(-3, 1);

    const g3Equal = midiToTargetFrequency(55, 440, equal, 'C');
    const g3Jt = midiToTargetFrequency(55, 440, jt, 'C');
    expect(frequencyToCentsError(g3Jt, g3Equal)).toBeCloseTo(-4, 1);
  });

  it('detects E2, E3, and E4 accurately at both 44100 Hz and 48000 Hz with harmonics and DC offset', () => {
    for (const sr of [44100, 48000]) {
      for (const targetHz of [82.4069, 164.8138, 329.6276]) {
        const buf = new Float32Array(4096);
        for (let i = 0; i < buf.length; i++) {
          const t = i / sr;
          // Fundamental + strong 2nd & 3rd harmonics + DC offset
          buf[i] =
            0.05 +
            0.6 * Math.sin(2 * Math.PI * targetHz * t) +
            0.35 * Math.sin(2 * Math.PI * targetHz * 2 * t + 0.3) +
            0.2 * Math.sin(2 * Math.PI * targetHz * 3 * t + 0.7);
        }
        const { hz, clarity } = detectPitchMPM(buf, sr);
        expect(clarity).toBeGreaterThan(0.95);
        expect(Math.abs(frequencyToCentsError(hz, targetHz))).toBeLessThan(0.2);
      }
    }
  });
});
