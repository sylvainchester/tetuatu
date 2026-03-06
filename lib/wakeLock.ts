import { useCallback, useRef } from 'react';

let wakeLock: WakeLockSentinel | null = null;

async function requestWakeLock() {
  if (typeof navigator === 'undefined') return;
  if (!('wakeLock' in navigator)) return;
  try {
    // @ts-expect-error Wake Lock is not in TS lib yet.
    wakeLock = await navigator.wakeLock.request('screen');
  } catch {
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
  const onVisibilityChangeRef = useRef<(() => void) | null>(null);

  const enable = useCallback(() => {
    requestWakeLock();
    if (typeof document === 'undefined') return;
    const currentHandler = onVisibilityChangeRef.current;
    if (currentHandler) {
      document.removeEventListener('visibilitychange', currentHandler);
    }
    onVisibilityChangeRef.current = () => {
      if (document.visibilityState === 'visible') {
        requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChangeRef.current);
  }, []);

  const disable = useCallback(() => {
    if (typeof document !== 'undefined' && onVisibilityChangeRef.current) {
      document.removeEventListener('visibilitychange', onVisibilityChangeRef.current);
    }
    releaseWakeLock();
    onVisibilityChangeRef.current = null;
  }, []);

  return { enable, disable };
}
