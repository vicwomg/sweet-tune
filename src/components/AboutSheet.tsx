import React from 'react';
import { X } from 'lucide-react';

interface AboutSheetProps {
  onClose: () => void;
}

export const AboutSheet: React.FC<AboutSheetProps> = ({ onClose }) => {
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex flex-col w-full max-w-md max-h-[85dvh] bg-zinc-950 border border-zinc-800 rounded-3xl overflow-hidden shadow-2xl"
      >
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-zinc-800/80 bg-zinc-900/50">
          <h2 className="font-['Michroma',sans-serif] text-base font-bold text-zinc-100">
            About SweetTune
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close about modal"
            className="p-2 rounded-full text-zinc-400 hover:text-zinc-200 active:scale-90 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-sm text-zinc-300 leading-relaxed overflow-y-auto">
          <p>
            <strong className="text-emerald-400">SweetTune</strong> is built for{' '}
            <strong className="text-zinc-100">multi-instrumentalists</strong> who need to
            switch between and program custom temperaments, sweetened tunings, and
            instrument-specific offsets with as little friction as possible.
          </p>

          <ul className="space-y-2 text-xs text-zinc-400 list-disc pl-4">
            <li>
              <strong className="text-zinc-200">One-tap switching:</strong> Pin up to 10
              temperaments right above the tuner; tap the active pill again to edit it.
            </li>
            <li>
              <strong className="text-zinc-200">Custom presets &amp; note filters:</strong>{' '}
              Set per-note cent offsets, sharp/flat spelling, key transposition, and
              include/exclude specific strings or notes.
            </li>
            <li>
              <strong className="text-zinc-200">Four live views:</strong> Circular strobe
              wheel, horizontal strobe bands, coarse/fine dial, and LED bars.
            </li>
            <li>
              <strong className="text-zinc-200">Note lock &amp; A4 calibration:</strong>{' '}
              Tap the note display to lock a target pitch, or tap <code className="text-zinc-200">A4 = 440 Hz</code> to adjust concert pitch.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
};
