import { NOTE_NAMES, type NoteName, type TemperamentPreset, type TunerFrame } from '../types/tuner';
import { getEffectiveEnabledNotes, getEffectiveOffsetCents } from './temperaments';

export interface AudioEngineConfig {
  a4Hz: number;
  lockedMidi: number | null;
  preset: TemperamentPreset;
  rootNote: NoteName;
  noiseGate: number;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private silentGain: GainNode | null = null;
  private refOsc: OscillatorNode | null = null;
  private refGain: GainNode | null = null;
  private onFrame: (frame: TunerFrame) => void;

  constructor(onFrame: (frame: TunerFrame) => void) {
    this.onFrame = onFrame;
  }

  async start(config: AudioEngineConfig): Promise<void> {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }
      this.updateConfig(config);
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    const trackSettings = stream.getAudioTracks()[0]?.getSettings();
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctxOptions: AudioContextOptions = { latencyHint: 'balanced' };
    if (trackSettings?.sampleRate && Number.isFinite(trackSettings.sampleRate)) {
      ctxOptions.sampleRate = trackSettings.sampleRate;
    }
    const ctx = new AudioCtx(ctxOptions);

    await ctx.audioWorklet.addModule('/strobe-processor.worklet.js');

    const source = ctx.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(ctx, 'strobe-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
    });

    // Connect through a zero-gain node to destination so iOS Safari
    // reliably schedules every AudioWorklet render quantum without dropping frames.
    const silentGain = ctx.createGain();
    silentGain.gain.value = 0;

    worklet.port.onmessage = (event: MessageEvent<Partial<TunerFrame>>) => {
      const d = event.data;
      this.onFrame({
        active: Boolean(d.active),
        midi: d.midi ?? 69,
        octave: d.octave ?? 4,
        pitchClass: d.pitchClass ?? 9,
        detectedHz: d.detectedHz ?? 0,
        targetHz: d.targetHz ?? config.a4Hz,
        cents: d.cents ?? 0,
        phaseVelocityHz: d.phaseVelocityHz ?? 0,
        phase: d.phase ?? 0,
        clarity: d.clarity ?? 0,
        rms: d.rms ?? 0,
      });
    };

    source.connect(worklet);
    worklet.connect(silentGain);
    silentGain.connect(ctx.destination);

    this.ctx = ctx;
    this.stream = stream;
    this.source = source;
    this.worklet = worklet;
    this.silentGain = silentGain;

    this.updateConfig(config);
  }

  updateConfig(config: AudioEngineConfig): void {
    if (!this.worklet) return;
    const offsetsByPc = NOTE_NAMES.map((_, idx) =>
      getEffectiveOffsetCents(idx, config.preset, config.rootNote)
    );
    const enabledByPc = getEffectiveEnabledNotes(config.preset, config.rootNote);
    this.worklet.port.postMessage({
      type: 'config',
      a4Hz: config.a4Hz,
      lockedMidi: config.lockedMidi,
      offsetsByPc,
      midiOffsets: config.preset.midiOffsets ?? null,
      enabledByPc,
      noiseGate: config.noiseGate,
    });
  }

  async playReferenceTone(hz: number): Promise<void> {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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
    if (this.silentGain) {
      this.silentGain.disconnect();
      this.silentGain = null;
    }
    if (this.worklet) {
      this.worklet.disconnect();
      this.worklet.port.onmessage = null;
      this.worklet = null;
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
