# Repository Guidelines

## Project Structure & Module Organization

This repository is a static GitHub Pages site. The main page lives at `index.html` in the repository root. Styles are in `CSS/index.css`, browser behavior is in `JS/index.js`, and image assets such as `profilePic.JPG`, `github_icon.png`, `linkedin_icon.png`, and `codewars_icon.png` are stored at the root. `CNAME` and `docs/CNAME` define the custom domain configuration; keep them in sync if domain settings change.

## Build, Test, and Development Commands

There is no package manager or build step. Open `index.html` directly in a browser for a quick local check.

For a closer local preview, serve the directory with a simple static server:

```powershell
python -m http.server 8000
```

Then visit `http://localhost:8000`. This helps catch path and browser loading behavior that may differ from opening the file directly.

## Coding Style & Naming Conventions

Use tabs for indentation in HTML, CSS, and JavaScript to match the existing files. Keep HTML IDs and classes descriptive and consistent with the current camelCase and kebab-style mix, for example `headerTop`, `home-section`, `navMenu`, and `social-icon`. Place site-wide colors in CSS custom properties under `:root` before using them elsewhere. Prefer small, plain JavaScript functions over adding dependencies.

## Testing Guidelines

No automated test framework is configured. Validate changes manually in a browser at desktop and mobile widths, especially the fixed header, hamburger menu, section navigation, scroll-state underline behavior, and responsive profile/social icon layout. Check the browser console for JavaScript errors after each change.

## Commit & Pull Request Guidelines

Recent commit history uses short, imperative summaries such as `Fixed website scalability` and `Added functional links to link icons`. Keep commits focused and concise. Pull requests should describe the user-visible change, list manual browser checks performed, and include screenshots or screen recordings for layout, animation, or responsive changes.

## Security & Configuration Tips

Avoid committing secrets or personal access tokens. If external API work is added, use HTTPS endpoints where possible and avoid exposing private keys in client-side JavaScript.
