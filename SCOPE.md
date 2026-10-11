# CVE — scope for the downloadable database

> **Status, 21 August 2026: built.** The publisher lives in `CVE-data`, the client modules in
> `CVE/js/`, and the wire format is frozen in `CVE-data/CONTRACT.md`. What follows is the reasoning
> that produced it; where a measurement here differs from the contract's, the contract measured a
> real published tree and wins.

**Drafted:** 21 August 2026 · **Status:** proposal, not yet decided
**Question:** keep the live NVD search, *and* let the database be downloaded once and thereafter only
updated.

Every number in §1 was **measured against the live NVD API on 21 August 2026**, not estimated. Numbers
marked **[E]** are projections from those measurements. Numbers marked **[V]** still need checking.

---

## 1. The measurements that decide the design

```
GET /rest/json/cves/2.0/?resultsPerPage=1
  → totalResults: 381,425          (2026-08-21T13:41Z)
  → access-control-allow-origin: * (browser-callable — live mode keeps working)
```

**Record size**, sampled 200 records at each end of the corpus:

| Sample | Raw / record | gzip -9 / record |
|---|---|---|
| Recent (startIndex 380 000) — many still unenriched | 2,317 B | 179 B |
| ~2019-era (startIndex 150 000) — fully enriched, full CPE lists | 3,758 B | 305 B |

**Trimmed to what a search actually needs** (id, published, lastModified, status, CVSS score+severity,
CWEs, product keys, description):

| Shape | Raw / record | gzip / record |
|---|---|---|
| Index, **no** description | 109–152 B | 8–16 B |
| **Index + full English description** | 415–685 B | **72–84 B** |
| Columnar variant of the same | 378–648 B | 70–82 B |

**Corpus projections [E]** at 381,425 records:

| Tier | What it holds | Raw | Gzipped |
|---|---|---|---|
| Index only | no descriptions — filter and sort, but no keyword search | ~45 MB | **~5 MB** |
| **Index + description** ← the recommendation | keyword search works fully offline | ~190 MB | **~34 MB** |
| Full mirror | everything NVD returns, incl. CPE configurations and references | ~1.2 GB | ~95 MB |

**Change volume**, measured by `lastModStartDate`:

| Window | CVEs modified |
|---|---|
| Last 24 h | **1,499** |
| Last 7 d | **7,562** |

**Delta sizes [E]** at ~90 B/record gzipped: **daily ≈ 135 KB · weekly ≈ 680 KB · 30-day ≈ 3 MB ·
120-day ≈ 10 MB** (120 days is NVD's maximum `lastMod` window).

> **The finding in one line: the searchable database is a 34 MB one-time download and a 135 KB/day
> update.** Everything that makes the dataset large — CPE match lists and reference arrays — is exactly
> the part nobody searches on, so it stays online and is fetched per-CVE on demand.

---

## 2. The constraint that shapes everything: NVD has no bulk file any more

The old per-year JSON data feeds are retired. **There is only the API**, and it is rate-limited:
5 requests per 30 s without a key, 50 with one; `resultsPerPage` maxes at 2000.

A full pull is `381,425 / 2000 = 191 requests` ≈ **19 minutes minimum unkeyed**, longer in practice.

So the decision is forced:

> **If each visitor builds their own copy, we generate 191 requests per user against a public-good
> service. That is abusive and it will get blocked. Therefore we become the publisher: we pull once on
> a schedule and publish a snapshot plus deltas; the browser downloads ours.**

This is the scope-defining change. CVE stops being a static page and becomes **a static page plus a
published dataset with an upkeep obligation** — the first thing in the fleet that can go stale and be
*wrong* rather than merely old. §6 is about paying that cost honestly.

### 2.1 A second feed finding

Measured today, sending an `Origin` header:

- **NVD** returns `access-control-allow-origin: *` → directly fetchable from the browser. ✅
- **CISA KEV** (`known_exploited_vulnerabilities.json`) returns **no ACAO header**. ❌
- **FIRST EPSS** (`epss_scores-current.csv.gz`, 2,565,242 B) returns **no ACAO header**. ❌

KEV is the single most actionable enrichment there is (*is this being exploited right now?*) and EPSS
is 2.5 MB. Neither can be fetched from a browser. **Since we are already standing up a publisher for
NVD, mirroring these two costs almost nothing and adds more value per byte than anything else here.**
One publisher, three feeds.

---

## 3. The three modes

Modes 2 and 3 are the same code; only the source of the shards differs.

| Mode | Behaviour | For whom |
|---|---|---|
| **Live** — today's behaviour, unchanged | Query NVD directly. Always current, needs internet, stores nothing. | The casual visitor. Stays the default. |
| **Local** | Download the snapshot once → IndexedDB → search offline → update by delta on open. | MSPs, hospital IT, anyone on a slow or filtered link. |
| **Bundled** | The same shards ship on the Offline Toolkit USB / image. "Update" is a file copy, not a fetch. | Air-gapped sites. |

**Bundled mode is the business reason to build this at all.** It closes the defect named in
`INDUSTRIES.md` §8.4 — CVE currently breaks the offline promise the moment it enters the Offline
Toolkit — and it does so with the same work that serves the online user. One fix, two buyers.

---

## 4. Mechanism

**Publisher** (a scheduled job, GitHub Actions cron, with a free NVD API key that never reaches the client):

1. Full pull, once, into per-year shards. ~30 shards; the largest recent years ~3–5 MB gzipped each.
2. Daily: pull `lastModStartDate = last run` → write `delta-YYYY-MM-DD.json.gz` (~135 KB).
3. Rewrite `manifest.json`: snapshot version, **snapshot date**, record count, shard list with
   **SHA-256 per file**, delta list with dates and hashes, and the feed versions of KEV/EPSS.
4. Periodically re-cut the snapshot so the delta chain never grows long.

**Client:**

1. Fetch `manifest.json` (a few KB) on open.
2. No local copy → offer the download, shard by shard, with visible progress; **verify each SHA-256
   with Web Crypto before storing** (the same discipline as `Hash`, and it satisfies the Offline
   Toolkit's checksum requirement).
3. Local copy present → apply only deltas newer than the stored `lastSync`, upserting by CVE id.
4. **Gap longer than ~45 days → re-download the snapshot** rather than chaining a hundred deltas.
   Simpler, and it bounds the worst case.

**Storage:** IndexedDB, not `localStorage` (5–10 MB cap). 190 MB is comfortable. Two caveats that must
be handled, not discovered:

- Call `navigator.storage.persist()`, or the origin is evictable under disk pressure.
- **Safari/iOS evicts unused origin data after about 7 days** **[V]**. The tool must survive "the
  database vanished" gracefully and say so plainly rather than silently returning zero results.

**Hosting.** Snapshots go to **GitHub Releases assets** (2 GB per asset, and — decisively — *not in git
history*), never committed to the Pages repo: a daily snapshot committed to git grows the repository
without bound, which is the trap in this design. Pages' hard limits are 100 MB per file and ~1 GB per
repo, so the full-mirror tier could not live there in one piece even if we wanted it. Bandwidth: the
100 GB/month soft limit ÷ 34 MB ≈ **~2,900 full downloads a month**, with deltas costing effectively
nothing. Ample now; worth knowing as a real ceiling. **[V]** Confirm CORS on release assets before
committing to this.

---

## 5. Scope cuts — what this is not

| Not building | Why |
|---|---|
| **A vulnerability scanner** | We do not fingerprint the customer's machines. Different product, funded competitors, and it breaks the "we never touch your data" line. |
| **Authoritative CPE matching** | Full applicability logic — version ranges, `vulnerable` flags, running-on relationships, node AND/OR trees — is a multi-month rabbit hole, and it is precisely the part of the dataset that costs 1 GB. |
| **Any real-time claim** | The snapshot date is stated prominently and permanently. *"As of"* is the product. |
| **Accounts, sync, server-side search** | Same reason as the rest of the fleet. |
| **Fixing NVD's enrichment backlog** | Pending CVEs stay pending and are shown as such. The app already does this correctly and honestly. |

**The middle ground on matching, for later:** advisory keyword/product matching against the asset list
in the `.carino` project file (`INDUSTRIES.md` §8.3) — labelled *advisory*, never *"you are
vulnerable"*. Phase 2, and only if a customer asks.

---

## 6. The upkeep obligation — the real cost of this feature

**A stale security database is worse than no security database**, because it answers confidently.
Accepting this scope means accepting a permanent duty, and the mitigations are mandatory rather than
nice-to-have:

- The manifest carries the snapshot date; **the UI shows the age of the local copy at all times and
  turns red past a threshold** (7 days is the obvious default).
- The publisher alerts on its own failure. This is the `Carino Watch` philosophy (§12.8.2) pointed at
  our own infrastructure, and it would be embarrassing to sell one and not run the other.
- Attribution and terms for all three feeds documented in the README, as the fleet already does for
  vendored code. **[V]** — read NVD's and FIRST's redistribution terms before publishing a mirror.

---

## 7. Effort and phasing **[E]**

| Piece | Effort |
|---|---|
| Publisher pipeline — initial pull, shard, daily delta, manifest, hashes | ~1 week |
| Client local mode — IndexedDB, download UI, delta apply, hash verify, offline search/filter/sort | ~1.5–2 weeks |
| Bundled mode — file-picker source instead of URL | ~2 days |
| KEV + EPSS mirror and join | ~2 days |
| **Phase 1 total** | **~4 weeks** |
| *Phase 2, only on request:* full-record air-gapped bundle · advisory asset matching · the signed "as of" report | +2–3 weeks |

**Recommended Phase 1 scope:** index + description (34 MB), sharded by year, daily deltas, SHA-256
manifest, three modes, KEV and EPSS mirrored, prominent age indicator. **Explicitly not** the full
mirror and **not** CPE matching.

---

## 8. Why this is worth doing at all

Not because offline search is nice. Because a **dated, hashed, reproducible snapshot** turns the tool
into an evidence producer:

> *"As of 2026-08-21, snapshot `sha256:…`, this asset list carried these known vulnerabilities."*

Offline-verifiable, reproducible by anyone holding the same snapshot, and exactly the artefact an
auditor asks a hospital or an MSP for. That is the §D.5 sentence again — **we sell evidence** — and it
is the difference between shipping a better search box and shipping a product.

---

## 9. Open decisions

1. **[D]** Phase 1 tier — confirm index + description (34 MB) rather than the full 95 MB mirror.
2. **[D]** Release assets vs. an orphan branch for snapshot hosting (contingent on the CORS check).
3. **[D]** Snapshot re-cut cadence — monthly? quarterly? It only trades publisher work against delta-chain length.
4. **[V]** NVD and FIRST redistribution terms; GitHub release-asset CORS; Safari eviction behaviour.
5. **[D]** Does the local database ship with the Offline Toolkit as a dated release, and is *that* the
   thing the annual subscription actually renews? If yes, this feature stops being a cost centre.

---

# Part II — what the corpus unlocks (21 August 2026)

Once CVE is a **hosting and display** project rather than a search box, the asset is no longer the
page — it is **381,425 records you own a local copy of**. Everything below falls out of that, and
almost none of it needs new data.

## 10. Four deployment shapes, one codebase

| Shape | What runs | Who it is for |
|---|---|---|
| **1 · The site** — `cve.carino.systems`, live NVD, unchanged | GitHub Pages | Casual visitor. Free, and it is the funnel. |
| **2 · The dataset** — snapshot + deltas + manifest, published by us | GitHub Releases | Anyone. Free. It is what makes 3 and 4 possible. |
| **3 · Self-hosted mirror** — *your own copy of the site and the data* | **Any static file host** — nginx, Caddy, `python -m http.server`, a share | Orgs whose network blocks `nvd.nist.gov`, which is most hospitals and every industrial network. |
| **4 · The offgrid appliance** — mirror + updater, on the `carino-offline` image | Custom-Images (`offline.conf` already exists) | Air-gapped sites. **This is the SKU.** |

**The design rule that keeps this cheap: shape 3 must require nothing but a static file server.** The
same `index.html`, the same shards, a different base URL. No database, no runtime, no backend — so
"host your own" is a `tar -xf` and a web root, and the deployment instructions fit on one page. Only
shape 4 adds a small updater binary, and only because an air-gapped box needs someone to carry the
delta in.

**Why shape 3 matters commercially:** an org that mirrors the corpus internally is an org that has
adopted a Carino component into its infrastructure, for free, with no sales call. That is the cheapest
possible top of funnel for the appliance in shape 4.

## 11. A fourth data tier — precomputed statistics

**The publisher should compute the aggregates, not the browser.** Scanning 381 k records in IndexedDB
to draw a chart is possible but slow, and it forces a 34 MB download on someone who only wanted to see
a graph. Instead the daily job emits `stats.json` — a few hundred KB of pre-rolled aggregates.

| Tier | Size | Unlocks |
|---|---|---|
| **`stats.json`** | **~200 KB [E]** | The whole observatory, instantly, with no database |
| Index, no descriptions | ~5 MB | Filter, sort, browse |
| Index + descriptions | ~34 MB | Full offline keyword search |
| Full mirror | ~95 MB | Air-gapped everything |

That ordering matters: **the most interesting public-facing feature is also the smallest download.**

## 12. The observatory — what is actually worth measuring

These are real numbers, pulled today, to show the shape of it:

```
total CVEs                    381,425
non-rejected                  363,409     → 18,016 rejected (4.7%)
CVSS v3 CRITICAL               30,620     → 8.0% of the corpus
in CISA KEV                     1,673     → 0.44%
```

> **30,620 criticals. 1,673 known to be exploited.** Under half a percent of all CVEs are on the KEV
> list. *Severity is not a work queue* — and that single chart is a better argument for EPSS and KEV
> triage than any vendor blog post, because the reader can recompute it from a snapshot hash.

And from a 400-record sample (two windows, recent + ~2019) — indicative only, but it shows what comes
out of the corpus for free:

```
vulnStatus       Modified 199 · Undergoing Analysis 79 · Analyzed 51 · Received 47 · Deferred 22
                 → 32% of the sample not yet enriched
no CWE assigned  16%          no CVSS v3  2%
top CWEs         CWE-284 access control · CWE-787 OOB write · CWE-416 UAF · CWE-79 XSS · CWE-125 OOB read
top CNAs         Oracle · Android · Chrome · MITRE · GitHub
description len  median 310 chars (min 62, max 1397)
```

**The metrics worth building, ranked by "does anyone else publish this well":**

| Metric | Why it is worth it |
|---|---|
| **Enrichment lag and the backlog counter** — how many CVEs sit in `Received` / `Awaiting Analysis` / `Undergoing Analysis`, and for how long | **The single most valuable chart here.** NVD's analysis backlog has been the story of the last two years and there is no good self-hostable public tracker of it. It is also *our* data-quality disclosure: it explains the PENDING cards the app already shows honestly. |
| **KEV overlap and time-to-KEV** — days from publication to appearing on the exploited list; what CVSS those entries carried *at the time* | Directly attacks "patch by severity". Actionable, and provable from the snapshot. |
| **Publication volume over time** | The CVE explosion, plainly drawn. The context everyone quotes and nobody sources. |
| **CWE distribution over time** | Are memory-safety classes actually shrinking? A genuine question with a real answer sitting in the corpus. |
| **CNA leaderboard** — volume, % self-scored, % with a CWE, median description length | A *data-quality* league table rather than a shaming exercise. Useful to defenders, and nobody publishes it. |
| **CVSS drift** — mean base score by year | Tests whether self-scoring inflates severity. Slightly provocative, entirely defensible. |
| **Rejected-CVE rate** | 4.7 % today. A quiet indicator of process health. |
| **Publication rhythm** — day of week, day of month | Patch Tuesday made visible. Cheap, and it is the chart people share. |
| Vendor/product concentration | Useful **only with the caveat in §14**. |

**All of it renders identically online and offline**, because it is one JSON file and one page.

## 13. The products that fall out of owning the corpus

| # | Thing | Build on | Note |
|---|---|---|---|
| 1 | **Watchlist → delta report.** Keep a product list in the `.carino` project file (`INDUSTRIES.md` §8.3); each sync answers *"since your last update, N new CVEs match your estate."* | Corpus + project file | **The highest-value user feature, and it is pure client-side once the corpus is local.** It also produces a dated artefact, which is what makes it billable. |
| 2 | **Snapshot-to-snapshot diff report** — what changed for these products between March and April | Two snapshots | The MSP's monthly deliverable. Essentially record #9 in `INDUSTRIES.md` §8.2. |
| 3 | **Saved search → RSS/Atom, digest, webhook** | Publisher (shape 3/4) | A browser cannot push; a self-hosted updater can. This is `Carino Watch` shaped and reuses its notification code. |
| 4 | **A CVSS vector explainer** — paste `AV:N/AC:L/…` and watch the score get built, term by term | `Learn`, `Hash`'s step-visualiser pattern | Exactly the fleet's pedagogical style, costs little, and answers the question every junior asks: *why is this a 9.8?* |
| 5 | **A CWE explainer with real examples drawn from the corpus** | `Learn` | Ties CVE into the curriculum, which is the funnel (§10.3 of the plan). |
| 6 | **Cross-fleet joins** — `Hardware` (vendor/model) → CVE; `SoftwareCatalog` (what you deploy) → CVE | `carino-bridge.js` | This is the chain from `INDUSTRIES.md` §8.3 made real, and it is what makes the IT bundle cohere rather than being eleven separate pages. |
| 7 | **Data-quality lens** — CVEs with no CWE, no CVSS, one-line descriptions, dead references | Corpus | Useful to defenders, mildly provocative, excellent content marketing. |
| 8 | **Reproducible statistics.** Every chart cites the snapshot hash that produced it | Manifest | **The real differentiator against every threat-intel blog:** anyone can recompute our number from the same snapshot. Costs nothing and is impossible for a vendor with proprietary data to match. |

## 14. Integrity rules — non-negotiable if we publish statistics

- **Never rank vendors as "most insecure" by raw CVE count.** A high count usually means more scrutiny
  and better disclosure, not worse software. If a vendor chart is published at all, it publishes that
  caveat *in the chart*, not in a footnote.
- **Every figure states its snapshot date and hash.** A statistic without a snapshot is a rumour.
- **Distinguish "no CVSS" from "CVSS 0".** Missing data is missing, never zero — the single most common
  way vulnerability statistics lie.
- **Sample sizes are stated.** The §12 table above says "400-record sample" for exactly this reason.
- **The backlog is disclosed, not hidden.** If a third of recent records are unenriched, the charts say
  so, because otherwise every derived statistic is quietly wrong.

## 15. What we still do not build

Everything in §5 stands, plus:

| Not building | Why |
|---|---|
| **An exploit database, or hosting PoC code** | A clear line. Dual-use, it changes what this company is, and it would poison the hospital conversation. Link to advisories; never host weapons. |
| **Proprietary scoring** — a "Carino risk score" | The whole value here is that the numbers are reproducible from public data. An invented score destroys exactly that. |
| **Hosted alerting as a service** | That is a server plus an on-call rotation. Ship it as shape 3/4 so the *customer* runs it. |
| **Feeding third-party scanners** | A different product with different obligations. If someone points their scanner at their own mirror, fine — but we do not advertise it or support it. |

## 16. Revised shape of the project

> **CVE Radar becomes: a live search page, a published dataset, a mirror anyone can host, an appliance
> for people who cannot reach the internet, and an observatory built from the same file — where every
> published number can be recomputed by anyone holding the snapshot hash.**

Effort, on top of §7's ~4 weeks:

| Piece | Effort **[E]** |
|---|---|
| `stats.json` in the publisher + the observatory page | ~1 week |
| Self-host packaging (tarball, one-page deploy doc, configurable base URL) | ~2 days |
| Watchlist → delta report | ~1 week |
| CVSS/CWE explainers | ~3 days |
| Feeds/digest in the self-hosted updater | ~3 days |

**Order:** self-host packaging first (2 days, and it is what turns a page into infrastructure), then
`stats.json` and the observatory (the funnel), then the watchlist report (the billable artefact).

---

# Part III — the Ticker view (10 October 2026)

The observatory (§12) answers *what does the corpus look like*. The owner's next question is *which way
is it moving* — the same question a markets panel answers, and the fleet already owns one. This part
scopes a **stocks-like panel for CVE tendencies**, built from the corpus and the Stocks codebase.

**Where it lives:** inside the CVE site — **built 2026-10-11 as the Trends and Projection modes inside
`index.html` (`#m=trends|proj`); `stats.html` redirects** there (`#m=trends&x=corpus`), so there is one
renderer and one manifest-hash check. The list stays the default mode. Same chrome, same mirror.
**No new subdomain** — the fleet merge rule (a tool is consolidated, never split into a
sub-hub) applies, and a second site would only duplicate the manifest, the hash discipline and the
integrity rules.

## 17. What it borrows from Stocks — by copying, not importing

No build and no shared package: files are copied into `CVE/js/` with a header naming their origin, the
way the fleet already vendors code.

| From `~/Github/Stocks` | What it gives us | Note |
|---|---|---|
| `js/indicators.js` (694 lines) | `sma`, `ema`, `stdev`, `bollinger`, `relativeStrength`, `returns`, `maxDrawdown` | **Pure — no imports, no DOM, no clock.** Output arrays are aligned to the input with `null` in warm-up and wherever an input is missing, which is exactly §14's *missing is never zero*. Copy `tests/indicators.test.mjs` with it. |
| `js/viz.js` (91 lines) | `sparkline()` — inline-SVG micro line+area; `hexA()`/`toRGB()` theme helpers | Already drops null/NaN holes. Matches `stats.html`'s inline-SVG, no-library rule. |
| `js/chart.js` (1,770 lines) | `createChart()` — canvas engine, panes, crosshair, log/percent scale | **P2 only, and only for the drill-down.** It imports `format.js`, `session.js` (market hours) and `viz.js`; CVE days are continuous, so `session.js` is replaced by a stub. If that stub grows past a page, inline SVG wins instead. **[E]** |
| `.stat-tile`, `.delta.up/.down/.flat`, `.spark` | KPI tile, signed change chip, micro-chart | Canonical copies are in Branding's **Data Viz** section (`branding.carino.systems#dataviz`); take the CSS from there, not from Stocks. |

**As built (2026-10-11), for the Trends and Projection modes inside index.html (`#m=trends|proj`;
stats.html redirects):** `indicators.js` became `js/cve-indicators.js` (the functions the modes use, with
its tests); `chart.js` was **not** copied — `js/cve-tschart.js` is inline SVG on the observatory's own kit
and takes only the crosshair, readout and legend patterns; `.seg` comes from Stocks' CSS and the tile,
delta and spark rules from Branding, both credited in `css/cve-obs.css`.

**What is deliberately not copied:** candles (a CVE count has no open/high/low), RSI/MACD/stochastics
(oscillators tuned to traded prices, meaningless on publication counts), drawings, the screener, and
anything that sounds like a buy or sell signal.

## 18. The mapping — what each market idea means here

| Markets idea | CVE meaning | Source |
|---|---|---|
| **Index** | Total CVE volume — new CVEs per day/week/month | `byMonth` + `ticks.json` |
| **Tickers** | CWEs, severity levels, KEV, and the user's **watchlist terms** | ticks / corpus |
| **Volume** | New CVEs per period for that ticker | ticks |
| **Relative strength** | A CWE's **share** of all CVEs, not its count. Raw counts rise with the total, so every CWE "rallies" in a growing corpus; share is the only honest trend line | `relativeStrength()` |
| **SMA 7 / 30 crossover** | A **sustained rise** — the 7-period average holding above the 30 | `sma()` |
| **Bollinger band / z-score** | **Unusual volume** — a period outside ±2σ, annotated with the known calendar cause where there is one (Patch Tuesday, Oracle's quarterly CPU) from the `rhythm` data | `bollinger()`, `stdev()` |
| **Per-CVE "price"** | The CVE's **EPSS daily score** | EPSS window (§19) |
| **Earnings shock** | The day a CVE is added to **KEV** | KEV `dateAdded` |
| **Rating change** | An NVD **re-score** (CVSS base score changed) | deltas |
| **Delisting** | **Rejection** | deltas |
| **Movers board** | New KEV adds · top EPSS gainers · re-scores, since the last sync | ticks + window |
| **Heatmap** | CWE × month, coloured by **change in share** (never raw count) | ticks / corpus |
| **Price alerts** | Watchlist alerts that **fire on sync** — the browser cannot push (§13 #3); push stays a shape 3/4 job | client |

> **The rule that makes the mapping honest: everything is a share, a rate or a dated event — never a
> raw count presented as a trend.** A growing corpus makes every raw count go up and to the right.

## 19. Decisions, 2026-10-10

1. **[D] Per-CVE EPSS history — publisher-hosted rolling window, client accumulates the rest.** The
   publisher keeps a window of daily EPSS scores for **every KEV CVE plus every CVE above an EPSS
   threshold**, backfillable from FIRST's dated daily files (`epss_scores-YYYY-MM-DD.csv.gz`). Anything
   outside the window the client records itself, one point per sync, from the day the user starts
   watching it — and labels it *"history since you started watching"*.
   **[E] proposal:** window **90 days**, threshold **EPSS ≥ 0.1**, sticky (a CVE that crossed the
   threshold stays in for the rest of the window). Size: ~1.7 k KEV + roughly 10–15 k above threshold
   ≈ **~15 k CVEs × 90 days**; scores quantised to 1e-4 (a `uint16`) and stored as change points
   compress to **~2–3 B/point gz** → **~3–4 MB**. A 365-day window would be **~14–16 MB** — larger than
   the index tier itself, which is why 90 is the proposal.
2. **[D] Weekly snapshots archived to GitHub Releases.** One full snapshot per week as a release asset,
   **~42 MB each, ~2.2 GB/year**. This turns the **state** metrics — backlog size, status mix,
   enrichment lag — from *attested* (we recorded it on the day; trust us) into **recomputable** (anyone
   can download the week's snapshot and get the same number). Not every tick field: `rejected` (rejected
   records leave the corpus), `net`, KEV `added`/`removed` and the EPSS file date compare against an
   earlier run rather than a snapshot, so they stay attested even for an archived week — `ticks.json`
   names them in `notes.attestedOnly` (CVE-data `CONTRACT.md` §13). It is §13 #8 extended backwards in time,
   and it closes the hosting question §4 and §9.2 left open: the live tree stays on `gh-pages`, the
   archive goes to Releases, never into git history.
3. **[D] Vendor/product tickers are watchlist-only.** A user may chart *their own* vendors; no vendor
   or product ever appears on a public board, movers list, heatmap or leaderboard. This is §14's first
   rule applied to a format that would otherwise invite exactly the "most insecure vendor" chart.
4. **[D] P0 done.** GitHub Pages for `CVE-data` now serves the `gh-pages` branch at
   `cve-data.carino.systems` (certificate approved, `access-control-allow-origin: *`);
   `manifest.json` and `stats.json.gz` return 200, and `stats.html` is being verified in a real browser
   for the first time — until today no chart had ever been drawn from published data.

## 20. A fifth data tier — `ticks.json`

`stats.json` is a picture of *today*. A ticker needs *every day*, and most of the state metrics cannot
be reconstructed after the fact from a current snapshot (a record that was `Received` in March and is
`Analyzed` now leaves no trace of March).

| Tier | Size | Unlocks |
|---|---|---|
| **`ticks.json`** — one row per publisher run | **~2 KB/day gz [E]** → ~0.7 MB/year | Every time series in the Ticker view |
| `stats.json` | ~20 KB gz (~100 KB plain) | The observatory |
| Index / index + description / full | 5 / 34 / 95 MB | Search, offline, air-gapped |

**Shape [E]:** each tick is `{date, manifestSha256, records, new, rejected, severity:{…}, status:{…},
backlog:{unenriched,total}, kev:{count,added}, cwe:{"CWE-79":N,…top 50 + other}}`. **Every tick is
stamped with the `manifestSha256` of the run that produced it**, so a point on a chart cites its
snapshot exactly as §14 requires.

**Append-only, and carried twice.** The publisher reads the previously published `ticks.json`, appends
today's row and republishes it. Because `gh-pages` is an **orphan branch force-pushed on every run**, a
single bad run that fails to read yesterday's file would silently wipe the whole history. So
`ticks.json` is **also committed to `main`** on every run — a few KB a day of git growth, which is the
one place committing data is the right call — and the publisher refuses to publish a `ticks.json`
shorter than the one on `main`.

## 21. Traps

| Trap | What goes wrong | The guard |
|---|---|---|
| **The settling window** | ~A third of recent records are unenriched (§12), so CWE and severity series **sag at the right edge** — every chart shows a false recent decline | Shade the settling window on every publish-date chart, label it, and **exclude it from indicator inputs** (SMA/Bollinger never see unsettled points). KEV listings by `dateAdded` do not wait on NVD and are not shaded. The edge (`settledThrough`) is per snapshot and can move earlier |
| **Hindsight bias in backfill** | Backfilling a series with *today's* scores, CWEs or CVSS applied to past dates makes the past look better-classified than it was | Backfill only from data dated at the time (FIRST's dated EPSS files, KEV `dateAdded`); anything else starts at its first recorded tick |
| **Recomputable vs attested** | Mixing the two hides which numbers anyone can check | Series keyed by **publish date or KEV date** are *recomputable* — re-derived from the current snapshot every run, so they revise as records settle. **Backlog and status mix are attested** — they exist only from the first recorded tick — *until weekly snapshots are archived, which §19.2 now does*. **Rejections, net change and KEV adds/removals stay attested even then** (they compare two runs, not one snapshot). Each chart says which kind it is |
| **Market language** | "Bullish", "breakout", "sell-off" imply a forecast and a trade | Plain words only: *rising*, *falling*, *spike*, *unusual*, *sustained*. For the same reason the view is not called "Ticker": it shipped as **Trends** (2026-10-11), and a test (`js/i18n-parity.test.mjs`) fails the build on the market words in any string |
| **The composite** | The temptation to sum tickers into a "Carino index" | **No composite index.** §15's "no proprietary scoring" covers it |
| **Forecasting** | A trend line extended past today is a prediction | **Projection (§21a), decided by the owner 2026-10-11, reversing the earlier "No forecasting" rule.** Projections live only in Projection mode. They project only monthly volume, weekly volume, the Critical+High share of scored CVEs, and monthly KEV additions. Inputs are complete months, or settled weeks that end at `settledThrough`. Every model is backtested from a rolling origin against "same as last period", and is drawn only if it beats that by ≥10%. Bands are empirical out-of-sample quantiles; they are never widened, and their measured coverage is printed. Points are dashed past the input edge and labelled "projection — not a measurement". The horizon is ≤3 months or ≤26 weeks. Never projected: backlog or other attested metrics until 8 rows over 8 weeks exist, EPSS, vendor, CNA or CWE figures, or any composite or risk figure. The method is `proj-v1`, recomputable with `node tools/project.mjs` |

§14 and §15 carry over unchanged. The view opens, on first load, with: **"Not a risk score, not a
vulnerability assessment."** — dismissible, and restated in the footer of every exported image.

### 21a. Projection — method `proj-v1` (decided 2026-10-11)

The owner asked for a Projection section. It is allowed on these terms, and only on these; the code is
`js/cve-project.js` (pure, no clock, no random numbers) and `node tools/project.mjs --stats stats.json.gz
--ticks ticks.json.gz --kev enrich/kev.json.gz` prints exactly the numbers the page draws.

- **Page frame.** A heading badge *not a measurement*; a fixed lede (arithmetic, not a measurement, not
  a risk assessment, often wrong — and how often is printed under each chart); a stamp with the snapshot,
  both `manifestSha256` values and `proj-v1`; a *Method* panel and a *Recompute* panel with the command
  and the three sha256s. Sections, in order: track record, monthly, weekly, C+H share, KEV, not projected.
- **Inputs.** `y[0..N-1]`, edge `N-1`; nothing past the edge ever reaches a model. Monthly: complete
  months of `stats.byMonth` from 1999-01 (the current month is a hollow marker, never pro-rated, never an
  input). Weekly: complete Sunday–Saturday weeks of `ticks.series.total` ending on or before
  `settledThrough`; the weeks after it are hollow *still settling — not an input* dots, and if most of them
  fall outside the 80% band the page says to read the range as a floor or ceiling. If the settling gap
  exceeds 182 days the weekly projection is withheld. Share: the same weeks, (C+H)/(C+H+M+L+NONE), null
  under 100 scored. KEV: additions per month by `dateAdded` from 2023-01 (the 2021–22 catalogue load is
  left out), exempt from settling.
- **Models.** Same as last period (naive), mean of last k, drift over k, log-linear over W, damped Holt on
  logs (α .5, β .2, φ .9, fixed). Monthly candidates: naive, mean 3, drift 12, log-linear 6/12/24, damped
  Holt; seasonal naive is scored for the Method text only. Weekly: naive, mean 4, log-linear 26. Share:
  naive, mean 13 (errors in pp). KEV: the mean of the last 12 months, with a negative-binomial band centred
  on that mean whose size r = m²/(v − m) comes from the mean m and variance v of the last 24 (so its
  variance is mean + mean²/r; Poisson when v does not exceed m). The page prints m, v, r and the centre;
  a Poisson band's backtest is printed beside it.
- **Selection.** Rolling-origin backtest; score = mean error over steps 1–3 on the last 24 origins. A
  candidate is drawn only if its score ≤ 0.9 × naive's; otherwise naive is drawn and the page says no
  method beat it by enough. The losers stay in the table and as thin grey lines.
- **Bands.** For each step h, the errors of the trailing 36 origins whose outcome was known (at least 12,
  or the cone stops). Percentiles 2.5/10/25/50/75/90/97.5 of those errors around the method's point; the
  drawn centre is the **median of past outcomes**. Asymmetric, never widened.
- **Coverage.** Measured out of sample with the same rule and printed as "80% band held n of m times";
  under 70% the page warns that the band has held less often than its label says.
- **Horizon.** 3 months; weekly through the snapshot week plus 4, at most 26; share through the snapshot
  week (what the share is likely to be once the queue drains).
- **Notes printed when they apply.** A break note when the last 6 months run ≥1.5× the 12 before; *no
  trend detected; projected flat* when |t| ≤ 2 on the share; the weekday pattern as the reason daily
  counts are not projected.
- **Not projected, with the reason on the page.** Backlog, queue and deferred share, status mix, record
  count, rejected and net (attested — each shows its counter until 8 rows over 8 weeks exist); EPSS;
  anything per vendor, CNA or CWE; daily volume; year totals; lag and CVSS drift; any composite or risk
  figure.

## 22. Phasing **[E]**

| Phase | Scope | Effort |
|---|---|---|
| **P0** — done 2026-10-10 | Pages serving `gh-pages` at `cve-data.carino.systems`, CORS `*`, first browser render of `stats.html` | — |
| **P1** — publisher — **built 2026-10-10** | `ticks.json` (append-only, carried forward, committed to `main`) · weekly snapshot to Releases · EPSS window with backfill. In `CVE-data`: `tools/ticks.mjs`, `tools/epss-window.mjs`, `tools/archive.mjs`, `tools/ticks-guard.mjs`, wired into `publish.mjs` and `publish.yml`; formats in its `CONTRACT.md` §4 and §13–§15. Live from the first scheduled run after it lands on `main` | **~3–4 days** |
| **P2** — the Trends view — **built 2026-10-11** | Trends and Projection modes inside index.html (`#m=trends|proj`); stats.html redirects. Trends: status strip, pulse tiles, volume with ranges, grains and a usual-range band, severity and no-score mix, CWE change heatmap, KEV, recent KEV and EPSS changes, backlog, and the seven whole-corpus panels; settling-window shading throughout. Projection: §21a. ("Ticker" was renamed "Trends", §21 plain words) | **~1 week** |
| **P3** — the watchlist | Per-CVE watchlist with EPSS "price", event markers (KEV add, re-score, rejection), alerts on sync, watchlist-only vendor tickers; client accumulation for CVEs outside the window | **~1 week** |

**Order:** P1 first and soon — `ticks.json` is the only part that **cannot be built later**; every day
it does not run is a day of state history lost for good (until the snapshot archive makes it
recomputable, which also starts in P1).

## 23. Open questions

1. **[V]** FIRST's EPSS API — does it send `access-control-allow-origin`, and how far back does its
   time-series endpoint go? If both are yes, the client could fetch one CVE's history on demand and the
   window could shrink.
   **Resolved 2026-10-10:** `api.first.org/data/v1/epss?cve=…&scope=time-series` **does** send
   `access-control-allow-origin: *`, but returns **only 30 days**. The publisher-hosted 90-day window
   stays; the API is at most a client-side top-up for the last month. The dated files
   (`epss_scores-YYYY-MM-DD.csv.gz`) go back at least to 2025-10 and are what the window is built from.
2. **[V]** CORS on GitHub Release assets for snapshot **downloads** from the browser (the §4/§9.4
   question, still unanswered). If absent, archived snapshots are recomputable by a person with `curl`,
   not by the page — still true to §13 #8, but say so.
   **Resolved 2026-10-10:** absent. A release-asset download answers with a 302 redirect and **no**
   `access-control-allow-origin`, so no page can fetch one. Recompute is **curl-only**, and it is said
   so in `CVE-data`'s README, CONTRACT §15, every release's notes, `archive.json`
   (`browserFetchable: false`) and the `notes.archive` field of `ticks.json`.
3. **[V]** Release storage over years — ~2.2 GB/year of assets has no documented per-repo cap, but
   "undocumented" is not "unlimited". Decide a thinning rule (e.g. keep weekly for a year, monthly
   after) before year three.
   *Measured 2026-10-10:* one weekly tar is ~60 MB (~64 MB with the EPSS window), so **~3.3 GB/year**,
   not 2.2 — the thinning rule matters a year sooner than estimated.
4. **[E]** EPSS window length and threshold (§19.1) — 90 days / ≥ 0.1 is a proposal, not a decision.
   *Measured 2026-10-10:* the real 90-day window is **213 KB gz** (18,138 CVEs, 56,643 change points),
   about 16× under §19.1's estimate — EPSS rarely moves at 1e-4. A 365-day window would be roughly
   0.6–1 MB **[E]**, so size no longer argues for 90.
