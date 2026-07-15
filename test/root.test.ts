import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveRoot } from "../src/store/root.ts";

const HOME = "/home/cedric";

test("AD-6 — global by default: the app shows the same data whichever workspace is open", () => {
  const a = resolveRoot({
    firstWorkspaceFolder: "/work/project-a",
    configuredPath: null,
    home: HOME,
    exists: () => false,
  });
  const b = resolveRoot({
    firstWorkspaceFolder: "/work/project-b",
    configuredPath: null,
    home: HOME,
    exists: () => false,
  });
  assert.equal(a.path, b.path);
  assert.equal(a.kind, "home");
});

test("AD-6 — present means the DIRECTORY EXISTS; contents are never consulted", () => {
  // An empty .leaddeck/ still wins. A root that resolved differently when empty
  // would BE the silent switch this rule exists to prevent.
  const r = resolveRoot({
    firstWorkspaceFolder: "/work/a",
    configuredPath: null,
    home: HOME,
    exists: (p) => p.includes(".leaddeck"),
  });
  assert.equal(r.kind, "local");
});

test("AD-6 — local overrides configured, configured overrides home", () => {
  const local = resolveRoot({
    firstWorkspaceFolder: "/work/a",
    configuredPath: "/elsewhere",
    home: HOME,
    exists: (p) => p.includes(".leaddeck"),
  });
  assert.equal(local.kind, "local");

  const configured = resolveRoot({
    firstWorkspaceFolder: "/work/a",
    configuredPath: "/elsewhere",
    home: HOME,
    exists: () => false,
  });
  assert.equal(configured.kind, "configured");
});

test("AD-6 — no workspace open skips to the next candidate", () => {
  const r = resolveRoot({
    firstWorkspaceFolder: null,
    configuredPath: null,
    home: HOME,
    exists: () => false,
  });
  assert.equal(r.kind, "home");
});

test("AD-6 — an empty or whitespace storagePath counts as unset", () => {
  for (const configuredPath of ["", "   "]) {
    const r = resolveRoot({
      firstWorkspaceFolder: null,
      configuredPath,
      home: HOME,
      exists: () => false,
    });
    assert.equal(r.kind, "home");
  }
});

test("AD-6 — ~ expands", () => {
  const r = resolveRoot({
    firstWorkspaceFolder: null,
    configuredPath: "~/notes/deck",
    home: HOME,
    exists: () => false,
  });
  assert.ok(!r.path.includes("~"));
  assert.ok(r.path.includes("notes"));
});

test("AD-6 — multi-root consults only workspaceFolders[0]", () => {
  // A .leaddeck in folder [1] is ignored; AD-7's chip is the disclosure.
  const seen: string[] = [];
  resolveRoot({
    firstWorkspaceFolder: "/work/first",
    configuredPath: null,
    home: HOME,
    exists: (p) => {
      seen.push(p);
      return false;
    },
  });
  assert.equal(seen.length, 1);
  assert.ok(seen[0]!.includes("first"));
});
