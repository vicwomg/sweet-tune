// AudioWorkletProcessor for SweetTune
// Combines McLeod Pitch Method (MPM) fundamental detection with a quadrature
// phase demodulator for true sub-cent strobe phase tracking.

class StrobeProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    this.bufferSize = 4096;
    this.hopSize = 1024;
    this.ringBuffer = new Float32Array(this.bufferSize);
    this.writeIndex = 0;
    this.samplesSinceHop = 0;

    // Configuration updated from main thread
    this.a4Hz = 440.0;
    this.lockedMidi = null;
    this.offsetsByPc = new Float32Array(12); // cents offset per pitch class (0 = C)
    this.midiOffsets = null;
    this.enabledByPc = new Array(12).fill(true);
    this.noiseGate = 0.009;

    // Hysteresis & smoothing
    this.lastAutoMidi = 69;
    this.smoothedCents = 0;
    this.holdFrames = 0;
    this.isGateOpen = false;

    // Quadrature demodulator state
    this.refPhase = 0;
    this.iFilt = 0;
    this.qFilt = 0;
    this.prevDemodPhase = 0;
    this.smoothedVelocityHz = 0;

    this.port.onmessage = (event) => {
      const msg = event.data;
      if (!msg || msg.type !== 'config') return;
      if (typeof msg.a4Hz === 'number') this.a4Hz = msg.a4Hz;
      this.lockedMidi = typeof msg.lockedMidi === 'number' ? msg.lockedMidi : null;
      if (Array.isArray(msg.offsetsByPc) && msg.offsetsByPc.length === 12) {
        for (let i = 0; i < 12; i++) {
          this.offsetsByPc[i] = msg.offsetsByPc[i] || 0;
        }
      }
      this.midiOffsets = msg.midiOffsets && typeof msg.midiOffsets === 'object' ? msg.midiOffsets : null;
      if (Array.isArray(msg.enabledByPc) && msg.enabledByPc.length === 12) {
        for (let i = 0; i < 12; i++) {
          this.enabledByPc[i] = msg.enabledByPc[i] !== false;
        }
      }
      if (typeof msg.noiseGate === 'number') this.noiseGate = msg.noiseGate;
    };
  }

  getTargetFrequency(midi) {
    const pc = ((midi % 12) + 12) % 12;
    const override = this.midiOffsets && typeof this.midiOffsets[midi] === 'number'
      ? this.midiOffsets[midi]
      : null;
    const offsetCents = override !== null ? override : (this.offsetsByPc[pc] || 0);
    return this.a4Hz * Math.pow(2, (midi - 69) / 12) * Math.pow(2, offsetCents / 1200);
  }

  findNearestEnabledMidi(floatMidi) {
    const rounded = Math.round(floatMidi);
    let bestMidi = rounded;
    let bestDist = Infinity;
    for (let d = -12; d <= 12; d++) {
      const candidate = rounded + d;
      const pc = ((candidate % 12) + 12) % 12;
      if (!this.enabledByPc[pc]) continue;
      const dist = Math.abs(floatMidi - candidate);
      if (dist < bestDist) {
        bestDist = dist;
        bestMidi = candidate;
      }
    }
    return bestDist === Infinity ? rounded : bestMidi;
  }

  detectPitchMPM(samples) {
    const n = samples.length;
    const minTau = Math.max(16, Math.floor(sampleRate / 2200));
    const maxTau = Math.min(Math.floor(n / 2), Math.floor(sampleRate / 27));

    const nsdf = new Float32Array(maxTau + 1);

    for (let tau = minTau; tau <= maxTau; tau++) {
      let acf = 0;
      let m = 0;
      const limit = n - tau;
      for (let i = 0; i < limit; i++) {
        const x1 = samples[i];
        const x2 = samples[i + tau];
        acf += x1 * x2;
        m += x1 * x1 + x2 * x2;
      }
      nsdf[tau] = m > 1e-12 ? (2 * acf) / m : 0;
    }

    // Find positive-going key maxima after first negative zero-crossing
    let pastFirstZero = false;
    let inPositiveRegion = false;
    let regionMaxVal = -1;
    let regionMaxTau = -1;

    const peaks = [];
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

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0 || input[0].length === 0) {
      return true;
    }

    const channel = input[0];
    const blockLen = channel.length;

    // 1. Write incoming samples to ring buffer and compute block RMS
    let sumSq = 0;
    for (let i = 0; i < blockLen; i++) {
      const s = channel[i];
      sumSq += s * s;
      this.ringBuffer[this.writeIndex] = s;
      this.writeIndex = (this.writeIndex + 1) % this.bufferSize;
    }
    const rms = Math.sqrt(sumSq / blockLen);

    // 2. Determine current target frequency for quadrature demodulation
    const activeMidi = this.lockedMidi !== null ? this.lockedMidi : this.lastAutoMidi;
    const targetHz = this.getTargetFrequency(activeMidi);

    // 3. Quadrature phase demodulator (runs every sample for true phase tracking)
    const phaseStep = (2 * Math.PI * targetHz) / sampleRate;
    const lpAlpha = 0.012;
    for (let i = 0; i < blockLen; i++) {
      const s = channel[i];
      const c = Math.cos(this.refPhase);
      const sn = -Math.sin(this.refPhase);
      this.iFilt += lpAlpha * (s * c - this.iFilt);
      this.qFilt += lpAlpha * (s * sn - this.qFilt);
      this.refPhase += phaseStep;
      if (this.refPhase >= 2 * Math.PI) {
        this.refPhase -= 2 * Math.PI;
      }
    }

    const demodPhase = Math.atan2(this.qFilt, this.iFilt);
    let dPhase = demodPhase - this.prevDemodPhase;
    if (dPhase > Math.PI) dPhase -= 2 * Math.PI;
    if (dPhase < -Math.PI) dPhase += 2 * Math.PI;
    this.prevDemodPhase = demodPhase;

    const dt = blockLen / sampleRate;
    const instVelHz = dPhase / (2 * Math.PI * dt);
    this.smoothedVelocityHz += 0.03 * (instVelHz - this.smoothedVelocityHz);

    this.samplesSinceHop += blockLen;
    if (this.samplesSinceHop < this.hopSize) {
      return true;
    }
    this.samplesSinceHop = 0;

    // Schmitt-trigger noise gate: higher threshold to open, lower threshold to stay open
    const gateThreshold = this.isGateOpen ? this.noiseGate * 0.45 : this.noiseGate;
    if (rms < gateThreshold) {
      if (this.holdFrames > 0) {
        this.holdFrames--;
        return true;
      }
      this.isGateOpen = false;
      this.port.postMessage({
        active: false,
        rms,
        clarity: 0,
      });
      return true;
    }

    // Linearize ring buffer for MPM
    const windowSamples = new Float32Array(this.bufferSize);
    const tailLen = this.bufferSize - this.writeIndex;
    windowSamples.set(this.ringBuffer.subarray(this.writeIndex), 0);
    windowSamples.set(this.ringBuffer.subarray(0, this.writeIndex), tailLen);

    const { hz, clarity } = this.detectPitchMPM(windowSamples);
    if (hz <= 0 || clarity < 0.72) {
      if (this.holdFrames > 0) {
        this.holdFrames--;
        return true;
      }
      this.isGateOpen = false;
      this.port.postMessage({
        active: false,
        rms,
        clarity,
      });
      return true;
    }
    this.isGateOpen = true;
    this.holdFrames = 18; // ~380ms holdover on decaying notes

    let midi = this.lockedMidi;
    if (midi === null) {
      const floatMidi = 69 + 12 * Math.log2(hz / this.a4Hz);
      const nearest = this.findNearestEnabledMidi(floatMidi);
      const lastPc = ((this.lastAutoMidi % 12) + 12) % 12;
      const lastEnabled = this.enabledByPc[lastPc];
      // Switch immediately if previous note was excluded, otherwise apply hysteresis
      if (!lastEnabled || (nearest !== this.lastAutoMidi && Math.abs(floatMidi - this.lastAutoMidi) > 0.65)) {
        this.lastAutoMidi = nearest;
        this.smoothedCents = 0;
      }
      midi = this.lastAutoMidi;
    }

    const finalTargetHz = this.getTargetFrequency(midi);
    const rawCents = Math.max(-100, Math.min(100, 1200 * Math.log2(hz / finalTargetHz)));
    this.smoothedCents += 0.22 * (rawCents - this.smoothedCents);
    const pc = ((midi % 12) + 12) % 12;
    const octave = Math.floor(midi / 12) - 1;

    // Derive strobe velocity directly from smoothed cent error so direction
    // is always strictly negative when flat and positive when sharp.
    const effectiveCents = Math.abs(this.smoothedCents) < 0.3 ? 0 : this.smoothedCents;
    const strobeVelocityHz = finalTargetHz * (Math.pow(2, effectiveCents / 1200) - 1);

    this.port.postMessage({
      active: true,
      midi,
      octave,
      pitchClass: pc,
      detectedHz: hz,
      targetHz: finalTargetHz,
      cents: this.smoothedCents,
      phaseVelocityHz: strobeVelocityHz,
      phase: demodPhase < 0 ? demodPhase + 2 * Math.PI : demodPhase,
      clarity,
      rms,
    });

    return true;
  }
}

registerProcessor('strobe-processor', StrobeProcessor);
