#!/usr/bin/env node
/**
 * deploy.js — stable-URL release for the sankhacooray.com analytics proxy.
 *
 * Pins one deploymentId and redeploys to it every run, so the web-app
 * /exec URL never changes. The whole network hard-codes this URL:
 *   - sankhacooray-com/js/sankha-analytics.js  (GA visitor badge)
 *   - dev-sankhacooray-com/index.html           (Claude activity badge, ?source=claude)
 * Deploying without the fixed id would mint a new URL and silently break
 * every site's badge.
 *
 * Auth: owned by bsc2fast@gmail.com. clasp here uses the WORKSPACE-SCOPED
 * credential at ../.clasprc.json — NOT the global ~/.clasprc.json (that's
 * sankha@ahlab.org) — so a release can never run as the wrong account.
 */
const { execSync } = require("child_process");
const path = require("path");

// Workspace-scoped bsc2fast credentials — never the global default.
process.env.clasp_config_auth = path.resolve(__dirname, "..", ".clasprc.json");

// Fixed deployment the network points at — do not change.
const DEPLOYMENT_ID =
  "AKfycbwvNZxtG3yOd2YUCDjRxUt9x9BcDP2St-ywC8WcecI_TcqirM3crgTW0qaR_712JTdhdw";

const version = require("./package.json").version;

function run(cmd) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: __dirname });
}

try {
  // --force: required whenever appsscript.json (the manifest) changed.
  run("npx clasp push --force");
  run(`npx clasp create-deployment --deploymentId ${DEPLOYMENT_ID} --description "prod v${version}"`);
  console.log(
    `\n✓ Redeployed to the stable URL:\n  https://script.google.com/macros/s/${DEPLOYMENT_ID}/exec`
  );
} catch (err) {
  console.error("\nDeploy failed:", err.message);
  process.exit(1);
}
