/**
 * Test.js — diagnostic helpers, run manually from the Apps Script editor.
 *
 * Not called by doGet. Exists so the deploying user can validate the
 * full chain (OAuth consent → API enabled → script property set → GA
 * viewer access → cache write) before doing the public web-app deploy.
 *
 * Usage:
 *   1. Open the editor (npm run open).
 *   2. Pick `testFetchStats` from the function dropdown (next to Run).
 *   3. Click Run. First time only, accept the analytics.readonly scope
 *      in the OAuth consent dialog.
 *   4. Open the Execution log (Cmd+Enter). You should see the full
 *      network blob. If misconfigured, the error tells you what to fix:
 *        "GA_PROPERTY_ID script property is not set" → set it.
 *        "PERMISSION_DENIED"                         → add the deploying
 *                                                       user as Viewer on
 *                                                       the GA property.
 *        "API has not been used"                     → click the link in
 *                                                       the error to enable
 *                                                       the Analytics Data
 *                                                       API on the GCP
 *                                                       project.
 */
function testFetchStats() {
  var payload = getStatsCached_(true);
  Logger.log(JSON.stringify(payload, null, 2));
  return payload;
}

/**
 * testHostSlice() — verify the per-host slicing a real request goes
 * through. Edit the host below to one of your subdomains and Run; the
 * log shows exactly what that site's badge would receive.
 */
function testHostSlice() {
  var host = 'fold.sankhacooray.com';   // <- change to test another site
  var blob = getStatsCached_(false);
  var payload = buildResponse_(blob, normalizeHost_(host));
  Logger.log(JSON.stringify(payload, null, 2));
  return payload;
}
