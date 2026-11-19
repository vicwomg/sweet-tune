import { NOTE_NAMES, type NoteName, type TemperamentPreset, type TunerFrame } from '../types/tuner';
import {
  findNearestEnabledMidi,
  getEffectiveEnabledNotes,
  getEffectiveOffsetCents,
  midiToTargetFrequency,
} from './temperaments';
import {
  disableIosSilentSwitchBypass,
  enableIosSilentSwitchBypass,
} from '../utils/iosAudioUnlock';

export interface AudioEngineConfig {
  a4Hz: number;
  lockedMidi: number | null;
  preset: TemperamentPreset;
  rootNote: NoteName;
  noiseGate: number;
  inputGain: number;
}

// Precomputed Hann window cache keyed by length
const hannWindowCache = new Map<number, Float32Array>();

function getHannWindow(n: number): Float32Array {
  let win = hannWindowCache.get(n);
  if (!win) {
    win = new Float32Array(n);
    const denom = n > 1 ? n - 1 : 1;
    for (let i = 0; i < n; i++) {
      win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / denom));
    }
    hannWindowCache.set(n, win);
  }
  return win;
}

// In-place radix-2 Cooley-Tukey FFT (n must be a power of 2)
function fftRadix2(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const angle = (-2 * Math.PI) / len;
    const wLenRe = Math.cos(angle);
    const wLenIm = Math.sin(angle);

    for (let i = 0; i < n; i += len) {
      let wRe = 1;
      let wIm = 0;
      for (let j = 0; j < half; j++) {
        const uRe = re[i + j];
        const uIm = im[i + j];
        const vRe = re[i + j + half] * wRe - im[i + j + half] * wIm;
        const vIm = re[i + j + half] * wIm + im[i + j + half] * wRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + half] = uRe - vRe;
        im[i + j + half] = uIm - vIm;

        const nextWRe = wRe * wLenRe - wIm * wLenIm;
        wIm = wRe * wLenIm + wIm * wLenRe;
        wRe = nextWRe;
      }
    }
  }
}

function refineHarmonicPhaseDiff(
  samples: Float32Array,
  sampleRate: number,
  initHz: number
): { hz: number; mag: number; stability: number } {
  const n = samples.length;
  const hop = n >> 1; // 2048 for 4096-sample buffer: independent halves maximize freq precision in noise
  const winLen = n - hop; // 2048 for 4096-sample buffer
  const win = getHannWindow(winLen);

  const omega = (2 * Math.PI * initHz) / sampleRate;
  const stepCos = Math.cos(omega);
  const stepSin = Math.sin(omega);

  let c = 1;
  let s = 0;
  let re1 = 0;
  let im1 = 0;
  let re2 = 0;
  let im2 = 0;

  for (let i = 0; i < winLen; i++) {
    const w = win[i];
    const x1 = samples[i] * w;
    const x2 = samples[i + hop] * w;

    re1 += x1 * c;
    im1 -= x1 * s;
    re2 += x2 * c;
    im2 -= x2 * s;

    const nextC = c * stepCos - s * stepSin;
    s = s * stepCos + c * stepSin;
    c = nextC;
  }

  const mag1 = Math.hypot(re1, im1);
  const mag2 = Math.hypot(re2, im2);
  const maxMag = Math.max(mag1, mag2);
  if (maxMag < 1e-9) {
    return { hz: initHz, mag: 0, stability: 0 };
  }

  const stability = Math.min(mag1, mag2) / maxMag;

  // Cross-spectrum Z2 * conj(Z1) gives phase advance over `hop` samples
  const crossRe = re2 * re1 + im2 * im1;
  const crossIm = im2 * re1 - re2 * im1;
  const obsPhase = Math.atan2(crossIm, crossRe);
  const expPhase = omega * hop;

  let diff = (obsPhase - expPhase) % (2 * Math.PI);
  if (diff > Math.PI) diff -= 2 * Math.PI;
  if (diff <= -Math.PI) diff += 2 * Math.PI;

  const refinedHz = initHz + (diff * sampleRate) / (2 * Math.PI * hop);
  return { hz: refinedHz, mag: Math.min(mag1, mag2), stability };
}

/**
 * Noise-robust spectral harmonic pitch detector with local median noise-floor
 * subtraction and two-window phase-difference refinement.
 * Excels in loud rooms and on amplified instruments with weak fundamentals.
 */
export function detectPitch(
  rawSamples: Float32Array,
  sampleRate: number,
  hintHz?: number
): { hz: number; clarity: number } {
  const n = rawSamples.length;
  // Require power-of-2 length >= 1024; fall back to MPM otherwise
  if (n < 1024 || (n & (n - 1)) !== 0) {
    return detectPitchMPM(rawSamples, sampleRate);
  }

  // Remove DC offset
  let mean = 0;
  for (let i = 0; i < n; i++) mean += rawSamples[i];
  mean /= n;

  const centered = new Float32Array(n);
  const win = getHannWindow(n);
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = rawSamples[i] - mean;
    centered[i] = v;
    re[i] = v * win[i];
  }

  fftRadix2(re, im);

  const halfN = n >> 1;
  const binHz = sampleRate / n;
  const maxFreqHz = 2400;
  const maxBin = Math.min(halfN - 2, Math.ceil(maxFreqHz / binHz) + 16);

  const mag = new Float32Array(maxBin + 1);
  for (let k = 0; k <= maxBin; k++) {
    mag[k] = Math.hypot(re[k], im[k]);
  }

  // Estimate local spectral noise floor via sliding median (±14 bins ≈ ±160 Hz)
  const floorRadius = 14;
  const noiseFloor = new Float32Array(maxBin + 1);
  const scratch = new Float32Array(floorRadius * 2 + 1);

  for (let k = 1; k <= maxBin; k++) {
    const lo = Math.max(1, k - floorRadius);
    const hi = Math.min(maxBin, k + floorRadius);
    const len = hi - lo + 1;
    for (let j = 0; j < len; j++) {
      scratch[j] = mag[lo + j];
    }
    const slice = scratch.subarray(0, len);
    slice.sort();
    noiseFloor[k] = slice[len >> 1];
  }

  const excess = new Float32Array(maxBin + 1);
  const snr = new Float32Array(maxBin + 1);
  const eps = 1e-7;

  for (let k = 1; k <= maxBin; k++) {
    const nf = Math.max(noiseFloor[k], eps);
    snr[k] = mag[k] / nf;
    excess[k] = Math.max(0, mag[k] - 1.6 * nf);
  }

  // Gather prominent local spectral peaks above the local noise floor
  const minBin = Math.max(2, Math.floor(27 / binHz));
  const peakMaxBin = Math.min(maxBin - 1, Math.ceil(maxFreqHz / binHz));
  const spectralPeaks: { bin: number; freq: number; excess: number; snr: number }[] = [];

  for (let k = minBin; k <= peakMaxBin; k++) {
    if (snr[k] < 2.6 || excess[k] <= 0) continue;
    if (mag[k] >= mag[k - 1] && mag[k] >= mag[k + 1]) {
      // Log-magnitude parabolic peak interpolation for accurate candidate frequency
      const m1 = Math.log(mag[k - 1] + eps);
      const m2 = Math.log(mag[k] + eps);
      const m3 = Math.log(mag[k + 1] + eps);
      const denom = 2 * (m1 - 2 * m2 + m3);
      let delta = 0;
      if (Math.abs(denom) > 1e-12) {
        const d = (m1 - m3) / denom;
        if (Math.abs(d) < 1) delta = d;
      }
      spectralPeaks.push({
        bin: k,
        freq: (k + delta) * binHz,
        excess: excess[k],
        snr: snr[k],
      });
    }
  }

  if (spectralPeaks.length === 0) {
    return { hz: 0, clarity: 0 };
  }

  // Keep the 18 strongest peaks (prioritizing nearest/loudest harmonic instrument)
  spectralPeaks.sort((a, b) => b.excess - a.excess);
  const topPeaks = spectralPeaks.slice(0, 18);

  // Search bounds (narrowed to ±300 cents when note-locked)
  const minF0 = hintHz ? Math.max(27, hintHz * Math.pow(2, -3 / 12)) : 27;
  const maxF0 = hintHz ? Math.min(2200, hintHz * Math.pow(2, 3 / 12)) : 2200;

  // Generate candidate fundamentals f_peak / h for h = 1..4 (handles missing/weak fundamentals)
  const candidates: number[] = [];
  for (const p of topPeaks) {
    for (let h = 1; h <= 4; h++) {
      const f0 = p.freq / h;
      if (f0 < minF0 || f0 > maxF0) continue;
      // Deduplicate candidates within 1.2%
      let dup = false;
      for (let i = 0; i < candidates.length; i++) {
        if (Math.abs(candidates[i] - f0) / f0 < 0.012) {
          dup = true;
          break;
        }
      }
      if (!dup) candidates.push(f0);
    }
  }

  if (candidates.length === 0) {
    return { hz: 0, clarity: 0 };
  }

  // Score each candidate with a harmonic comb over the noise-subtracted spectrum
  let bestF0 = 0;
  let bestScore = 0;
  let bestMatchedCount = 0;
  let bestPeakSnr = 0;

  for (const f0 of candidates) {
    const maxH = Math.min(6, Math.floor(maxFreqHz / f0));
    let totalScore = 0;
    let oddScore = 0;
    let matchedCount = 0;
    let peakSnr = 0;
    let h1Snr = 0;
    let h3Snr = 0;

    for (let h = 1; h <= maxH; h++) {
      const targetBin = (f0 * h) / binHz;
      const center = Math.round(targetBin);
      if (center < 1 || center > peakMaxBin) break;

      // Search ±1 bin around expected harmonic (accounts for slight guitar inharmonicity)
      let localBestK = center;
      let localBestExcess = excess[center];
      if (center - 1 >= 1 && excess[center - 1] > localBestExcess) {
        localBestK = center - 1;
        localBestExcess = excess[center - 1];
      }
      if (center + 1 <= peakMaxBin && excess[center + 1] > localBestExcess) {
        localBestK = center + 1;
        localBestExcess = excess[center + 1];
      }

      const hSnr = snr[localBestK];
      if (h === 1) h1Snr = hSnr;
      if (h === 3) h3Snr = hSnr;

      if (hSnr >= 2.4 && localBestExcess > 0) {
        const w = 1 / Math.sqrt(h);
        const contrib = localBestExcess * w;
        totalScore += contrib;
        if (h % 2 === 1) oddScore += contrib;
        matchedCount++;
        if (hSnr > peakSnr) peakSnr = hSnr;
      }
    }

    if (matchedCount === 0) continue;

    // Reject ghost subharmonics: a true fundamental must have real odd-harmonic energy
    if (oddScore < 0.2 * totalScore) continue;
    if (h1Snr < 2.2 && h3Snr < 2.2) continue;

    // Require strong peak SNR for single-harmonic (pure sine) detections to reject room noise spikes
    if (matchedCount === 1 && peakSnr < 5.5) continue;
    if (matchedCount >= 2 && peakSnr < 3.0) continue;

    // Mild harmonic richness bonus when >= 2 harmonics align
    const harmonicBonus = matchedCount >= 2 ? 1 + 0.06 * Math.min(matchedCount, 5) : 1;
    // Slight preference for presence of fundamental to break near-ties cleanly
    const fundBonus = h1Snr >= 2.4 ? 1.04 : 1.0;
    const score = totalScore * harmonicBonus * fundBonus;

    if (score > bestScore) {
      bestScore = score;
      bestF0 = f0;
      bestMatchedCount = matchedCount;
      bestPeakSnr = peakSnr;
    }
  }

  if (bestF0 <= 0) {
    return { hz: 0, clarity: 0 };
  }

  // Refine fundamental frequency to < 0.1 cent via two-window phase difference across matched harmonics
  const maxH = Math.min(5, Math.floor(maxFreqHz / bestF0));
  const estimates: { f0: number; weight: number; stability: number }[] = [];

  for (let h = 1; h <= maxH; h++) {
    const targetBin = (bestF0 * h) / binHz;
    const center = Math.round(targetBin);
    if (center < 1 || center > peakMaxBin) break;

    let k = center;
    if (center - 1 >= 1 && mag[center - 1] > mag[k]) k = center - 1;
    if (center + 1 <= peakMaxBin && mag[center + 1] > mag[k]) k = center + 1;

    if (snr[k] < 2.4 || excess[k] <= 0) continue;

    // Parabolic init within ~0.5 Hz
    const m1 = Math.log(mag[k - 1] + eps);
    const m2 = Math.log(mag[k] + eps);
    const m3 = Math.log(mag[k + 1] + eps);
    const denom = 2 * (m1 - 2 * m2 + m3);
    let delta = 0;
    if (Math.abs(denom) > 1e-12) {
      const d = (m1 - m3) / denom;
      if (Math.abs(d) < 1) delta = d;
    }
    const initHarmHz = (k + delta) * binHz;

    const refined = refineHarmonicPhaseDiff(centered, sampleRate, initHarmHz);
    if (refined.mag <= 0 || refined.stability < 0.25) continue;

    const estF0 = refined.hz / h;
    if (Math.abs(estF0 - bestF0) / bestF0 > 0.04) continue;

    // Optimal Cramér-Rao weighting with capped SNR so silent bins don't let one harmonic dominate
    const cappedSnr = Math.min(snr[k], 30);
    estimates.push({
      f0: estF0,
      weight: h * h * cappedSnr * cappedSnr * refined.stability * (excess[k] / (topPeaks[0].excess + eps) + 0.1),
      stability: refined.stability,
    });
  }

  if (estimates.length === 0) {
    return { hz: 0, clarity: 0 };
  }

  // Find consensus anchor via unweighted median (>= 3 harmonics) so a single harmonic
  // corrupted by another instrument cannot outvote the remaining harmonics
  const byFreq = [...estimates].sort((a, b) => a.f0 - b.f0);
  const anchorF0 =
    byFreq.length >= 3
      ? byFreq[byFreq.length >> 1].f0
      : [...estimates].sort((a, b) => b.weight - a.weight)[0].f0;

  let weightedSum = 0;
  let totalWeight = 0;
  let maxStability = 0;

  for (const est of estimates) {
    if (Math.abs(est.f0 - anchorF0) / anchorF0 <= 0.006) {
      weightedSum += est.f0 * est.weight;
      totalWeight += est.weight;
      if (est.stability > maxStability) maxStability = est.stability;
    }
  }

  const finalHz = totalWeight > 0 ? weightedSum / totalWeight : anchorF0;
  // Map spectral SNR + harmonic count into a 0..1 clarity metric
  const snrClarity = Math.min(1, Math.max(0, (bestPeakSnr - 1.0) / 6.0));
  const harmonicClarity = Math.min(1, 0.55 + 0.15 * bestMatchedCount);
  const clarity = Math.min(1, snrClarity * harmonicClarity * Math.max(0.75, maxStability));

  return { hz: finalHz, clarity };
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
  private pendingMidi: number | null = null;
  private pendingMidiCount = 0;
  private recentCents: number[] = [];
  private smoothedCents = 0;
  private holdFrames = 0;
  private isGateOpen = false;
  private zeroSignalFrames = 0;
  private isRestarting = false;
  private lastRestartTime = 0;

  constructor(onFrame: (frame: TunerFrame) => void) {
    this.onFrame = onFrame;
  }

  async restart(config?: AudioEngineConfig): Promise<void> {
    await this.recover(config, true);
  }

  /**
   * Recovers microphone capture after iOS background/foreground interruption
   * WITHOUT destroying the user-gesture-unlocked AudioContext.
   * Returns true if both AudioContext and MediaStreamTrack are live.
   */
  async recover(config?: AudioEngineConfig, forceNewStream = false): Promise<boolean> {
    if (this.isRestarting) return false;
    const nextConfig = config ?? this.config;
    if (!nextConfig) return false;
    this.config = nextConfig;

    if (!this.ctx || !this.analyser || !this.highpass || (this.ctx.state as string) === 'closed') {
      this.isRestarting = true;
      this.lastRestartTime = performance.now();
      try {
        this.stop();
        await this.start(nextConfig);
        const t = this.stream?.getAudioTracks()[0];
        return Boolean(
          this.ctx &&
            (this.ctx.state as string) === 'running' &&
            t &&
            t.readyState === 'live' &&
            !t.muted
        );
      } catch {
        return false;
      } finally {
        this.isRestarting = false;
      }
    }

    // Resume existing unlocked AudioContext (handles both 'suspended' and iOS WebKit 'interrupted')
    if ((this.ctx.state as string) !== 'running') {
      try {
        await this.ctx.resume();
      } catch {
        // Ignore if still transitioning to foreground
      }
    }

    const track = this.stream?.getAudioTracks()[0];
    const needsNewStream =
      forceNewStream || !track || track.readyState === 'ended' || track.muted;

    if (!needsNewStream) {
      return (this.ctx.state as string) === 'running';
    }

    this.isRestarting = true;
    this.lastRestartTime = performance.now();
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      if (!this.ctx || !this.highpass || (this.ctx.state as string) === 'closed') {
        newStream.getTracks().forEach((t) => t.stop());
        return false;
      }

      if (this.source) {
        try {
          this.source.disconnect();
        } catch {
          // Ignore
        }
      }
      if (this.stream) {
        this.stream.getTracks().forEach((t) => t.stop());
      }

      const newSource = this.ctx.createMediaStreamSource(newStream);
      newSource.connect(this.highpass);
      this.stream = newStream;
      this.source = newSource;
      this.bindStreamListeners(newStream);

      if ((this.ctx.state as string) !== 'running') {
        await this.ctx.resume();
      }

      const newTrack = newStream.getAudioTracks()[0];
      return Boolean(
        (this.ctx.state as string) === 'running' &&
          newTrack &&
          newTrack.readyState === 'live' &&
          !newTrack.muted
      );
    } catch {
      return false;
    } finally {
      this.isRestarting = false;
    }
  }

  private bindStreamListeners(stream: MediaStream): void {
    const track = stream.getAudioTracks()[0];
    if (!track) return;
    track.onended = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        void this.recover(undefined, true);
      }
    };
    track.onunmute = () => {
      if (this.ctx && (this.ctx.state as string) !== 'running') {
        void this.ctx.resume();
      }
    };
  }

  async start(config: AudioEngineConfig): Promise<void> {
    this.config = config;

    if (this.ctx && this.analyser && (this.ctx.state as string) !== 'closed') {
      await this.recover(config, false);
      return;
    }

    // Create AudioContext at native hardware sample rate without AudioWorklet
    // (avoids WebKit Bug 274507 where 44.1kHz + AudioWorklet introduces 128-frame quantum distortion)
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      throw new Error(
        'Microphone access requires HTTPS or localhost (browsers disable navigator.mediaDevices on plain HTTP LAN IPs).'
      );
    }

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

    // Peak safety limiter only (high threshold preserves SNR between nearby instrument and loud room)
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -3;
    compressor.knee.value = 6;
    compressor.ratio.value = 12;
    compressor.attack.value = 0.002;
    compressor.release.value = 0.08;

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
    this.bindStreamListeners(stream);
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
    if (!this.ctx || !this.analyser || !this.config || this.isRestarting) return;

    // Resume on both 'suspended' and iOS WebKit 'interrupted' states
    if (
      typeof document !== 'undefined' &&
      document.visibilityState === 'visible' &&
      (this.ctx.state as string) !== 'running'
    ) {
      void this.ctx.resume();
    }

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

    // Self-healing watchdog: on iOS, backgrounding can end or zero-mute the MediaStreamTrack.
    // Hot-swap the stream on the existing unlocked AudioContext if dead for ~625ms while visible.
    const track = this.stream?.getAudioTracks()[0];
    const trackDead = !track || track.readyState === 'ended' || track.muted;
    if (rms === 0 || trackDead) {
      this.zeroSignalFrames++;
      const isVisible =
        typeof document === 'undefined' || document.visibilityState === 'visible';
      if (
        isVisible &&
        this.zeroSignalFrames >= 25 &&
        performance.now() - this.lastRestartTime > 1500
      ) {
        this.zeroSignalFrames = 0;
        void this.recover(undefined, true);
        return;
      }
    } else {
      this.zeroSignalFrames = 0;
    }

    const { a4Hz, lockedMidi, preset, rootNote, noiseGate } = this.config;
    const gateThreshold = this.isGateOpen ? noiseGate * 0.45 : noiseGate;

    if (rms < gateThreshold) {
      if (this.holdFrames > 0) {
        this.holdFrames--;
        return;
      }
      this.isGateOpen = false;
      this.pendingMidi = null;
      this.pendingMidiCount = 0;
      this.recentCents = [];
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

    const hintHz =
      lockedMidi !== null
        ? midiToTargetFrequency(lockedMidi, a4Hz, preset, rootNote)
        : undefined;
    const { hz, clarity } = detectPitch(this.timeBuffer, this.ctx.sampleRate, hintHz);
    if (hz <= 0 || clarity < 0.28) {
      if (this.holdFrames > 0) {
        this.holdFrames--;
        return;
      }
      this.isGateOpen = false;
      this.pendingMidi = null;
      this.pendingMidiCount = 0;
      this.recentCents = [];
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

    const wasGateOpen = this.isGateOpen;
    this.isGateOpen = true;
    this.holdFrames = 15; // ~375ms holdover on decaying notes

    const enabledByPc = getEffectiveEnabledNotes(preset, rootNote);
    let midi = lockedMidi;
    if (midi === null) {
      const floatMidi = 69 + 12 * Math.log2(hz / a4Hz);
      const nearest = findNearestEnabledMidi(floatMidi, enabledByPc);
      const lastPc = ((this.lastAutoMidi % 12) + 12) % 12;
      const lastEnabled = enabledByPc[lastPc];
      if (!lastEnabled || !wasGateOpen) {
        // Switch immediately when starting from silence or if previous note is disabled
        this.lastAutoMidi = nearest;
        this.pendingMidi = null;
        this.pendingMidiCount = 0;
        this.recentCents = [];
        this.smoothedCents = 0;
      } else if (
        nearest !== this.lastAutoMidi &&
        Math.abs(floatMidi - this.lastAutoMidi) > 0.65
      ) {
        // Require 2 consecutive consistent frames (~50ms) to ignore transient loud-room glitches
        if (this.pendingMidi === nearest) {
          this.pendingMidiCount++;
          if (this.pendingMidiCount >= 2) {
            this.lastAutoMidi = nearest;
            this.pendingMidi = null;
            this.pendingMidiCount = 0;
            this.recentCents = [];
            this.smoothedCents = 0;
          } else {
            return;
          }
        } else {
          this.pendingMidi = nearest;
          this.pendingMidiCount = 1;
          return;
        }
      } else {
        this.pendingMidi = null;
        this.pendingMidiCount = 0;
      }
      midi = this.lastAutoMidi;
    }

    const finalTargetHz = midiToTargetFrequency(midi, a4Hz, preset, rootNote);
    const rawCents = Math.max(-100, Math.min(100, 1200 * Math.log2(hz / finalTargetHz)));

    // 3-frame median filter rejects single-frame noise spikes before exponential smoothing
    this.recentCents.push(rawCents);
    if (this.recentCents.length > 3) this.recentCents.shift();
    let filteredCents = rawCents;
    if (this.recentCents.length === 3) {
      const [a, b, c] = this.recentCents;
      filteredCents = Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
    }

    this.smoothedCents += 0.25 * (filteredCents - this.smoothedCents);

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
    enableIosSilentSwitchBypass(Boolean(this.stream));
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
    disableIosSilentSwitchBypass();
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
