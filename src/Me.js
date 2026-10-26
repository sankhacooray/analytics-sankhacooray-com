/**
 * Me.js — registry of the owner's browsers that are excluded from GA.
 *
 * A browser marked "not counted" (cdn.sankhacooray.com/me, cookie
 * sankha_me=1) sends nothing to GA, so GA can't list it. Instead the switch
 * page, and sankha-analytics.js once a day, ping this route so the private
 * console can show which browsers are excluded and when each was last seen.
 *
 * Routes (GET, ?source=me):
 *   &id=<16 hex>&state=on|off|seen&label=…&name=…&host=…
 *       public upsert. Only short, sanitised fields are stored; a browser
 *       that opted out is the owner, so nothing here identifies a visitor.
 *   &action=list&token=…     → { devices: [...] }   (console only)
 *   &action=forget&id=…&token=…                     (console only)
 * The token is ME_LIST_TOKEN, else CLAUDE_INGEST_TOKEN; list/forget fail closed
 * when it is unset.
 *
 * Storage: one Script Property per device, key "me:<id>", capped at
 * ME_MAX_DEVICES; when full, the least recently seen device is evicted.
 */
var ME_PREFIX = 'me:';
var ME_MAX_DEVICES = 60;

function handleMeGet_(params) {
  var props = PropertiesService.getScriptProperties();
  if (params.action === 'list' || params.action === 'forget') {
    // Falls back to the existing Claude ingest secret: background writes
    // (claude:sessions, me:*) make the editor's Script Properties page drop
    // newly added keys, so a second secret is hard to add here.
    var expected = props.getProperty('ME_LIST_TOKEN') || props.getProperty('CLAUDE_INGEST_TOKEN');
    if (!expected || params.token !== expected) return { ok: false, error: 'unauthorized' };
    if (params.action === 'forget') {
      if (!/^[a-f0-9]{16}$/.test(params.id || '')) return { ok: false, error: 'bad-id' };
      props.deleteProperty(ME_PREFIX + params.id);
      return { ok: true };
    }
    return { ok: true, devices: readDevices_(props) };
  }
  return pingMe_(props, params);
}

function pingMe_(props, params) {
  var id = String(params.id || '');
  var state = String(params.state || '');
  if (!/^[a-f0-9]{16}$/.test(id) || ['on', 'off', 'seen'].indexOf(state) === -1) {
    return { ok: false, error: 'bad-request' };
  }
  var host = clean_(params.host, 80);
  if (host && !/(^|\.)sankhacooray\.com$/.test(host)) host = '';

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { ok: false, error: 'busy' };
  try {
    var key = ME_PREFIX + id;
    var now = new Date().toISOString();
    var raw = props.getProperty(key);
    var d = raw ? JSON.parse(raw) : null;
    if (!d) {
      var all = readDevices_(props);
      if (all.length >= ME_MAX_DEVICES) {
        all.sort(function (a, b) { return a.last < b.last ? -1 : 1; });
        props.deleteProperty(ME_PREFIX + all[0].id);
      }
      d = { id: id, first: now };
    }
    d.last = now;
    d.state = state === 'seen' ? (d.state || 'on') : state;
    if (state === 'on' && !d.markedAt) d.markedAt = now;
    d.label = clean_(params.label, 60) || d.label || '';
    d.name = clean_(params.name, 40) || d.name || '';
    if (host) d.host = host;
    props.setProperty(key, JSON.stringify(d));
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function readDevices_(props) {
  var all = props.getProperties();
  return Object.keys(all).filter(function (k) { return k.indexOf(ME_PREFIX) === 0; })
    .map(function (k) { try { return JSON.parse(all[k]); } catch (e) { return null; } })
    .filter(Boolean)
    .sort(function (a, b) { return a.last < b.last ? 1 : -1; });
}

function clean_(v, max) {
  return String(v || '').replace(/[^\w .,:·()\/+-]/g, '').trim().slice(0, max);
}
