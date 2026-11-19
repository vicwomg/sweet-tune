const SCREEN_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes
const PING_THROTTLE_MS = 4000;

interface SweetTuneNativeBridge {
  keepScreenAwake?: () => void;
}

class ScreenWakeManager {
  private sentinel: WakeLockSentinel | null = null;
  private timeoutId: number | null = null;
  private lastPingTime = 0;
  private isRequesting = false;

  /**
   * Keeps the screen awake for 3 minutes from the most recent call.
   * Safe to call frequently (throttled internally to every 4 seconds).
   */
  ping(force = false): void {
    const now = performance.now();
    if (!force && now - this.lastPingTime < PING_THROTTLE_MS) {
      return;
    }
    this.lastPingTime = now;

    // Notify native Android bridge if running in Android WebView
    const nativeBridge = (window as unknown as { SweetTuneNative?: SweetTuneNativeBridge })
      .SweetTuneNative;
    nativeBridge?.keepScreenAwake?.();

    // Reset 3-minute release timer for Web / iOS WakeLock API
    if (this.timeoutId !== null) {
      window.clearTimeout(this.timeoutId);
    }
    this.timeoutId = window.setTimeout(() => {
      void this.release();
    }, SCREEN_TIMEOUT_MS);

    if (!this.sentinel && !this.isRequesting) {
      void this.acquire();
    }
  }

  private async acquire(): Promise<void> {
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;

    this.isRequesting = true;
    try {
      const sentinel = await navigator.wakeLock.request('screen');
      this.sentinel = sentinel;
      sentinel.addEventListener('release', () => {
        if (this.sentinel === sentinel) {
          this.sentinel = null;
        }
      });
    } catch {
      // Ignore if wakeLock is unsupported or blocked by battery saver
    } finally {
      this.isRequesting = false;
    }
  }

  async release(): Promise<void> {
    if (this.timeoutId !== null) {
      window.clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    const current = this.sentinel;
    this.sentinel = null;
    if (current) {
      try {
        await current.release();
      } catch {
        // Ignore if already released
      }
    }
  }
}

export const screenWakeManager = new ScreenWakeManager();
