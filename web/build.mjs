// Builds the MCP Apps board view (web/board-app.generated.mjs, committed so Node can import tools.mjs without a
// build), then dist/worker.mjs: the browser MCP client is bundled and inlined into the page, then the Worker is bundled.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const here = new URL('.', import.meta.url);
// zod bundles ~40 UI translations via one index module; the browser bundles only need English error messages.
const englishOnly = { name: 'zod-english-only', setup(b) {
  b.onLoad({ filter: /zod[\\/]v4[\\/]locales[\\/]index\.js$/ }, () => ({ contents: 'export { default as en } from "./en.js";', loader: 'js' }));
} };
const inline = async (entry, page, marker) => {
  const out = await build({ entryPoints: [new URL(entry, here).pathname], plugins: [englishOnly], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', minify: true, legalComments: 'none' });
  const js = out.outputFiles[0].text.replaceAll('</script', '<\\/script');
  return readFileSync(new URL(page, here), 'utf8').replace(marker, () => js);
};
export const boardSource = async () => `export const BOARD_APP_HTML = ${JSON.stringify(await inline('board-app.mjs', 'board-app.html', '/*APP*/'))};\n`;
if (process.argv.includes('--check-board')) {
  // Used by the tests: fails if the committed board view is older than its source.
  const fresh = await boardSource();
  if (fresh !== readFileSync(new URL('board-app.generated.mjs', here), 'utf8')) { console.error('web/board-app.generated.mjs is stale: run node web/build.mjs'); process.exit(1); }
  console.log('board view up to date');
} else {
  writeFileSync(new URL('board-app.generated.mjs', here), await boardSource());
  const html = await inline('client.mjs', 'page.html', '/*CLIENT*/');
  writeFileSync(new URL('page.generated.mjs', here), `export const HTML = ${JSON.stringify(html)};\n`);
  mkdirSync(new URL('../dist/', here), { recursive: true });
  await build({ entryPoints: [new URL('worker.mjs', here).pathname], bundle: true, outfile: new URL('../dist/worker.mjs', here).pathname, format: 'esm', platform: 'neutral', target: 'es2022', mainFields: ['module', 'main'], conditions: ['workerd', 'worker', 'import'], external: ['cloudflare:workers', 'node:*'], minify: true });
  console.log(`built: page ${Math.round(html.length / 1024)} KB, board view ${Math.round((await boardSource()).length / 1024)} KB`);
}
