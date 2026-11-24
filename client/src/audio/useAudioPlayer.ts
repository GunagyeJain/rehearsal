import { useCallback, useEffect, useRef, useState } from 'react';

export interface AudioPlayer {
  play: () => Promise<void>;
  pause: () => void;
  seek: (sec: number) => void;
  currentTimeSec: number;
  durationSec: number;
  playing: boolean;
}

export interface AudioPlayerOptions {
  /**
   * Known duration, used when the element cannot report one. Chrome's MediaRecorder WebM has no
   * duration header, so a fresh recording reads as Infinity until fully scanned.
   */
  durationSec?: number;
}

/**
 * Playback for one recording. currentTimeSec updates every animation frame while playing so a
 * playhead moves smoothly (timeupdate alone fires about four times a second).
 */
export function useAudioPlayer(src: string | Blob | null, options: AudioPlayerOptions = {}): AudioPlayer {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [prevSrc, setPrevSrc] = useState(src);
  const knownDuration = options.durationSec ?? 0;

  // A new source starts from zero (state adjusted during render, not in an effect).
  if (prevSrc !== src) {
    setPrevSrc(src);
    setCurrentTimeSec(0);
    setMediaDuration(0);
    setPlaying(false);
  }

  useEffect(() => {
    if (src === null) return;
    const url = typeof src === 'string' ? src : URL.createObjectURL(src);
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.src = url;
    audioRef.current = audio;
    let frame = 0;
    const follow = () => {
      setCurrentTimeSec(audio.currentTime);
      frame = requestAnimationFrame(follow);
    };
    const onDuration = () => setMediaDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    const onPlay = () => {
      setPlaying(true);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(follow);
    };
    const onPause = () => {
      setPlaying(false);
      cancelAnimationFrame(frame);
      setCurrentTimeSec(audio.currentTime);
    };
    const onSeeked = () => setCurrentTimeSec(audio.currentTime);
    audio.addEventListener('loadedmetadata', onDuration);
    audio.addEventListener('durationchange', onDuration);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onPause);
    audio.addEventListener('seeked', onSeeked);
    return () => {
      cancelAnimationFrame(frame);
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      audioRef.current = null;
      if (typeof src !== 'string') URL.revokeObjectURL(url);
    };
  }, [src]);

  const durationSec = mediaDuration > 0 ? mediaDuration : knownDuration;

  const play = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (durationSec > 0 && audio.currentTime >= durationSec - 0.05) audio.currentTime = 0;
    await audio.play();
  }, [durationSec]);

  const pause = useCallback(() => audioRef.current?.pause(), []);

  const seek = useCallback(
    (sec: number) => {
      const audio = audioRef.current;
      const target = Math.max(0, durationSec > 0 ? Math.min(sec, durationSec) : sec);
      if (audio) audio.currentTime = target;
      setCurrentTimeSec(target);
    },
    [durationSec],
  );

  return { play, pause, seek, currentTimeSec, durationSec, playing };
}

export interface PlayTtsOptions {
  signal?: AbortSignal;
  /** Content type of an ArrayBuffer source. /api/tts returns WAV. */
  mimeType?: string;
}

/**
 * Play the AI's spoken line and resolve when it finishes. Rejects if playback fails or the
 * browser blocks autoplay (NotAllowedError: show a play control), and with an AbortError when
 * the signal aborts (playback stops at once).
 */
export function playTts(source: ArrayBuffer | string, options: PlayTtsOptions = {}): Promise<void> {
  const { signal, mimeType = 'audio/wav' } = options;
  if (signal?.aborted) return Promise.reject(new DOMException('Playback aborted', 'AbortError'));
  const url = typeof source === 'string' ? source : URL.createObjectURL(new Blob([source], { type: mimeType }));
  const audio = new Audio(url);

  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
      audio.pause();
      if (typeof source !== 'string') URL.revokeObjectURL(url);
    };
    const onEnded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('The spoken line could not be played.'));
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException('Playback aborted', 'AbortError'));
    };
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    signal?.addEventListener('abort', onAbort);
    audio.play().catch((err: unknown) => {
      cleanup();
      reject(err);
    });
  });
}
