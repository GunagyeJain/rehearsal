import { useCallback, useEffect, useState } from 'react';
import { mediaDevicesAvailable, stopStream } from './mediaErrors';

export type MicPermissionState = 'unknown' | 'prompt' | 'granted' | 'denied' | 'unsupported';

export interface MicPermission {
  state: MicPermissionState;
  /** Ask for the microphone (shows the browser prompt). Resolves true when granted. */
  request: () => Promise<boolean>;
}

function initialState(): MicPermissionState {
  return mediaDevicesAvailable() ? 'unknown' : 'unsupported';
}

/**
 * Microphone permission without prompting on mount: reads the Permissions API where it exists
 * and follows its changes. Browsers without it stay 'unknown' until request() is called.
 */
export function useMicPermission(): MicPermission {
  const [state, setState] = useState<MicPermissionState>(initialState);

  useEffect(() => {
    if (!mediaDevicesAvailable() || typeof navigator.permissions?.query !== 'function') return;
    let status: PermissionStatus | null = null;
    let cancelled = false;
    const sync = () => {
      if (status && !cancelled) setState(status.state === 'granted' ? 'granted' : status.state === 'denied' ? 'denied' : 'prompt');
    };
    navigator.permissions
      // 'microphone' is not in every TS lib PermissionName union yet, but all current engines accept it.
      .query({ name: 'microphone' as PermissionName })
      .then((result) => {
        status = result;
        sync();
        result.addEventListener('change', sync);
      })
      .catch(() => {
        // Querying the microphone is unsupported in this engine; request() will find out.
      });
    return () => {
      cancelled = true;
      status?.removeEventListener('change', sync);
    };
  }, []);

  const request = useCallback(async () => {
    if (!mediaDevicesAvailable()) {
      setState('unsupported');
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stopStream(stream);
      setState('granted');
      return true;
    } catch (error: unknown) {
      const name = error instanceof DOMException ? error.name : '';
      setState(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'prompt');
      return false;
    }
  }, []);

  return { state, request };
}
