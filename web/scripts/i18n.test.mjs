import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const sourceURL = new URL("../src/i18n/index.ts", import.meta.url);
const require = createRequire(sourceURL);
const code = ts.transpileModule(readFileSync(sourceURL, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;

function load({ saved = null, languages = ["en-US"], language = "en-US", blocked = false, server = false } = {}) {
  const writes = [];
  let reloads = 0;
  const context = { exports: {}, require };
  if (!server) {
    context.document = { documentElement: { lang: "en" } };
    context.window = {
      localStorage: {
        getItem(key) {
          assert.equal(key, "artex.locale");
          if (blocked) throw new Error("Storage blocked");
          return saved;
        },
        setItem(key, value) {
          if (blocked) throw new Error("Storage blocked");
          writes.push([key, value]);
        },
      },
      navigator: { languages, language },
      location: { reload: () => { reloads++; } },
    };
  }
  vm.runInNewContext(code, context, { filename: "i18n/index.js" });
  return { api: context.exports, document: context.document, writes, reloads: () => reloads };
}

test("static export remains English and unknown keys fall back safely", () => {
  const { api } = load({ server: true });
  assert.equal(api.locale, "en");
  assert.equal(api.intlLocale, "en-US");
  assert.equal(api.t("Unknown {value}", { value: 3 }), "Unknown 3");
});

test("saved Turkish preference wins and sets the document and Intl locale", () => {
  const { api, document } = load({ saved: "tr", languages: ["en-US"] });
  assert.equal(api.locale, "tr");
  assert.equal(api.intlLocale, "tr-TR");
  assert.equal(document.documentElement.lang, "tr");
  assert.equal(api.t("Language"), "Dil");
  assert.equal(api.t("{count} tasks", { count: 3 }), "3 görev");
  assert.equal(api.t("Task #{id}"), "Görev #{id}");
  assert.equal(api.t("constructor"), "constructor");
  assert.equal(api.t("toString"), "toString");
  assert.equal(api.t("__proto__"), "__proto__");
  assert.equal(api.t("{count} tasks", Object.create({ count: 3 })), "{count} görev");
});

test("unsupported languages, invalid preferences and blocked storage fall back safely", () => {
  for (const tag of ["zh", "zh-CN", "zh-SG", "zh-Hans-CN", "ZH-cn", "fr-FR", "de-DE"]) {
    assert.equal(load({ languages: [tag] }).api.locale, "en");
  }
  assert.equal(load({ saved: "invalid", languages: ["fr-FR", "tr-TR"] }).api.locale, "tr");
  assert.equal(load({ blocked: true, languages: ["tr-TR"] }).api.locale, "tr");
  assert.equal(load({ languages: null, language: "tr-TR" }).api.locale, "tr");
  assert.equal(load({ languages: [], language: "zh-CN" }).api.locale, "en");
  assert.equal(load({ languages: ["fr-FR"] }).api.locale, "en");
});

test("existing English and Turkish preferences and formatting are preserved", () => {
  const english = load({ saved: "en", languages: ["fr-FR"] }).api;
  const turkish = load({ saved: "tr", languages: ["fr-FR"] }).api;
  assert.equal(english.locale, "en");
  assert.equal(english.t("Language"), "Language");
  assert.equal(turkish.locale, "tr");
  assert.equal(turkish.intlLocale, "tr-TR");
  assert.equal(turkish.t("Language"), "Dil");
  assert.equal(load({ languages: ["tr-TR"] }).api.locale, "tr");
});

test("switching persists the existing storage key and reloads once", () => {
  const state = load();
  state.api.setLocale("en");
  assert.equal(state.reloads(), 0);
  state.api.setLocale("tr");
  assert.deepEqual(state.writes, [["artex.locale", "tr"]]);
  assert.equal(state.reloads(), 1);
  const blocked = load({ blocked: true });
  assert.doesNotThrow(() => blocked.api.setLocale("tr"));
  assert.equal(blocked.reloads(), 1);
});
