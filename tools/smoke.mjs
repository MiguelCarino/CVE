#!/usr/bin/env node
/* ------------------------------------------------------------------
   smoke.mjs — headless Chromium smoke test for the List / Trends /
   Projection modes of index.html.

     node tools/smoke.mjs                 fixture mirror (js/fixtures/obs)
     node tools/smoke.mjs --live          drop ?mirror=, read cve-data.carino.systems
     node tools/smoke.mjs --only=1,2      run a subset of the numbered checks
     node tools/smoke.mjs --shots=DIR     where the screenshots go
                                          (default: $TMPDIR/cve-smoke)
     node tools/smoke.mjs --chromium=PATH (default: /usr/bin/chromium-browser,
                                          or $CHROMIUM)
     node tools/smoke.mjs --verbose       also print requests and tolerated errors

   Zero dependencies: Node 22's global WebSocket speaks the Chrome
   DevTools Protocol directly, `python3 -m http.server` serves the repo,
   and each numbered check runs in its own browser context so no state
   (hash, localStorage, the fleet language cookie) leaks between them.
   Exit status is non-zero if any check fails, or the harness itself does.

   What is defended is the page contract, not the pixels: List mode
   fetches nothing it did not fetch before the dashboard existed; the
   dashboard draws without NaN, verifies its hashes, hatches what is still
   settling and labels what is projected; the back button and the shared
   hash survive a round trip; nothing scrolls sideways on a phone; and the
   old stats.html links still land on the right panel.
   ------------------------------------------------------------------ */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
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

const STEP_MS = 30000;        // ceiling for one CDP call
const DRAW_MS = 10000;        // SPEC §8: the dashboard has 10 s to draw

/* ---- the selectors this test leans on --------------------------------
   Kept in one place: the SPEC fixes the class names (.o-pulse, .stat-tile,
   .o-cone80, .o-readout) but not every container id, so the section
   lookups try the explicit hook first and fall back to the id. */

const SEL = {
    root: '#obsRoot',
    trends: '#obsTrends',
    proj: '#obsProj',
    header: '#obsHeader',
    mode: (m) => '#modeSwitch [data-mode="' + m + '"]',
    tile: '#obsTrends .o-pulse .stat-tile',
    tileLabel: '#obsTrends .o-pulse .stat-tile .st-label',
    cone: '#obsProj .o-cone80',
    readout: '.o-readout',
};

// The section element for an `x` id inside a mode root. Trends' "volume"
// must not resolve to the corpus panel #obs-volume, so panels are skipped.
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

// Requests List mode must never make (SPEC §8 assertion 1).
const OBS_REQ = /stats\.json|ticks\.json|epss-window|cve-obs|cve-trends|cve-project/;

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

/* ---- a page in its own browser context ------------------------------ */

async function openPage(cdp, origin, { width = 1280, height = 900, mobile = false } = {}) {
    const { browserContextId } = await cdp.send('Target.createBrowserContext', { disposeOnDetach: true });
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const send = (m, p) => cdp.send(m, p, sessionId);

    const page = { requests: [], errors: [], waiters: new Set() };
    const off = cdp.on((msg) => {
        if (msg.sessionId !== sessionId) return;
        const p = msg.params || {};
        switch (msg.method) {
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

    // Switch mode by clicking the segmented control, as a person would.
    async function toMode(page, m) {
        await page.click(SEL.mode(m));
        if (m === 'list') {
            await page.waitFor(hidden(SEL.root), DRAW_MS, 'List mode hides ' + SEL.root);
        } else {
            const host = m === 'trends' ? SEL.trends : SEL.proj;
            await page.waitFor('!(' + hidden(host) + ') && document.querySelectorAll(' +
                JSON.stringify(host + ' svg') + ').length > 0', DRAW_MS, m + ' mode draws');
        }
    }

    let englishProbe = null;

    try {
        /* 1. List mode is the page it was ---------------------------------- */
        await step(1, 'List: no dashboard requests, #obsRoot hidden, no console errors', async (expect) => {
            const page = await boot('/index.html' + withQ());
            try {
                // Let the deferred boot and the 1.5 s background sync start.
                await new Promise((r) => setTimeout(r, 2500));
                if (VERBOSE) for (const u of page.requests) console.log('     (request) ' + u);
                const leaked = page.requests.filter((u) => OBS_REQ.test(u));
                expect(leaked.length === 0, 'List mode requested: ' + leaked.slice(0, 5).join(', '));
                expect(await page.eval(hidden(SEL.root)), SEL.root + ' is visible in List mode');
                const errs = realErrors(page, origin);
                expect(errs.length === 0, 'console errors:\n       ' + errs.slice(0, 8).join('\n       '));
                await page.shot('1-list');
            } finally { await page.close(); }
        });

        /* 2. Trends ---------------------------------------------------------- */
        await step(2, 'Trends: draws, verifies, hatches, reads out', async (expect) => {
            const page = await boot('/index.html' + withQ());
            try {
                await page.click(SEL.mode('trends'));
                expect(/(^#|&)m=trends(&|$)/.test(await hashOf(page)), 'hash lacks m=trends: ' + await hashOf(page));
                await page.waitFor(countOf(SEL.trends + ' svg') + ' >= 6', DRAW_MS, '≥ 6 svg in ' + SEL.trends);
                expect(await page.eval(countOf(SEL.tile)) === 6, 'Pulse tiles: ' + await page.eval(countOf(SEL.tile)) + ', want 6');
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
                englishProbe = {
                    modes: await page.eval(`[].map.call(document.querySelectorAll('#modeSwitch [data-mode]'),function(b){return b.textContent.trim();})`),
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
                await page.click(SEL.mode('proj'));
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
                const bad = await page.eval(BAD_SVG_JS(SEL.proj));
                expect(bad.length === 0, 'bad SVG attributes: ' + bad.join('; '));
                await page.shot('3-projection');
                const errs = realErrors(page, origin);
                expect(errs.length === 0, 'console errors:\n       ' + errs.slice(0, 8).join('\n       '));
            } finally { await page.close(); }
        });

        /* 4. Back button ----------------------------------------------------- */
        await step(4, 'History: back → Trends, back → List', async (expect) => {
            const page = await boot('/index.html' + withQ());
            try {
                await toMode(page, 'trends');
                await toMode(page, 'proj');
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
                await page.shot('4-history');
            } finally { await page.close(); }
        });

        /* 5. Shared hash survives the round trip -------------------------------- */
        await step(5, 'Round trip keeps q and s', async (expect) => {
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

        /* 6. Phone width ------------------------------------------------------- */
        await step(6, '375 px: no horizontal scroll in any mode', async (expect) => {
            const page = await boot('/index.html' + withQ(), { width: 375, height: 812, mobile: true });
            try {
                for (const m of ['list', 'trends', 'proj']) {
                    if (m !== 'list') await toMode(page, m);
                    await new Promise((r) => setTimeout(r, 300));
                    const w = await page.eval('({sw:document.documentElement.scrollWidth, iw:innerWidth})');
                    expect(w.sw <= w.iw, m + ': scrollWidth ' + w.sw + ' > innerWidth ' + w.iw);
                    await page.shot('6-phone-' + m);
                }
            } finally { await page.close(); }
        });

        /* 7. Japanese -------------------------------------------------------- */
        await step(7, '?lang=ja#m=trends: mode buttons and Pulse labels are translated', async (expect) => {
            const page = await boot('/index.html' + withQ('lang=ja') + '#m=trends');
            try {
                await page.waitFor(countOf(SEL.tileLabel) + ' >= 6', DRAW_MS, 'Pulse labels in ja');
                const modes = await page.eval(`[].map.call(document.querySelectorAll('#modeSwitch [data-mode]'),function(b){return b.textContent.trim();})`);
                const pulse = await page.eval(`[].map.call(document.querySelectorAll(${JSON.stringify(SEL.tileLabel)}),function(b){return b.textContent.trim();})`);
                const en = englishProbe || { modes: ['List', 'Trends', 'Projection'], pulse: [] };
                const same = (a, b) => a.filter((x, i) => x === b[i]);
                expect(modes.length === 3 && same(modes, en.modes).length === 0, 'mode buttons not translated: ' + modes.join(' | '));
                expect(pulse.length === 6 && (!en.pulse.length || same(pulse, en.pulse).length === 0),
                    'Pulse labels not translated: ' + pulse.join(' | '));
                await page.shot('7-trends-ja');
            } finally { await page.close(); }
        });

        /* 8. Old stats.html links ------------------------------------------------ */
        await step(8, 'stats.html#kev lands on #m=trends&x=corpus-kev', async (expect) => {
            const page = await openPage(cdp, origin);
            try {
                await page.goto('/stats.html' + withQ() + '#kev');
                await page.waitFor("/\\/index\\.html$/.test(location.pathname)", DRAW_MS, 'redirect to index.html');
                const href = await page.eval('location.href');
                expect(/#m=trends&x=corpus-kev$/.test(href), 'landed on ' + href);
                if (!LIVE) expect(href.includes('mirror='), '?mirror= dropped by the redirect: ' + href);
                await page.waitFor("typeof window.cveRerender === 'function'", DRAW_MS, 'index.html boot').catch(() => {});
                await page.waitFor(`(function(){var d=document.getElementById('obs-kev');return !!d&&d.open;})()`, DRAW_MS,
                    'corpus panel #obs-kev open').catch((e) => expect(false, e.message));
                await page.shot('8-stats-redirect');
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
