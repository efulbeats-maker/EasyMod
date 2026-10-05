'use strict';
// EasyMod staging build: SOLO plugin Nuvio (6 scraper da manifest).
// Default e --nuvio costruiscono gli stessi 6 bundle. Nessuna funzione
// aggregator/server (no index bundle, no transpile, no Stremio/Docker).
// Target/format/platform preservati: es2016, cjs, neutral.
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const PROVIDERS_DIR = path.join(__dirname, 'providers');
const SRC_DIR = path.join(__dirname, 'src');

const NUVIO_SCRAPERS = [
  'guardoserie',
  'animeunity',
  'animeworld',
  'animesaturn',
  'streamingcommunity',
  'altadefinizionestreaming'
];
const NUVIO_ENTRY_OVERRIDE = {
  guardoserie: path.join(SRC_DIR, 'guardoserie', 'nuvio.js')
};
const NUVIO_EXTERNAL = ['undici', 'fs', 'path', 'https', 'http', 'http2', 'url', 'crypto', 'util', 'zlib', 'stream', 'events', 'assert', 'sql.js', 'puppeteer-extra', 'puppeteer-extra-plugin-stealth', 'axios', 'child_process'];

async function buildNuvioProviders(minify = false) {
  console.log('Building Nuvio plugin providers (6 scrapers only)...');
  if (!fs.existsSync(SRC_DIR)) {
    throw new Error('Src directory not found!');
  }
  if (!fs.existsSync(PROVIDERS_DIR)) {
    fs.mkdirSync(PROVIDERS_DIR, { recursive: true });
  }
  for (const provider of NUVIO_SCRAPERS) {
    const entryPoint = NUVIO_ENTRY_OVERRIDE[provider] || path.join(SRC_DIR, provider, 'index.js');
    const outFile = path.join(PROVIDERS_DIR, `${provider}.js`);
    if (!fs.existsSync(entryPoint)) {
      throw new Error(`Missing entry for ${provider}: ${entryPoint}.`);
    }
    console.log(`Building (nuvio) ${provider} from ${path.relative(__dirname, entryPoint)}...`);
    try {
      await esbuild.build({
        entryPoints: [entryPoint],
        outfile: outFile,
        bundle: true,
        minify: minify,
        platform: 'neutral',
        target: ['es2016'],
        format: 'cjs',
        define: {
          'process.env.NODE_ENV': minify ? '"production"' : '"development"'
        },
        external: NUVIO_EXTERNAL,
        nodePaths: process.env.NODE_PATH ? String(process.env.NODE_PATH).split(path.delimiter).filter(Boolean) : []
      });
      console.log(`✅ Built (nuvio) ${provider}`);
    } catch (e) {
      throw new Error(`Failed to build (nuvio) ${provider}: ${e && e.message ? e.message : e}`);
    }
  }
  console.log('Nuvio build done: 6 plugin bundles only.');
}

async function build() {
  const args = process.argv.slice(2);
  const shouldMinify = args.includes('--minify');
  // Default e --nuvio: stesso output plugin-only (6 bundle).
  await buildNuvioProviders(shouldMinify);
}

build().catch((e) => { console.error(e); process.exitCode = 1; });
