# analytics-sankhacooray-com

Google Apps Script web-app proxy that aggregates visitor stats from the
**GA4 Data API** for the whole sankhacooray.com network and serves a
small, cached, **per-host** JSON blob to every public site.

It powers two things on the sites:

1. **Google Analytics tracking** — every page (main domain + all
   subdomains) reports into **one** GA4 property under **one** measurement
   ID, told apart by the `hostName` dimension.
2. **A public "fame" badge** — a small pill in the corner of each page
   showing how busy *that* site is today and where it ranks among its
   sibling sites this month. Credentials never reach the browser; only
   aggregate counts do.

This mirrors the pattern from `ahlab-org/ahl-analytics-appscript`, extended
to slice stats **by host** so each subdomain shows its own numbers.

---

## How it works

```
Browser (sankha-analytics.js on any site)
    │  GET ?host=fold.sankhacooray.com   (no auth headers)
    ▼
Apps Script web app  (doGet → Code.js)
    │  one cached network-wide blob; slice out the requested host
    ├─ cache HIT  → return sliced JSON
    └─ cache MISS → fetch fresh from GA, cache, return
            │  4 calls: realtime + today + 7d + 30d  (Reports.js)
            ▼
        GA4 Data API (AnalyticsData advanced service)
```

One cache miss per TTL window (default 5 min) makes **4** GA calls for the
*entire network*, because slicing a host out of the cached blob costs no
quota. Thousands of public hits → a handful of API calls per hour.

### Response shape (per request)

```jsonc
{
  "host": "fold.sankhacooray.com",
  "site": {
    "today":   { "users": 12, "pageviews": 28 },
    "last7d":  { "users": 90, "pageviews": 210 },
    "last30d": { "users": 340, "pageviews": 880 }
  },
  "rank": 2,            // this host's 30-day rank in the network
  "totalSites": 15,
  "network": {
    "realtime": { "activeUsers": 5 },   // network-wide (realtime has no host dim)
    "today":    { "users": 60,  "pageviews": 140 },
    "last7d":   { "users": 420, "pageviews": 980 },
    "last30d":  { "users": 1500,"pageviews": 3900 }
  },
  "cachedAt": "2026-06-09T12:00:00.000Z"
}
```

> **Note on realtime:** the GA4 realtime API does not expose `hostName`,
> so the live "active now" number is network-wide, not per-site. Per-site
> freshness comes from the `today` range, which GA fills within minutes.

### Endpoint params

| Param      | Example                        | Effect                                   |
|------------|--------------------------------|------------------------------------------|
| `host`     | `fold.sankhacooray.com`        | Scope the `site` block to this host.     |
| `refresh`  | `1`                            | Bypass cache (dev only; honour-based).   |

---

## Files

```
src/
  Code.js         doGet — slices the cached network blob per host
  Reports.js      the 4 GA4 Data API calls, broken down by hostName
  CacheLayer.js   ScriptCache wrapper (one blob, all hosts)
  Test.js         testFetchStats / testHostSlice — run from the editor
  appsscript.json manifest: AnalyticsData service, scopes, web-app access
.clasp.json.example   copy to .clasp.json after `clasp create`
```

The browser-side counterpart lives in the main site repo:
`sankhacooray-com/js/sankha-analytics.js` (served at
`https://sankhacooray.com/js/sankha-analytics.js` and loaded by every page).

---

## Setup

See **[SETUP.md](SETUP.md)** for the full step-by-step — creating the GA4
property, copying this project into your personal Google account,
deploying, and wiring the two config values into the sites.
