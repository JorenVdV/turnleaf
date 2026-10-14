// Runtime APIs the app uses that predate the oldest WebView the legacy build supports (Chrome 86,
// see scripts/legacy-webview-css.ts). Each one is only installed when the platform lacks it.

if (!Array.prototype.at) {
  Object.defineProperty(Array.prototype, 'at', {
    configurable: true,
    writable: true,
    value: function at<T>(this: T[], index: number): T | undefined {
      const i = Math.trunc(index) || 0;
      return this[i < 0 ? this.length + i : i];
    },
  });
}

// Chrome 116.
if (typeof AbortSignal !== 'undefined' && !('any' in AbortSignal)) {
  Object.defineProperty(AbortSignal, 'any', {
    configurable: true,
    writable: true,
    value: function any(signals: AbortSignal[]): AbortSignal {
      const controller = new AbortController();
      for (const signal of signals) {
        if (signal.aborted) {
          controller.abort((signal as AbortSignal & { reason?: unknown }).reason);
          break;
        }
        signal.addEventListener(
          'abort',
          () => controller.abort((signal as AbortSignal & { reason?: unknown }).reason),
          { once: true },
        );
      }
      return controller.signal;
    },
  });
}

export {};
