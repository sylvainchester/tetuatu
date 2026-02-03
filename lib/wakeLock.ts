let wakeLock: WakeLockSentinel | null = null;

async function requestWakeLock() {
  if (typeof navigator === 'undefined') return;
  if (!('wakeLock' in navigator)) return;
  try {
    // @ts-expect-error Wake Lock is not in TS lib yet.
    wakeLock = await navigator.wakeLock.request('screen');
  } catch (_err) {
    // Ignore failures (unsupported or denied).
  }
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}

export function useWakeLock() {
  let onVisibilityChange: (() => void) | null = null;

  const enable = () => {
    requestWakeLock();
    if (typeof document === 'undefined') return;
    onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
  };

  const disable = () => {
    if (typeof document !== 'undefined' && onVisibilityChange) {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
    releaseWakeLock();
    onVisibilityChange = null;
  };

  return { enable, disable };
}
