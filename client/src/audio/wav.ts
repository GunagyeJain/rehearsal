/** Minimal WAV header reading, so the live screen can time its text reveal to the spoken line. */

const RIFF = 0x52494646; // "RIFF"
const WAVE = 0x57415645; // "WAVE"
const FMT = 0x666d7420; // "fmt "
const DATA = 0x64617461; // "data"
const HEADER_MIN_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;
const BYTE_RATE_OFFSET = 8;
/** Streaming encoders write this placeholder when the length is unknown. */
const UNKNOWN_SIZE = 0xffffffff;

/**
 * Duration in seconds of a PCM WAV buffer, or null when it is not a readable WAV.
 * Tolerates a streaming header (data size unknown) by measuring to the end of the buffer.
 */
export function wavDurationSec(buffer: ArrayBuffer): number | null {
  if (buffer.byteLength < HEADER_MIN_BYTES) return null;
  const view = new DataView(buffer);
  if (view.getUint32(0) !== RIFF || view.getUint32(8) !== WAVE) return null;

  let byteRate = 0;
  let offset = HEADER_MIN_BYTES;
  while (offset + CHUNK_HEADER_BYTES <= buffer.byteLength) {
    const id = view.getUint32(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + CHUNK_HEADER_BYTES;
    if (id === FMT && body + BYTE_RATE_OFFSET + 4 <= buffer.byteLength) {
      byteRate = view.getUint32(body + BYTE_RATE_OFFSET, true);
    } else if (id === DATA) {
      if (byteRate <= 0) return null;
      const available = buffer.byteLength - body;
      const dataBytes = size === UNKNOWN_SIZE || size === 0 || size > available ? available : size;
      return dataBytes / byteRate;
    }
    if (size === UNKNOWN_SIZE) return null;
    offset = body + size + (size % 2);
  }
  return null;
}
