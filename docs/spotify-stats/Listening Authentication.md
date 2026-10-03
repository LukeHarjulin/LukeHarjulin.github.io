# Listening authentication

The portfolio remains public. `/listening/` serves a static passphrase form; all statistics, history searches, and album recommendations require a Worker-verified session. Static HTML and JavaScript are downloadable and contain no listening credentials or private data.

## Configure secrets

Run `pnpm listening:secrets` to enter a shared passphrase interactively (12–1024 characters). The helper generates a separate random signing secret and preserves existing Spotify/Last.fm credentials in the ignored `.dev.vars` file. For an automatically generated passphrase, run:

```powershell
pwsh -NoProfile -File tools/setup_listening_secrets.ps1 -Generate
```

Neither mode prints credentials. Read the passphrase locally from `.dev.vars` when needed; do not commit or paste that file into logs. Re-running is a no-op when both secrets exist. Add `-Rotate` to replace them and invalidate all existing sessions on deployment. Spotify OAuth reauthorisation preserves both listening secrets.

Production requires `LISTENING_PASSPHRASE`, `LISTENING_SESSION_SECRET` (at least 32 characters), `PUBLIC_SITE_ORIGIN`, and the `LOGIN_RATE_LIMITER` binding. Missing configuration returns 503 and never exposes data. Copy the limiter and required-secret entries from `wrangler.example.toml` into an existing local production config. Its namespace `1001` is reserved for listening logins within this account; it must not be reused by unrelated applications. Keep `workers_dev = false` and `preview_urls = false`.

## Session and API contract

| Endpoint | Request | Result |
| --- | --- | --- |
| `POST /api/auth/login` | JSON `{ "passphrase": "…" }` | Sets the cookie; `data: { authenticated: true, expiresAt: <Unix milliseconds> }` |
| `GET /api/auth/session` | Cookie, if present | `data: { authenticated: boolean, expiresAt: <Unix milliseconds or null> }`; no token |
| `POST /api/auth/logout` | JSON `{}` | Expires the cookie; `data: { authenticated: false }` |

Responses retain the existing `{ data, meta }` / `{ error: { code, message } }` envelopes. Login/logout require an exact `Origin` match and `application/json`; API preflight is unauthenticated. Browser requests include credentials. CORS permits only `PUBLIC_SITE_ORIGIN`, never `*`.

Incorrect passphrases return `401 INVALID_PASSPHRASE`; invalid data sessions return `401 UNAUTHENTICATED`. Invalid JSON, shape, or bodies over 4 KiB return `400 INVALID_REQUEST`; unsupported media types return 415. Login attempts are limited to approximately five per IP per minute by Cloudflare's location-local limiter; 429 includes `Retry-After: 60`. Limiter errors fail closed with 503. This is not a strict global brute-force quota: use a strong shared phrase.

The production host-only cookie is `__Host-listening_session`, with `HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800`. It contains a versioned HMAC-SHA-256 token with issued-at and expiry times, never the phrase. Its key is derived from both secrets; changing either invalidates every session. Expiry is enforced by the Worker after exactly seven days, without renewal. The form verifies that the cookie was accepted before loading data.

Lock removes the cookie from this browser; it does not centrally revoke copies of that token. Rotate secrets for global revocation. Tabs detect invalid sessions on requests; the page also schedules its own expiry and rechecks restored browser-history pages. A failed logout hides data immediately and records a retry marker in session storage when available. Do not assume server sign-out succeeded until the UI confirms it.

## Caching and rollout

Authentication precedes every data route and cache lookup. An internal shared `spotify-authenticated-v1` cache retains existing TTLs and contains no cookies or tokens. All responses leaving the Worker have `Cache-Control: private, no-store` and `CDN-Cache-Control: no-store`. Internal cache tests are not a substitute for testing the actual Worker entrypoint.

Deploy in this order:

1. Confirm local validation passes and that the GitHub Pages build has `PUBLIC_SPOTIFY_API_BASE_URL=https://spotify-api.lukeharjulin.com`.
2. Configure secrets and rate-limit binding, then run `pnpm worker:deploy`. The helper uploads `.dev.vars` with the deployment, including the existing provider secrets.
3. Purge Cloudflare's cache for **only `spotify-api.lukeharjulin.com`**. Verify the Cloudflare API/dashboard confirms success. Do not broaden to an unrelated zone-wide purge.
4. Publish the frontend through the existing GitHub Pages workflow.
5. Verify direct anonymous requests to all `/api/spotify/*` endpoints return 401, including after warming the authenticated cache. Verify real-browser login, reload, and Lock on the custom domain.

The deployment must not be reported complete if the cache purge or frontend publish is blocked. Previously downloaded public data and browser copies cannot be recalled. Rollback must retain the authentication boundary: do not deploy an older public Worker merely to restore the UI. Scheduled ingestion and recommendation refresh never depend on visitor sessions.

## Local development and validation

Use `http://127.0.0.1:8000` for Astro and `http://127.0.0.1:8787` for Wrangler, with `PUBLIC_SPOTIFY_API_BASE_URL` pointing to Wrangler. The local config uses `PUBLIC_SITE_ORIGIN=http://127.0.0.1:8000` and `LISTENING_LOCAL_HTTP=true`. That flag permits a separate, non-Secure `listening_session_local` cookie only when both the API hostname and configured website hostname are loopback; it never relaxes production cookies or bypasses authentication. Keep both local hostnames identical.

```powershell
# Shell 1 (Astro 7: avoid automatic agent background detachment on Windows)
$env:PUBLIC_SPOTIFY_API_BASE_URL = "http://127.0.0.1:8787"
$env:ASTRO_DEV_BACKGROUND = "1"
pnpm dev --host 127.0.0.1 --port 8000

# Shell 2
pnpm exec wrangler dev --config wrangler.local.toml --ip 127.0.0.1 --port 8787

# Verification
pnpm worker:typecheck
pnpm site:typecheck
pnpm worker:test --maxWorkers 1 --testTimeout 60000
pnpm spotify:oauth:test
pnpm build
pnpm test:browser
```

Browser tests use their own synthetic in-memory D1 and passphrase; they never read `.dev.vars` or remote D1. They run headless Edge on Windows (Chromium elsewhere; install it with `pnpm exec playwright install chromium`). Output screenshots/traces are under ignored `.verification/browser`. Operational logging must not include login bodies, cookies, signing secrets, or raw authorization headers.
