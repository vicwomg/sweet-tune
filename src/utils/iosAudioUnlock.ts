interface NavigatorWithAudioSession extends Navigator {
  audioSession?: {
    type: 'auto' | 'playback' | 'transient' | 'transient-solo' | 'ambient' | 'play-and-record';
  };
}

let silentAudioEl: HTMLAudioElement | null = null;
let silentWavUrl: string | null = null;

function getSilentWavUrl(): string {
  if (silentWavUrl) return silentWavUrl;

  // Generate a valid 0.1s 8kHz mono 16-bit PCM silent WAV in memory
  const sampleRate = 8000;
  const numSamples = 800;
  const dataBytes = numSamples * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buf);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) {
      view.setUint8(offset + i, s.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format = 1
  view.setUint16(22, 1, true); // 1 channel (mono)
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, dataBytes, true);

  const blob = new Blob([buf], { type: 'audio/wav' });
  silentWavUrl = URL.createObjectURL(blob);
  return silentWavUrl;
}

/**
 * Forces iOS Safari / Home Screen WebApp to bypass the physical Silent/Ring switch
 * for Web Audio API oscillators (Metronome & Reference Tone) by:
 * 1. Setting `navigator.audioSession.type` (iOS 16.4+) to `'play-and-record'` or `'playback'`
 * 2. Playing a looping silent HTML5 `<audio>` element so WebKit promotes the session
 *    from `AVAudioSessionCategorySoloAmbient` (muted by silent switch) to `Playback`.
 */
export function enableIosSilentSwitchBypass(micActive = false): void {
  if (typeof navigator !== 'undefined') {
    const nav = navigator as NavigatorWithAudioSession;
    if (nav.audioSession) {
      try {
        nav.audioSession.type = micActive ? 'play-and-record' : 'playback';
      } catch {
        // Ignore if browser rejects audioSession assignment
      }
    }
  }

  if (typeof Audio !== 'undefined') {
    try {
      if (!silentAudioEl) {
        silentAudioEl = new Audio(getSilentWavUrl());
        silentAudioEl.loop = true;
        silentAudioEl.volume = 0.01;
        silentAudioEl.setAttribute('playsinline', 'true');
      }
      if (silentAudioEl.paused) {
        void silentAudioEl.play().catch(() => {
          // Ignore if not triggered by user gesture
        });
      }
    } catch {
      // Ignore in non-browser test environments
    }
  }
}

export function disableIosSilentSwitchBypass(): void {
  if (silentAudioEl && !silentAudioEl.paused) {
    try {
      silentAudioEl.pause();
    } catch {
      // Ignore
    }
  }
}
