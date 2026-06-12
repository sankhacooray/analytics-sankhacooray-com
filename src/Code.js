/**
 * Code.js — entry point for the sankhacooray.com network analytics proxy.
 *
 * Public, anonymous endpoint. The whole network (sankhacooray.com plus
 * every subdomain) reports into ONE GA4 property under ONE measurement
 * ID; the sites are told apart by the `hostName` dimension. This proxy
 * fetches the network-wide numbers once, caches them, and on each
 * request slices out the stats for the single host the caller asks
 * about — so every visitor can see how busy *this* site is, and where
 * it ranks against its siblings.
 *
 * Auth credentials never leave Apps Script: the executing user
 * (USER_DEPLOYING) holds the Viewer grant on the GA4 property; the
 * browser only ever sees aggregated counts.
 *
 * Caching strategy:
 *   One cache miss per CACHE_TTL_SECONDS window (default 300s) calls GA
 *   exactly four times (realtime + today + 7d + 30d). Every public hit
 *   in between — for ANY host — is served from the one cached blob,
 *   because slicing a host out of the cached data costs no API quota.
 *
 * Configuration (Project Settings → Script Properties):
 *   GA_PROPERTY_ID    — required. Numeric GA4 property ID (e.g.
 *                       "452109876"). NOT the measurement ID (G-XXXX).
 *                       GA4 Admin → Property Settings → Property ID.
 *   CACHE_TTL_SECONDS — optional. Override the default 5-min TTL.
 *                       Hard-floored at 60s so quota can't be torched.
 *
 * Routing: a single GET endpoint.
 *   ?host=fold.sankhacooray.com  — scope the `site` block to this host.
 *                                   Omit to get network numbers only.
 *   ?refresh=1                   — bypass cache (dev only; honour-based,
 *                                   since the endpoint is public).
 */
function doGet(e) {
  try {
    var params  = (e && e.parameter) || {};

    // Claude Code activity lives in Claude.js — route it before touching
    // GA so the visitor path stays untouched (and costs no GA quota).
    if (params.source === 'claude') {
      return jsonResponse_(handleClaudeGet_(params));
    }

    var refresh = params.refresh === '1';
    var host    = normalizeHost_(params.host);

    var blob = getStatsCached_(refresh);     // network-wide, cached
    return jsonResponse_(buildResponse_(blob, host));
  } catch (err) {
    return jsonResponse_({
      error: 'stats-unavailable',
      message: String(err && err.message || err)
    });
  }
}

/**
 * buildResponse_(blob, host) — shape the cached network blob into the
 * per-request payload the widget reads.
 *
 * `site` is the slice for the requested host (null if no host given).
 * `rank` / `totalSites` let a site say "ranked #2 of 15 this month".
 * `network` carries the whole-network totals so the badge can show
 * context ("X active across the network right now").
 */
function buildResponse_(blob, host) {
  var site = null;
  var rank = null;
  if (host) {
    site = {
      today:   sliceHost_(blob.today,   host),
      last7d:  sliceHost_(blob.last7d,  host),
      last30d: sliceHost_(blob.last30d, host)
    };
    rank = rankOf_(blob.last30d.order, host);
  }

  return {
    host: host || null,
    site: site,
    rank: rank,
    totalSites: blob.last30d.order.length,
    network: {
      realtime: blob.realtime,
      today:    blob.today.total,
      last7d:   blob.last7d.total,
      last30d:  blob.last30d.total
    },
    cachedAt: blob.cachedAt
  };
}

/**
 * sliceHost_(range, host) — pull one host's row out of a cached range,
 * defaulting to zeros when the host has no traffic in that window (so
 * the widget can show "0 today" rather than breaking on undefined).
 */
function sliceHost_(range, host) {
  return (range.byHost && range.byHost[host]) || { users: 0, pageviews: 0 };
}

/**
 * rankOf_(order, host) — 1-based position of `host` in the 30-day
 * users-descending ranking, or null if the host has no 30-day traffic.
 */
function rankOf_(order, host) {
  for (var i = 0; i < order.length; i++) {
    if (order[i] === host) return i + 1;
  }
  return null;
}

/**
 * normalizeHost_(raw) — lower-case, trim, and strip any leading "www."
 * so "WWW.Fold.Sankhacooray.com" and "fold.sankhacooray.com" collapse
 * to the same key the GA hostName dimension uses. Returns null for
 * empty / missing input.
 */
function normalizeHost_(raw) {
  if (!raw) return null;
  var h = String(raw).trim().toLowerCase();
  if (h.indexOf('www.') === 0) h = h.slice(4);
  return h || null;
}

/**
 * jsonResponse_(obj)
 *
 * Apps Script's ContentService can't set real HTTP status codes from a
 * web app, so failures are signalled by an `error` field in the body.
 * The widget checks for `error` and hides itself rather than rendering
 * a broken badge.
 */
function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
