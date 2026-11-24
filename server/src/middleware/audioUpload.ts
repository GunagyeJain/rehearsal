import type { RequestHandler } from 'express';
import multer from 'multer';
import { MAX_AUDIO_UPLOAD_BYTES } from '@rehearsal/shared';
import { HttpError } from '../http/HttpError';

/** Multipart field carrying the recording (spec/api.md "Multipart uploads"). */
export const AUDIO_FIELD = 'audio';
/** Text fields are tiny: durationSec only. */
const MAX_TEXT_FIELDS = 4;
const MAX_TEXT_FIELD_BYTES = 1024;

/**
 * Containers the client recorder produces (client/src/audio/mime.ts) plus wav/mpeg for synthesized
 * takes. Aliases collapse to one stored value, so the echoed Content-Type is always one of these.
 */
const AUDIO_MIME_ALIASES: Readonly<Record<string, string>> = {
  'audio/webm': 'audio/webm',
  'audio/ogg': 'audio/ogg',
  'audio/mp4': 'audio/mp4',
  'audio/x-m4a': 'audio/mp4',
  'audio/wav': 'audio/wav',
  'audio/x-wav': 'audio/wav',
  'audio/wave': 'audio/wav',
  'audio/mpeg': 'audio/mpeg',
};

/** The normalized container type for a client-declared mime type, or null when not allowed. */
export function normalizeAudioMime(raw: string): string | null {
  const base = raw.split(';')[0]?.trim().toLowerCase() ?? '';
  return AUDIO_MIME_ALIASES[base] ?? null;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AUDIO_UPLOAD_BYTES, files: 1, fields: MAX_TEXT_FIELDS, fieldSize: MAX_TEXT_FIELD_BYTES },
  fileFilter: (_req, file, cb) => {
    if (normalizeAudioMime(file.mimetype) !== null) {
      cb(null, true);
      return;
    }
    cb(new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'That file is not audio. Record your answer again.'));
  },
}).single(AUDIO_FIELD);

function mapMulterError(error: multer.MulterError): HttpError {
  if (error.code === 'LIMIT_FILE_SIZE') {
    return new HttpError(413, 'PAYLOAD_TOO_LARGE', 'That recording is too large to upload.');
  }
  return new HttpError(400, 'BAD_REQUEST', 'The upload could not be read. Record your answer again.');
}

/** Single audio file held in memory; never written to disk or logged. */
export const audioUpload: RequestHandler = (req, res, next) => {
  upload(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError) {
      next(mapMulterError(error));
      return;
    }
    next(error);
  });
};
