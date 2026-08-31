# Spotify Stats

Project knowledge base for the public Spotify listening-stats feature.

## Navigation

- [[Overview and Architecture]]
- [[Decision Log]]
- [[Task List]]
- [[Open Questions]]
- [[Spotify Setup]]
- [[Cloudflare Setup]]
- [[API Reference and Privacy]]
- [Architecture Diagrams](diagrams/README.md)

## Status

The architecture, dedicated `/listening/` route, API and error envelopes, normalized D1 model, reporting defaults, ingestion schedule, privacy boundary, and manual-first Worker deployment approach are approved. The Worker, D1 database, custom API domain, Spotify secrets, controlled ingestion, production API checks, frontend rendering, tests, and setup documentation are in place. Remaining release work is tracked in [[Task List]], currently focused on Cron dispatch verification, the GitHub Pages build variable, final test coverage, and commit/push.

The documentation in this directory is the project coordination record. Keep the decision log, task list, and open questions current as work progresses.
