# CVE Radar Pro — review of the current site

**Reviewed:** 21 August 2026 · **Against:** `index.html` at `73f9ad5`, which is identical to
`origin/main`, so this is what `cve.carino.systems` serves.
**Method:** source review plus live NVD API checks. The findings marked **verified** were reproduced
against the API today; the browser extension was not connected, so the visual pass is from the CSS and
markup rather than a screenshot.

---

## 0. Status — fixed 21 August 2026

Everything in §2 and §3 is fixed in the working tree, and the fixes were verified against the live API
(see §7). The product gap in §4 — KEV, EPSS, references, affected products — is deliberately **not**
addressed here: it waits on the corpus in `SCOPE.md`. The CVSS vector and CWE chips *were* added,
because both already arrive in the payload the app was throwing away.

---

## 1. What the site actually does today

One file, no build step, vanilla JS. A 320 px dark filter rail beside a light results column, with the
rail collapsing to a ☰ drawer under 900 px.

| Control | Sends to NVD |
|---|---|
| Quick-search tags (7, hardcoded) | sets keyword, searches immediately |
| Keyword | `keywordSearch` |
| Timeframe — 7 / 30 / 90 days | `pubStartDate` + `pubEndDate` |
| Timeframe — Year 2024/2025/2026 | **`keywordSearch=CVE-<year>`** ← see F1 |
| Timeframe — All Time (Slow) | *no date parameters at all* ← see F4 |
| Minimum Severity | `cvssV3Severity` ← see F2 |
| Sort By | client-side only, over what was fetched |

Rendering: one card per CVE — ID linked to `nvd.nist.gov`, `vulnStatus` badge, description clamped to
two lines and click-to-expand, published/updated dates, and a score box coloured by severity, with
CVSS v3.1 → v3.0 → v2 fallback. Records in `Received` / `Awaiting Analysis` / `Undergoing Analysis`
render as grey `PENDING` cards rather than as zeros.

A search runs on page load. The keyword is mirrored into the URL hash as you type.

---

## 2. Correctness — the four that matter

### F1 · The Year filter returns CVEs from the wrong years. **Verified.**

`fetchYearlyData()` searches `keywordSearch = "CVE-2025"`. NVD's `keywordSearch` matches the
**description text**, not the identifier — so it finds CVEs whose *description mentions* CVE-2025.
Live, today:

```
keywordSearch=CVE-2025  →  totalResults: 45,284
  CVE-2023-51989   published 2024-01-11
  CVE-2024-9065    published 2024-10-10
  CVE-2024-8873    published 2024-11-16
```

**Not one of the first three is a 2025 CVE.** The function then computes
`startIndex = totalResults - 50` and fetches the **last** page — so "Year 2025" shows 50 arbitrary
records from the tail of a text search that was never about 2025. Two API round-trips to produce a
wrong answer.

*Root cause, and it is not the author's fault:* `pubStartDate`/`pubEndDate` are capped at a 120-day
range, so a calendar year genuinely cannot be fetched in one request. The workaround was reasonable to
try; it just does not work. The correct fix is 4 chunked requests per year — or the local corpus, where
it is a trivial filter.

### F2 · "High+" hides every Critical. **Verified.**

`cvssV3Severity` is an **exact-match** filter, not a floor:

```
cvssV3Severity=HIGH  →  totalResults: 76,441   (sampled severities: {HIGH})
cvssV3Severity=CRITICAL →  totalResults: 30,620
```

The labels read *Low+ / Medium+ / High+*. Selecting **High+ therefore excludes all 30,620 criticals.**
In a security tool this is the worst possible direction for an error to point: the filter that sounds
most cautious hides the most dangerous records. **This is the single most serious finding.**

Fix without the corpus: either relabel the options as exact severities (honest, one-line change), or
issue one request per severity at or above the floor and merge.

### F3 · Only 50 results ever come back, and the count does not say so.

`resultsPerPage = 50`, no pagination, no "load more". The header renders
`currentVulnerabilities.length` — so it says **"50 Results Shown"** when the query matched 76,441. The
API returns `totalResults` in the same response and it is never displayed. The user has no way to learn
they are seeing 0.07 % of the matches.

Consequence for F1/F2: every filter bug is invisible, because the result set always looks plausible.

### F4 · "All Time (Slow)" shows 1999.

With `days === 'all'` no date parameters are sent, so NVD returns the first 50 records in its default
order — which begins at `CVE-1999-0095`. It is not slow; it is the oldest 50 CVEs in the database,
every time. The client-side "newest first" sort then orders those 50 among themselves, which makes the
output look deliberate.

---

## 3. Robustness and safety

### F5 · Descriptions are injected as HTML. **Verified as a live rendering bug, and an XSS vector.**

`div.innerHTML = \`… ${cve.descriptions[0].value} …\`` — no escaping. In a 400-record sample, **2
descriptions contained raw angle-bracket tokens**:

```
CVE-2026-50186  →  <user_id>
CVE-2020-25793  →  <InlineArray<A, T>
```

Those are silently swallowed by the parser today, so the displayed description is **already wrong** for
those records. The security case is the same defect one step further: CVE descriptions routinely quote
attack payloads verbatim, and one containing `<img src=x onerror=…>` would execute. `vulnStatus` and
the `title` attribute are interpolated the same way. Use `textContent`, or escape.

### F6 · `descriptions[0]` is assumed English. Some CNAs supply a non-English description first. Filter on `lang === 'en'`.

### F7 · Dates are parsed as local time. NVD returns `2026-08-21T13:41:31.243` with **no timezone suffix**, which JS parses as local time. Displayed dates can be off by a day either side of midnight. Append `Z`.

### F8 · Sorting misrepresents its own scope. "Score (High to Low)" sorts the 50 records that happened to arrive, not the result set. With F3 it reads as a ranking of the database.

### F9 · Unrated CVEs sort as 0 but display `--`. `getScore()` returns `0`, so "Score (Low to High)" leads with PENDING cards. Either exclude them from score sorts or sort them last explicitly.

### F10 · No rate-limit handling. Unkeyed NVD allows **5 requests per 30 s**. A page load costs one request; the Year path costs two. There is no backoff, no retry, and no distinction between 403 (throttled) and 503 (NVD down) — both render "Could not retrieve data from NIST", which at least does not lie, but does not help either.

### F11 · The shareable link is only half shareable. Only the keyword enters the hash. Timeframe, severity and sort are lost, so a shared link does not reproduce the view. The README's "shareable searches" overstates this.

### F12 · The year options (2024, 2025, 2026) are hardcoded and will rot.

### F13 · Keyboard and screen-reader gaps. Expand-on-click is `<p onclick>` — not focusable, no `aria-expanded`. Quick tags are `<span onclick>` rather than buttons. Neither is reachable without a mouse.

---

## 4. The product gap

Even with every bug above fixed, the card carries: ID, status, description, two dates, one number.
It does not carry the **CVSS vector**, the **CWE**, the **references**, the **affected products**, and
neither of the two fields that actually drive triage — **CISA KEV** and **EPSS**.

> As it stands the site is a filter UI in front of NVD that strips out the data a defender needs, so
> every real question ends with a click through to `nvd.nist.gov`. It is a nicer front door to someone
> else's database rather than a tool.

That is the honest framing, and it is the argument for the corpus work in `SCOPE.md` — not the offline
capability by itself.

---

## 5. UI — what is good, and what is not

**Keep.** The dark rail / light document split is right and consistent with `netplan` and `topo`. The
☰ drawer with a scrim under 900 px matches the fleet pattern. The card layout — severity on the left
border, score boxed off on the right behind a rule — is clean and scans well. The loader overlay is
unobtrusive. **The PENDING treatment is the best decision in the file:** refusing to render an
unanalysed CVE as a zero is honest, and it quietly documents NVD's enrichment backlog.

**Fix.**

- **Two golds.** `--primary: #b45309` drives links and the focus border, while buttons, tags and focus
  rings use `#eab308`. Pick one from Branding's tokens.
- **No result-level affordances.** No copy-the-ID, no export, no per-card link to references. Anyone
  compiling a list is retyping identifiers.
- **The empty state is bare text.** It cannot distinguish "no matches" from "your filter is
  self-contradictory", which given F2 is a real scenario.
- **`totalResults` is missing from the header** — F3 is as much a UI omission as a data one.
- **A search fires on every page load**, spending an API request on visitors who came to read.
- **No stated data provenance.** No "data from NVD, retrieved at «time»". Once §6 of `SCOPE.md` exists
  this becomes mandatory; it would be worth adding now.

---

## 6. Verdict

> **The shell is good. The data layer is wrong.**

Three of the four filter behaviours — Year, All Time, and Minimum Severity — return results that do not
match their labels, and the result count conceals it. The two functions doing the most work
(`fetchYearlyData`'s probe-then-fetch-last-page, and the severity pass-through) exist only because the
NVD API cannot do what the UI promises.

**This is the argument for `SCOPE.md`, restated in one line:** with the corpus in IndexedDB, F1, F2,
F3, F4, F8 and F9 stop being bugs to fix and become properties that cannot occur — year filtering,
a true severity floor, honest totals, and whole-corpus sorting are all trivial local operations. The
corpus is not a feature request. **It is the fix.**

### Order of work

| | Do | Why |
|---|---|---|
| **Now, before anything else** | F2 (relabel or merge queries), F5 (escape), F3 (show `totalResults`) | Under an hour each; F2 and F5 are the two that can actually harm someone |
| **Now** | F1 and F4 — chunk the year into 4 requests, or drop both options until the corpus lands | Better to remove a control than to ship one that lies |
| **Next** | F6, F7, F9, F11, F12, F13 | Ordinary correctness and access |
| **Then** | The corpus (`SCOPE.md` §7) | Which retires most of the above permanently |
| **With the corpus** | KEV, EPSS, CVSS vector, CWE, references on the card | The product gap in §4 |


---

## 7. What was changed, and how it was verified

Verified by loading the shipped script in Node with DOM stubs and running its own planner, then
sending the URLs it generated to the live API.

**The planner now produces correct queries.**

```
severityQueries('HIGH')   → ["HIGH","CRITICAL"]      (was: HIGH only)
windowsFor('2025')        → 2025-01-01→03-31  90d
                            2025-04-01→06-30  91d
                            2025-07-01→09-30  92d
                            2025-10-01→12-31  92d    (all inside the 120-day cap)
windowsFor('2026')        → three windows, the last clamped to today; Q4 dropped
esc('<img src=x onerror=alert(1)> <user_id>')
                          → &lt;img src=x onerror=alert(1)&gt; &lt;user_id&gt;
nvdDate('2026-01-01T00:30:00.000')
                          → 2026-01-01T00:30:00.000Z  (was read as local time)
```

**F1 — the year filter.** Sending the URL the app now builds for Q1 2025, keyword `Chrome`:

```
…pubStartDate=2025-01-01…&pubEndDate=2025-03-31…&keywordSearch=Chrome&cvssV3Severity=HIGH
  → CVE-2025-0291  published 2025-01-08  HIGH
    CVE-2025-0437  published 2025-01-15  HIGH
```

Every record is genuinely from the requested quarter. The old build returned CVE-2023 and CVE-2024
records for the same request.

**F2 — the severity floor.** In Q1 2025 alone:

```
cvssV3Severity=HIGH      → 1,216
cvssV3Severity=CRITICAL  →   556
```

The old "High+" showed the 1,216 and silently hid the 556. Both streams are now fetched and merged,
and the floor is re-applied locally so the result is correct regardless of which path was taken.

### The fixes, by finding

| | Finding | Fix |
|---|---|---|
| F1 | Year filter returned other years | Four quarter windows on `pubStartDate`/`pubEndDate`; the `keywordSearch=CVE-<year>` trick is gone |
| F2 | "High+" hid every Critical | Floor built from one stream per level (`HIGH` + `CRITICAL`), re-applied client-side; the Critical option is relabelled *Critical only* |
| F3 | Count concealed coverage | Header reads *"Showing X of Y loaded (Z matched)"* against the API's `totalResults`, with a **Load more** control |
| F4 | "All Time" showed 1999 | Option removed; years now run from the current year back to 1999 |
| F5 | Descriptions injected as HTML | Everything from the API is escaped before it reaches `innerHTML` |
| F6 | `descriptions[0]` assumed English | The `lang === 'en'` entry is selected explicitly |
| F7 | Timestamps read as local time | `Z` appended before parsing |
| F8 | Sort misrepresented its scope | Still client-side, but now over a 1,000-per-page window with the loaded/matched counts on screen |
| F9 | Unrated sorted as 0 | Unrated records sort last in both score directions |
| F10 | No rate-limit handling | Serial token bucket (5 / 30 s) with a visible countdown and one retry on 403/429 |
| F11 | Half-shareable links | The whole view is in the hash (`#q=…&t=…&s=…&o=…`); bare-keyword links still work |
| F12 | Hardcoded years | Generated from the current year back to 1999 |
| F13 | Keyboard and screen-reader gaps | Tags and the description toggle are real `<button>`s with `aria-expanded`/`aria-controls` and focus rings |
| new | A record could pass the High+ floor and still render as a grey `--` PENDING card, because PENDING was decided by `vulnStatus`. **30% of a 400-record sample carry a CNA score NVD has not analysed.** PENDING now means *no score at all* (2%), and the card names the score's source | Found while testing the fix, not in the original review |
| new | `metrics.cvssMetricV31[0]` could show a CNA's score while NVD's own sat beside it — 18 of 400 records carry more than one metric entry | NVD's entry is preferred, then any `Primary`, then the first |
| §5 | Two golds, no affordances, no provenance | `--accent` split from `--primary` by surface; copy-ID, CSV and JSON export; a provenance line stating source and retrieval time |

### Found by testing the fix

Loading the shipped script under a stubbed DOM and driving a full search revealed two things the source
review had not:

- **A year query at `High+` is eight requests, and nothing appeared for ~30 s** while the rate limiter
  waited. Results now paint after each request — newest quarter and highest severity first — so the
  first cards land in about a second. Verified: *first paint after request 1, five paints across the
  search*.
- **The reset flashed "no CVEs were published in this window"** between clearing the old results and
  the first response, and the loader overlay would have covered cards that progressive rendering had
  already painted. Both fixed.

### Deliberately not changed

- **A search still runs on page load.** The review flagged the cost, but it is now a single request and
  an empty dashboard on arrival is the worse trade.
- **KEV, EPSS, references and affected products are still absent.** They need the mirror in `SCOPE.md`
  — KEV and EPSS send no CORS header, so a browser cannot fetch them at all.
- **The severity floor still cannot see CVSS v2-only records** under `High+` or `Critical only`, because
  `cvssV3Severity` matches v3 metrics only. Documented in the README rather than hidden.
