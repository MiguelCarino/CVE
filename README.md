# CVE Radar Pro

Client-side CVE search dashboard for the NIST National Vulnerability Database — keyword search, timeframe and severity filters, and color-coded CVSS cards, all in a single static page.

Live at **https://cve.carino.systems**

![image](https://github.com/user-attachments/assets/f9d84263-b4a1-42b4-8911-4a6bc09db5f7)

## Features

- **Keyword search** — free-text search over product, vendor, or keyword (NVD `keywordSearch`), with quick-search tags for Linux Kernel, Rust, Windows 11, Android, Fortinet, Chrome, and Ivanti.
- **Timeframe filter** — Last 7 / 30 / 90 days (default 90), a specific year (2024–2026), or All Time.
- **Minimum severity filter** — Any / Low+ / Medium+ / High+ / Critical, passed to the API as `cvssV3Severity`.
- **Client-side sorting** — re-sort fetched results by date (newest/oldest) or CVSS score (high/low) without re-querying the API.
- **CVE cards** — each result shows the CVE ID (linked to its detail page at `nvd.nist.gov/vuln/detail/<id>`), NVD analysis status badge, a two-line description that expands on click, published/updated dates, and a score box colored by severity (Low / Medium / High / Critical). CVEs still awaiting NVD analysis render as grey "PENDING" cards.
- **CVSS version fallback** — scores are read from CVSS v3.1 first, then v3.0, then v2.
- **Shareable searches** — the search term is mirrored into the URL hash as you type (e.g. `#Fortinet`), and a hash present on page load pre-fills the search box; a search runs automatically on load.
- **Mobile drawer** — below 900px the filter rail becomes an off-canvas drawer toggled by a ☰ button injected into the shared navbar; it closes via the scrim, the Escape key, or automatically when a quick-tag or Search is tapped.
- **API status indicator** — the results header shows Fetching… / NVD API Connected / API Error.

## How it works

Everything runs client-side in a single `index.html` — vanilla JS, no frameworks, no build step, no backend.

- **API**: queries the NVD CVE API 2.0 directly from the browser at `https://services.nvd.nist.gov/rest/json/cves/2.0/`, unauthenticated (no API key), fetching up to 50 results per request (`resultsPerPage=50`).
- **Date-range searches** (7/30/90 days) send `pubStartDate`/`pubEndDate` computed from today; **All Time** omits the date bounds.
- **Year searches** use a two-step strategy: a 1-result probe with `keywordSearch` set to `CVE-<year>` (plus any user keyword) reads `totalResults`, then a second request fetches the last page (`startIndex = totalResults − 50`) so the newest entries of that year are shown.
- **Rate limiting**: there is no API key handling or retry logic; if the NVD API rejects or fails a request (including public rate limiting), the app shows a "Connection Error — please wait a moment and try again" message.
- **Sorting** is purely client-side: fetched vulnerabilities are held in memory and re-sorted/re-rendered on dropdown change.
- **Persistence**: nothing is cached or stored (no localStorage/cookies); the only persisted state is the search term in the URL hash.
- **Fleet chrome**: shared Carino Systems top navbar via `carino-navbar.js` (with `carino-clock.js`), self-hosted fonts via `fonts/carino-fonts.css`, gold-on-black filter rail with a light results area.

## License

Licensed under the **GNU Affero General Public License v3.0 or later** (AGPL-3.0-or-later) — see [LICENSE](LICENSE). Copyright © 2026 Miguel Carino.
