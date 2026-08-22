# CVE Radar Pro

Client-side CVE search dashboard for the NIST National Vulnerability Database — keyword search, timeframe and severity filters, and color-coded CVSS cards, all in a single static page.

Live at **https://cve.carino.systems**

![image](https://github.com/user-attachments/assets/f9d84263-b4a1-42b4-8911-4a6bc09db5f7)

## Features

- **Keyword search** — free-text search over product, vendor, or keyword (NVD `keywordSearch`).
- **Quick views** — a *view* is the whole search state (keyword + timeframe + severity floor + sort), which is exactly what the share link carries. The sidebar shows **five starred chips and a `⋯`**; the full catalogue of 35 lives in a dialog, so the list can grow without the sidebar growing. Grouped as **Triage** (*Critical · last 7 days*, *High+ · last 30 days*), **Edge & VPN** (Fortinet, Ivanti, Citrix, Palo Alto, SonicWall, Cisco), **Operating systems**, **Servers & data**, **Browsers**, **Clinical & imaging** (DICOM, PACS, Orthanc, GE Healthcare, Philips, Siemens, Medtronic), **Cloud & CI**, and **Languages & runtimes**. The less obvious ones were checked against the API before shipping, so none of them are dead ends.
- **Your own views** — *Save current view* names whatever is on screen and stars it; star or unstar anything to choose the five in the sidebar; export and import the whole set as JSON.
- **Timeframe filter** — Last 7 / 30 / 90 days (default 90), or any single year from the current one back to 1999.
- **Minimum severity filter** — Any / Low+ / Medium+ / High+ / Critical only. It is a **floor**: `High+` includes Critical.
- **Honest counts** — the results header reads *"Showing X of Y loaded (Z matched)"*, where Z is the API's own `totalResults`. **Load more** fetches the next page of each unfinished query.
- **Client-side sorting** — re-sort loaded results by date or CVSS score without re-querying. Unrated CVEs have no score, so they sort last in both directions rather than as a 0.
- **CVE cards** — CVE ID (linked to `nvd.nist.gov/vuln/detail/<id>`), NVD analysis status, description with an expand control, the CVSS vector and its source, CWE chips linking to `cwe.mitre.org`, published/updated dates, a copy-ID button, and a score box coloured by severity.
- **CVSS version fallback** — scores are read from CVSS v3.1 first, then v3.0, then v2. Where a record carries several metric entries, NVD's own is preferred over the CNA's, and the card says which one it is showing (`CVSS 3.1 · NVD` / `· CNA`).
- **PENDING means no score** — a grey PENDING card means the record carries no CVSS at all (about 2% of records). A CVE that NVD has not analysed yet usually still carries the CNA's score; that score is shown, with the `vulnStatus` badge saying NVD has not finished.
- **Export** — CSV or JSON of what is on screen. The JSON carries the query, the retrieval timestamp and both counts.
- **Shareable views** — the whole view is in the URL hash (`#q=chrome&t=2025&s=HIGH&o=score-high`), so a shared link reproduces what the sender saw. Old links carrying a bare keyword still work.
- **KEV and EPSS** — cards carry a **KEV** badge when CISA lists the CVE as known-exploited, and an EPSS chip with the exploitation probability. Both are filterable. Neither service can be fetched by a browser at all; see [Exploitation and probability](#exploitation-and-probability--kev-and-epss).
- **The observatory** — [`stats.html`](stats.html) plots the whole corpus: publication volume, severity mix, the NVD enrichment backlog, analysis lag, CWE and CNA data quality, KEV overlap, EPSS distribution. It downloads ~200 KB and no shards.
- **Watchlists** — name a list of product terms once and ask *"what is new for my estate since my last sync?"* Exports to CSV, JSON and a printable HTML, each stamped with the snapshot it was computed from.
- **Provenance** — the rail states where the data came from and when it was retrieved.
- **Mobile drawer** — below 900px the filter rail becomes an off-canvas drawer toggled by a ☰ button injected into the shared navbar; it closes via the scrim, the Escape key, or automatically when a quick-tag or Search is tapped.
- **API status indicator** — Fetching… / per-request progress / rate-limit countdown / NVD API Connected / API Error.

## How it works

Everything runs client-side in a single `index.html` — vanilla JS, no frameworks, no build step, no backend. Queries go to the NVD CVE API 2.0 at `https://services.nvd.nist.gov/rest/json/cves/2.0/`, unauthenticated, `resultsPerPage=1000`.

Three rules govern the client, and each exists because an earlier build broke it — see [`REVIEW.md`](REVIEW.md) for the evidence:

1. **Fetch by date range only.** `pubStartDate`/`pubEndDate` cap at a 120-day span, so a calendar year is fetched as **four quarter windows** (the longest is 92 days). The previous build asked for `keywordSearch=CVE-<year>`, but `keywordSearch` matches the *description text*, not the identifier — it returned other years entirely, and then kept only the last page of them.
2. **`cvssV3Severity` is an exact match, never a floor.** A floor of `High+` is built by querying `HIGH` and `CRITICAL` as separate streams and merging; wider floors fetch unfiltered and are filtered locally, because three or four requests per window is not worth it. The floor is applied client-side as well, so the result is correct either way. *(Caveat: `cvssV3Severity` matches v3 records only, so a CVE carrying only CVSS v2 metrics will not appear under a narrow floor.)*
3. **Never show a count we did not measure.** `totalResults` is reported next to how much of it is actually loaded.

Other mechanics:

- **Progressive rendering** — a year at a `High+` floor is eight requests, and the rate limiter has to pause partway through. Results paint after *each* request, newest quarter and highest severity first, so the first cards are on screen in about a second and the rest fill in behind them.
- **Rate limiting** — unkeyed NVD allows 5 requests per 30 s. Every call passes through a serial token bucket that waits when the window is full and shows the countdown; a 403 or 429 triggers one patient retry before failing. No API key is handled or stored.
- **Escaping** — everything from the API is escaped before it reaches `innerHTML`. CVE descriptions quote attack payloads verbatim and contain bare angle brackets such as `<user_id>`, which the previous build silently swallowed.
- **Timestamps** — NVD returns times with no timezone suffix, so `Z` is appended before parsing; otherwise the browser reads them as local time and the displayed date can slip by a day.
- **Descriptions** — the English entry is selected explicitly rather than assuming it is first.
- **Persistence** — no CVE data is ever cached or stored, and nothing about a search leaves the browser. The one thing kept locally is **the views you save**, in `localStorage` under `cve.views`; that access is wrapped so a browser that refuses it (private mode, storage disabled) simply has no saved views rather than breaking. Everything else lives in the URL hash. Use *Export* if you want the set to survive a cleared profile.
- **Fleet chrome** — shared Carino Systems top navbar via `carino-navbar.js` (with `carino-clock.js`), self-hosted fonts via `fonts/carino-fonts.css`, gold-on-black filter rail with a light results area.

## Offline corpus

The page can hold the whole NVD corpus locally and search it with no network at all. Three sources
are tried **per query**, and every fallback is announced rather than silent:

| | Source | Falls through when |
|---|---|---|
| 1 | **Local** — 28 gzipped year shards in IndexedDB | no local copy; the store lacks a year the query needs; or the query has a keyword and the stored tier is `index` |
| 2 | **Mirror** — your own host, default `cve-data.carino.systems` | network error, non-200, malformed manifest, or a SHA-256 mismatch |
| 3 | **NVD live** | — |

**A snapshot has a date; "last 7 days" does not.** When a query window runs past the snapshot, the
residual span becomes its own NVD request and merges in. If that request fails, the local results
stay on screen and the header says **complete through *date*** — because returning fewer records
without saying so is the failure this whole rebuild exists to remove.

Measured: **one year decompresses and scans in 244 ms, all 28 years in 892 ms, peak memory 139 MB.**
Shards are stored compressed and decompressed **one at a time** in a Web Worker — holding the corpus
as live objects instead costs 896 MB, which is the entire reason for that design. A year query
offline is ~250 ms; the same query online is four to eight requests plus a possible 30-second
rate-limit pause. **Offline is the fast path, not the degraded one.**

Two tiers: **full** (~30 MB, with descriptions, full offline keyword search) and **index** (~5 MB,
no descriptions, keyword matching falls back to id and product keys). The client offers `full` by
default but warns and prefers `index` when `navigator.deviceMemory < 4` or the viewport is ≤900 px.

Open the **Data source** dialog from the provenance line in the rail to download, update, delete, or
point the client at your own mirror. The sidebar gains no controls.

Publisher, wire format and the self-hosting bundle: **[CVE-data](https://github.com/MiguelCarino/CVE-data)**
— `CONTRACT.md` is the schema of record, `SEAMS.md` walks one record end to end.

## Exploitation and probability — KEV and EPSS

A CVSS score says how bad a vulnerability would be if someone used it. Two other feeds say whether
anyone *is*:

- **CISA KEV** — the Known Exploited Vulnerabilities catalogue. About **1,700 entries**, each with
  the date CISA added it, the remediation due date for US federal agencies, and whether it is known
  to be used in ransomware campaigns. It answers *is this being exploited right now*, which is worth
  more per byte than anything else in this dataset.
- **FIRST EPSS** — a daily-refreshed probability that a given CVE will be exploited in the wild in
  the next 30 days, plus that score's percentile against every other CVE. One score per CVE.

**Neither one can be fetched by a browser.** Measured with a cross-origin `Origin` header on
21 August 2026: **CISA KEV and FIRST EPSS both send no `access-control-allow-origin`.** Not a
restrictive value — none at all, so the browser refuses the response before this page ever sees it.
No amount of client-side cleverness gets around that; a proxy or a mirror is the only route. So the
publisher mirrors both, hashed like everything else:

```
/enrich/kev.json.gz      ~1,700 entries
/enrich/epss.json.gz     one score per CVE
```

Mirroring them is therefore not a convenience or a caching trick — it is the only way a page with no
backend can ever show this data at all. Both files are small enough to load with the corpus and
useful enough to load without it.

Either file may be **absent**: if CISA or FIRST is down when the publisher runs, the manifest simply
omits that key. The client degrades to *no badges* — never to a wrong badge, and never to a failed
publish. A filter whose feed did not load is **not applied**, and the header says so: silently
filtering to KEV with no KEV catalogue would empty the list and read exactly like *nothing here is
being exploited*, which is the most expensive wrong answer this page could give.

KEV is fetched on every visit, corpus or no corpus — it is ~1,700 entries and it answers the
question worth the most per byte. **EPSS is not fetched on a device reporting less than 4 GB of
memory**: it is one score per CVE, roughly 60 MB held as live objects against about 50 KB for the
whole of KEV, and §8 already refuses to hand such a device a full-tier corpus. The EPSS control is
then disabled and its tooltip says which of the two reasons applies.

**Filtering, and its honest limit.** *Known exploited only* and an *EPSS at least* threshold are
display-side filters over the records already loaded, applied **after** the severity floor. They
never enter the query plan — no source is asked to search by them, because no source offers it.
Both ride in the share link (`k=1`, `e=0.5`) and in saved quick views.

That has a consequence the UI states rather than hides: **KEV is 0.44% of all CVEs** — roughly 1,700
of 381,425. Turning the KEV filter on over a 1,000-record page fetched live from NVD will usually
show nothing at all, not because nothing is exploited but because the page you happened to load
holds none of it. Against a local corpus the same filter is exact, because every record is present
to be filtered. When the filter is on and the answer came from NVD live, the header says so.

## The observatory — `stats.html`

[`stats.html`](stats.html) is the corpus seen whole: 381,425 records, plotted. It reads
`manifest.json` and `stats.json.gz` — about **200 KB** — and **never a shard**. The most interesting
public-facing thing here is also the smallest download, so it works on a phone, on hotel wifi, and
for someone who has no intention of storing 30 MB.

Charts are **inline SVG with no library and no CDN**, theme-aware, self-hosted fonts like the rest of
the fleet. What it plots:

| Panel | |
|---|---|
| **01 · The backlog** — *what is not analysed yet* | How many published records NVD has not finished analysing, month by month, and the NVD status mix behind that count. It is first because it is the largest single caveat on every other figure on the page. |
| **02 · Known exploited** — *severity is not a work queue* | KEV size, its overlap with the corpus, the severity those records carried at publication, and how many days passed between publication and the KEV listing. Plus the EPSS distribution, and the median EPSS for KEV versus non-KEV records. |
| **03 · Volume** — *how much gets published* | CVEs per year and per month, with rejections counted separately. |
| **04 · Severity** — *the distribution, and what "none" means* | The CRITICAL/HIGH/MEDIUM/LOW mix and its drift year by year, with **none** and **no CVSS at all** kept as separate columns. Plus mean NVD-vs-CNA score drift, with sample sizes. |
| **05 · Weaknesses** — *which mistakes, and whether they move* | The most common CWEs overall and by year. |
| **06 · Data quality** — *what the records themselves are missing* | Per assigner: CVSS coverage, CWE coverage, median description length. Records with no CWE, no CVSS, or a description too short to act on. Analysis lag as median and p90 days. |
| **07 · Rhythm** — *when the work happens* | Publications by weekday and by day of month. |

### Five rules every chart on that page obeys

1. **Never rank vendors or CNAs by raw CVE count as "most insecure".** A high count usually means
   more scrutiny, a working disclosure process and an assigner that publishes. The CNA panel is a
   *data-quality* table — CVSS coverage, CWE coverage, description length — and it carries that
   caveat **in the chart**, not in a footnote somebody will crop off.
2. **Missing is never zero.** "No CVSS" and "CVSS 0.0" are different columns and never merge.
3. **Every figure states its snapshot and its `manifestSha256`.** A statistic without a snapshot is
   a rumour.
4. **The backlog is disclosed, never hidden.** If a third of recent records are unenriched, every
   statistic derived from them says so on the chart.
5. **Sample sizes are printed wherever a median or a mean appears.**

Absent KEV or EPSS means those two panels are **omitted, not zeroed** — a chart of zeros is a lie
about the data, where a missing chart is a fact about the publish.

## Watchlists

A watchlist is a named list of product terms — *your estate* — kept in `localStorage` under
`cve.watch`, beside the quick views, and nowhere else. Its report answers one question:

> **since your last sync, N new CVEs match your estate.**

The report takes every record published after the watchlist's `since` date, matches each term
against the description, the CVE id and the vendor:product keys, and runs the whole thing through
the corpus worker. Three rules make that sentence literally true rather than a turn of phrase:

1. **A report requires a local corpus.** "Since your last sync" is meaningless with no previous
   sync — NVD live has no yesterday. With no stored snapshot the report refuses and says why,
   rather than returning a short list that looks complete.
2. **The window ends at the snapshot, never at *now*.** A snapshot has a date; "up to today" does
   not. The report says *through 2026-08-21* because that is the last day the stored corpus can
   speak for.
3. **A year the store lacks is a refusal, not a smaller answer.** Half a security answer reads
   exactly like a whole one, so a window touching a missing shard rejects with the years named.

`since` only ever moves when you mark a report reviewed, which is what keeps the headline honest
across runs. Reaching watchlists is done from the **Data source** dialog, because a watchlist is
something you do with the corpus — the sidebar still gains no controls.

Export as **CSV**, **JSON** or a **printable HTML** page. Every one of the three is stamped with the
term list, the window it covers, the snapshot date and the `manifestSha256` it was computed from, so
whoever receives it can fetch that snapshot and recompute the same answer. That stamp is the whole
difference between a deliverable and a screenshot.

## Documents

- [`REVIEW.md`](REVIEW.md) — the review this rebuild answers, with the API evidence for each finding.
- [`SCOPE.md`](SCOPE.md) — the proposal for a downloadable, self-hostable copy of the database, and what an owned corpus unlocks.

## Licensing

**Mine — GNU Affero General Public License v3.0 or later.** Everything in this
repository *except* the paths listed below. Copyright © 2026 Miguel Carino.
Full terms in [LICENSE](LICENSE).

**Not mine.** The files below are third-party works redistributed here. This
project's licence does not cover them and could not: they are not mine to
relicense. Each keeps its own terms, and each carries its own notice.

| Path | What it is | Licence | Notice |
| --- | --- | --- | --- |
| [`fonts/`](fonts/) | IBM Plex Mono, IBM Plex Sans, Red Hat Display | SIL OFL 1.1 | [`fonts/OFL.txt`](fonts/OFL.txt) |

Those files travel with any fork, mirror or repackaging of this repository, and
their notices must travel with them.
