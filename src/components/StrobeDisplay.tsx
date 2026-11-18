import React, { useEffect, useRef } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Lock,
  Mic,
  Unlock,
} from 'lucide-react';
import { formatNoteName, getEffectiveOffsetCents } from '../audio/temperaments';
import type { NoteName, StrobeStyle, TemperamentPreset, TunerFrame } from '../types/tuner';

interface StrobeDisplayProps {
  frameRef: React.MutableRefObject<TunerFrame>;
  isListening: boolean;
  onStartTuner: () => void;
  strobeStyle: StrobeStyle;
  lockedMidi: number | null;
  onToggleLock: (currentMidi: number) => void;
  onStepLockedMidi: (delta: number) => void;
  useFlats: boolean;
  activePreset: TemperamentPreset;
  rootNote: NoteName;
  a4Hz: number;
  onOpenSettings: () => void;
}

export const StrobeDisplay: React.FC<StrobeDisplayProps> = ({
  frameRef,
  isListening,
  onStartTuner,
  strobeStyle,
  lockedMidi,
  onToggleLock,
  onStepLockedMidi,
  useFlats,
  activePreset,
  rootNote,
  a4Hz,
  onOpenSettings,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const noteElRef = useRef<HTMLSpanElement | null>(null);
  const octaveElRef = useRef<HTMLSpanElement | null>(null);
  const centsElRef = useRef<HTMLSpanElement | null>(null);
  const targetHzElRef = useRef<HTMLSpanElement | null>(null);
  const offsetElRef = useRef<HTMLSpanElement | null>(null);
  const statusPillRef = useRef<HTMLDivElement | null>(null);

  const rotationRef = useRef(0);
  const smoothedCentsRef = useRef(0);
  const smoothedVelRef = useRef(0);
  const activeAlphaRef = useRef(0.25);
  const lastDisplayMidiRef = useRef(69);
  const lastTextUpdateRef = useRef(0);

  useEffect(() => {
    let rafId = 0;
    let lastTime = performance.now();

    const render = (now: number) => {
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      const frame = frameRef.current;
      const isActive = isListening && frame.active;

      const targetAlpha = isActive ? 0.9 : 0.25;
      activeAlphaRef.current += (isActive ? 0.25 : 0.08) * (targetAlpha - activeAlphaRef.current);

      if (isActive) {
        smoothedCentsRef.current += 0.08 * (frame.cents - smoothedCentsRef.current);
        smoothedVelRef.current += 0.1 * (frame.phaseVelocityHz - smoothedVelRef.current);
        lastDisplayMidiRef.current = frame.midi;
        // Convert phaseVelocityHz into readable visual radians/sec
        const vel = Math.max(-6, Math.min(6, smoothedVelRef.current));
        rotationRef.current += vel * Math.PI * 0.22 * dt;
      } else {
        smoothedCentsRef.current *= 0.92;
        smoothedVelRef.current *= 0.9;
      }

      const displayMidi = lockedMidi !== null ? lockedMidi : lastDisplayMidiRef.current;
      const pc = ((displayMidi % 12) + 12) % 12;
      const octave = Math.floor(displayMidi / 12) - 1;
      const noteText = formatNoteName(pc, useFlats);

      const cents = smoothedCentsRef.current;
      const inTune = isActive && Math.abs(cents) <= 1.5;
      const close = isActive && Math.abs(cents) <= 6.0;

      // Throttle numeric/text updates to ~9 Hz so digits don't blur
      if (now - lastTextUpdateRef.current >= 110) {
        lastTextUpdateRef.current = now;

        if (noteElRef.current) noteElRef.current.textContent = noteText;
        if (octaveElRef.current) octaveElRef.current.textContent = String(octave);

        if (centsElRef.current) {
          if (!isActive) {
            centsElRef.current.textContent = '---';
            centsElRef.current.className = 'font-mono text-2xl font-semibold tracking-tight text-zinc-500';
          } else {
            const sign = cents > 0.05 ? '+' : '';
            centsElRef.current.textContent = `${sign}${cents.toFixed(1)}`;
            centsElRef.current.className = `font-mono text-2xl font-semibold tracking-tight transition-colors ${
              inTune
                ? 'text-emerald-400'
                : close
                  ? 'text-amber-300'
                  : cents < 0
                    ? 'text-sky-400'
                    : 'text-rose-400'
            }`;
          }
        }

        if (targetHzElRef.current && offsetElRef.current) {
          const equalHz = a4Hz * Math.pow(2, (displayMidi - 69) / 12);
          const midiOverride = activePreset.midiOffsets?.[displayMidi];
          const offsetCents =
            typeof midiOverride === 'number'
              ? midiOverride
              : getEffectiveOffsetCents(pc, activePreset, rootNote);
          const targetHz = equalHz * Math.pow(2, offsetCents / 1200);
          targetHzElRef.current.textContent = `${targetHz.toFixed(2)} Hz · `;

          const isZero = Math.abs(offsetCents) < 0.05;
          offsetElRef.current.textContent = isZero
            ? '0.0'
            : `${offsetCents > 0 ? '+' : ''}${offsetCents.toFixed(1)}`;
          offsetElRef.current.className = isZero
            ? 'text-zinc-400'
            : offsetCents > 0
              ? 'text-sky-400 font-semibold'
              : 'text-rose-400 font-semibold';
        }

        if (statusPillRef.current) {
          statusPillRef.current.style.opacity = inTune ? '1' : '0';
        }
      }

      // Draw Canvas
      const canvas = canvasRef.current;
      if (canvas) {
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        const w = Math.max(1, Math.floor(rect.width * dpr));
        const h = Math.max(1, Math.floor(rect.height * dpr));
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }

        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.save();
          ctx.scale(dpr, dpr);
          ctx.clearRect(0, 0, rect.width, rect.height);

          const accent = !isActive
            ? '#3f3f46'
            : inTune
              ? '#34d399'
              : close
                ? '#fbbf24'
                : cents < 0
                  ? '#38bdf8'
                  : '#fb7185';

          if (strobeStyle === 'circle') {
            drawCircleStrobe(
              ctx,
              rect.width,
              rect.height,
              rotationRef.current,
              accent,
              activeAlphaRef.current,
              inTune
            );
          } else if (strobeStyle === 'horizontal') {
            drawHorizontalStrobe(
              ctx,
              rect.width,
              rect.height,
              rotationRef.current,
              accent,
              activeAlphaRef.current,
              inTune
            );
          } else if (strobeStyle === 'dial') {
            drawDialMeter(
              ctx,
              rect.width,
              rect.height,
              cents,
              accent,
              activeAlphaRef.current,
              isActive,
              inTune
            );
          } else {
            drawLedBarsMeter(
              ctx,
              rect.width,
              rect.height,
              cents,
              activeAlphaRef.current,
              isActive,
              inTune
            );
          }

          ctx.restore();
        }
      }

      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, [frameRef, isListening, strobeStyle, lockedMidi, useFlats, activePreset, rootNote, a4Hz]);

  return (
    <div className="relative flex flex-1 flex-col items-center justify-center w-full max-w-md mx-auto px-2 select-none min-h-0">
      {/* Canvas Strobe Area */}
      <div className="relative w-full aspect-square max-h-full flex items-center justify-center">
        <canvas
          ref={canvasRef}
          className={`w-full h-full block transition-opacity duration-200 ${
            isListening ? 'opacity-100' : 'opacity-30'
          }`}
        />

        {/* Center Overlay: Start Tuner when idle, Note/Cents readout when listening */}
        {!isListening ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <button
              type="button"
              onClick={onStartTuner}
              className="flex items-center gap-2.5 px-7 py-4 rounded-2xl bg-emerald-500 text-zinc-950 font-bold text-base shadow-xl shadow-emerald-500/25 active:scale-95 transition"
            >
              <Mic className="w-5 h-5" />
              <span>Start Tuner</span>
            </button>
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div
            ref={statusPillRef}
            className="mb-1 rounded-full bg-emerald-500/20 border border-emerald-400/50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-emerald-300 transition-opacity duration-150"
            style={{ opacity: 0 }}
          >
            In Tune
          </div>

          <button
            type="button"
            onClick={onOpenSettings}
            className="pointer-events-auto mb-1.5 rounded-full bg-zinc-900/85 border border-zinc-800 px-2.5 py-0.5 text-[11px] font-mono font-semibold text-zinc-400 hover:text-zinc-200 active:scale-95 transition"
          >
            A4 = {a4Hz} Hz
          </button>

          <div className="flex items-center gap-2 pointer-events-auto">
            {lockedMidi !== null && (
              <button
                type="button"
                onClick={() => onStepLockedMidi(-1)}
                aria-label="Previous note"
                className="p-2 rounded-full bg-zinc-900/80 border border-zinc-700/70 text-zinc-300 active:scale-90 transition"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}

            <button
              type="button"
              onClick={() => onToggleLock(lastDisplayMidiRef.current)}
              title={lockedMidi !== null ? 'Unlock note' : 'Lock current note'}
              className="group flex items-baseline gap-1 px-4 py-2 rounded-2xl bg-zinc-950/75 backdrop-blur-sm border border-zinc-800/80 active:scale-95 transition"
            >
              <span
                ref={noteElRef}
                className="text-5xl font-black tracking-tight text-zinc-50"
              >
                A
              </span>
              <span
                ref={octaveElRef}
                className="text-xl font-bold text-zinc-400"
              >
                4
              </span>
              <span className="ml-1.5 self-center text-zinc-400">
                {lockedMidi !== null ? (
                  <Lock className="w-4 h-4 text-amber-400" />
                ) : (
                  <Unlock className="w-3.5 h-3.5 opacity-50 group-hover:opacity-100" />
                )}
              </span>
            </button>

            {lockedMidi !== null && (
              <button
                type="button"
                onClick={() => onStepLockedMidi(1)}
                aria-label="Next note"
                className="p-2 rounded-full bg-zinc-900/80 border border-zinc-700/70 text-zinc-300 active:scale-90 transition"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="mt-2">
            <span ref={centsElRef} className="font-mono text-2xl font-semibold text-zinc-500">
              ---
            </span>
          </div>

          <span className="mt-1 font-mono text-xs text-zinc-400 bg-zinc-950/70 px-2.5 py-0.5 rounded-full">
            <span ref={targetHzElRef}>440.00 Hz · </span>
            <span ref={offsetElRef} className="text-zinc-400">0.0</span>
          </span>
        </div>
        )}
      </div>
    </div>
  );
};

function drawCircleStrobe(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  angle: number,
  accent: string,
  alpha: number,
  inTune: boolean
) {
  const cx = w / 2;
  const cy = h / 2;
  const maxR = Math.min(w, h) * 0.485;

  // Subtle outer bezel
  ctx.beginPath();
  ctx.arc(cx, cy, maxR, 0, Math.PI * 2);
  ctx.strokeStyle = inTune ? 'rgba(52, 211, 153, 0.35)' : 'rgba(63, 63, 70, 0.6)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // 3 concentric strobe rings (1x, 2x, 4x harmonic densities)
  const rings = [
    { rInner: maxR * 0.62, rOuter: maxR * 0.72, segments: 12, speedMult: 1 },
    { rInner: maxR * 0.74, rOuter: maxR * 0.85, segments: 24, speedMult: 2 },
    { rInner: maxR * 0.87, rOuter: maxR * 0.97, segments: 36, speedMult: 3 },
  ];

  for (const ring of rings) {
    const rMid = (ring.rInner + ring.rOuter) / 2;
    const thickness = ring.rOuter - ring.rInner;
    const step = (Math.PI * 2) / ring.segments;
    const arcLen = step * 0.48;
    const phaseOffset = angle * ring.speedMult;

    for (let i = 0; i < ring.segments; i++) {
      const start = i * step + phaseOffset;
      ctx.beginPath();
      ctx.arc(cx, cy, rMid, start, start + arcLen);
      ctx.strokeStyle = accent;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = thickness;
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

function drawHorizontalStrobe(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  phase: number,
  accent: string,
  alpha: number,
  inTune: boolean
) {
  const padX = 6;
  const bandW = w - padX * 2;
  const bandH = Math.max(24, Math.min(34, h * 0.075));
  const gap = 6;
  const groupH = bandH * 2 + gap;
  const topY = h * 0.14 - groupH / 2;
  const botY = h * 0.86 - groupH / 2;
  const bands = [
    { y: topY, height: bandH, count: 10, mult: 1 },
    { y: topY + bandH + gap, height: bandH, count: 18, mult: 2 },
    { y: botY, height: bandH, count: 18, mult: 2 },
    { y: botY + bandH + gap, height: bandH, count: 10, mult: 1 },
  ];

  // Center reference ticks
  ctx.strokeStyle = inTune ? 'rgba(52, 211, 153, 0.7)' : 'rgba(113, 113, 122, 0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(w / 2, topY - 6);
  ctx.lineTo(w / 2, topY + bandH * 2 + gap + 6);
  ctx.moveTo(w / 2, botY - 6);
  ctx.lineTo(w / 2, botY + bandH * 2 + gap + 6);
  ctx.stroke();

  for (const band of bands) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(padX, band.y, bandW, band.height, 6);
    ctx.clip();

    ctx.fillStyle = 'rgba(24, 24, 27, 0.85)';
    ctx.fillRect(padX, band.y, bandW, band.height);

    const period = bandW / band.count;
    const blockW = period * 0.48;
    const shift = (((phase * band.mult) / (Math.PI * 2)) * period) % period;

    ctx.fillStyle = accent;
    ctx.globalAlpha = alpha;

    for (let x = padX - period * 2 + shift; x < padX + bandW + period; x += period) {
      ctx.fillRect(x, band.y + 2, blockW, band.height - 4);
    }

    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function drawDialMeter(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cents: number,
  accent: string,
  alpha: number,
  isActive: boolean,
  inTune: boolean
) {
  const padX = 16;
  const trackW = w - padX * 2;
  const centerX = w / 2;

  const drawScale = (
    scaleY: number,
    range: number,
    step: number,
    labeledSet: Set<number>
  ) => {
    const clamped = Math.max(-range, Math.min(range, cents));
    const norm = clamped / range; // -1..+1

    // Background track
    ctx.fillStyle = 'rgba(24, 24, 27, 0.85)';
    ctx.beginPath();
    ctx.roundRect(padX - 6, scaleY - 22, trackW + 12, 48, 12);
    ctx.fill();

    // Center in-tune zone (-1.5 to +1.5 cents)
    const zoneW = Math.min(trackW, (3 / (range * 2)) * trackW);
    ctx.fillStyle = inTune ? 'rgba(52, 211, 153, 0.25)' : 'rgba(52, 211, 153, 0.1)';
    ctx.fillRect(centerX - zoneW / 2, scaleY - 14, zoneW, 24);

    // Horizontal baseline
    ctx.strokeStyle = 'rgba(82, 82, 91, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(padX, scaleY + 10);
    ctx.lineTo(padX + trackW, scaleY + 10);
    ctx.stroke();

    // Ticks
    ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'center';
    for (let c = -range; c <= range; c += step) {
      const x = centerX + (c / range) * (trackW / 2);
      const isLabeled = labeledSet.has(c);
      const tickH = c === 0 ? 18 : isLabeled ? 13 : 8;

      ctx.strokeStyle = c === 0 ? '#34d399' : 'rgba(161, 161, 170, 0.7)';
      ctx.lineWidth = c === 0 ? 2 : 1.25;
      ctx.beginPath();
      ctx.moveTo(x, scaleY + 10);
      ctx.lineTo(x, scaleY + 10 - tickH);
      ctx.stroke();

      if (isLabeled) {
        ctx.fillStyle = c === 0 ? '#34d399' : '#a1a1aa';
        ctx.fillText(c > 0 ? `+${c}` : String(c), x, scaleY + 22);
      }
    }

    // Needle / pointer
    const needleX = isActive ? centerX + norm * (trackW / 2) : centerX;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = accent;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(needleX, scaleY - 18);
    ctx.lineTo(needleX, scaleY + 12);
    ctx.stroke();

    // Top triangle marker
    ctx.beginPath();
    ctx.moveTo(needleX, scaleY - 10);
    ctx.lineTo(needleX - 6, scaleY - 20);
    ctx.lineTo(needleX + 6, scaleY - 20);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  const topY = h * 0.14;
  const botY = h * 0.86;

  // Coarse -25 to +25 on top, Fine -5 to +5 on bottom
  drawScale(topY, 25, 5, new Set([-25, -15, -5, 0, 5, 15, 25]));
  drawScale(botY, 5, 1, new Set([-5, -3, -1, 0, 1, 3, 5]));
}

function drawLedBarsMeter(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cents: number,
  alpha: number,
  isActive: boolean,
  inTune: boolean
) {
  const padX = 10;
  const totalW = w - padX * 2;
  const sideCount = 12; // 12 flat + 1 center + 12 sharp = 25 LEDs
  const totalCols = sideCount * 2 + 1;
  const gap = 3;
  const barW = (totalW - gap * (totalCols - 1)) / totalCols;
  const barH = 38;
  const topY = h * 0.14 - barH / 2;
  const botY = h * 0.86 - barH / 2;

  const drawRow = (y: number, range: number) => {
    const clamped = Math.max(-range, Math.min(range, cents));
    const litSteps = isActive ? Math.round((Math.abs(clamped) / range) * sideCount) : 0;
    const isFlat = clamped < 0;

    for (let i = -sideCount; i <= sideCount; i++) {
      const colIdx = i + sideCount;
      const x = padX + colIdx * (barW + gap);

      let lit = false;
      if (isActive) {
        if (i === 0) {
          lit = inTune || Math.abs(clamped) < range * 0.09;
        } else if (isFlat && i < 0 && Math.abs(i) <= litSteps) {
          lit = true;
        } else if (!isFlat && i > 0 && i <= litSteps) {
          lit = true;
        }
      }

      let color = 'rgba(39, 39, 42, 0.9)';
      if (lit) {
        if (i === 0) {
          color = '#34d399';
        } else if (Math.abs(i) <= 3) {
          color = '#fbbf24';
        } else if (i < 0) {
          color = '#38bdf8';
        } else {
          color = '#fb7185';
        }
      }

      ctx.save();
      ctx.globalAlpha = lit ? alpha : 0.65;
      ctx.fillStyle = color;
      ctx.beginPath();
      const hAdj = i === 0 ? barH + 8 : barH;
      const yAdj = i === 0 ? y - 4 : y;
      ctx.roundRect(x, yAdj, barW, hAdj, 3);
      ctx.fill();
      ctx.restore();
    }

    // Scale labels under row
    ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = '#71717a';
    ctx.textAlign = 'left';
    ctx.fillText(`-${range}`, padX, y + barH + 14);
    ctx.textAlign = 'center';
    ctx.fillStyle = inTune ? '#34d399' : '#a1a1aa';
    ctx.fillText('0', w / 2, y + barH + 14);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#71717a';
    ctx.fillText(`+${range}`, w - padX, y + barH + 14);
  };

  drawRow(topY, 25);
  drawRow(botY, 5);
}
