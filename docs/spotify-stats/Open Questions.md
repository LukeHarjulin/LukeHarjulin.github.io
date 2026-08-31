# Open Questions

Back to [[Spotify Stats]]. Record approved answers in [[Decision Log]].

These items remain deliberately unresolved. They require operator values or product/API decisions and must not be guessed during implementation.

## Product and Reporting

- How should plays with missing or unavailable Spotify metadata appear?

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

- Spotify's recently-played endpoint provides a limited recent window. Is forward-only collection sufficient for launch?
- If older listening history is later imported, what source format and provenance rules should apply?
