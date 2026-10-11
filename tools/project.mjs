#!/usr/bin/env node
/* ------------------------------------------------------------------
   tools/project.mjs — recompute Projection mode from the published files.

     node tools/project.mjs --stats stats.json.gz --ticks ticks.json.gz \
                            --kev enrich/kev.json.gz [--snapshot YYYY-MM-DD]

   Prints, as JSON, the four projections (monthly, weekly, C+H share, KEV)
   with every number the page draws: the method chosen, the table it was
   chosen from, the cone, the measured coverage. It runs the page's own
   js/cve-series.js and js/cve-project.js (loaded the way the tests load
   them, with `new Function('self', src)`), so a disagreement between this
   output and the page is a bug, not a rounding difference.

   The sha256 of each input file is printed beside the result, to compare
   with the manifest the page verified against. The snapshot defaults to
   stats.snapshot; it is never read from the clock.
   ------------------------------------------------------------------ */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';

const root = new URL('../js/', import.meta.url);

function usage(msg) {
    if (msg) process.stderr.write('project.mjs: ' + msg + '\n');
    process.stderr.write('usage: node tools/project.mjs --stats <stats.json[.gz]> --ticks <ticks.json[.gz]> --kev <kev.json[.gz]> [--snapshot YYYY-MM-DD]\n');
    process.exit(2);
}

function args(argv) {
    const o = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '-h' || a === '--help') usage();
        const m = /^--(stats|ticks|kev|snapshot)(?:=(.*))?$/.exec(a);
        if (!m) usage('unknown argument ' + a);
        o[m[1]] = m[2] != null ? m[2] : argv[++i];
        if (o[m[1]] == null) usage('missing value for --' + m[1]);
    }
    if (!o.stats) usage('--stats is required');
    if (o.snapshot && !/^\d{4}-\d{2}-\d{2}$/.test(o.snapshot)) usage('--snapshot must be YYYY-MM-DD');
    return o;
}

// Raw bytes are hashed as published (gzip and all), then gunzipped when
// they start with the gzip magic, whatever the file is called.
function load(path) {
    const bytes = readFileSync(path);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const text = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes).toString('utf8') : bytes.toString('utf8');
    return { data: JSON.parse(text), file: basename(path), bytes: bytes.length, sha256 };
}

const opt = args(process.argv.slice(2));
const self = {};
for (const f of ['cve-series.js', 'cve-project.js']) {
    new Function('self', readFileSync(new URL(f, root), 'utf8'))(self);
}

const stats = load(opt.stats);
const ticks = opt.ticks ? load(opt.ticks) : null;
const kev = opt.kev ? load(opt.kev) : null;

const result = self.CveProject.projectAll({
    stats: stats.data,
    ticks: ticks && ticks.data,
    kev: kev && kev.data,
    snapshot: opt.snapshot,
}, { series: self.CveSeries });

const meta = (f) => (f ? { file: f.file, bytes: f.bytes, sha256: f.sha256 } : null);
process.stdout.write(JSON.stringify({
    method: result.method,
    snapshot: result.snapshot,
    inputs: {
        stats: meta(stats),
        ticks: meta(ticks),
        kev: meta(kev),
        statsManifestSha256: stats.data.manifestSha256 || null,
        ticksManifestSha256: ticks && ticks.data.series ? ticks.data.series.manifestSha256 || null : null,
    },
    monthly: result.monthly,
    weekly: result.weekly,
    share: result.share,
    kev: result.kev,
}, null, 2) + '\n');
