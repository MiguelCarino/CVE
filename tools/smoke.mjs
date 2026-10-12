#!/usr/bin/env node
/* ------------------------------------------------------------------
   smoke.mjs — headless Chromium smoke test for the List / Trends /
   Projection / Observatory modes of index.html.

     node tools/smoke.mjs                 fixture mirror (js/fixtures/obs)
     node tools/smoke.mjs --live          drop ?mirror=, read cve-data.carino.systems
     node tools/smoke.mjs --only=1,2      run a subset of the numbered checks
     node tools/smoke.mjs --shots=DIR     where the screenshots go
                                          (default: $TMPDIR/cve-smoke)
     node tools/smoke.mjs --chromium=PATH (default: /usr/bin/chromium-browser,
                                          or $CHROMIUM)
     node tools/smoke.mjs --verbose       also print requests and tolerated errors
     node tools/smoke.mjs --runs=N        timing runs per variant in check 9 (default 3)

   Zero dependencies: Node 22's global WebSocket speaks the Chrome
   DevTools Protocol directly, `python3 -m http.server` serves the repo,
   and each numbered check runs in its own browser context so no state
   (hash, localStorage, the fleet language cookie) leaks between them.
   Exit status is non-zero if any check fails, or the harness itself does.

   NVD is never reached: every request to it is answered by the harness
   (CDP Fetch domain) with a canned page of records after a fixed delay, so
   the list's own timing is the same on every run and the dashboards'
   effect on it can be measured. The default mirror the list reads its
   KEV/EPSS badges from is refused for the same reason.

   What is defended is the page contract, not the pixels: the list loads
   as it did before the dashboards existed, and nothing of theirs runs
   until it has settled; the dashboards are prepared behind it in small
   pieces and their buttons open only when each is ready, in order; a
   prepared mode opens at once; the dashboard draws without NaN, verifies
   its hashes, hatches what is still settling and labels what is projected;
   the back button and the shared hash survive a round trip; a link to a
   mode opens it when it has loaded, a click while one loads gets its own
   history entry and working with the list cancels a waiting link; the
   list's KEV filter and its web fonts are not delayed or relaid out by
   the dashboards; a resize rebuilds the hidden modes at the new width;
   the header keeps its row; nothing scrolls sideways on a phone; and the
   old stats.html links still land on the right panel.
   ------------------------------------------------------------------ */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../', import.meta.url));

const ARGV = process.argv.slice(2);
const flag = (name) => {
    const a = ARGV.find((x) => x === '--' + name || x.startsWith('--' + name + '='));
    return a === undefined ? undefined : (a.includes('=') ? a.slice(a.indexOf('=') + 1) : true);
};
const LIVE = !!flag('live');
const ONLY = String(flag('only') || '').split(',').filter(Boolean).map(Number);
const SHOTS = String(flag('shots') || join(tmpdir(), 'cve-smoke'));
const CHROMIUM = String(flag('chromium') || process.env.CHROMIUM || '/usr/bin/chromium-browser');
const VERBOSE = !!flag('verbose');

const RUNS = Math.max(1, parseInt(flag('runs'), 10) || 3);

const STEP_MS = 30000;        // ceiling for one CDP call
const DRAW_MS = 10000;        // SPEC §8: the dashboard has 10 s to draw
const READY_MS = 20000;       // ceiling for all three modes to be prepared
const NVD_MS = 1500;          // the canned NVD answer's delay
const SLOW_NVD_MS = 4500;     // …and a slow one, past CveModes' 3 s idle delay

/* ---- the selectors this test leans on --------------------------------
   Kept in one place: the SPEC fixes the class names (.o-pulse, .stat-tile,
   .o-cone80, .o-readout) but not every container id, so the section
   lookups try the explicit hook first and fall back to the id. */

const SEL = {
    root: '#obsRoot',
    trends: '#obsTrends',
    proj: '#obsProj',
    obs: '#obsCorpus',
    header: '#obsHeader',
    mode: (m) => '#modeSwitch [data-mode="' + m + '"]',
    tile: '#obsTrends .o-pulse .stat-tile',
    tileLabel: '#obsTrends .o-pulse .stat-tile .st-label',
    cone: '#obsProj .o-cone80',
    readout: '.o-readout',
};

const HOST_SEL = { trends: SEL.trends, proj: SEL.proj, obs: SEL.obs };

// The section element for an `x` id inside a mode root. Corpus panels
// (#obs-volume) are skipped, so a Trends id never resolves to one.
const SECTION_JS = `function (root, x) {
    var r = document.querySelector(root);
    if (!r) return null;
    var hit = r.querySelector('[data-x="' + x + '"]') || r.querySelector('[data-section="' + x + '"]');
    if (hit) return hit;
    var all = r.querySelectorAll('[id*="' + x + '"]');
    for (var i = 0; i < all.length; i++) {
        if (!all[i].closest('.o-panel') && all[i].id !== 'obs-' + x) return all[i];
    }
    return null;
}`;

// Requests that belong to the dashboards. Before the list has settled none
// may start; with ?noobs none may start at all (SPEC §8 assertion 1). The
// list reads KEV and EPSS from the default mirror for its badges, so the
// feed names only count on this origin (the fixture mirror).
// The web fonts only the dashboards use count as theirs: the list never
// asks for these weights.
const OBS_FILE = /cve-obs|cve-trends|cve-project|cve-corpus-panels|cve-tschart|cve-indicators|cve-series|cve-observatory|i18n-obs|fonts\/(IBMPlexMono-600|RedHatDisplay-(700|800))-/;
const OBS_DATA = /stats\.json|ticks\.json|epss-window|enrich\/kev\.json|fixtures\/obs\/manifest\.json/;
const isObsReq = (origin) => (u) => (u.startsWith(origin) && (OBS_FILE.test(u) || OBS_DATA.test(u))) ||
    /stats\.json|ticks\.json|epss-window/.test(u);
// The scripts a long animation frame may not be attributed to while the
// dashboards are prepared in the background.
const OBS_SCRIPT = /cve-modes|cve-obs|cve-trends|cve-projection|cve-project\b|cve-corpus-panels|cve-tschart|cve-indicators|cve-series|cve-observatory|i18n-obs/;

/* ---- processes ------------------------------------------------------- */

const children = [];
let profileDir = null;

function freePort() {
    return new Promise((resolve, reject) => {
        const s = createServer();
        s.unref();
        s.on('error', reject);
        s.listen(0, '127.0.0.1', () => {
            const { port } = s.address();
            s.close(() => resolve(port));
        });
    });
}

function launch(cmd, args, label) {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let tail = '';
    p.stderr.on('data', (d) => { tail = (tail + d).slice(-4000); });
    p.on('error', (e) => { tail += '\n' + e.message; p.failed = true; });
    p.label = label;
    p.tail = () => tail;
    children.push(p);
    return p;
}

// Poll fn until truthy. `proc`, when given, is a child whose death ends the
// wait at once instead of at the timeout.
async function until(fn, ms, what, proc) {
    const t0 = Date.now();
    let last;
    while (Date.now() - t0 < ms) {
        if (proc && (proc.exitCode !== null || proc.signalCode !== null || proc.failed)) {
            throw new Error(proc.label + ' exited before ' + what);
        }
        try {
            const v = await fn();
            if (v) return v;
        } catch (e) { last = e; }
        await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('timed out after ' + ms + ' ms: ' + what + (last ? ' (' + last.message + ')' : ''));
}

// Kill everything we started, then drop the throwaway profile. Safe to
// call twice (normal exit and a signal racing it).
let cleaned = false;
async function cleanup() {
    if (cleaned) return;
    cleaned = true;
    for (const p of children) {
        if (p.exitCode === null && p.signalCode === null) p.kill('SIGTERM');
    }
    await Promise.all(children.map((p) => (p.exitCode !== null || p.signalCode !== null)
        ? null
        : new Promise((r) => {
            const t = setTimeout(() => { p.kill('SIGKILL'); r(); }, 3000);
            p.once('exit', () => { clearTimeout(t); r(); });
        })));
    if (profileDir) {
        try { rmSync(profileDir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
    }
}
for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => { cleanup().then(() => process.exit(130)); });
}

/* ---- a minimal CDP client ------------------------------------------- */

class Cdp {
    constructor(url) {
        this.url = url;
        this.id = 0;
        this.pending = new Map();
        this.handlers = new Set();
    }
    open() {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(this.url);
            this.ws = ws;
            ws.onopen = () => resolve(this);
            ws.onerror = () => reject(new Error('CDP socket failed: ' + this.url));
            ws.onclose = () => {
                for (const { reject: rj } of this.pending.values()) rj(new Error('CDP socket closed'));
                this.pending.clear();
            };
            ws.onmessage = (ev) => {
                const msg = JSON.parse(ev.data);
                if (msg.id !== undefined && this.pending.has(msg.id)) {
                    const { resolve: rs, reject: rj, method } = this.pending.get(msg.id);
                    this.pending.delete(msg.id);
                    if (msg.error) rj(new Error(method + ': ' + msg.error.message));
                    else rs(msg.result);
                    return;
                }
                for (const h of this.handlers) h(msg);
            };
        });
    }
    send(method, params = {}, sessionId) {
        const id = ++this.id;
        const msg = { id, method, params };
        if (sessionId) msg.sessionId = sessionId;
        return new Promise((resolve, reject) => {
            const t = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(method + ': no reply in ' + STEP_MS + ' ms'));
            }, STEP_MS);
            this.pending.set(id, {
                method,
                resolve: (v) => { clearTimeout(t); resolve(v); },
                reject: (e) => { clearTimeout(t); reject(e); },
            });
            this.ws.send(JSON.stringify(msg));
        });
    }
    on(fn) { this.handlers.add(fn); return () => this.handlers.delete(fn); }
    close() { try { this.ws.close(); } catch (e) { /* already gone */ } }
}

/* ---- the canned NVD answer ---------------------------------------------

   200 records over the last 90 days, the same on every run: enough cards
   that rendering them is a real piece of work for the page, so a
   dashboard piece that ran in its way would show in the list's timing. */
function nvdFixture() {
    const sev = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
    const score = { CRITICAL: 9.8, HIGH: 7.5, MEDIUM: 5.3, LOW: 3.1 };
    const t0 = Date.UTC(2026, 9, 1);
    const vulns = [];
    for (let i = 0; i < 200; i++) {
        const s = sev[i % 4];
        const d = new Date(t0 - i * 9 * 3600 * 1000).toISOString().slice(0, 23);
        vulns.push({ cve: {
            id: 'CVE-2026-' + String(10000 + i), sourceIdentifier: 'smoke@example.org',
            published: d, lastModified: d, vulnStatus: 'Analyzed',
            descriptions: [{ lang: 'en', value: 'Smoke-test record ' + i + ': a buffer overflow in an example component allows a remote attacker to do something it should not. <user_id> stays escaped.' }],
            metrics: { cvssMetricV31: [{ source: 'nvd@nist.gov', type: 'Primary', cvssData: {
                version: '3.1', vectorString: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
                baseScore: score[s], baseSeverity: s } }] },
            weaknesses: [{ source: 'nvd@nist.gov', type: 'Primary', description: [{ lang: 'en', value: 'CWE-' + (79 + i % 7) }] }],
            references: [],
        } });
    }
    return Buffer.from(JSON.stringify({
        resultsPerPage: vulns.length, startIndex: 0, totalResults: vulns.length,
        format: 'NVD_CVE', version: '2.0', timestamp: new Date(t0).toISOString(), vulnerabilities: vulns,
    })).toString('base64');
}
const NVD_BODY = nvdFixture();

/* What the page records about itself, from the first line of the document:
   when the list's first result (or its error) entered the DOM and when the
   frame after it was painted, every long task and long animation frame
   with the scripts in it, and each change of a mode button's state. */
const PROBE = `(function () {
    var P = window.__perf = { listDom: null, listPaint: null, lt: [], loaf: [], btn: [], kevOn: null, fontsDone: [], fontAdds: [] };
    // Web fonts: every face that finished loading through the CSS (each one
    // is a relayout of the whole page), and every face a script handed to
    // the document — with whether a rebuild of the list happened in the
    // same task (its layout then covers the face).
    try {
        document.fonts.addEventListener('loadingdone', function (e) {
            P.fontsDone.push({ t: performance.now(), f: e.fontfaces.map(function (x) { return x.family.replace(/"/g, '') + ' ' + x.weight; }) });
        });
        var add = FontFaceSet.prototype.add, open = null;
        FontFaceSet.prototype.add = function (f) {
            var e = { t: performance.now(), f: String(f.family).replace(/"/g, '') + ' ' + f.weight, rebuild: false };
            P.fontAdds.push(e);
            if (!open) { open = []; setTimeout(function () { open = null; }, 0); }
            open.push(e);
            return add.call(this, f);
        };
        P.__fontTask = function () { if (open) open.forEach(function (e) { e.rebuild = true; }); };
    } catch (e) {}
    try { new PerformanceObserver(function (l) { l.getEntries().forEach(function (e) { P.lt.push({ s: e.startTime, d: e.duration }); }); })
        .observe({ type: 'longtask', buffered: true }); } catch (e) {}
    try { new PerformanceObserver(function (l) { l.getEntries().forEach(function (e) {
        P.loaf.push({ s: e.startTime, d: e.duration, b: e.blockingDuration,
            r: e.renderStart ? e.renderStart - e.startTime : 0, l: e.styleAndLayoutStart ? e.styleAndLayoutStart - e.startTime : 0,
            scripts: (e.scripts || []).map(function (x) {
            return { u: x.sourceURL || '', f: x.sourceFunctionName || '', d: x.duration, i: x.invoker || '', fl: x.forcedStyleAndLayoutDuration || 0, st: x.startTime - e.startTime }; }) });
    }); }).observe({ type: 'long-animation-frame', buffered: true }); } catch (e) {}
    document.addEventListener('DOMContentLoaded', function () {
        var list = document.getElementById('resultsList');
        if (list) new MutationObserver(function () { if (P.__fontTask) P.__fontTask(); }).observe(list, { childList: true });
        var kev = document.getElementById('kevOnly');
        if (kev) new MutationObserver(function () {
            if (P.kevOn == null && !kev.disabled) P.kevOn = performance.now();
        }).observe(kev, { attributes: true, attributeFilter: ['disabled'] });
        if (list) new MutationObserver(function () {
            if (P.listDom != null || !list.querySelector('.cve-item, .empty')) return;
            P.listDom = performance.now();
            requestAnimationFrame(function () { setTimeout(function () { P.listPaint = performance.now(); }, 0); });
        }).observe(list, { childList: true });
        var sw = document.getElementById('modeSwitch');
        if (!sw) return;
        var last = {};
        var log = function () {
            Array.prototype.forEach.call(sw.querySelectorAll('[data-mode]'), function (b) {
                var m = b.getAttribute('data-mode');
                var k = (b.getAttribute('data-state') || '') + '|' + b.disabled;
                if (last[m] === k) return;
                last[m] = k;
                P.btn.push({ m: m, state: b.getAttribute('data-state') || '', disabled: b.disabled, t: performance.now() });
            });
        };
        log();
        new MutationObserver(log).observe(sw, { attributes: true, subtree: true, attributeFilter: ['disabled', 'data-state'] });
    });
})();`;

/* ---- a page in its own browser context ------------------------------ */

// The default mirror's files, served from the fixture mirror when a timed
// visit wants the list's KEV and EPSS badges to load (`badges`).
function fixtureFile(url) {
    try {
        const path = join(REPO, 'js/fixtures/obs', new URL(url).pathname);
        if (!path.startsWith(join(REPO, 'js/fixtures/obs'))) return null;
        return readFileSync(path);
    } catch (e) { return null; }
}

async function openPage(cdp, origin, { width = 1280, height = 900, mobile = false, nvdMs = NVD_MS, cpu = 1, badges = false } = {}) {
    const { browserContextId } = await cdp.send('Target.createBrowserContext', { disposeOnDetach: true });
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const send = (m, p) => cdp.send(m, p, sessionId);

    const page = { requests: [], errors: [], waiters: new Set() };
    const off = cdp.on((msg) => {
        if (msg.sessionId !== sessionId) return;
        const p = msg.params || {};
        switch (msg.method) {
            case 'Fetch.requestPaused':
                // NVD: the canned page, after the fixed delay. The default
                // mirror (the list's badges): refused at once.
                if (/services\.nvd\.nist\.gov/.test(p.request.url)) {
                    setTimeout(() => {
                        send('Fetch.fulfillRequest', {
                            requestId: p.requestId, responseCode: 200, body: NVD_BODY,
                            responseHeaders: [{ name: 'Content-Type', value: 'application/json' },
                                { name: 'Access-Control-Allow-Origin', value: '*' }],
                        }).catch(() => {});
                    }, nvdMs);
                } else {
                    const body = badges ? fixtureFile(p.request.url) : null;
                    if (body) {
                        send('Fetch.fulfillRequest', {
                            requestId: p.requestId, responseCode: 200, body: body.toString('base64'),
                            responseHeaders: [{ name: 'Content-Type', value: /\.json$/.test(p.request.url) ? 'application/json' : 'application/octet-stream' },
                                { name: 'Access-Control-Allow-Origin', value: '*' }],
                        }).catch(() => {});
                    } else {
                        send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'InternetDisconnected' }).catch(() => {});
                    }
                }
                break;
            case 'Network.requestWillBeSent':
                page.requests.push(p.request.url);
                break;
            case 'Runtime.exceptionThrown': {
                const d = p.exceptionDetails || {};
                page.errors.push({ kind: 'exception', text: (d.exception && d.exception.description) || d.text, url: d.url || '' });
                break;
            }
            case 'Runtime.consoleAPICalled':
                if (p.type === 'error' || p.type === 'assert') {
                    page.errors.push({
                        kind: 'console',
                        text: (p.args || []).map((a) => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(' '),
                        url: (p.stackTrace && p.stackTrace.callFrames[0] && p.stackTrace.callFrames[0].url) || '',
                    });
                }
                break;
            case 'Log.entryAdded':
                if (p.entry.level === 'error') {
                    page.errors.push({ kind: 'log:' + p.entry.source, text: p.entry.text, url: p.entry.url || '' });
                }
                break;
        }
        for (const w of page.waiters) w(msg);
    });
    await Promise.all(['Page.enable', 'Runtime.enable', 'Network.enable', 'Log.enable'].map((m) => send(m)));
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
    const patterns = [{ urlPattern: '*services.nvd.nist.gov*', requestStage: 'Request' }];
    if (!LIVE) patterns.push({ urlPattern: '*cve-data.carino.systems*', requestStage: 'Request' });
    await send('Fetch.enable', { patterns });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: PROBE });
    if (cpu > 1) await send('Emulation.setCPUThrottlingRate', { rate: cpu });

    function once(method, ms) {
        return new Promise((resolve, reject) => {
            const t = setTimeout(() => { page.waiters.delete(w); reject(new Error('no ' + method + ' in ' + ms + ' ms')); }, ms);
            const w = (msg) => {
                if (msg.method === method) { clearTimeout(t); page.waiters.delete(w); resolve(msg.params); }
            };
            page.waiters.add(w);
        });
    }

    Object.assign(page, {
        send,
        async goto(path) {
            const loaded = once('Page.loadEventFired', STEP_MS);
            const r = await send('Page.navigate', { url: origin + path });
            if (r.errorText) throw new Error('navigate ' + path + ': ' + r.errorText);
            await loaded;
        },
        async eval(expression) {
            const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
            if (r.exceptionDetails) {
                const d = r.exceptionDetails;
                throw new Error('eval: ' + ((d.exception && d.exception.description) || d.text));
            }
            return r.result.value;
        },
        waitFor(expression, ms, what) {
            return until(() => page.eval(expression), ms, what || expression);
        },
        async click(sel) {
            const ok = await page.eval('(function(){var e=document.querySelector(' + JSON.stringify(sel) +
                ');if(!e)return false;e.click();return true;})()');
            if (!ok) throw new Error('nothing to click: ' + sel);
        },
        async shot(name) {
            const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
            writeFileSync(join(SHOTS, name + '.png'), Buffer.from(data, 'base64'));
        },
        async close() {
            off();
            await cdp.send('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
        },
    });
    return page;
}

/* ---- checks ----------------------------------------------------------- */

const results = [];

// One numbered check. `expect` records a failure and carries on, so a run
// reports everything that is wrong rather than the first thing; a thrown
// error (a timeout, a missing element) ends the check.
async function step(n, title, fn) {
    if (ONLY.length && n !== 0 && !ONLY.includes(n)) return;   // 0 feeds the rest
    const fails = [];
    const expect = (cond, msg) => { if (!cond) fails.push(msg); return !!cond; };
    const t0 = Date.now();
    try {
        await fn(expect);
    } catch (e) {
        fails.push(e.message);
    }
    const ok = fails.length === 0;
    results.push({ n, title, ok, fails });
    const ms = Date.now() - t0;
    console.log((ok ? 'PASS ' : 'FAIL ') + n + '. ' + title + ' (' + ms + ' ms)');
    for (const f of fails) console.log('     - ' + f);
}

// Console noise the List page makes on its own when NVD (or the default
// mirror) is unreachable: SPEC §8 tolerates it. Anything thrown by our own
// origin's scripts is never tolerated.
function realErrors(page, origin) {
    const tolerated = (e) => {
        const local = e.url.startsWith(origin);
        if (e.kind === 'log:network' && !local) return true;
        if (e.kind === 'log:network' && /\/favicon\.ico$/.test(e.url)) return true;
        return e.kind === 'console' && /nvd\.nist\.gov|Failed to fetch|NetworkError|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|cve-data\.carino\.systems/i.test(e.text);
    };
    if (VERBOSE) {
        for (const e of page.errors.filter(tolerated)) console.log('     (tolerated) ' + e.kind + ': ' + String(e.text).split('\n')[0] + ' ' + e.url);
    }
    return page.errors.filter((e) => !tolerated(e)).map((e) => e.kind + ': ' + String(e.text).split('\n')[0] + (e.url ? ' @ ' + e.url : ''));
}

const hashOf = (page) => page.eval('location.hash');
const hashParams = async (page) => new URLSearchParams((await hashOf(page)).replace(/^#/, ''));

// Every attribute of every SVG node under a root, scanned for the values a
// broken scale writes (SPEC §8 assertion 2).
const BAD_SVG_JS = (root) => `(function(){
    var bad = [];
    document.querySelectorAll(${JSON.stringify(root + ' svg, ' + root + ' svg *')}).forEach(function (n) {
        for (var i = 0; i < n.attributes.length; i++) {
            var a = n.attributes[i];
            if (/NaN|undefined|Infinity/.test(a.value)) bad.push(n.tagName + '[' + a.name + '="' + a.value.slice(0, 60) + '"]');
        }
    });
    return bad.slice(0, 5).concat(bad.length > 5 ? ['… ' + (bad.length - 5) + ' more'] : []);
})()`;

const textOf = (sel) => `(function(){var e=document.querySelector(${JSON.stringify(sel)});return e?e.textContent.replace(/\\s+/g,' ').trim():null;})()`;
const countOf = (sel) => `document.querySelectorAll(${JSON.stringify(sel)}).length`;
const hidden = (sel) => `(function(){var e=document.querySelector(${JSON.stringify(sel)});` +
    `return !e || e.hidden || getComputedStyle(e).display === 'none';})()`;

// The manifestSha256 recipe the page must reproduce (SPEC §1.3): sha256 of
// the manifest minus `stats` and `ticks`, serialised, plus a newline.
function manifestHash(manifest) {
    const m = { ...manifest };
    delete m.stats;
    delete m.ticks;
    return createHash('sha256').update(JSON.stringify(m) + '\n').digest('hex');
}

async function main() {
    mkdirSync(SHOTS, { recursive: true });

    /* -- static server -- */
    const port = await freePort();
    const origin = 'http://127.0.0.1:' + port;
    const server = launch('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', REPO], 'http.server');
    await until(() => fetch(origin + '/index.html', { method: 'HEAD' }).then((r) => r.ok), 10000,
        'python http.server on ' + origin, server);

    const mirror = origin + '/js/fixtures/obs';
    const mq = LIVE ? '' : '?mirror=' + encodeURIComponent(mirror);
    const withQ = (extra) => (mq ? mq + (extra ? '&' + extra : '') : (extra ? '?' + extra : ''));

    // The page has to verify the raw .gz bytes, so the server must not set
    // Content-Encoding (the browser would inflate them first). The expected
    // manifest hash is computed here from the same bytes the page reads.
    let expectHash = null;
    await step(0, 'harness: server, fixtures and manifest hash', async (expect) => {
        const base = LIVE ? 'https://cve-data.carino.systems' : mirror;
        const manifest = await fetch(base + '/manifest.json', { cache: 'no-store' }).then((r) => {
            if (!r.ok) throw new Error('manifest.json: HTTP ' + r.status);
            return r.json();
        });
        expectHash = manifestHash(manifest);
        if (LIVE) return;
        const entries = [manifest.stats, manifest.ticks, manifest.enrich && manifest.enrich.kev,
            manifest.enrich && manifest.enrich.epssWindow];
        for (const e of entries) {
            if (!expect(e && e.file, 'manifest entry missing')) continue;
            const r = await fetch(mirror + '/' + e.file, { cache: 'no-store' });
            if (!expect(r.ok, e.file + ': HTTP ' + r.status)) continue;
            expect(!r.headers.get('content-encoding'), e.file + ' served with Content-Encoding ' + r.headers.get('content-encoding'));
            const sha = createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex');
            expect(sha === e.sha256, e.file + ' sha256 ' + sha.slice(0, 12) + '… ≠ manifest ' + String(e.sha256).slice(0, 12) + '…');
        }
    });

    /* -- browser -- */
    const cdpPort = await freePort();
    profileDir = mkdtempSync(join(tmpdir(), 'cve-smoke-profile-'));
    const chrome = launch(CHROMIUM, [
        '--headless=new',
        '--remote-debugging-port=' + cdpPort,
        '--remote-debugging-address=127.0.0.1',
        '--user-data-dir=' + profileDir,
        '--window-size=1280,900',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-sync',
        '--lang=en-US',
        'about:blank',
    ], 'chromium');
    const ver = await until(() => fetch('http://127.0.0.1:' + cdpPort + '/json/version').then((r) => r.json()),
        15000, 'chromium DevTools endpoint', chrome);
    const cdp = await new Cdp(ver.webSocketDebuggerUrl).open();
    console.log('# ' + ver.Browser + ' · ' + origin + (LIVE ? ' · live mirror' : ' · fixture mirror'));

    // A page left on index.html with the app booted.
    async function boot(path, opts) {
        const page = await openPage(cdp, origin, opts);
        await page.goto(path);
        await page.waitFor("typeof window.cveRerender === 'function' && !!document.getElementById('resultsList')",
            DRAW_MS, 'index.html boot');
        return page;
    }

    const DASH = ['trends', 'proj', 'obs'];
    const readyJs = (m) => `(function(){var b=document.querySelector(${JSON.stringify(SEL.mode(m))});` +
        `return !!b&&!b.disabled&&b.getAttribute('data-state')==='ready';})()`;
    const allReady = '(' + DASH.map(readyJs).join('&&') + ')';
    const drawn = (m) => '!(' + hidden(HOST_SEL[m]) + ') && document.querySelectorAll(' +
        JSON.stringify(HOST_SEL[m] + ' svg') + ').length > 0';

    // Switch mode by clicking the segmented control, as a person would —
    // once its button says the mode is ready.
    async function toMode(page, m) {
        if (m !== 'list') await page.waitFor(readyJs(m), READY_MS, m + ' button enabled');
        await page.click(SEL.mode(m));
        if (m === 'list') {
            await page.waitFor(hidden(SEL.root), DRAW_MS, 'List mode hides ' + SEL.root);
        } else {
            await page.waitFor(drawn(m), DRAW_MS, m + ' mode draws');
        }
    }

    // The visible label of each mode button (the long name on a desktop).
    const modeLabels = `[].map.call(document.querySelectorAll('#modeSwitch [data-mode]'),function(b){return b.innerText.replace(/\\s+/g,' ').trim();})`;

    /* One timed visit (check 9). Waits for the list's first paint and, with
       the dashboards on, for all three to be ready; with `clicks`, opens
       each mode in turn and times the click to the frame that shows it. */
    async function perfRun({ noobs = false, nvdMs = NVD_MS, cpu = 1, clicks = false } = {}) {
        // The list's KEV and EPSS feeds load too (from the fixture mirror),
        // so the time its KEV filter is enabled can be compared.
        const page = await boot('/index.html' + withQ(noobs ? 'noobs' : ''), { nvdMs, cpu, badges: !LIVE });
        try {
            await page.waitFor('window.__perf && __perf.listPaint != null', nvdMs + 20000 * cpu, 'list painted');
            if (!LIVE) await page.waitFor('__perf.kevOn != null', 20000 * cpu, 'KEV filter enabled');
            if (noobs) await new Promise((r) => setTimeout(r, 1500));
            else await page.waitFor(allReady, READY_MS * cpu, 'all three modes ready');
            // Long enough for a web font asked for by the last piece to land.
            await new Promise((r) => setTimeout(r, 300));
            const r = await page.eval(`(function(){var P=__perf;var nav=performance.getEntriesByType('navigation')[0]||{};
                return {listDom:P.listDom,listPaint:P.listPaint,dcl:nav.domContentLoadedEventStart||0,kevOn:P.kevOn,
                res:performance.getEntriesByType('resource').map(function(e){return {u:e.name,s:e.startTime};}),
                fontsDone:P.fontsDone,fontAdds:P.fontAdds,loaf:P.loaf,lt:P.lt,btn:P.btn};})()`);
            const obsRes = r.res.filter((x) => isObsReq(origin)(x.u));
            const out = {
                listDom: r.listDom, listPaint: r.listPaint, dcl: r.dcl,
                firstObs: obsRes.length ? Math.min(...obsRes.map((x) => x.s)) : null,
                firstObsUrl: obsRes.length ? obsRes.reduce((a, x) => (x.s < a.s ? x : a)).u : null,
                obsRequests: obsRes.length, btn: r.btn, readyAt: {}, frames: [], clicks: {},
                // From the list's first result to its KEV filter being usable.
                kevGap: r.kevOn != null && r.listDom != null ? r.kevOn - r.listDom : null,
                // Faces that finished loading through the CSS after the list
                // was drawn, and faces a script added outside a list rebuild.
                lateFonts: [...new Set(r.fontsDone.filter((x) => x.t >= r.listDom).flatMap((x) => x.f))].sort(),
                strayAdds: r.fontAdds.filter((x) => x.t >= r.listDom && !x.rebuild).map((x) => x.f + ' @' + Math.round(x.t)),
                fontAdds: r.fontAdds.length,
                requests: page.requests.filter(isObsReq(origin)),
            };
            for (const m of DASH) {
                const e = r.btn.find((b) => b.m === m && b.state === 'ready' && !b.disabled);
                out.readyAt[m] = e ? e.t : null;
            }
            // Long frames while the dashboards were being prepared, and how
            // much of each was the dashboards' own script.
            const end = Math.max(...DASH.map((m) => out.readyAt[m] || 0)) + 100;
            const from = out.firstObs == null ? Infinity : out.firstObs;
            out.frames = r.loaf.filter((f) => f.s + f.d >= from && f.s <= end).map((f) => {
                const own = f.scripts.filter((x) => OBS_SCRIPT.test(x.u));
                return { s: f.s, d: f.d, r: f.r, l: f.l, own: own.reduce((a, x) => a + x.d, 0), top: own.sort((a, b) => b.d - a.d)[0] || null, all: f.scripts };
            });
            if (VERBOSE) for (const f of out.frames.filter((x) => x.d > 50)) console.log('     (frame) ' + JSON.stringify(f));
            out.longTasks = r.lt.filter((x) => x.s + x.d >= from && x.s <= end).map((x) => x.d);
            if (clicks) {
                for (const m of DASH.concat(['list'])) {
                    out.clicks[m] = await page.eval(`(async function(){
                        var b=document.querySelector(${JSON.stringify(SEL.mode(m))});
                        var host=document.querySelector(${JSON.stringify(m === 'list' ? '#resultsList' : HOST_SEL[m])});
                        var t0=performance.now(); b.click();
                        await new Promise(function(r){requestAnimationFrame(function(){setTimeout(r,0);});});
                        var t1=performance.now();
                        var vis=!!host&&!host.hidden&&host.getBoundingClientRect().height>0&&
                            (${m === 'list'}||host.querySelectorAll('svg').length>0);
                        await new Promise(function(r){setTimeout(r,400);});
                        var fr=__perf.loaf.filter(function(f){return f.s+f.d>=t0&&f.s<=t1+400;}).map(function(f){return f.d;});
                        var lt=__perf.lt.filter(function(f){return f.s+f.d>=t0&&f.s<=t1+400;}).map(function(f){return f.d;});
                        var big=__perf.loaf.filter(function(f){return f.s+f.d>=t0&&f.s<=t1+400;}).sort(function(a,b){return b.d-a.d;})[0]||null;
                        return {ms:t1-t0,vis:vis,frame:fr.length?Math.max.apply(null,fr):0,task:lt.length?Math.max.apply(null,lt):0,
                            big:big&&{at:Math.round(big.s-t0),d:Math.round(big.d),r:Math.round(big.r),l:Math.round(big.l),
                                scripts:big.scripts.map(function(x){return x.u.split('/').pop()+':'+x.f+' '+x.i+' '+Math.round(x.d)+'/'+Math.round(x.fl);})}};
                    })()`);
                }
            }
            if (VERBOSE) for (const m of Object.keys(out.clicks)) console.log('     (click ' + m + ') ' + JSON.stringify(out.clicks[m]));
            out.errors = realErrors(page, origin);
            return out;
        } finally { await page.close(); }
    }
    const median = (a) => { const b = a.filter((v) => v != null).sort((x, y) => x - y); return b.length ? b[Math.floor((b.length - 1) / 2)] : null; };
    const ms = (v) => (v == null ? '—' : Math.round(v) + ' ms');

    let englishProbe = null;

    try {
        /* 1. List mode is the page it was ---------------------------------- */
        await step(1, 'List: nothing of the dashboards before the list settles; ?noobs loads none; no console errors', async (expect) => {
            const page = await boot('/index.html' + withQ());
            try {
                await page.waitFor('window.__perf && __perf.listPaint != null', NVD_MS + DRAW_MS, 'list painted');
                expect(await page.eval(hidden(SEL.root)), SEL.root + ' is visible in List mode');
                const disabled = await page.eval(`(function(){var P=__perf.btn;return ${JSON.stringify(DASH)}.every(function(m){
                    var e=P.find(function(b){return b.m===m;});return !!e&&e.disabled;});})()`);
                expect(disabled, 'a dashboard button was not disabled from the start');
                await page.shot('1-list-loading');
                await page.waitFor(allReady, READY_MS, 'all three modes ready');
                const r = await page.eval(`({listDom:__perf.listDom,res:performance.getEntriesByType('resource').map(function(e){return {u:e.name,s:e.startTime};})})`);
                const early = r.res.filter((x) => isObsReq(origin)(x.u) && x.s < r.listDom);
                expect(early.length === 0, 'dashboard requests before the list settled: ' + early.slice(0, 5).map((x) => x.u.replace(origin, '') + ' @' + Math.round(x.s)).join(', '));
                expect(await page.eval(hidden(SEL.root)), SEL.root + ' became visible on its own');
                // The modes are built, and stay laid out, inside #obsRoot:
                // while the list shows it takes no space, and is out of the
                // tab order and the accessibility tree.
                expect(await page.eval(`(function(){var r=document.querySelector(${JSON.stringify(SEL.root)});
                    return r.getBoundingClientRect().height===0&&r.getAttribute('aria-hidden')==='true';})()`),
                    SEL.root + ' takes up space in List mode, or is not aria-hidden');
                // checkVisibility() is false under display:none and inside a
                // content-visibility:hidden box, which is what keeps a mode
                // out of the tab order there.
                const focusable = await page.eval(`[].filter.call(document.querySelectorAll(${JSON.stringify(SEL.root)}+' :is(a[href],button,input,select,textarea,summary,[tabindex])'),function(e){
                    return !e.closest('[inert]')&&e.checkVisibility();}).length`);
                expect(focusable === 0, focusable + ' focusable element(s) in ' + SEL.root + ' while the list shows');
                expect(await page.eval(`[].every.call(document.querySelectorAll(${JSON.stringify(SEL.root)}+' > [hidden]'),function(h){
                    return h.getBoundingClientRect().height===0&&getComputedStyle(h).contentVisibility==='hidden';})`),
                    'a mode not on screen takes up space, or is not skipped');
                const errs = realErrors(page, origin);
                expect(errs.length === 0, 'console errors:\n       ' + errs.slice(0, 8).join('\n       '));
                await page.shot('1-list');
            } finally { await page.close(); }

            // ?noobs: the page the list was before the dashboards existed —
            // and a click still opens a mode, loaded then.
            const lazy = await boot('/index.html' + withQ('noobs'));
            try {
                await lazy.waitFor('window.__perf && __perf.listPaint != null', NVD_MS + DRAW_MS, 'list painted (?noobs)');
                await new Promise((r) => setTimeout(r, 5000));
                if (VERBOSE) for (const u of lazy.requests) console.log('     (request) ' + u);
                const leaked = lazy.requests.filter(isObsReq(origin));
                expect(leaked.length === 0, '?noobs requested: ' + leaked.slice(0, 5).join(', '));
                const st = await lazy.eval(`[].map.call(document.querySelectorAll('#modeSwitch [data-mode]'),function(b){return b.getAttribute('data-mode')+':'+(b.getAttribute('data-state')||'')+':'+b.disabled;})`);
                expect(st.join(' ') === 'list::false trends:idle:false proj:idle:false obs:idle:false', '?noobs buttons: ' + st.join(' '));
                await lazy.click(SEL.mode('trends'));
                await lazy.waitFor(drawn('trends'), DRAW_MS, '?noobs: Trends opens when it has loaded')
                    .catch((e) => expect(false, e.message));
                const errs = realErrors(lazy, origin);
                expect(errs.length === 0, 'console errors (?noobs):\n       ' + errs.slice(0, 8).join('\n       '));
            } finally { await lazy.close(); }
        });

        /* 2. Trends ---------------------------------------------------------- */
        await step(2, 'Trends: draws, verifies, hatches, reads out', async (expect) => {
            const page = await boot('/index.html' + withQ());
            try {
                await toMode(page, 'trends');
                expect(/(^#|&)m=trends(&|$)/.test(await hashOf(page)), 'hash lacks m=trends: ' + await hashOf(page));
                await page.waitFor(countOf(SEL.trends + ' svg') + ' >= 6', DRAW_MS, '≥ 6 svg in ' + SEL.trends);
                expect(await page.eval(countOf(SEL.tile)) === 6, 'Pulse tiles: ' + await page.eval(countOf(SEL.tile)) + ', want 6');
                expect(await page.eval(countOf(SEL.trends + ' details.o-panel')) === 0, 'Trends still holds the corpus panels');
                const bad = await page.eval(BAD_SVG_JS(SEL.root));
                expect(bad.length === 0, 'bad SVG attributes: ' + bad.join('; '));

                // The manifest-hash badge: the first 8 hex digits, with a ✓.
                const head = await page.eval(textOf(SEL.header)) || '';
                const short = expectHash ? expectHash.slice(0, 8) : '';
                expect(short && head.includes(short), 'header lacks manifest hash ' + short + ': ' + head.slice(0, 160));
                expect(await page.eval(`(function(){var r=document.querySelector(${JSON.stringify(SEL.header)});if(!r)return false;
                    var w=document.createTreeWalker(r,NodeFilter.SHOW_ELEMENT),n;
                    while((n=w.nextNode())){var t=n.textContent;if(t.indexOf(${JSON.stringify(short)})!==-1&&t.length<80&&t.indexOf('✓')!==-1&&t.indexOf('✗')===-1)return true;}
                    return false;})()`), 'manifest hash badge does not show ✓');

                // The volume chart: a hatched settle rect, and a readout on hover.
                const vol = '(' + SECTION_JS + ')(' + JSON.stringify(SEL.trends) + ', "volume")';
                expect(await page.eval(`(function(){var s=${vol};return !!(s&&s.querySelector('rect[fill^="url(#"]'));})()`),
                    'no hatch rect (fill="url(#…)") in the volume chart');
                const box = await page.eval(`(function(){var s=${vol};if(!s)return null;
                    var p=s.querySelector('[role="img"][tabindex]')||s.querySelector('svg');if(!p)return null;
                    p.scrollIntoView({block:'center'});var r=p.getBoundingClientRect();
                    return {x:r.left+r.width*0.6,y:r.top+r.height*0.5,w:r.width,h:r.height};})()`);
                if (expect(box && box.w > 0, 'volume plot not found')) {
                    await new Promise((r) => setTimeout(r, 200));
                    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x - 20, y: box.y });
                    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
                    await page.waitFor(`(function(){var e=document.querySelector(${JSON.stringify(SEL.readout)});
                        return !!e && !e.hidden && getComputedStyle(e).display!=='none' && getComputedStyle(e).visibility!=='hidden'
                        && e.textContent.trim().length>0;})()`, 3000, 'visible ' + SEL.readout + ' after pointermove')
                        .catch((e) => expect(false, e.message));
                    await page.shot('2-trends-readout');
                }
                // Charts drawn off-screen were drawn at the width they are
                // shown at: no figure is wider than its column.
                const over = await page.eval(`[].filter.call(document.querySelectorAll('${SEL.trends} .fig-scroll > svg'),function(s){
                    return s.getBoundingClientRect().width > s.parentNode.getBoundingClientRect().width + 4 && !s.parentNode.hasAttribute('tabindex');}).length`);
                expect(over === 0, over + ' Trends chart(s) wider than their box without a scroll affordance');
                englishProbe = {
                    modes: await page.eval(modeLabels),
                    pulse: await page.eval(`[].map.call(document.querySelectorAll(${JSON.stringify(SEL.tileLabel)}),function(b){return b.textContent.trim();})`),
                };
                await page.eval("document.querySelector('.results-area') && document.querySelector('.results-area').scrollTo(0,0)");
                await page.shot('2-trends');
                const errs = realErrors(page, origin);
                expect(errs.length === 0, 'console errors:\n       ' + errs.slice(0, 8).join('\n       '));
            } finally { await page.close(); }
        });

        /* 3. Projection -------------------------------------------------------- */
        await step(3, 'Projection: 4 cones, 4 track-record rows, gate counter', async (expect) => {
            const page = await boot('/index.html' + withQ());
            try {
                await toMode(page, 'proj');
                expect(/(^#|&)m=proj(&|$)/.test(await hashOf(page)), 'hash lacks m=proj: ' + await hashOf(page));
                await page.waitFor(countOf(SEL.cone) + ' >= 4', DRAW_MS, '4 × ' + SEL.cone)
                    .catch((e) => expect(false, e.message));
                const cones = await page.eval(countOf(SEL.cone));
                expect(cones === 4, 'cones: ' + cones + ', want 4');
                const rec = '(' + SECTION_JS + ')(' + JSON.stringify(SEL.proj) + ', "record")';
                const rows = await page.eval(`(function(){var s=${rec}||document.querySelector(${JSON.stringify(SEL.proj)});
                    var t=s&&s.querySelector('table');if(!t)return -1;
                    return (t.tBodies[0]?t.tBodies[0].rows.length:t.rows.length-1);})()`);
                expect(rows === 4, 'track-record rows: ' + rows + ', want 4');
                const np = '(' + SECTION_JS + ')(' + JSON.stringify(SEL.proj) + ', "notproj")';
                const npText = await page.eval(`(function(){var s=${np}||document.querySelector(${JSON.stringify(SEL.proj)});return s?s.textContent:'';})()`);
                expect(/\b1 of 8\b/.test(npText), 'Not projected lacks "1 of 8"');
                // The KEV cone is drawn complete, not "loading" then patched.
                const kev = '(' + SECTION_JS + ')(' + JSON.stringify(SEL.proj) + ', "kev")';
                expect(await page.eval(`(function(){var s=${kev};return !!s&&!!s.querySelector('.o-cone80');})()`), 'KEV section has no cone');
                const bad = await page.eval(BAD_SVG_JS(SEL.proj));
                expect(bad.length === 0, 'bad SVG attributes: ' + bad.join('; '));
                await page.shot('3-projection');
                const errs = realErrors(page, origin);
                expect(errs.length === 0, 'console errors:\n       ' + errs.slice(0, 8).join('\n       '));
            } finally { await page.close(); }
        });

        /* 4. Observatory -------------------------------------------------------- */
        await step(4, 'Observatory: seven panels, all built, stamped, chip bar, rail link', async (expect) => {
            const page = await boot('/index.html' + withQ());
            try {
                await page.waitFor(readyJs('obs'), READY_MS, 'obs button enabled');
                // The rail's link opens the same mode.
                await page.click('#obsLink');
                await page.waitFor(drawn('obs'), DRAW_MS, 'Observatory draws from the rail link');
                expect(/(^#|&)m=obs(&|$)/.test(await hashOf(page)), 'hash lacks m=obs: ' + await hashOf(page));
                const panels = await page.eval(`[].map.call(document.querySelectorAll('${SEL.obs} details.o-panel'),function(d){
                    return d.id+':'+d.open+':'+(d.querySelector('.o-panel-body').childNodes.length>0);})`);
                expect(panels.length === 7, 'panels: ' + panels.length + ', want 7');
                expect(panels.every((p) => /:true:true$/.test(p)), 'a panel is closed or unbuilt: ' + panels.join(' '));
                const chips = await page.eval(countOf(SEL.header + ' .o-chipbar [data-x]'));
                expect(chips === 7, 'Observatory chips: ' + chips + ', want 7');
                const stamps = await page.eval(countOf(SEL.obs + ' figure.fig .stamp'));
                const figs = await page.eval(countOf(SEL.obs + ' figure.fig'));
                expect(figs > 0 && stamps === figs, 'stamps ' + stamps + ' of ' + figs + ' figures');
                const bad = await page.eval(BAD_SVG_JS(SEL.obs));
                expect(bad.length === 0, 'bad SVG attributes: ' + bad.join('; '));
                await page.shot('4-observatory');
                const errs = realErrors(page, origin);
                expect(errs.length === 0, 'console errors:\n       ' + errs.slice(0, 8).join('\n       '));
            } finally { await page.close(); }
        });

        /* 5. Back button ----------------------------------------------------- */
        await step(5, 'History: back → Trends, back → List', async (expect) => {
            const page = await boot('/index.html' + withQ());
            try {
                await toMode(page, 'trends');
                await toMode(page, 'obs');
                await page.eval('history.back()');
                await page.waitFor('/(^#|&)m=trends(&|$)/.test(location.hash)', DRAW_MS, 'first back → m=trends')
                    .catch((e) => expect(false, e.message));
                await page.waitFor('!(' + hidden(SEL.trends) + ')', DRAW_MS, 'Trends shown after back')
                    .catch((e) => expect(false, e.message));
                await page.eval('history.back()');
                await page.waitFor("!/(^#|&)m=/.test(location.hash)", DRAW_MS, 'second back → no m=')
                    .catch((e) => expect(false, e.message));
                await page.waitFor(hidden(SEL.root), DRAW_MS, 'List shown after second back')
                    .catch((e) => expect(false, e.message));
                await page.shot('5-history');
            } finally { await page.close(); }
        });

        /* 6. Shared hash survives the round trip -------------------------------- */
        await step(6, 'Round trip keeps q and s', async (expect) => {
            const page = await boot('/index.html' + withQ() + '#q=log4j&s=HIGH');
            try {
                await toMode(page, 'trends');
                let p = await hashParams(page);
                expect(p.get('q') === 'log4j' && p.get('s') === 'HIGH', 'Trends hash dropped q/s: ' + await hashOf(page));
                await toMode(page, 'list');
                p = await hashParams(page);
                expect(p.get('q') === 'log4j' && p.get('s') === 'HIGH' && !p.has('m'),
                    'List hash after round trip: ' + await hashOf(page));
                expect(await page.eval("document.getElementById('searchTerm').value") === 'log4j', '#searchTerm lost log4j');
                expect(await page.eval("document.getElementById('cvssSeverity').value") === 'HIGH', '#cvssSeverity lost HIGH');
            } finally { await page.close(); }
        });

        /* 7. Phone width ------------------------------------------------------- */
        await step(7, '375 px: no horizontal scroll in any mode; 320 px: four buttons fit in every language', async (expect) => {
            const page = await boot('/index.html' + withQ(), { width: 375, height: 812, mobile: true });
            try {
                // The loading state on a phone: the list is in, the modes are not yet.
                await page.waitFor('window.__perf && __perf.listPaint != null', NVD_MS + DRAW_MS, 'list painted');
                await page.shot('7-phone-loading');
                await page.waitFor(allReady, READY_MS, 'all three modes ready');
                for (const m of ['list'].concat(DASH)) {
                    if (m !== 'list') await toMode(page, m);
                    await new Promise((r) => setTimeout(r, 300));
                    const w = await page.eval('({sw:document.documentElement.scrollWidth, iw:innerWidth})');
                    expect(w.sw <= w.iw, m + ': scrollWidth ' + w.sw + ' > innerWidth ' + w.iw);
                    await page.shot('7-phone-' + m);
                }
            } finally { await page.close(); }
            for (const lang of ['en', 'es', 'pt-BR', 'ja', 'ru']) {
                const p = await boot('/index.html' + withQ('lang=' + lang + '&noobs'), { width: 320, height: 640, mobile: true });
                try {
                    const fit = await p.eval(`(function(){var sw=document.getElementById('modeSwitch');var r=sw.getBoundingClientRect();
                        var out=[].map.call(sw.querySelectorAll('[data-mode]'),function(b){var c=b.getBoundingClientRect();
                        return {t:b.innerText.trim(),cut:b.scrollWidth>b.clientWidth+1,out:c.right>r.right+1||c.left<r.left-1,name:b.textContent.trim()};});
                        return {rows:Math.round(r.height),btns:out,sw:document.documentElement.scrollWidth,iw:innerWidth};})()`);
                    expect(fit.btns.length === 4, lang + ': ' + fit.btns.length + ' buttons');
                    const cut = fit.btns.filter((b) => b.cut || b.out).map((b) => b.t);
                    expect(cut.length === 0, lang + ' at 320 px: label cut off: ' + cut.join(', '));
                    expect(fit.sw <= fit.iw, lang + ' at 320 px: page scrolls sideways');
                    if (lang === 'ru') {
                        await p.waitFor('window.__perf && __perf.listPaint != null', NVD_MS + DRAW_MS, 'list painted (ru)').catch(() => {});
                        await p.shot('7-phone-320-ru');
                    }
                } finally { await p.close(); }
            }
        });

        /* 8. Japanese -------------------------------------------------------- */
        await step(8, '?lang=ja#m=trends: opens by itself; buttons and Pulse labels are translated; only ja strings load', async (expect) => {
            const page = await boot('/index.html' + withQ('lang=ja') + '#m=trends');
            try {
                await page.waitFor(countOf(SEL.tileLabel) + ' >= 6', READY_MS, 'Pulse labels in ja');
                const modes = await page.eval(modeLabels);
                const pulse = await page.eval(`[].map.call(document.querySelectorAll(${JSON.stringify(SEL.tileLabel)}),function(b){return b.textContent.trim();})`);
                const en = englishProbe || { modes: ['List', 'Trends', 'Projection', 'Observatory'], pulse: [] };
                const same = (a, b) => a.filter((x, i) => x === b[i]);
                expect(modes.length === 4 && same(modes, en.modes).length === 0, 'mode buttons not translated: ' + modes.join(' | '));
                expect(pulse.length === 6 && (!en.pulse.length || same(pulse, en.pulse).length === 0),
                    'Pulse labels not translated: ' + pulse.join(' | '));
                const loc = page.requests.filter((u) => /i18n-obs/.test(u)).map((u) => u.replace(/.*\//, ''));
                expect(loc.length === 1 && loc[0] === 'i18n-obs-ja.js', 'locale files fetched: ' + loc.join(', '));
                await page.shot('8-trends-ja');
            } finally { await page.close(); }
            // English fetches no dashboard strings at all.
            const enPage = await boot('/index.html' + withQ('lang=en'));
            try {
                await enPage.waitFor(allReady, READY_MS, 'all three modes ready (en)');
                const loc = enPage.requests.filter((u) => /i18n-obs/.test(u));
                expect(loc.length === 0, 'English fetched ' + loc.join(', '));
            } finally { await enPage.close(); }
        });

        /* 9. Old stats.html links ------------------------------------------------ */
        await step(9, 'stats.html#kev lands on #m=obs&x=kev; old #m=trends&x=corpus-* links follow', async (expect) => {
            const page = await openPage(cdp, origin);
            try {
                await page.goto('/stats.html' + withQ() + '#kev');
                await page.waitFor("/\\/index\\.html$/.test(location.pathname)", DRAW_MS, 'redirect to index.html');
                const href = await page.eval('location.href');
                expect(/#m=obs&x=kev$/.test(href), 'landed on ' + href);
                if (!LIVE) expect(href.includes('mirror='), '?mirror= dropped by the redirect: ' + href);
                await page.waitFor("typeof window.cveRerender === 'function'", DRAW_MS, 'index.html boot').catch(() => {});
                await page.waitFor(`(function(){var d=document.getElementById('obs-kev');return !!d&&d.open&&!d.closest('[hidden]')&&!d.closest('[data-staging]');})()`, READY_MS,
                    'corpus panel #obs-kev open and shown').catch((e) => expect(false, e.message));
                await page.shot('9-stats-redirect');
            } finally { await page.close(); }
            const bare = await openPage(cdp, origin);
            try {
                await bare.goto('/stats.html' + withQ());
                await bare.waitFor("/\\/index\\.html$/.test(location.pathname)", DRAW_MS, 'redirect to index.html');
                const href = await bare.eval('location.href');
                expect(/#m=obs$/.test(href), 'stats.html landed on ' + href);
            } finally { await bare.close(); }
            const old = await boot('/index.html' + withQ() + '#m=trends&x=corpus-cwe');
            try {
                await old.waitFor(drawn('obs'), READY_MS, 'old corpus link opens the Observatory').catch((e) => expect(false, e.message));
                const p = await hashParams(old);
                expect(p.get('m') === 'obs' && p.get('x') === 'cwe', 'old corpus link became ' + await hashOf(old));
            } finally { await old.close(); }
        });

        /* 10. Deep links wait for their mode ------------------------------------- */
        await step(10, 'Deep link: the list first, a note, then the mode by itself; a search meanwhile cancels it', async (expect) => {
            const page = await boot('/index.html' + withQ() + '#m=proj&x=kev');
            try {
                const early = await page.eval(`({mode: document.querySelector('.results-area').classList.contains('is-obs'),
                    note: !document.getElementById('modeNote').hidden, text: document.getElementById('modeNote').textContent})`);
                expect(!early.mode, 'a deep link showed the dashboard before the list');
                expect(early.note && /Projection/.test(early.text), 'no "will open when it has loaded" note: ' + JSON.stringify(early));
                await page.waitFor('window.__perf && __perf.listPaint != null', NVD_MS + DRAW_MS, 'list painted first');
                await page.waitFor(drawn('proj'), READY_MS, 'Projection opens by itself').catch((e) => expect(false, e.message));
                const p = await hashParams(page);
                expect(p.get('m') === 'proj' && p.get('x') === 'kev', 'hash after the switch: ' + await hashOf(page));
                expect(await page.eval("document.getElementById('modeNote').hidden"), 'note still shown after the switch');
                const listFirst = await page.eval(`(function(){var e=__perf.btn.find(function(b){return b.m==='proj'&&b.state==='ready';});return !!e&&e.t>=__perf.listDom;})()`);
                expect(listFirst, 'Projection was ready before the list had rendered');
            } finally { await page.close(); }

            const cancel = await boot('/index.html' + withQ() + '#m=obs');
            try {
                await cancel.eval("document.getElementById('searchTerm').value='chrome';document.querySelector('.search-btn').click()");
                await cancel.waitFor(allReady, READY_MS, 'all three modes ready');
                await new Promise((r) => setTimeout(r, 300));
                expect(await cancel.eval(hidden(SEL.root)), 'the Observatory opened after the reader had searched');
                const p = await hashParams(cancel);
                expect(!p.has('m') && p.get('q') === 'chrome', 'hash after a cancelled deep link: ' + await hashOf(cancel));
                expect(await cancel.eval("document.getElementById('modeNote').hidden"), 'note still shown after the search');
            } finally { await cancel.close(); }
        });

        /* 11. Timing --------------------------------------------------------------- */
        await step(11, 'Timing (1x): the list is not slower; nothing early; no long frames from the dashboards; buttons in order; switches < 150 ms', async (expect) => {
            for (const nvdMs of [NVD_MS, SLOW_NVD_MS]) {
                const on = [], off = [];
                for (let i = 0; i < RUNS; i++) {
                    off.push(await perfRun({ noobs: true, nvdMs }));
                    on.push(await perfRun({ nvdMs, clicks: i === 0 }));
                }
                const mOn = median(on.map((r) => r.listPaint)), mOff = median(off.map((r) => r.listPaint));
                console.log('     NVD ' + nvdMs + ' ms · list painted at ' + ms(mOn) + ' with the dashboards, ' + ms(mOff) + ' with ?noobs (medians of ' + RUNS + ')');
                // (a) within 10 % (+50 ms) of the page without the dashboards.
                expect(mOn <= mOff * 1.1 + 50, 'NVD ' + nvdMs + ': list painted at ' + ms(mOn) + ' vs ' + ms(mOff) + ' without the dashboards');
                // (a) …and so are its KEV and EPSS feeds: the KEV filter is
                // enabled as soon after the first result as without them.
                if (!LIVE) {
                    const kOn = median(on.map((r) => r.kevGap)), kOff = median(off.map((r) => r.kevGap));
                    console.log('     KEV filter enabled ' + ms(kOn) + ' after the first result with the dashboards, ' + ms(kOff) + ' with ?noobs');
                    expect(kOn != null && kOff != null && kOn <= kOff * 1.1 + 50, 'NVD ' + nvdMs + ': KEV filter enabled ' + ms(kOn) + ' after the list vs ' + ms(kOff) + ' without the dashboards');
                }
                // (c) no relayout of the whole list for the dashboards' web
                // fonts: no face loads through the CSS after the list is
                // drawn that does not load without them, and the faces they
                // add enter with a rebuild of the list.
                const base = new Set(off.flatMap((r) => r.lateFonts));
                for (const r of on) {
                    // (b) nothing before the list settled or the idle delay passed.
                    const gate = Math.min(r.listDom, r.dcl + 3000) - 50;
                    expect(r.firstObs != null && r.firstObs >= gate, 'NVD ' + nvdMs + ': first dashboard request at ' + ms(r.firstObs) +
                        ' (' + String(r.firstObsUrl).replace(origin, '') + '), before ' + ms(gate));
                    const extra = r.lateFonts.filter((f) => !base.has(f));
                    expect(extra.length === 0, 'NVD ' + nvdMs + ': web fonts loaded after the list only with the dashboards: ' + extra.join(', '));
                    expect(r.fontAdds > 0 || LIVE, 'NVD ' + nvdMs + ': the dashboards added no web font (the faces would each load on their own)');
                    expect(r.strayAdds.length === 0, 'NVD ' + nvdMs + ': web fonts added outside a list rebuild: ' + r.strayAdds.slice(0, 4).join(', '));
                    // (c) no long frame that is the dashboards' doing.
                    const long = r.frames.filter((f) => f.d > 50 && f.own > 0);
                    expect(long.length === 0, 'NVD ' + nvdMs + ': long frames with dashboard script: ' +
                        long.slice(0, 4).map((f) => Math.round(f.d) + ' ms (own ' + Math.round(f.own) + ' ms, ' +
                            (f.top ? f.top.u.replace(/.*\//, '') + ' ' + f.top.f + ' ' + f.top.i : '') + ')').join('; '));
                    // (d) disabled from the start, then ready in order.
                    for (const m of DASH) {
                        const first = r.btn.find((b) => b.m === m);
                        expect(first && first.disabled, m + ' was not disabled at first');
                    }
                    const order = DASH.map((m) => r.readyAt[m]);
                    expect(order.every((t) => t != null) && order[0] < order[1] && order[1] < order[2],
                        'NVD ' + nvdMs + ': ready out of order: ' + DASH.map((m, i) => m + ' ' + ms(order[i])).join(', '));
                    expect(r.errors.length === 0, 'console errors:\n       ' + r.errors.slice(0, 8).join('\n       '));
                }
                const r0 = on[0];
                const own = r0.frames.map((f) => f.own);
                console.log('     ready at ' + DASH.map((m) => m + ' ' + ms(r0.readyAt[m])).join(', ') + ' · ' +
                    r0.obsRequests + ' requests from ' + ms(r0.firstObs) + ' · longest frame during preparation ' +
                    ms(Math.max(0, ...r0.frames.map((f) => f.d))) + ' (dashboard script in it ' + ms(Math.max(0, ...own)) + ') · long tasks ' +
                    (r0.longTasks.length ? r0.longTasks.map(Math.round).join('/') + ' ms' : 'none'));
                // (e) a prepared mode opens at once.
                const c = r0.clicks;
                console.log('     click → visible: ' + Object.keys(c).map((m) => m + ' ' + ms(c[m].ms) + ' (frame ' + ms(c[m].frame) + ')').join(', '));
                for (const m of DASH) {
                    expect(c[m] && c[m].vis, m + ': not visible one frame after the click');
                    expect(c[m] && c[m].ms < 150, m + ': click → visible ' + ms(c[m] && c[m].ms));
                }
            }
        });

        /* 12. The same at 4x CPU throttle, reported ---------------------------------- */
        await step(12, 'Timing (4x CPU, reported): list, readiness, frames, switches', async (expect) => {
            const off = await perfRun({ noobs: true, nvdMs: SLOW_NVD_MS, cpu: 4 });
            const on = await perfRun({ nvdMs: SLOW_NVD_MS, cpu: 4, clicks: true });
            const long = on.frames.filter((f) => f.d > 50 && f.own > 0);
            console.log('     NVD ' + SLOW_NVD_MS + ' ms · list painted at ' + ms(on.listPaint) + ' with the dashboards, ' + ms(off.listPaint) + ' with ?noobs');
            if (!LIVE) console.log('     KEV filter enabled ' + ms(on.kevGap) + ' after the first result with the dashboards, ' + ms(off.kevGap) + ' with ?noobs');
            console.log('     web fonts after the list: ' + (on.lateFonts.join(', ') || 'none') + ' (?noobs: ' + (off.lateFonts.join(', ') || 'none') + ') · added outside a list rebuild: ' + (on.strayAdds.join(', ') || 'none'));
            console.log('     ready at ' + DASH.map((m) => m + ' ' + ms(on.readyAt[m])).join(', ') + ' · longest frame during preparation ' +
                ms(Math.max(0, ...on.frames.map((f) => f.d))) + ' · dashboard script in a frame at most ' + ms(Math.max(0, ...on.frames.map((f) => f.own))) +
                ' · frames > 50 ms with dashboard script: ' + long.length);
            console.log('     click → visible: ' + Object.keys(on.clicks).map((m) => m + ' ' + ms(on.clicks[m].ms) + ' (frame ' + ms(on.clicks[m].frame) + ')').join(', '));
            expect(DASH.every((m) => on.readyAt[m] != null), 'not every mode became ready at 4x');
            expect(on.errors.length === 0, 'console errors:\n       ' + on.errors.slice(0, 8).join('\n       '));
        });

        /* 13. A language switch ------------------------------------------------------ */
        await step(13, 'Language switch: the mode on screen redraws, the others are prepared again, in the new language', async (expect) => {
            const page = await boot('/index.html' + withQ('lang=en'));
            try {
                await toMode(page, 'trends');
                await page.waitFor(allReady, READY_MS, 'all three modes ready');
                await page.eval("window.CarinoLang.set('es')");
                await page.waitFor(`[].some.call(document.querySelectorAll(${JSON.stringify(SEL.tileLabel)}),function(b){return /[áéíóúñ]|Publicad|nuev/i.test(b.textContent);})`,
                    DRAW_MS, 'Pulse labels in es').catch((e) => expect(false, e.message));
                await page.waitFor(allReady, READY_MS, 'all three modes ready again after the switch');
                const h2 = await page.eval(`(function(){var e=document.querySelector('${SEL.proj} #proj-top h2');return e?e.textContent:'';})()`);
                expect(/Proyección/.test(h2), 'Projection was not rebuilt in es: ' + h2);
                const ob = await page.eval(`(function(){var e=document.querySelector('${SEL.obs} #obs-top h2');return e?e.textContent:'';})()`);
                expect(/Observatorio/.test(ob), 'Observatory was not rebuilt in es: ' + ob);
                expect(await page.eval(countOf('[data-staging]')) === 0, 'a staging box was left behind in #obsRoot');
                const loc = page.requests.filter((u) => /i18n-obs/.test(u)).map((u) => u.replace(/.*\//, ''));
                expect(loc.length === 1 && loc[0] === 'i18n-obs-es.js', 'locale files fetched: ' + loc.join(', '));
                const errs = realErrors(page, origin);
                expect(errs.length === 0, 'console errors:\n       ' + errs.slice(0, 8).join('\n       '));
                await page.shot('13-trends-es');
            } finally { await page.close(); }
        });

        /* 14. A mirror that cannot be read ----------------------------------------- */
        await step(14, 'Unreachable mirror: the buttons open again, and a mode shows why, with the mirror box', async (expect) => {
            const bad = '?mirror=' + encodeURIComponent(origin + '/no-such-mirror');
            const page = await boot('/index.html' + bad);
            try {
                await page.waitFor(`[].every.call(document.querySelectorAll('#modeSwitch [data-mode]:not([data-mode="list"])'),function(b){
                    return b.getAttribute('data-state')==='failed'&&!b.disabled;})`, READY_MS, 'three failed, enabled buttons');
                await page.click(SEL.mode('trends'));
                await page.waitFor(`!!document.querySelector('#obsRoot .o-errview .mirrorbox')`, DRAW_MS, 'the error view with the mirror box')
                    .catch((e) => expect(false, e.message));
                expect(/(^#|&)m=trends(&|$)/.test(await hashOf(page)), 'hash lacks m=trends: ' + await hashOf(page));
                await page.shot('14-mirror-error');
            } finally { await page.close(); }
        });

        /* 15. A mode asked for before it is ready ---------------------------------- */
        await step(15, 'Waiting for a mode: a click gets its history entry and Back cancels it; working with the list cancels a link', async (expect) => {
            const st = `({len:history.length,hash:location.hash,pend:CveModes.pending(),mode:CveModes.current(),obs:CveModes.state('obs'),
                note:!document.getElementById('modeNote').hidden})`;
            // The rail link while the Observatory is still loading.
            const page = await boot('/index.html' + withQ());
            try {
                const a = await page.eval(st);
                await page.click('#obsLink');
                const b = await page.eval(st);
                if (a.obs !== 'ready') {
                    expect(b.len === a.len + 1, 'the rail link while loading added no history entry: ' + a.len + ' → ' + b.len);
                    expect(/(^#|&)m=obs(&|$)/.test(b.hash) && b.pend && b.pend.m === 'obs' && b.note, 'the rail link while loading: ' + JSON.stringify(b));
                    await page.eval('history.back()');
                    await page.waitFor("!/(^#|&)m=/.test(location.hash)", DRAW_MS, 'Back → the list\'s own entry');
                    const c = await page.eval(st);
                    expect(!c.pend && !c.note, 'Back did not cancel the wait: ' + JSON.stringify(c));
                    await page.waitFor(allReady, READY_MS, 'all three modes ready');
                    await new Promise((r) => setTimeout(r, 300));
                    expect(await page.eval(hidden(SEL.root)), 'the Observatory opened after Back had cancelled it');
                } else expect(false, 'the Observatory was ready before the first click; nothing was tested');
            } finally { await page.close(); }
            // The same link, waited out: Back from the Observatory is the list.
            const p2 = await boot('/index.html' + withQ());
            try {
                const len = await p2.eval('history.length');
                await p2.click('#obsLink');
                await p2.waitFor(drawn('obs'), READY_MS, 'the Observatory opens by itself');
                expect(await p2.eval('history.length') === len + 1, 'not one history entry for the rail link');
                await p2.eval('history.back()');
                await p2.waitFor(hidden(SEL.root), DRAW_MS, 'Back from the Observatory → the list').catch((e) => expect(false, e.message));
                expect(/\/index\.html$/.test(await p2.eval('location.pathname')), 'Back left the page');
            } finally { await p2.close(); }
            // ?noobs: the first click on a mode loads it, with its entry.
            const p3 = await boot('/index.html' + withQ('noobs'));
            try {
                await p3.waitFor('window.__perf && __perf.listPaint != null', NVD_MS + DRAW_MS, 'list painted');
                const len = await p3.eval('history.length');
                await p3.click(SEL.mode('trends'));
                await p3.waitFor(drawn('trends'), READY_MS, 'Trends loads on its first click');
                expect(await p3.eval('history.length') === len + 1, '?noobs: the first click on Trends added no history entry');
                await p3.eval('history.back()');
                await p3.waitFor(hidden(SEL.root), DRAW_MS, '?noobs: Back from Trends → the list').catch((e) => expect(false, e.message));
            } finally { await p3.close(); }
            // A deep link, then the reader sorts, or filters by KEV: it stays the list.
            for (const [what, js] of [['sort', "var c=document.getElementById('sortBy');c.selectedIndex=1;c.dispatchEvent(new Event('change'));"],
                ['KEV filter', "var c=document.getElementById('kevOnly');c.checked=!c.checked;c.dispatchEvent(new Event('change'));"]]) {
                const p = await boot('/index.html' + withQ() + '#m=obs');
                try {
                    await p.eval('(function(){' + js + '})()');
                    const s = await p.eval(st);
                    expect(!s.pend && !/(^#|&)m=/.test(s.hash) && !s.note, what + ' did not cancel the deep link: ' + JSON.stringify(s));
                    await p.waitFor(allReady, READY_MS, 'all three modes ready');
                    await new Promise((r) => setTimeout(r, 300));
                    expect(await p.eval(hidden(SEL.root)), 'the Observatory opened after the reader changed the ' + what);
                } finally { await p.close(); }
            }
        });

        /* 16. Widths -------------------------------------------------------------------- */
        await step(16, 'A resize while the list shows: the modes are built again at the new width, then open at once; a rebuild on screen keeps its scroll', async (expect) => {
            const page = await boot('/index.html' + withQ());
            // Every figure drawn at its box's width (±3 px).
            const widthsOff = (host) => `(function(){var bad=[];document.querySelectorAll(${JSON.stringify(host + ' figure.fig')}).forEach(function(f){
                var e=f.__obsEntry;if(!e||!e.scroll.clientWidth)return;var w=Math.max(240,Math.floor(e.scroll.clientWidth));
                if(Math.abs(w-e.lastW)>=3)bad.push((f.id||'fig')+' '+e.lastW+'≠'+w);});return bad;})()`;
            try {
                await page.waitFor(allReady, READY_MS, 'all three modes ready');
                await page.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
                await page.waitFor("[].some.call(document.querySelectorAll('#modeSwitch [data-mode]'),function(b){return b.disabled;})", 3000,
                    'the buttons wait while the modes are built again').catch((e) => expect(false, e.message));
                await page.waitFor(allReady, READY_MS, 'all three modes ready again');
                for (const m of DASH) {
                    const c = await page.eval(`(async function(){var t0=performance.now();document.querySelector(${JSON.stringify(SEL.mode(m))}).click();
                        await new Promise(function(r){requestAnimationFrame(function(){setTimeout(r,0);});});return performance.now()-t0;})()`);
                    const bad = await page.eval(widthsOff(HOST_SEL[m]));
                    expect(bad.length === 0, m + ' opened with charts at the old width: ' + bad.slice(0, 4).join(', '));
                    expect(c < 150, m + ': click → visible ' + ms(c) + ' after the resize');
                }
                // A new bundle while the Observatory is on screen and scrolled.
                await toMode(page, 'obs');
                await page.eval(`document.querySelector('.results-area').scrollTop=4000`);
                await new Promise((r) => setTimeout(r, 300));
                const before = await page.eval(`document.querySelector('.results-area').scrollTop`);
                await page.eval(`(function(){window.__svgMin=1e9;var h=function(){var e=document.querySelector(${JSON.stringify(SEL.obs)});
                    var n=e?e.querySelectorAll('svg').length:0;if(n<__svgMin)__svgMin=n;if(!window.__svgStop)requestAnimationFrame(h);};requestAnimationFrame(h);})()`);
                const alt = encodeURIComponent(origin + '/js/../js/fixtures/obs');
                await page.eval(`history.replaceState(null,'',${JSON.stringify(LIVE ? '?' : '?mirror=' + alt)}+location.hash)`);
                await page.eval(`window.dispatchEvent(new Event('cve:datachanged'))`);
                await new Promise((r) => setTimeout(r, 500));
                await page.waitFor(allReady, READY_MS, 'all three modes ready after the new bundle');
                await new Promise((r) => setTimeout(r, 300));
                await page.eval('window.__svgStop=true');
                const after = await page.eval(`document.querySelector('.results-area').scrollTop`);
                expect(before > 1000 && Math.abs(after - before) < 400, 'the rebuild on screen moved the scroll: ' + before + ' → ' + after);
                expect(await page.eval('__svgMin') > 0, 'the Observatory on screen went blank while it was rebuilt');
            } finally { await page.close(); }
        });

        /* 17. The list's header ---------------------------------------------------------- */
        await step(17, 'Header: one row at 1366 px; the "will open" note moves nothing; a mode that becomes ready is announced', async (expect) => {
            const page = await boot('/index.html' + withQ(), { width: 1366, height: 900 });
            try {
                await page.waitFor(`!!document.querySelector('#resultsList .cve-item')`, NVD_MS + DRAW_MS, 'the list');
                const geo = `(function(){var l=document.querySelector('.rh-left').getBoundingClientRect(),r=document.querySelector('.rh-right').getBoundingClientRect();
                    return {rows:l.bottom<=r.top+5||r.bottom<=l.top+5?2:1,hh:Math.round(document.querySelector('.results-header').getBoundingClientRect().height),
                    card:Math.round(document.querySelector('#resultsList .cve-item').getBoundingClientRect().top),
                    count:Math.round(document.getElementById('resultCount').getBoundingClientRect().height)};})()`;
                const a = await page.eval(geo);
                // As before the fourth button: one row, 81 px (f114b4a).
                expect(a.rows === 1 && a.hh <= 81, 'the list header at 1366 px: ' + a.rows + ' rows, ' + a.hh + ' px (one row of 81 px before the fourth button)');
                if (await page.eval("CveModes.state('obs')") !== 'ready') {
                    await page.click('#obsLink');
                    const b = await page.eval(geo);
                    expect(!(await page.eval("document.getElementById('modeNote').hidden")), 'no note after the rail link');
                    expect(b.card === a.card && b.count === a.count && b.hh === a.hh, 'the note moved the list: ' + JSON.stringify(a) + ' → ' + JSON.stringify(b));
                }
                await page.waitFor(allReady, READY_MS, 'all three modes ready');
                const said = await page.eval("document.getElementById('modeLive').textContent");
                for (const name of ['Trends', 'Projection', 'Observatory']) {
                    expect(new RegExp(name + ' is ready').test(said), 'not announced: ' + name + ' is ready (live region: "' + said + '")');
                }
                expect(await page.eval("document.getElementById('modeLive').getAttribute('aria-live')") === 'polite', '#modeLive is not a polite live region');
            } finally { await page.close(); }
        });
    } finally {
        await cdp.send('Browser.close').catch(() => {});
        cdp.close();
    }
}

let code = 0;
try {
    await main();
} catch (e) {
    console.log('HARNESS ' + e.message);
    for (const p of children) if (p.tail()) console.log('# ' + p.label + ' stderr (tail):\n' + p.tail().split('\n').slice(-8).join('\n'));
    code = 2;
}
await cleanup();
const failed = results.filter((r) => !r.ok);
console.log('# ' + (results.length - failed.length) + ' passed, ' + failed.length + ' failed · screenshots: ' + SHOTS);
if (failed.length && !code) code = 1;
process.exit(code);
