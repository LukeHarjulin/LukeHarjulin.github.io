# Luke Harjulin Portfolio

Static online CV built with Astro 7 and deployed to GitHub Pages.

## Local Development

Use Node.js 24 and pnpm 11.5.3.

```powershell
pnpm install
pnpm dev
```

Build the production site:

```powershell
pnpm build
pnpm preview
```

## CV Content Workflow

Shared website and CV content lives in `src/data/cv.json`. Edit that file first, then regenerate the downloadable CV and build the site:

```powershell
pip install -r requirements.txt
pnpm build:all
```

`pnpm build:all` writes `public/cv/Luke-Harjulin-CV.pdf` and then runs the Astro production build. Avoid editing the generated PDF directly, because it will be overwritten by the next CV generation.

## Deployment

The workflow in `.github/workflows/deploy.yml` deploys automatically when `master` is pushed.

Manual redeploys are available from GitHub Actions:

1. Open **Actions**.
2. Run **Deploy portfolio to GitHub Pages**.
3. Set `ref` to a branch, tag, or commit SHA from `master` history.
4. Optionally set `version_label`.

The deployed site exposes build metadata at `/version.json`. The workflow can also deploy older pre-Astro commits by publishing their root static files.

## GitHub Pages Settings

Set the repository Pages source to **GitHub Actions**. The custom domain is preserved through `public/CNAME`, with the existing root `CNAME` and `docs/CNAME` retained for domain consistency.
