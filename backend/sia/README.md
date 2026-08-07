# SIA (backend module)

## Current status

Structural foundation only (M1-1). This module exists in the repository but
is not wired into the application in any way: nothing requires it, no route
mounts it, and it performs no runtime work.

## Current files

| File | Purpose |
|---|---|
| `index.js` | Empty CommonJS export scaffold. Safe to require; no side effects. |
| `config.js` | Reads SIA-related environment variables into a small configuration object. No validation of provider credentials; no network calls. |

## Configuration variables

All are optional. If unset, `config.js` returns the listed default.

| Variable | Default | Notes |
|---|---|---|
| `SIA_ENABLED` | `false` | Only the exact (trimmed) string `"true"` enables it. |
| `SIA_LLM_PROVIDER` | `null` | Trimmed; blank becomes `null`. |
| `SIA_LLM_TIMEOUT_MS` | `8000` | Must be a finite, positive number; anything else falls back to the default. |

## Non-goals (as of M1-1)

This module does **not** currently provide, and this milestone does not
implement:

- No HTTP route or controller.
- No LLM provider integration or API calls.
- No context builder or access to `backend/analytics/**` data.
- No frontend integration.

## Roadmap

Functionality described above as a non-goal will be introduced in later,
separately approved milestones -- nothing beyond the structural scaffold and
configuration surface exists yet.
