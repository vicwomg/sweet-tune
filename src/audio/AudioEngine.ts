import { NOTE_NAMES, type NoteName, type TemperamentPreset, type TunerFrame } from '../types/tuner';
import {
  findNearestEnabledMidi,
  getEffectiveEnabledNotes,
  getEffectiveOffsetCents,
  midiToTargetFrequency,
} from './temperaments';

export interface AudioEngineConfig {
  a4Hz: number;
  lockedMidi: number | null;
  preset: TemperamentPreset;
  rootNote: NoteName;
  noiseGate: number;
  inputGain: number;
}

export function detectPitchMPM(
  rawSamples: Float32Array,
  sampleRate: number
): { hz: number; clarity: number } {
  const n = rawSamples.length;
  const minTau = Math.max(16, Math.floor(sampleRate / 2200));
  const maxTau = Math.min(Math.floor(n / 2), Math.floor(sampleRate / 27));

  // Remove DC offset so microphone bias cannot shift NSDF lobes
  let mean = 0;
  for (let i = 0; i < n; i++) {
    mean += rawSamples[i];
  }
  mean /= n;

  const samples = new Float32Array(n);
  const sq = new Float32Array(n);
  let m = 0;
  for (let i = 0; i < n; i++) {
    const v = rawSamples[i] - mean;
    samples[i] = v;
    const v2 = v * v;
    sq[i] = v2;
    m += 2 * v2;
  }

  const nsdf = new Float32Array(maxTau + 1);
  nsdf[0] = 1;

  for (let tau = 1; tau <= maxTau; tau++) {
    m -= sq[n - tau] + sq[tau - 1];
    if (tau < minTau) continue;

    let acf = 0;
    const limit = n - tau;
    for (let i = 0; i < limit; i++) {
      acf += samples[i] * samples[i + tau];
    }
    nsdf[tau] = m > 1e-12 ? (2 * acf) / m : 0;
  }

  // Find positive-going key maxima after first negative zero-crossing
  let pastFirstZero = false;
  let inPositiveRegion = false;
  let regionMaxVal = -1;
  let regionMaxTau = -1;

  const peaks: { tau: number; val: number }[] = [];
  let globalMax = -1;

  for (let tau = minTau; tau <= maxTau; tau++) {
    const val = nsdf[tau];
    if (!pastFirstZero) {
      if (val < 0) pastFirstZero = true;
      continue;
    }

    if (val > 0) {
      if (!inPositiveRegion) {
        inPositiveRegion = true;
        regionMaxVal = val;
        regionMaxTau = tau;
      } else if (val > regionMaxVal) {
        regionMaxVal = val;
        regionMaxTau = tau;
      }
    } else if (inPositiveRegion) {
      inPositiveRegion = false;
      peaks.push({ tau: regionMaxTau, val: regionMaxVal });
      if (regionMaxVal > globalMax) globalMax = regionMaxVal;
    }
  }

  if (inPositiveRegion && regionMaxTau !== -1) {
    peaks.push({ tau: regionMaxTau, val: regionMaxVal });
    if (regionMaxVal > globalMax) globalMax = regionMaxVal;
  }

  if (peaks.length === 0 || globalMax < 0.7) {
    return { hz: 0, clarity: Math.max(0, globalMax) };
  }

  // Pick the first peak >= 0.88 * globalMax to avoid subharmonic octave errors
  const threshold = 0.88 * globalMax;
  let chosen = peaks[0];
  for (let i = 0; i < peaks.length; i++) {
    if (peaks[i].val >= threshold) {
      chosen = peaks[i];
      break;
    }
  }

  // Parabolic interpolation around chosen.tau
  let refinedTau = chosen.tau;
  if (chosen.tau > minTau && chosen.tau < maxTau) {
    const y1 = nsdf[chosen.tau - 1];
    const y2 = nsdf[chosen.tau];
    const y3 = nsdf[chosen.tau + 1];
    const denom = 2 * (y1 - 2 * y2 + y3);
    if (Math.abs(denom) > 1e-12) {
      const delta = (y1 - y3) / denom;
      if (Math.abs(delta) < 1) {
        refinedTau += delta;
      }
    }
  }

  return {
    hz: sampleRate / refinedTau,
    clarity: chosen.val,
  };
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private highpass: BiquadFilterNode | null = null;
  private lowpass: BiquadFilterNode | null = null;
  private inputGainNode: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private analyser: AnalyserNode | null = null;
  private timeBuffer: Float32Array = new Float32Array(4096);
  private timerId: number | null = null;

  private refOsc: OscillatorNode | null = null;
  private refGain: GainNode | null = null;
  private onFrame: (frame: TunerFrame) => void;

  private config: AudioEngineConfig | null = null;
  private lastAutoMidi = 69;
  private smoothedCents = 0;
  private holdFrames = 0;
  private isGateOpen = false;

  constructor(onFrame: (frame: TunerFrame) => void) {
    this.onFrame = onFrame;
  }

  async start(config: AudioEngineConfig): Promise<void> {
    this.config = config;

    if (this.ctx && this.analyser) {
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }
      return;
    }

    // Create AudioContext at native hardware sample rate without AudioWorklet
    // (avoids WebKit Bug 274507 where 44.1kHz + AudioWorklet introduces 128-frame quantum distortion)
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    const source = ctx.createMediaStreamSource(stream);

    // Bandpass conditioning: strip sub-bass rumble/DC (<32 Hz) and high-frequency hiss (>2400 Hz)
    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 32;
    highpass.Q.value = 0.707;

    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 2400;
    lowpass.Q.value = 0.707;

    // Preamp boost for quiet instruments / distant mics
    const inputGainNode = ctx.createGain();
    inputGainNode.gain.value = config.inputGain;

    // Gentle peak limiter so boosted transients don't clip while sustain stays strong
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.knee.value = 12;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.15;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0;

    source
      .connect(highpass)
      .connect(lowpass)
      .connect(inputGainNode)
      .connect(compressor)
      .connect(analyser);

    this.ctx = ctx;
    this.stream = stream;
    this.source = source;
    this.highpass = highpass;
    this.lowpass = lowpass;
    this.inputGainNode = inputGainNode;
    this.compressor = compressor;
    this.analyser = analyser;
    this.timeBuffer = new Float32Array(analyser.fftSize);

    this.timerId = window.setInterval(() => {
      this.processFrame();
    }, 25);
  }

  private processFrame(): void {
    if (!this.ctx || !this.analyser || !this.config) return;

    this.analyser.getFloatTimeDomainData(this.timeBuffer);
    const n = this.timeBuffer.length;

    // Compute RMS over the latest 1024 samples for responsive gating
    const rmsStart = Math.max(0, n - 1024);
    let sumSq = 0;
    for (let i = rmsStart; i < n; i++) {
      const s = this.timeBuffer[i];
      sumSq += s * s;
    }
    const rms = Math.sqrt(sumSq / (n - rmsStart));

    const { a4Hz, lockedMidi, preset, rootNote, noiseGate } = this.config;
    const gateThreshold = this.isGateOpen ? noiseGate * 0.45 : noiseGate;

    if (rms < gateThreshold) {
      if (this.holdFrames > 0) {
        this.holdFrames--;
        return;
      }
      this.isGateOpen = false;
      this.onFrame({
        active: false,
        midi: this.lastAutoMidi,
        octave: Math.floor(this.lastAutoMidi / 12) - 1,
        pitchClass: ((this.lastAutoMidi % 12) + 12) % 12,
        detectedHz: 0,
        targetHz: a4Hz,
        cents: 0,
        phaseVelocityHz: 0,
        phase: 0,
        clarity: 0,
        rms,
      });
      return;
    }

    const { hz, clarity } = detectPitchMPM(this.timeBuffer, this.ctx.sampleRate);
    if (hz <= 0 || clarity < 0.72) {
      if (this.holdFrames > 0) {
        this.holdFrames--;
        return;
      }
      this.isGateOpen = false;
      this.onFrame({
        active: false,
        midi: this.lastAutoMidi,
        octave: Math.floor(this.lastAutoMidi / 12) - 1,
        pitchClass: ((this.lastAutoMidi % 12) + 12) % 12,
        detectedHz: 0,
        targetHz: a4Hz,
        cents: 0,
        phaseVelocityHz: 0,
        phase: 0,
        clarity,
        rms,
      });
      return;
    }

    this.isGateOpen = true;
    this.holdFrames = 15; // ~375ms holdover on decaying notes

    const enabledByPc = getEffectiveEnabledNotes(preset, rootNote);
    let midi = lockedMidi;
    if (midi === null) {
      const floatMidi = 69 + 12 * Math.log2(hz / a4Hz);
      const nearest = findNearestEnabledMidi(floatMidi, enabledByPc);
      const lastPc = ((this.lastAutoMidi % 12) + 12) % 12;
      const lastEnabled = enabledByPc[lastPc];
      if (
        !lastEnabled ||
        (nearest !== this.lastAutoMidi && Math.abs(floatMidi - this.lastAutoMidi) > 0.65)
      ) {
        this.lastAutoMidi = nearest;
        this.smoothedCents = 0;
      }
      midi = this.lastAutoMidi;
    }

    const finalTargetHz = midiToTargetFrequency(midi, a4Hz, preset, rootNote);
    const rawCents = Math.max(-100, Math.min(100, 1200 * Math.log2(hz / finalTargetHz)));
    this.smoothedCents += 0.25 * (rawCents - this.smoothedCents);

    const pc = ((midi % 12) + 12) % 12;
    const octave = Math.floor(midi / 12) - 1;

    const effectiveCents = Math.abs(this.smoothedCents) < 0.3 ? 0 : this.smoothedCents;
    const strobeVelocityHz = finalTargetHz * (Math.pow(2, effectiveCents / 1200) - 1);

    this.onFrame({
      active: true,
      midi,
      octave,
      pitchClass: pc,
      detectedHz: hz,
      targetHz: finalTargetHz,
      cents: this.smoothedCents,
      phaseVelocityHz: strobeVelocityHz,
      phase: 0,
      clarity,
      rms,
    });
  }

  updateConfig(config: AudioEngineConfig): void {
    this.config = config;
    if (this.inputGainNode && this.ctx) {
      this.inputGainNode.gain.setTargetAtTime(config.inputGain, this.ctx.currentTime, 0.02);
    }
    // Keep unused import warm or ensure offsets are always valid
    void getEffectiveOffsetCents(0, config.preset, config.rootNote);
    void NOTE_NAMES;
  }

  async playReferenceTone(hz: number): Promise<void> {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
    this.stopReferenceTone();

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(hz, this.ctx.currentTime);
    gain.gain.setValueAtTime(0.001, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.15, this.ctx.currentTime + 0.04);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();

    this.refOsc = osc;
    this.refGain = gain;
  }

  updateReferenceTone(hz: number): void {
    if (this.refOsc && this.ctx) {
      this.refOsc.frequency.setTargetAtTime(hz, this.ctx.currentTime, 0.02);
    }
  }

  stopReferenceTone(): void {
    if (this.refOsc && this.refGain && this.ctx) {
      try {
        const now = this.ctx.currentTime;
        this.refGain.gain.cancelScheduledValues(now);
        this.refGain.gain.setTargetAtTime(0.0001, now, 0.02);
        this.refOsc.stop(now + 0.06);
      } catch {
        // Ignore if already stopped
      }
    }
    this.refOsc = null;
    this.refGain = null;
  }

  getSampleRate(): number | null {
    return this.ctx ? this.ctx.sampleRate : null;
  }

  stop(): void {
    this.stopReferenceTone();
    if (this.timerId !== null) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }
    if (this.analyser) {
      this.analyser.disconnect();
      this.analyser = null;
    }
    if (this.compressor) {
      this.compressor.disconnect();
      this.compressor = null;
    }
    if (this.inputGainNode) {
      this.inputGainNode.disconnect();
      this.inputGainNode = null;
    }
    if (this.lowpass) {
      this.lowpass.disconnect();
      this.lowpass = null;
    }
    if (this.highpass) {
      this.highpass.disconnect();
      this.highpass = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}
