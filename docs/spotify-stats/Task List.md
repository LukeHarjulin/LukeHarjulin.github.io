# Task List

Back to [[Spotify Stats]]. Decisions are in [[Decision Log]] and unresolved choices are in [[Open Questions]].

## Coordination

- [x] Inspect the existing framework, build process, deployment, and frontend conventions.
- [x] Investigate Cloudflare Worker, D1, and Cron requirements.
- [x] Investigate Spotify OAuth, scopes, token refresh, and recently-played behavior.
- [x] Obtain approval for the architecture, API surface, normalized schema, deduplication key, privacy boundary, and deployment approach.
- [x] Obtain and record approval for response envelopes, reporting defaults, limits, CORS, cache windows, and the five-minute ingestion schedule.
- [x] Obtain and record approval for the production Worker name, D1 name, custom API domain, frontend origin, and local Spotify redirect URI.
- [x] Create the Obsidian-compatible project knowledge base.
- [x] Create and validate editable Draw.io-compatible architecture diagrams for context, ingestion, public reads, D1, and deployment.
- [x] Keep this task list, decision log, and open questions synchronized during foundation implementation.

## Backend Foundation

- [x] Add the Worker sidecar directory and typed environment bindings.
- [x] Add an example Wrangler configuration containing the approved non-secret values and a placeholder for the Cloudflare-generated D1 ID.
- [x] Add a local OAuth bootstrap that validates state and stores credentials only in the ignored `.dev.vars` file.
- [x] Declare required Spotify secrets in Wrangler so development and deployment validate the secret contract.
- [x] Make the manual deploy upload only the validated Spotify secret set alongside the Worker code.
- [x] Add the initial D1 migration for `artists`, `albums`, `tracks`, `track_artists`, `plays`, and ingestion state.
- [x] Implement Spotify access-token refresh.
- [x] Implement recently-played ingestion and idempotent metadata upserts.
- [x] Implement the scheduled handler.
- [x] Implement public read-only API routing.
- [x] Implement the approved `{ data, meta }` success and structured `{ error }` response envelopes.
- [x] Finalize the stable public error-code names and hide configuration-specific failures.
- [x] Implement query functions for summaries, rankings, activity, archive search, recent plays, and lifetime totals.
- [x] Implement now-playing with a stored recent-play fallback.
- [x] Apply `Europe/London` calendar boundaries to summary, archive, ranking, and activity queries.
- [x] Approximate listening time by summing Spotify track duration per persisted play.
- [x] Default recent plays to 20 and enforce a maximum of 50.
- [x] Change the default heatmap query to 365 inclusive trailing London calendar days.
- [x] Restrict archive search to case-insensitive track-name substring matching.
- [x] Require configured-origin CORS without a production wildcard fallback.
- [x] Apply the approved 15/30/60-second endpoint cache windows and `no-store` errors.
- [x] Put the approved five-minute schedule in the Wrangler example used to create the deployable configuration.

## Frontend Foundation

- [x] Add the dedicated listening route at [src/pages/listening.astro](../../src/pages/listening.astro).
- [x] Keep listening stats out of the portfolio homepage and primary navigation.
- [x] Add a subdued listening link to the homepage footer.
- [x] Extend [src/styles/global.css](../../src/styles/global.css) using existing visual conventions.
- [x] Extend [src/scripts/site.ts](../../src/scripts/site.ts) with loading, success, empty, and error states.
- [x] Read the Worker API base from a public build-time environment variable rather than hard-coding a host.
- [x] Verify desktop and mobile layouts, fixed-header behavior, navigation, interactions, and browser console output with real local data.

## Verification

- [x] Add focused tests for period validation and query construction.
- [x] Add tests for Spotify response mapping and play deduplication behavior.
- [x] Add focused tests for OAuth dotenv ownership, atomic replacement, and line-break rejection.
- [x] Fix OAuth authorize-URL parameter joining and add a regression test for separators and encoding.
- [x] Add route tests for invalid input and private-route rejection.
- [x] Add route response-contract tests for every supported endpoint using the approved envelope.
- [x] Add timezone tests covering `Europe/London` calendar boundaries and daylight-saving transitions.
- [x] Add tests for the trailing-one-year heatmap window and configured-origin CORS.
- [x] Apply the D1 migration to a local database.
- [x] Exercise scheduled ingestion with a test D1 database and mocked Spotify responses.
- [x] Run the Astro production build.
- [x] Confirm no secret or raw-history fields appear in built frontend assets or implemented public response mappings.

## Operator Setup and Release

- [x] Create the Spotify application and generate the three local Worker secrets with the OAuth bootstrap.
- [x] Authenticate Wrangler with the target Cloudflare account.
- [x] Provision the `spotify-listening` D1 database in Western Europe.
- [x] Create the ignored runtime Wrangler configuration with the Cloudflare-generated D1 ID.
- [x] Complete [[Spotify Setup]].
- [ ] Complete [[Cloudflare Setup]].
- [x] Configure the frontend API base URL in the GitHub Pages build environment.
- [x] Apply the initial D1 migration to the local and remote databases.
- [x] Deploy the Worker manually with Cron initially disabled.
- [x] Trigger and verify a controlled ingestion run against local D1 using the real Spotify integration.
- [x] Verify duplicate ingestion leaves the persisted play count unchanged.
- [x] Trigger and verify controlled ingestion against remote D1 using a temporary remote development binding.
- [x] Verify duplicate remote ingestion leaves the persisted play count unchanged.
- [x] Verify production public API responses, cache headers, and CORS behavior.
- [x] Configure the approved five-minute Cron Trigger.
- [x] Enable persisted Worker invocation logs at 100% sampling with traces disabled.
- [ ] Verify Cloudflare dispatches the five-minute Cron Trigger; a cleanly recreated schedule was present in the API from 2026-08-31 20:09:33Z, but no scheduled invocation appeared at the 21:10, 21:15, 21:20, or 21:25 Europe/London boundaries while live tailing captured ordinary requests.
- [ ] Consider Worker deployment automation only after manual deployment is stable.
