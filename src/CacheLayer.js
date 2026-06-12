/**
 * CacheLayer.js — wraps Apps Script's CacheService so Code.js can call
 * getStatsCached_() without thinking about TTLs, JSON encoding, or
 * cache size limits.
 *
 * Why caching matters: the endpoint is public and anonymous, and the
 * GA Data API has a real per-property quota (~25k tokens/day on the
 * standard tier). Without caching, a popular page or a single bot could
 * drain quota and brick the badge for everyone. One cached blob serves
 * every host — slicing a host out of it in Code.js costs zero quota —
 * so the whole network refreshes GA just once per TTL window.
 *
 * Cache scope: ScriptCache (shared across all callers). Key is constant
 * — there is exactly one network-wide blob. Values are JSON-stringified
 * and stay well under CacheService's 100 KB per-value cap.
 */

var CACHE_KEY = 'sankha-stats:v1';
var DEFAULT_TTL_SECONDS = 300;   // 5 minutes
var MIN_TTL_SECONDS     = 60;    // floor — protects quota even if the
                                 // script property is mis-set

/**
 * getStatsCached_(forceRefresh) — main entry called from doGet.
 *
 * On cache hit: returns the cached blob untouched (keeps its original
 * `cachedAt`). On miss: calls getStats_() in Reports.js, stores the
 * result, returns it. `forceRefresh=true` skips the read but still
 * writes — intended for manual debugging via ?refresh=1.
 */
function getStatsCached_(forceRefresh) {
  var cache = CacheService.getScriptCache();
  if (!forceRefresh) {
    var hit = cache.get(CACHE_KEY);
    if (hit) {
      try { return JSON.parse(hit); }
      catch (e) { /* fall through to refresh */ }
    }
  }

  var fresh = getStats_();
  cache.put(CACHE_KEY, JSON.stringify(fresh), resolveTtl_());
  return fresh;
}

function resolveTtl_() {
  var raw = PropertiesService.getScriptProperties().getProperty('CACHE_TTL_SECONDS');
  var n = parseInt(raw, 10);
  if (!isFinite(n) || n <= 0) return DEFAULT_TTL_SECONDS;
  return Math.max(n, MIN_TTL_SECONDS);
}
