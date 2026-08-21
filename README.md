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
