import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Hand, Minus, Play, Plus, Square } from 'lucide-react';
import {
  disableIosSilentSwitchBypass,
  enableIosSilentSwitchBypass,
} from '../utils/iosAudioUnlock';
import { screenWakeManager } from '../utils/wakeLock';

interface MetronomeViewProps {
  bpm: number;
  onChangeBpm: (bpm: number) => void;
  beats: number;
  onChangeBeats: (beats: number) => void;
  accents: boolean[];
  onToggleAccent: (index: number) => void;
}

const MIN_BPM = 30;
const MAX_BPM = 260;

export const MetronomeView: React.FC<MetronomeViewProps> = ({
  bpm,
  onChangeBpm,
  beats,
  onChangeBeats,
  accents,
  onToggleAccent,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentBeat, setCurrentBeat] = useState<number>(-1);

  const ctxRef = useRef<AudioContext | null>(null);
  const schedulerIdRef = useRef<number | null>(null);
  const visualTimeoutsRef = useRef<number[]>([]);
  const nextNoteTimeRef = useRef<number>(0);
  const nextBeatIndexRef = useRef<number>(0);
  const tapTimesRef = useRef<number[]>([]);

  // Horizontal pendulum animation state synced to AudioContext.currentTime
  const trackElRef = useRef<HTMLDivElement | null>(null);
  const bobElRef = useRef<HTMLDivElement | null>(null);
  const centerTickElRef = useRef<HTMLDivElement | null>(null);
  const swingCountRef = useRef<number>(0);
  const swingsRef = useRef<
    { startTime: number; duration: number; dir: 1 | -1; isAccent: boolean }[]
  >([]);

  // Keep latest props accessible inside the lookahead scheduler without restarting it
  const bpmRef = useRef(bpm);
  const beatsRef = useRef(beats);
  const accentsRef = useRef(accents);

  useEffect(() => {
    bpmRef.current = bpm;
  }, [bpm]);

  useEffect(() => {
    beatsRef.current = beats;
    if (nextBeatIndexRef.current >= beats) {
      nextBeatIndexRef.current = 0;
    }
  }, [beats]);

  useEffect(() => {
    accentsRef.current = accents;
  }, [accents]);

  const clearVisualTimeouts = useCallback(() => {
    visualTimeoutsRef.current.forEach((id) => window.clearTimeout(id));
    visualTimeoutsRef.current = [];
  }, []);

  const scheduleClick = useCallback((time: number, beatIndex: number) => {
    const ctx = ctxRef.current;
    if (!ctx) return;

    const isAccent = Boolean(accentsRef.current[beatIndex]);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(isAccent ? 1320 : 880, time);

    const peakGain = isAccent ? 0.55 : 0.3;
    const decay = isAccent ? 0.05 : 0.035;

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(peakGain, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + decay);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(time);
    osc.stop(time + decay + 0.01);

    const secondsPerBeat = 60 / bpmRef.current;
    const dir: 1 | -1 = swingCountRef.current % 2 === 0 ? 1 : -1;
    swingCountRef.current += 1;
    swingsRef.current.push({
      startTime: time,
      duration: secondsPerBeat,
      dir,
      isAccent,
    });
    if (swingsRef.current.length > 8) {
      swingsRef.current.shift();
    }

    const delayMs = Math.max(0, (time - ctx.currentTime) * 1000);
    const timeoutId = window.setTimeout(() => {
      setCurrentBeat(beatIndex);
      screenWakeManager.ping();
    }, delayMs);
    visualTimeoutsRef.current.push(timeoutId);
  }, []);

  const stopMetronome = useCallback(() => {
    if (schedulerIdRef.current !== null) {
      window.clearInterval(schedulerIdRef.current);
      schedulerIdRef.current = null;
    }
    clearVisualTimeouts();
    swingsRef.current = [];
    swingCountRef.current = 0;
    setIsPlaying(false);
    setCurrentBeat(-1);
    disableIosSilentSwitchBypass();
  }, [clearVisualTimeouts]);

  const startMetronome = useCallback(async () => {
    enableIosSilentSwitchBypass(true);
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

    if (!ctxRef.current) {
      ctxRef.current = new AudioCtx();
    }
    const ctx = ctxRef.current;
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    nextBeatIndexRef.current = 0;
    swingCountRef.current = 0;
    swingsRef.current = [];
    nextNoteTimeRef.current = ctx.currentTime + 0.04;
    setIsPlaying(true);

    const lookaheadMs = 25;
    const scheduleAheadSec = 0.1;

    schedulerIdRef.current = window.setInterval(() => {
      const audioCtx = ctxRef.current;
      if (!audioCtx) return;

      while (nextNoteTimeRef.current < audioCtx.currentTime + scheduleAheadSec) {
        const beatIdx = nextBeatIndexRef.current;
        scheduleClick(nextNoteTimeRef.current, beatIdx);

        const secondsPerBeat = 60 / bpmRef.current;
        nextNoteTimeRef.current += secondsPerBeat;
        nextBeatIndexRef.current = (beatIdx + 1) % beatsRef.current;
      }
    }, lookaheadMs);
  }, [scheduleClick]);

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      stopMetronome();
    } else {
      void startMetronome();
    }
  }, [isPlaying, startMetronome, stopMetronome]);

  useEffect(() => {
    let rafId = 0;

    const animate = () => {
      const trackEl = trackElRef.current;
      const bobEl = bobElRef.current;
      const centerTickEl = centerTickElRef.current;
      const ctx = ctxRef.current;

      if (trackEl && bobEl) {
        const trackW = trackEl.clientWidth;
        const bobW = 24;
        const maxOffset = Math.max(0, (trackW - bobW - 16) / 2);

        if (!isPlaying || !ctx || swingsRef.current.length === 0) {
          bobEl.style.transform = 'translate3d(0px, 0, 0) scale(1)';
          bobEl.style.backgroundColor = '#71717a';
          bobEl.style.boxShadow = 'none';
          bobEl.style.opacity = '0.5';
          if (centerTickEl) {
            centerTickEl.style.backgroundColor = '#3f3f46';
            centerTickEl.style.boxShadow = 'none';
          }
        } else {
          const now = ctx.currentTime;
          const list = swingsRef.current;
          let active = list[0];
          for (let i = list.length - 1; i >= 0; i--) {
            if (now >= list[i].startTime) {
              active = list[i];
              break;
            }
          }

          const rawU = (now - active.startTime) / Math.max(0.05, active.duration);
          const u = Math.max(0, Math.min(1, rawU));

          // Simple harmonic pendulum motion crossing center (x = 0) on every beat (u = 0, 1):
          // Swings out to +dir apex at u = 0.5, then returns through center at u = 1.0
          const normX = now < active.startTime ? 0 : active.dir * Math.sin(Math.PI * u);
          const px = normX * maxOffset;

          // Brief flash right when crossing the center on the beat (u near 0)
          const pulse = now >= active.startTime ? Math.max(0, Math.exp(-u * 7.5)) : 0;
          const scale = 1 + 0.22 * pulse;

          bobEl.style.transform = `translate3d(${px.toFixed(2)}px, 0, 0) scale(${scale.toFixed(3)})`;
          bobEl.style.opacity = (0.45 + 0.55 * pulse).toFixed(3);

          if (active.isAccent) {
            bobEl.style.backgroundColor = pulse > 0.15 ? '#34d399' : '#10b981';
            bobEl.style.boxShadow =
              pulse > 0.08
                ? `0 0 ${(22 * pulse).toFixed(1)}px rgba(52, 211, 153, ${(0.95 * pulse).toFixed(2)})`
                : 'none';
          } else {
            bobEl.style.backgroundColor = pulse > 0.15 ? '#ffffff' : '#a1a1aa';
            bobEl.style.boxShadow =
              pulse > 0.08
                ? `0 0 ${(18 * pulse).toFixed(1)}px rgba(255, 255, 255, ${(0.85 * pulse).toFixed(2)})`
                : 'none';
          }

          if (centerTickEl) {
            if (pulse > 0.1) {
              const tickColor = active.isAccent ? '#34d399' : '#f4f4f5';
              centerTickEl.style.backgroundColor = tickColor;
              centerTickEl.style.boxShadow = active.isAccent
                ? `0 0 10px rgba(52, 211, 153, ${(0.8 * pulse).toFixed(2)})`
                : `0 0 8px rgba(244, 244, 245, ${(0.7 * pulse).toFixed(2)})`;
            } else {
              centerTickEl.style.backgroundColor = '#3f3f46';
              centerTickEl.style.boxShadow = 'none';
            }
          }
        }
      }

      rafId = requestAnimationFrame(animate);
    };

    rafId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying]);

  useEffect(() => {
    return () => {
      if (schedulerIdRef.current !== null) {
        window.clearInterval(schedulerIdRef.current);
      }
      clearVisualTimeouts();
      disableIosSilentSwitchBypass();
      if (ctxRef.current) {
        void ctxRef.current.close();
        ctxRef.current = null;
      }
    };
  }, [clearVisualTimeouts]);

  const handleTapTempo = () => {
    const now = performance.now();
    const taps = tapTimesRef.current;
    if (taps.length > 0 && now - taps[taps.length - 1] > 2000) {
      tapTimesRef.current = [now];
      return;
    }

    taps.push(now);
    if (taps.length > 6) {
      taps.shift();
    }

    if (taps.length >= 2) {
      let totalInterval = 0;
      for (let i = 1; i < taps.length; i++) {
        totalInterval += taps[i] - taps[i - 1];
      }
      const avgMs = totalInterval / (taps.length - 1);
      const nextBpm = Math.round(60000 / avgMs);
      onChangeBpm(Math.max(MIN_BPM, Math.min(MAX_BPM, nextBpm)));
    }
  };

  const stepBpm = (delta: number) => {
    onChangeBpm(Math.max(MIN_BPM, Math.min(MAX_BPM, bpm + delta)));
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-between w-full max-w-md mx-auto px-4 py-4 select-none min-h-0">
      {/* Beat Dots Grid (up to 12 beats: 4 dots x 3 rows) */}
      <div className="w-full flex flex-col items-center gap-3">
        <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-300 text-center">
          Metronome
        </h2>

        <div className="flex flex-col items-center gap-2.5 w-full">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400 text-center">
            Beats · Tap dot to accent
          </span>
          <div className="flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={() => onChangeBeats(Math.max(1, beats - 1))}
              disabled={beats <= 1}
              aria-label="Decrease beats"
              className="w-11 h-11 flex items-center justify-center rounded-full bg-zinc-900 border border-zinc-800 text-zinc-200 disabled:opacity-35 active:scale-90 transition"
            >
              <Minus className="w-4 h-4" />
            </button>
            <span className="w-8 text-center font-mono text-lg font-bold text-zinc-100">
              {beats}
            </span>
            <button
              type="button"
              onClick={() => onChangeBeats(Math.min(12, beats + 1))}
              disabled={beats >= 12}
              aria-label="Increase beats"
              className="w-11 h-11 flex items-center justify-center rounded-full bg-zinc-900 border border-zinc-800 text-zinc-200 disabled:opacity-35 active:scale-90 transition"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-3.5 py-2">
          {Array.from({ length: beats }, (_, i) => {
            const isAccent = Boolean(accents[i]);
            const isCurrent = isPlaying && currentBeat === i;

            return (
              <button
                key={i}
                type="button"
                onClick={() => onToggleAccent(i)}
                aria-label={`Beat ${i + 1}${isAccent ? ' (accented)' : ''}`}
                className={`w-13 h-13 rounded-full flex items-center justify-center font-mono text-sm font-bold border-2 transition-all duration-75 active:scale-90 ${
                  isCurrent
                    ? isAccent
                      ? 'bg-emerald-400 border-emerald-300 text-zinc-950 scale-110 shadow-[0_0_18px_rgba(52,211,153,0.75)]'
                      : 'bg-zinc-100 border-white text-zinc-950 scale-105 shadow-[0_0_14px_rgba(244,244,245,0.6)]'
                    : isAccent
                      ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                      : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:border-zinc-500'
                }`}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tempo Readout & Controls */}
      <div className="w-full flex flex-col items-center gap-3 my-auto">
        {/* Horizontal Harmonic Pendulum Track */}
        <div
          ref={trackElRef}
          aria-label="Horizontal metronome pendulum"
          className="relative w-full h-11 rounded-2xl bg-zinc-900/90 border border-zinc-800 flex items-center justify-center overflow-hidden px-2"
        >
          {/* Horizontal guide line & scale ticks */}
          <div className="absolute left-4 right-4 h-px bg-zinc-800" />
          <div className="absolute left-1/4 h-2.5 w-px bg-zinc-800" />
          <div
            ref={centerTickElRef}
            className="absolute left-1/2 h-6 w-0.5 -translate-x-1/2 bg-zinc-700 rounded-full transition-colors duration-75"
          />
          <div className="absolute left-3/4 h-2.5 w-px bg-zinc-800" />

          {/* Swinging pendulum bob */}
          <div
            ref={bobElRef}
            className="relative z-10 w-6 h-6 rounded-full will-change-transform"
            style={{ backgroundColor: '#71717a', opacity: 0.5, transform: 'translate3d(0px, 0, 0)' }}
          />
        </div>

        <div className="flex flex-col items-center">
          <span className="font-mono text-6xl font-black tracking-tight text-zinc-50">
            {bpm}
          </span>
          <span className="text-xs font-bold uppercase tracking-widest text-zinc-500">
            BPM
          </span>
        </div>

        <input
          type="range"
          min={MIN_BPM}
          max={MAX_BPM}
          step={1}
          value={bpm}
          onChange={(e) => onChangeBpm(parseInt(e.target.value, 10))}
          aria-label="Tempo BPM"
          className="w-full h-7 accent-emerald-500 cursor-pointer"
        />

        <div className="grid grid-cols-4 gap-2 w-full">
          {[-5, -1, 1, 5].map((delta) => (
            <button
              key={delta}
              type="button"
              onClick={() => stepBpm(delta)}
              className="py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-xs font-mono font-bold text-zinc-200 active:scale-95 transition"
            >
              {delta > 0 ? `+${delta}` : delta}
            </button>
          ))}
        </div>
      </div>

      {/* Play/Stop & Tap Tempo */}
      <div className="w-full grid grid-cols-2 gap-3 pt-2 pb-2">
        <button
          type="button"
          onClick={togglePlay}
          className={`flex items-center justify-center gap-2 py-4 rounded-2xl font-bold text-base shadow-lg active:scale-95 transition ${
            isPlaying
              ? 'bg-rose-500 text-zinc-950 shadow-rose-500/20'
              : 'bg-emerald-500 text-zinc-950 shadow-emerald-500/20'
          }`}
        >
          {isPlaying ? (
            <>
              <Square className="w-4 h-4 fill-current" />
              <span>Stop</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-current" />
              <span>Start</span>
            </>
          )}
        </button>

        <button
          type="button"
          onClick={handleTapTempo}
          className="flex items-center justify-center gap-2 py-4 rounded-2xl bg-zinc-900 border border-zinc-700 text-zinc-100 font-bold text-base active:scale-95 active:bg-zinc-800 transition"
        >
          <Hand className="w-4 h-4 text-purple-400" />
          <span>Tap</span>
        </button>
      </div>
    </div>
  );
};
