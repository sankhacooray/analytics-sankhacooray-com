/**
 * Reports.js — wraps the GA4 Data API into the four calls that build
 * the network-wide stats blob.
 *
 * Uses the AnalyticsData advanced service (enabled in appsscript.json),
 * which authenticates as the deploying user. That user must have at
 * least Viewer access to the GA4 property named by GA_PROPERTY_ID.
 *
 * The whole sankhacooray.com network shares ONE GA4 property, so each
 * range report is broken down by the `hostName` dimension — that single
 * call yields, in one shot: every site's per-host numbers, the
 * property-wide total (via metricAggregations TOTAL), and the ranking
 * order (rows come back sorted by users descending).
 *
 * Network blob shape (Code.js slices per-host out of this):
 *   {
 *     realtime: { activeUsers: N },              // network-wide, last 30 min
 *     today:    Range,                           // since midnight
 *     last7d:   Range,
 *     last30d:  Range,
 *     cachedAt: "ISO-8601 string"
 *   }
 * where Range =
 *   {
 *     total:  { users: N, pageviews: N },
 *     byHost: { "fold.sankhacooray.com": { users, pageviews }, ... },
 *     order:  [ "fold.sankhacooray.com", ... ]   // users desc
 *   }
 */

/**
 * getStats_() — make the four GA Data API calls and assemble the blob.
 *
 * Realtime is its own API surface (runRealtimeReport) and — importantly
 * — does NOT expose the hostName dimension, so the realtime number is
 * network-wide only. Per-site freshness is carried by the `today`
 * range instead, which GA populates within minutes.
 */
function getStats_() {
  var propertyId = getProperty_('GA_PROPERTY_ID');
  if (!propertyId) {
    throw new Error('GA_PROPERTY_ID script property is not set. ' +
      'Open Project Settings → Script Properties and add the numeric ' +
      'GA4 property ID (e.g. 452109876).');
  }
  var propertyPath = 'properties/' + propertyId;

  return {
    realtime: fetchRealtime_(propertyPath),
    today:    fetchRangeByHost_(propertyPath, 'today'),
    last7d:   fetchRangeByHost_(propertyPath, '7daysAgo'),
    last30d:  fetchRangeByHost_(propertyPath, '30daysAgo'),
    cachedAt: new Date().toISOString()
  };
}

/**
 * Realtime: total users active across the network in the last 30 min.
 *
 * No hostName breakdown — the realtime API doesn't offer that
 * dimension. We sum a tiny country-keyed report to get the total
 * without paying for an explicit totals row.
 */
function fetchRealtime_(propertyPath) {
  var resp = AnalyticsData.Properties.runRealtimeReport({
    metrics: [{ name: 'activeUsers' }],
    limit: 1
  }, propertyPath);

  var rows = (resp && resp.rows) || [];
  var total = rows.reduce(function (acc, r) {
    return acc + (parseInt(r.metricValues[0].value, 10) || 0);
  }, 0);

  return { activeUsers: total };
}

/**
 * Range report: users + pageviews per host for a date range.
 *
 * `startDate` accepts GA's relative-date strings ("today", "7daysAgo",
 * "30daysAgo"). End date is always "today" so the window runs right up
 * to now — visitors expect "this week" to include today.
 *
 * limit: 250 comfortably covers the whole network of subdomains.
 * metricAggregations ['TOTAL'] gives the authoritative property-wide
 * total (which can differ from a sum-over-host when GA folds rows out
 * of a limited window).
 */
function fetchRangeByHost_(propertyPath, startDate) {
  var resp = AnalyticsData.Properties.runReport({
    dateRanges: [{ startDate: startDate, endDate: 'today' }],
    dimensions: [{ name: 'hostName' }],
    metrics:    [{ name: 'activeUsers' }, { name: 'screenPageViews' }],
    orderBys:   [{ metric: { metricName: 'activeUsers' }, desc: true }],
    metricAggregations: ['TOTAL'],
    limit: 250
  }, propertyPath);

  var rows = (resp && resp.rows) || [];
  var byHost = {};
  var order  = [];
  rows.forEach(function (r) {
    var host = normalizeHost_((r.dimensionValues[0] && r.dimensionValues[0].value) || '');
    if (!host) return;
    var entry = {
      users:     parseInt(r.metricValues[0].value, 10) || 0,
      pageviews: parseInt(r.metricValues[1].value, 10) || 0
    };
    // hostName can yield duplicates (e.g. apex + www) that we collapse
    // onto one key in normalizeHost_; merge rather than overwrite.
    if (byHost[host]) {
      byHost[host].users     += entry.users;
      byHost[host].pageviews += entry.pageviews;
    } else {
      byHost[host] = entry;
      order.push(host);
    }
  });

  var totals = (resp && resp.totals && resp.totals[0]);
  var total;
  if (totals && totals.metricValues) {
    total = {
      users:     parseInt(totals.metricValues[0].value, 10) || 0,
      pageviews: parseInt(totals.metricValues[1].value, 10) || 0
    };
  } else {
    total = order.reduce(function (acc, h) {
      acc.users     += byHost[h].users;
      acc.pageviews += byHost[h].pageviews;
      return acc;
    }, { users: 0, pageviews: 0 });
  }

  return { total: total, byHost: byHost, order: order };
}

/**
 * getProperty_(name) — small wrapper around PropertiesService so the
 * report code doesn't have to know the storage mechanism. Returns null
 * when missing so callers can produce a friendly error.
 */
function getProperty_(name) {
  var v = PropertiesService.getScriptProperties().getProperty(name);
  return (v && String(v).trim()) || null;
}
