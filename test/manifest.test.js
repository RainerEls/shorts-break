const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ROOT, read } = require("./helpers");

const manifest = JSON.parse(read("manifest.json"));
const exists = (file) => fs.existsSync(path.join(ROOT, file));

test("every file the manifest names exists", () => {
  const files = [
    ...Object.values(manifest.icons),
    ...manifest.background.scripts,
    ...manifest.content_scripts.flatMap((c) => [...(c.js || []), ...(c.css || [])]),
    manifest.browser_action.default_icon,
    manifest.browser_action.default_popup,
    manifest.options_ui.page,
  ];
  for (const file of files) assert.ok(exists(file), file);
});

test("every script and stylesheet the pages load exists", () => {
  for (const page of ["games.html", "popup.html", "options.html"]) {
    const html = read(page);
    const refs = [...html.matchAll(/<(?:script[^>]+src|link[^>]+href)="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(refs.length > 0, `${page} loads nothing`);
    for (const ref of refs) assert.ok(exists(ref), `${page} → ${ref}`);
  }
});

test("pages load common.js before the scripts that use it", () => {
  for (const page of ["games.html", "popup.html"]) {
    const srcs = [...read(page).matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(srcs[0], "lib/common.js", page);
  }
  assert.equal(manifest.background.scripts[0], "lib/common.js");
});

test("the content script runs only on YouTube", () => {
  for (const c of manifest.content_scripts) {
    for (const m of c.matches) assert.match(m, /^\*:\/\/\*\.youtube\.com\/\*$/);
  }
});

test("asks for no more permissions than it needs", () => {
  assert.deepEqual([...manifest.permissions].sort(), ["*://*.youtube.com/*", "storage"]);
});

test("declares no data collection", () => {
  assert.deepEqual(manifest.browser_specific_settings.gecko.data_collection_permissions.required, ["none"]);
});

test("keeps the add-on id that installed copies update from", () => {
  assert.equal(manifest.browser_specific_settings.gecko.id, "shorts-break@sleepy");
});

test("the version is a placeholder the release stamps", () => {
  assert.equal(manifest.version, "0.0.0");
});

test("every script parses", () => {
  const vm = require("node:vm");
  const scripts = fs.readdirSync(ROOT).filter((f) => f.endsWith(".js")).concat(fs.readdirSync(path.join(ROOT, "lib")).filter((f) => f.endsWith(".js")).map((f) => `lib/${f}`));
  for (const file of scripts) assert.doesNotThrow(() => new vm.Script(read(file), { filename: file }), file);
});
