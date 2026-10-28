# CrushCache

A FLAMES-style entertainment project. The GitHub Pages edition runs the existing score calculation entirely in the browser and clearly labels scores as entertainment, not relationship predictions.

## Browser demo

GitHub Pages publishes a browser-only edition. Names are not submitted to a server. Only the previous score/category is stored locally; the existing share button sends text only when a visitor chooses to open it.

Build with Node.js:

```powershell
node tools/build-pages.mjs
```

The output is `dist-pages/`. The Pages workflow publishes that directory automatically after pushes to `main`.

## Original serverless mode

The original Netlify function remains in `netlify/functions/`. It needs its separately configured Airtable/Redis environment values and is not part of the GitHub Pages deployment. This task does not create or configure those external services. Keep credentials out of the repository.
