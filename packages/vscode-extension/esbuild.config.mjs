import * as esbuild from 'esbuild';
import { readFileSync } from 'fs';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {esbuild.BuildOptions} */
const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  external: ['vscode'],
  outfile: 'dist/extension.js',
  sourcemap: !production,
  minify: production,
};

// The extension renders on the main thread only (it never passes `mode: 'worker'`
// nor calls render*ToBitmap). Each viewer package still ships a render worker as
// a dynamically-imported host plus a self-contained module asset. esbuild's iife
// output can't code-split that dynamic import into a lazy chunk (only
// esm/splitting can), so it would otherwise inline dead worker-loading code into
// webview.js. Stub the import to a throwing no-op — it is never reached at
// runtime in the extension.
const stubRenderWorkerPlugin = {
  name: 'stub-render-worker',
  setup(build) {
    build.onResolve({ filter: /render-worker-host/ }, (args) => ({
      path: args.path,
      namespace: 'stub-render-worker',
    }));
    build.onLoad({ filter: /.*/, namespace: 'stub-render-worker' }, () => ({
      contents:
        "export function createRenderWorker() {" +
        " throw new Error('[ooxml] worker rendering is not available in the VS Code extension (main-thread only)'); }",
      loader: 'js',
    }));
  },
};

/** @type {esbuild.BuildOptions} */
const webviewConfig = {
  entryPoints: ['src/webview/bootstrap.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  outfile: 'dist/webview.js',
  sourcemap: !production,
  minify: production,
  // WASM files are loaded at runtime via fetch — exclude from bundle
  external: ['*.wasm'],
  loader: {
    '.wasm': 'file',
  },
  plugins: [stubRenderWorkerPlugin],
};

async function build() {
  if (watch) {
    const [extCtx, wvCtx] = await Promise.all([
      esbuild.context(extensionConfig),
      esbuild.context(webviewConfig),
    ]);
    await Promise.all([extCtx.watch(), wvCtx.watch()]);
    console.log('[esbuild] watching...');
  } else {
    await Promise.all([
      esbuild.build(extensionConfig),
      esbuild.build(webviewConfig),
    ]);
    console.log('[esbuild] build complete');
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
