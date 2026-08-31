# Spotify Setup

Back to [[Spotify Stats]]. Related backend steps are in [[Cloudflare Setup]].

## Required Application Configuration

1. Create or select a Spotify developer application.
2. Register `http://127.0.0.1:8888/callback` as the exact redirect URI. Spotify allows HTTP only for explicit loopback IP literals; do not replace `127.0.0.1` with `localhost`.
3. If the application is in development mode, add the Spotify account whose listening history will be collected to the application's allowed users.
4. Keep the client secret and all tokens out of the GitHub Pages frontend, repository files, issue text, build output, and screenshots.

The bootstrap script uses that same callback during authorization and token exchange. Spotify requires an exact match.

## Required Scopes

- `user-read-currently-playing` for current playback state.
- `user-read-recently-played` for scheduled recently-played ingestion.

Do not request broader scopes unless a later approved feature requires them.

## Worker Secrets and Variables

Store these as Cloudflare Worker secrets unless the Worker implementation explicitly identifies a non-sensitive value as a variable:

| Name | Purpose |
| --- | --- |
| `SPOTIFY_CLIENT_ID` | Spotify application client ID. Treat as backend configuration. |
| `SPOTIFY_CLIENT_SECRET` | Spotify application client secret. |
| `SPOTIFY_REFRESH_TOKEN` | Refresh token for the listening account. |

The frontend needs none of these values.

## One-Time Authorization

After registering the callback and adding the listening account to the app when required, run:

```powershell
pnpm spotify:oauth
```

The script requires PowerShell 7. It prompts for the Spotify client ID and masked client secret, opens Spotify authorization, listens only on `127.0.0.1:8888` for up to five minutes, validates the OAuth state, exchanges the code, and verifies the two required scopes. It atomically writes `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, and `SPOTIFY_REFRESH_TOKEN` to the ignored `.dev.vars` file without printing the refresh token. It does not add an OAuth route to the public Worker.

The repository's `.dev.vars` file is reserved for those three Spotify secrets. The bootstrap stops before authorization if it finds any other assignment, preventing the bulk upload command from sending unrelated local credentials to this Worker.

The initial `pnpm worker:deploy` command validates this file and uploads its three secrets alongside the Worker code. To rotate the same secrets later without a separate code deploy, run:

```powershell
pnpm worker:secrets
```

Both commands validate that `.dev.vars` contains each required Spotify key exactly once and no other assignments. The rotation command sends it to Wrangler over standard input. Never paste its values into shell history, and retain the file only on a trusted local machine.

## Runtime Expectations

- The Worker exchanges the refresh token for short-lived access tokens.
- If a refresh response does not include a replacement refresh token, the Worker retains the existing one.
- HTTP `429` responses must honor Spotify's retry guidance rather than retrying in a tight loop.
- HTTP `401` or token-refresh failures should be observable in Worker logs without logging credentials or token bodies.
- A current-playing response with no active playback is normal and should trigger the stored recent-play fallback.

## Manual Verification

- Confirm current playback can be read while a track is playing.
- Confirm no-current-playback behavior returns no live item without failing ingestion.
- Confirm recently played data can be read with the intended account.
- Confirm Worker logs redact authorization headers, access tokens, refresh tokens, and token endpoint bodies.
- Confirm no Spotify credentials are present in the GitHub Pages build artifacts.
