// Builds dist/worker.mjs: the browser MCP client is bundled and inlined into the page, then the Worker is bundled.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const here = new URL('.', import.meta.url);
const client = await build({ entryPoints: [new URL('client.mjs', here).pathname], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', minify: true });
const js = client.outputFiles[0].text.replaceAll('</script', '<\\/script');
const html = readFileSync(new URL('page.html', here), 'utf8').replace('/*CLIENT*/', () => js);
writeFileSync(new URL('page.generated.mjs', here), `export const HTML = ${JSON.stringify(html)};\n`);
mkdirSync(new URL('../dist/', here), { recursive: true });
await build({ entryPoints: [new URL('worker.mjs', here).pathname], bundle: true, outfile: new URL('../dist/worker.mjs', here).pathname, format: 'esm', platform: 'neutral', target: 'es2022', mainFields: ['module', 'main'], conditions: ['workerd', 'worker', 'import'], external: ['cloudflare:workers', 'node:*'], minify: true });
console.log(`built: page ${Math.round(html.length / 1024)} KB`);
