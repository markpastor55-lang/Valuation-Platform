/**
 * Bundles the preview into one self-contained HTML fragment (dist/index.html) that can be opened
 * from disk or published as a page. Workspace packages resolve to their TypeScript sources.
 */
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

const result = await build({
  entryPoints: ['src/main.tsx'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2022',
  conditions: ['source'],
  legalComments: 'none',
  write: false,
});
const js = result.outputFiles[0].text
  .replaceAll('</script', '<\\/script')
  .replaceAll('<!--', '<\\!--');
const css = await readFile('src/styles.css', 'utf8');
const html = `<title>Valuation Platform Preview</title>
<meta name="description" content="Clickable preview of the valuation inspection and reporting app, running the real rules engine on synthetic data.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+Condensed:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&family=Caveat:wght@500&display=swap">
<style>
${css}</style>
<div id="app"></div>
<script>
${js}</script>
`;
await mkdir('dist', { recursive: true });
await writeFile('dist/index.html', html);
// A complete document for opening straight from a phone or desktop (no hosting needed).
const standalone =
  `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#23508a">
${html}`.replace('<div id="app"></div>', '</head>\n<body>\n<div id="app"></div>') +
  '</body>\n</html>\n';
await writeFile('dist/valuation-platform-preview.html', standalone);
process.stdout.write(`dist/index.html ${(html.length / 1024).toFixed(0)} KB\n`);
