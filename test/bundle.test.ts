import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * The bundle actually loads.
 *
 * Every other test exercises source. This one exercises what SHIPS — the thing
 * VS Code will `require()`. It exists because the two halves have genuinely
 * different runtimes and formats, and a mismatch there fails at activation with
 * an error no unit test would ever see.
 */

const root = join(import.meta.dirname, "..");
const hostBundle = join(root, "dist", "extension.cjs");
const webBundle = join(root, "media", "main.js");

const built = existsSync(hostBundle) && existsSync(webBundle);

test("the host bundle loads under require(), the way VS Code loads it", { skip: !built }, () => {
  // package.json is "type":"module" so Node runs the tests as ESM -- but an
  // extension host uses require(). The .cjs extension is what reconciles them;
  // as dist/extension.js this throws ERR_REQUIRE_ESM and the extension dies on
  // activation, which no source-level test would ever catch.
  //
  // `vscode` only exists inside a real host, so resolution of THAT module is
  // expected to fail here. Everything up to it must not: reaching the vscode
  // require means the module was found, parsed, and executed as CommonJS.
  const require = createRequire(import.meta.url);
  try {
    const mod = require(hostBundle) as { activate?: unknown; deactivate?: unknown };
    assert.equal(typeof mod.activate, "function");
    assert.equal(typeof mod.deactivate, "function");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    assert.equal(err.code, "MODULE_NOT_FOUND", `bundle failed to load: ${err.message}`);
    assert.match(err.message, /'vscode'/, `only vscode may be missing: ${err.message}`);
  }
});

test("the host bundle externalizes vscode and inlines everything else", { skip: !built }, () => {
  const src = readFileSync(hostBundle, "utf8");
  assert.match(src, /require\("vscode"\)/, "vscode must stay external");
  // Zero runtime dependencies: nothing but vscode and node: builtins.
  const requires = [...src.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1]!);
  const foreign = requires.filter((r) => r !== "vscode" && !r.startsWith("node:"));
  assert.deepEqual(foreign, [], `unexpected runtime dependency: ${foreign.join(", ")}`);
});

test("AD-12 — the webview bundle has no Node in it", { skip: !built }, () => {
  // The webview runs in a browser. A node: import here means the layering broke
  // and the bundle dies on load -- this is what caught model/ids.ts reaching
  // for node:crypto.
  const src = readFileSync(webBundle, "utf8");
  assert.doesNotMatch(src, /require\("node:/);
  assert.doesNotMatch(src, /from"node:/);
});

test("AD-12 — no CDN, no external fetch: the webview is self-contained", { skip: !built }, () => {
  const src = readFileSync(webBundle, "utf8");
  assert.doesNotMatch(src, /https?:\/\/(?!www\.w3\.org)/, "no external URL may appear");
});

test("the extension declares the .cjs entry it actually builds", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    main: string;
    type: string;
  };
  assert.equal(pkg.type, "module");
  assert.equal(pkg.main, "./dist/extension.cjs");
});
