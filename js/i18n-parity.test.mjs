/* ------------------------------------------------------------------
   i18n-parity.test.mjs — run with `node --test js/*.test.mjs`.

   Zero dependencies, node:test and node:assert only. i18n.js is a classic
   script whose dictionary is a top-level `const I18N`; js/i18n-obs-<locale>.js
   (the dashboard strings, one lazily loaded file per locale) extend it with
   Object.assign. All five are evaluated here in one Function body, so each
   locale file sees the const exactly as it does in the page, and the DOM
   half of i18n.js (from `function currentFleetLang` on) is cut off.

   What is defended: English source strings ARE the keys, so a missing key
   does not throw, it silently shows English. These checks are the only
   thing that notices. Every locale carries the same keys; every literal the
   page translates exists in every locale; the %n placeholders survive
   translation; and the dashboard's English never borrows market words
   ("bullish", "forecast"…) — a projection is arithmetic, not a call.
   ------------------------------------------------------------------ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');

const LOCALES = ['es', 'pt-BR', 'ja', 'ru'];

/* ---- load the dictionary ------------------------------------------- */

// One file per locale, and each must exist: a locale whose file is missing
// would show the dashboards in English with nothing here to say so.
const OBS = LOCALES.map((l) => 'js/i18n-obs-' + l + '.js');
for (const f of OBS) assert.ok(existsSync(new URL(f, ROOT)), f + ' is missing');
const I18N = new Function(
    read('i18n.js').split('function currentFleetLang')[0] + ';\n' +
    OBS.map(read).join(';\n') + ';\nreturn I18N;')();

/* ---- collect the literals ------------------------------------------ */

// A quoted JS string literal: '…' or "…", backslash escapes allowed. The
// unescape is enough for what the sources actually use (\' \" \\ \n).
const LIT = String.raw`(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)")`;
const unescape = (s) => s.replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c));

function literals(src, callRe) {
    const re = new RegExp(callRe + String.raw`\(\s*` + LIT, 'g');
    return [...src.matchAll(re)].map((m) => unescape(m[1] !== undefined ? m[1] : m[2]));
}

// Static markup: applyStaticI18n keys an element by its trimmed textContent.
// Only leaf text is collected (an element with child markup would need a
// DOM to compute its key, and none are written that way today).
function staticKeys(html) {
    return [...html.matchAll(/<([a-z][a-z0-9]*)\b[^>]*\bdata-i18n\b[^>]*>([^<]*)<\/\1>/gi)]
        .map((m) => m[2].trim()).filter(Boolean);
}

const html = read('index.html');
const jsFiles = readdirSync(new URL('js/', ROOT))
    .filter((f) => /^cve-.*\.js$/.test(f))
    .map((f) => ({ f: 'js/' + f, src: read('js/' + f) }));

// Where each key came from, for a failure message someone can act on.
const USED = new Map();
function use(key, where) {
    if (!USED.has(key)) USED.set(key, where);
}
for (const k of staticKeys(html)) use(k, 'index.html data-i18n');
for (const k of literals(html, String.raw`\b(?:t_|tf)`)) use(k, 'index.html t_/tf');
for (const { f, src } of jsFiles) {
    for (const k of literals(src, String.raw`\bTF?`)) use(k, f + ' T/TF');
    for (const k of literals(src, String.raw`\b(?:t_|tf)`)) use(k, f + ' t_/tf');
}

const placeholders = (s) => [...new Set(s.match(/%\d+/g) || [])].sort().join(',');

/* ---- tests ---------------------------------------------------------- */

test('every locale exists and carries the same key set', () => {
    for (const l of LOCALES) assert.ok(I18N[l], 'locale missing: ' + l);
    const all = new Set(LOCALES.flatMap((l) => Object.keys(I18N[l])));
    for (const l of LOCALES) {
        const missing = [...all].filter((k) => !(k in I18N[l]));
        assert.deepEqual(missing, [], l + ' lacks ' + missing.length + ' key(s)');
    }
});

test('no translation is empty', () => {
    for (const l of LOCALES) {
        const empty = Object.keys(I18N[l]).filter((k) =>
            typeof I18N[l][k] !== 'string' || !I18N[l][k].trim());
        assert.deepEqual(empty, [], l + ' has empty values');
    }
});

test('every literal the page translates exists in every locale', () => {
    assert.ok(USED.size > 50, 'literal scan found only ' + USED.size + ' keys — regex broken?');
    for (const l of LOCALES) {
        const missing = [...USED].filter(([k]) => !(k in I18N[l]))
            .map(([k, where]) => where + ': ' + JSON.stringify(k));
        assert.deepEqual(missing, [], l + ' is missing ' + missing.length + ' used key(s)');
    }
});

test('%n placeholder sets match the English key', () => {
    const bad = [];
    for (const l of LOCALES) {
        for (const [k, v] of Object.entries(I18N[l])) {
            if (placeholders(k) !== placeholders(String(v))) {
                bad.push(l + ': ' + JSON.stringify(k) + ' → ' + JSON.stringify(v));
            }
        }
    }
    assert.deepEqual(bad, []);
});

test('English keys use no market vocabulary', () => {
    const BANNED = /\b(bullish|bearish|breakout|momentum|rally|gainers|losers|ticker|signal|forecast)/i;
    // "risk score" is allowed only in the one disclaimer that denies it.
    const DISCLAIMER = 'Not a risk score, not a vulnerability assessment.';
    const keys = new Set([...Object.keys(I18N.es), ...USED.keys()]);
    const bad = [...keys].filter((k) =>
        BANNED.test(k) || (/risk score/i.test(k) && k !== DISCLAIMER));
    assert.deepEqual(bad, []);
});

test('each dashboard locale file extends its own locale and nothing else', () => {
    // The page loads only the current locale's file; one that also wrote
    // another locale's keys would make that locale depend on load order.
    for (const l of LOCALES) {
        const src = read('js/i18n-obs-' + l + '.js');
        const targets = [...src.matchAll(/Object\.assign\(\s*I18N\[\s*'([^']+)'\s*\]/g)].map((m) => m[1]);
        assert.deepEqual(targets, [l], 'js/i18n-obs-' + l + '.js extends ' + JSON.stringify(targets));
    }
});
