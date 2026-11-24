export { LiveWaveform } from './LiveWaveform';
export { PlaybackWaveform, type PlaybackWaveformProps } from './PlaybackWaveform';
export { useMicPermission, type MicPermission, type MicPermissionState } from './useMicPermission';
export { useRecorder, type Recorder, type RecorderOptions, type RecorderStatus, type RecordingResult } from './useRecorder';
export { playTts, useAudioPlayer, type AudioPlayer, type AudioPlayerOptions, type PlayTtsOptions } from './useAudioPlayer';
export { computePeaks, decodePeaks, peaksFromWords, resamplePeaks, type DecodedPeaks } from './peaks';
export {
  buildWaveformMarks,
  fillerMarkId,
  formatClock,
  marksForTurn,
  pauseMarkId,
  type WaveformMark,
  type WaveformMarkKind,
} from './geometry';
export { pickBrowserMimeType, pickRecorderMimeType, baseMimeType } from './mime';
export { recorderError, type RecorderError, type RecorderErrorCode } from './mediaErrors';
export { createSyntheticAnalyser, type SyntheticAnalyser } from './syntheticAnalyser';
export { wavDurationSec } from './wav';
export { canSynthesizeSpeech, speakWithSynthesis, type SynthesisOptions } from './speechSynthesis';
export { MicDeniedHelp } from './MicDeniedHelp';
export { detectBrowser, micHelpFor, type BrowserFamily, type MicHelp } from './micHelp';
