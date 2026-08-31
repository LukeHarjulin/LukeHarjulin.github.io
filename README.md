# Luke Harjulin Portfolio

Static online CV built with Astro 7 and deployed to GitHub Pages.

## Local Development

Use Node.js 24 and pnpm 11.5.3. The Spotify OAuth bootstrap additionally requires PowerShell 7 (`pwsh`).

```powershell
pnpm install
pnpm dev
```

Build the production site:

```powershell
pnpm build
pnpm preview
```

## Spotify Listening Stats

The listening-stats frontend remains part of this Astro site. Spotify OAuth, scheduled ingestion, aggregate queries, and the public read-only API run in a separate Cloudflare Worker backed by D1.

Start with the [Spotify stats knowledge base](docs/spotify-stats/Spotify%20Stats.md) for the architecture, decision log, task list, open questions, local development, and manual deployment runbooks. The frontend reads the public Worker origin from `PUBLIC_SPOTIFY_API_BASE_URL`; Spotify credentials are Worker secrets and must never be supplied to the Astro build.

Worker development commands:

```powershell
Copy-Item wrangler.example.toml wrangler.toml
pnpm spotify:oauth
pnpm d1:migrate:local
pnpm worker:dev
```

Replace `<D1_DATABASE_ID>` in the ignored `wrangler.toml` first. The OAuth command writes local Spotify secrets to the ignored `.dev.vars` file. In a separate shell, point Astro at the local Worker before starting the site:

```powershell
$env:PUBLIC_SPOTIFY_API_BASE_URL = "http://localhost:8787"
pnpm dev
```

For GitHub Pages, create the repository Actions variable `PUBLIC_SPOTIFY_API_BASE_URL` with `https://spotify-api.lukeharjulin.com`. The Pages workflow passes that public origin into the Astro build; it never receives Spotify credentials.

## CV Content Workflow

Shared website and CV content lives in `src/data/cv.json`. Edit that file first, then regenerate the downloadable CV and build the site:

```powershell
pip install -r requirements.txt
pnpm build:all
```

`pnpm build:all` writes `public/cv/Luke-Harjulin-CV.pdf` and then runs the Astro production build. Avoid editing the generated PDF directly, because it will be overwritten by the next CV generation.

## Deployment

The workflow in `.github/workflows/deploy.yml` deploys automatically when `master` is pushed.

The Worker is deployed manually during the initial rollout. The GitHub Pages workflow does not receive Cloudflare or Spotify credentials.

After completing the Spotify and Cloudflare runbooks, deploy the Worker and its validated three-secret set together:

```powershell
pnpm worker:deploy
```

Manual redeploys are available from GitHub Actions:

1. Open **Actions**.
2. Run **Deploy portfolio to GitHub Pages**.
3. Set `ref` to a branch, tag, or commit SHA from `master` history.
4. Optionally set `version_label`.

The deployed site exposes build metadata at `/version.json`. The workflow can also deploy older pre-Astro commits by publishing their root static files.

## GitHub Pages Settings

Set the repository Pages source to **GitHub Actions**. The custom domain is preserved through `public/CNAME`, with the existing root `CNAME` and `docs/CNAME` retained for domain consistency.
