# SIA-API-06 — POST /sia/transcriptions

## Route contract

`verifyToken → siaVoiceLimiter → voiceReadinessGate → uploadAudioField → transcribe`.
The multipart field is `audio`; optional `languageHint` and `durationHintSeconds` are validated
after upload parsing.

## Current execution flow

1. `voiceReadinessGate` returns `503` before multipart parsing when voice configuration is not
   ready.
2. Multer uses memory storage. Invalid/wrong fields return `400`; the configured size limit
   returns `413`.
3. The controller validates presence of non-empty audio, language-hint format, and duration hint.
4. It detects the audio container from the uploaded bytes, not the client MIME header. An unknown
   signature returns `415`.
5. It calls `transcribeAudio` with a server-owned filename, detected MIME type, and an abort signal
   that responds to genuine request aborts or a prematurely closed response.
6. A successful provider result returns transcript, detected language, and duration. Empty speech
   returns `422`; other provider failures return the generic voice-unavailable `503`.

## Data and privacy boundary

The audio buffer exists only in the request-memory path. This route does not call SIA answer,
session, or ML-service code, and it does not retain audio or transcript data in a session/cache.
Safe event logging excludes audio bytes, transcript, and authorization values.

## Verified sources

- `backend/Routes/sia.routes.js`
- `backend/Controllers/SiaControllers/transcribe.js`
- `backend/Middlewares/audioUpload.js`
- `backend/sia/audioContainerSignature.js`
- `backend/sia/transcriptionService.js`
