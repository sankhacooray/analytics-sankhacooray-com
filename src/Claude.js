/**
 * Claude.js — "developing right now" activity endpoint for the
 * sankhacooray.com network, served from the same Apps Script web app as
 * the GA4 visitor proxy (Code.js).
 *
 * Why it lives here: this project is already the public, anonymous,
 * credential-free analytics proxy for the network. Claude Code activity
 * is just one more aggregate signal the public sites can read.
 *
 * Two halves:
 *
 *   1. doPost  — INGEST. A Claude Code hook on Sankha's machine POSTs a
 *      small JSON ping on every SessionStart / Stop / SessionEnd. The
 *      Stop ping carries the session's *cumulative* token totals (read
 *      locally from the transcript file — never via any API key). We
 *      upsert one row per session, so the repeated Stop pings overwrite
 *      rather than accumulate. Ingest is gated by a shared secret
 *      (CLAUDE_INGEST_TOKEN script property) so the public endpoint can't
 *      be spoofed into faking a "live" status.
 *
 *   2. doGet?source=claude — SERVE. Collapse the per-session rows into
 *      the small aggregate the badge reads: are we active right now, when
 *      were we last active, and token / session counts for today + 7d.
 *      No secret, no raw session data — only rolled-up numbers leave.
 *
 * Storage: ScriptProperties, one JSON blob keyed CLAUDE_SESSIONS_KEY.
 * Each session row is ~120 bytes; we prune to the last few days and cap
 * the count, so the blob stays far under the 9 KB per-property limit. No
 * Sheet, no external quota — reads and writes are local to the project.
 *
 * Configuration (Project Settings → Script Properties):
 *   CLAUDE_INGEST_TOKEN — required for ingest. Shared secret the hook
 *                         must send. If unset, ALL ingest is rejected
 *                         (fail closed). Generate with `openssl rand -hex 16`.
 */

var CLAUDE_SESSIONS_KEY = 'claude:sessions:v1';
var CLAUDE_ACTIVE_WINDOW_MS = 5 * 60 * 1000;   // "live now" = pinged within 5 min
var CLAUDE_RETAIN_MS        = 8 * 24 * 60 * 60 * 1000;  // drop sessions older than 8d
var CLAUDE_MAX_SESSIONS     = 300;             // hard cap on stored rows

/**
 * doPost(e) — ingest endpoint (this project has no other POST handler).
 * Always returns 200 with an {ok} body; the hook is fire-and-forget and
 * ignores the response, so failures stay silent on the client.
 */
function doPost(e) {
  try {
    var payload = {};
    if (e && e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    }
    return jsonResponse_(ingestClaude_(payload));
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err && err.message || err) });
  }
}

/**
 * ingestClaude_(payload) — validate the shared secret, then upsert the
 * session row. Token totals are monotonic (only ever grow) so an
 * out-of-order or duplicated Stop ping can't shrink a count.
 *
 * Expected payload:
 *   { token, event, sessionId, tokensIn?, tokensOut? }
 */
function ingestClaude_(payload) {
  if (!payload || typeof payload !== 'object') return { ok: false, error: 'bad-payload' };

  var expected = PropertiesService.getScriptProperties().getProperty('CLAUDE_INGEST_TOKEN');
  if (!expected || payload.token !== expected) return { ok: false, error: 'unauthorized' };

  var sid = String(payload.sessionId || '').slice(0, 64);
  if (!sid) return { ok: false, error: 'no-session' };

  var lock = LockService.getScriptLock();
  lock.waitLock(5000);   // serialise concurrent pings so no upsert is lost
  try {
    var props = PropertiesService.getScriptProperties();
    var sessions = readSessions_(props);
    var now = Date.now();

    var s = sessions[sid] || { in: 0, out: 0, first: now, last: now, ended: false };
    s.last = now;
    s.ended = (payload.event === 'SessionEnd');   // drop the live dot immediately on end

    if (typeof payload.tokensIn === 'number' && payload.tokensIn >= s.in) {
      s.in = Math.round(payload.tokensIn);
    }
    if (typeof payload.tokensOut === 'number' && payload.tokensOut >= s.out) {
      s.out = Math.round(payload.tokensOut);
    }

    sessions[sid] = s;
    writeSessions_(props, pruneSessions_(sessions, now));
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/**
 * handleClaudeGet_(params) — roll the per-session rows up into the public
 * aggregate. Called from Code.js's doGet when ?source=claude.
 *
 *   activeNow    — any non-ended session pinged within the live window
 *   lastActiveAt — most recent ping across all sessions (ISO, or null)
 *   tokens/today — sum of in+out for sessions last active today (local TZ)
 *   tokens/week  — same over a rolling 7 days
 *   sessions     — distinct session counts for the same two windows
 */
function handleClaudeGet_(params) {
  var props = PropertiesService.getScriptProperties();
  var sessions = readSessions_(props);
  var now = Date.now();
  var tz = Session.getScriptTimeZone();
  var todayKey = dayKey_(now, tz);
  var weekAgo = now - 7 * 24 * 60 * 60 * 1000;

  var tokToday = 0, tokWeek = 0, sessToday = 0, sessWeek = 0;
  var active = false, lastActive = 0;

  for (var sid in sessions) {
    var s = sessions[sid];
    var tot = (s.in || 0) + (s.out || 0);
    if (s.last > lastActive) lastActive = s.last;
    if (!s.ended && (now - s.last) <= CLAUDE_ACTIVE_WINDOW_MS) active = true;
    if (dayKey_(s.last, tz) === todayKey) { tokToday += tot; sessToday++; }
    if (s.last >= weekAgo) { tokWeek += tot; sessWeek++; }
  }

  return {
    source: 'claude',
    activeNow: active,
    lastActiveAt: lastActive ? new Date(lastActive).toISOString() : null,
    tokens: { today: tokToday, week: tokWeek },
    sessions: { today: sessToday, week: sessWeek },
    cachedAt: new Date(now).toISOString()
  };
}

/* ───────────────────────── storage helpers ───────────────────────── */

function readSessions_(props) {
  var raw = props.getProperty(CLAUDE_SESSIONS_KEY);
  if (!raw) return {};
  try { return JSON.parse(raw) || {}; }
  catch (e) { return {}; }
}

function writeSessions_(props, sessions) {
  props.setProperty(CLAUDE_SESSIONS_KEY, JSON.stringify(sessions));
}

/**
 * pruneSessions_(sessions, now) — keep the blob small and bounded: drop
 * anything older than the retention window, then, if still over the cap,
 * keep only the most-recently-active rows.
 */
function pruneSessions_(sessions, now) {
  var kept = {};
  var ids = [];
  for (var sid in sessions) {
    if (now - sessions[sid].last <= CLAUDE_RETAIN_MS) {
      kept[sid] = sessions[sid];
      ids.push(sid);
    }
  }
  if (ids.length > CLAUDE_MAX_SESSIONS) {
    ids.sort(function (a, b) { return kept[b].last - kept[a].last; });
    var trimmed = {};
    for (var i = 0; i < CLAUDE_MAX_SESSIONS; i++) trimmed[ids[i]] = kept[ids[i]];
    return trimmed;
  }
  return kept;
}

/** dayKey_(ms, tz) — local calendar day, e.g. "2026-06-09". */
function dayKey_(ms, tz) {
  return Utilities.formatDate(new Date(ms), tz, 'yyyy-MM-dd');
}
