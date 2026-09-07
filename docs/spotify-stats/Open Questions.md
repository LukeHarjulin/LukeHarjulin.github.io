# Open Questions

Back to [[Spotify Stats]]. Record approved answers in [[Decision Log]].

These items remain deliberately unresolved. They require operator values or product/API decisions and must not be guessed during implementation.

## API

- What pagination contract should archive search use?
- Should public error responses include a request identifier for diagnostics?

## Spotify

- Has the listening account been added to the Spotify application's allowlist if the application is in development mode?
- How will refresh-token reauthorization be detected and communicated if Spotify invalidates or expires the token?

## Cloudflare

- Why is Cloudflare not dispatching the accepted `*/5 * * * *` schedule after the documented propagation window? On 2026-08-31 the trigger was explicitly removed with `crons = []`, recreated at 20:09:33Z, and remained present in the schedules API, but a working live tail recorded ordinary requests and no Cron event through the 21:25 Europe/London boundary.
- After Cron verification, should invocation logs be disabled, or should query-string redaction be configured through a supported Wrangler/API path so archive search terms are not retained?
- Which Cloudflare environment names, if any, are needed beyond local and production?

## Historical Coverage

- The first 250-play calibration chunk reported 1,889 rows written, or 7.556 rows per play. Should Cron remain paused until all 456 remaining chunks finish, or should each UTC-day batch use its own pause, recovery bookmark, bounded import, and Cron restoration cycle?
- How much of the 100,000-row daily Free allowance should each batch reserve as operational headroom? The importer admits chunks at twice the larger of its planner estimate and the highest observed write rate.
