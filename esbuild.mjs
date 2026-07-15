import * as esbuild from "esbuild";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/**
 * Two entry points, deliberately.
 *
 * v1 shipped its webview JS as template-literal strings inside the extension
 * bundle: zero type-checking, zero bundling. AD-12 requires external assets
 * served from webview.cspSource — which is also what removes the need for a
 * nonce, since nothing is inline.
 */
const targets = [
  {
    entryPoints: ["src/surface/extension.ts"],
    outfile: "dist/extension.js",
    platform: "node",
    format: "cjs",
    external: ["vscode"],
  },
  {
    entryPoints: ["src/surface/webview/main.ts"],
    outfile: "media/main.js",
    platform: "browser",
    format: "iife",
    external: [],
  },
];

const common = {
  bundle: true,
  target: "node20",
  minify: production,
  sourcemap: !production,
  logLevel: "info",
};

if (watch) {
  const ctxs = await Promise.all(
    targets.map((t) => esbuild.context({ ...common, ...t })),
  );
  await Promise.all(ctxs.map((c) => c.watch()));
} else {
  await Promise.all(targets.map((t) => esbuild.build({ ...common, ...t })));
}
