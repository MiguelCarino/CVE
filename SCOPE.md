# CVE — scope for the downloadable database

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
