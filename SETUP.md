# Setup — what to configure on your side

You'll create a GA4 property in **your personal Google account**, copy this
Apps Script project there, deploy it, and paste two values into the shared
client script. Everything credential-related stays in your Google account;
the sites only ever see aggregate numbers.

There are exactly **two values** the sites need from you at the end:
a **Measurement ID** (`G-XXXXXXXXXX`) and a **proxy `/exec` URL**.

---

## 1. Create the GA4 property (one property for the whole network)

1. Go to <https://analytics.google.com> → **Admin** → **Create** → **Property**.
   Name it e.g. *Sankha Cooray Network*. Time zone: Asia/Colombo.
2. Under the property → **Data Streams** → **Add stream** → **Web**.
   - Website URL: `https://sankhacooray.com`
   - Stream name: *sankhacooray network*
   - **Do NOT** create a separate stream per subdomain — one stream serves
     the whole network; subdomains are separated later by `hostName`.
3. Copy the two IDs you'll need:
   - **Measurement ID** — looks like `G-XXXXXXXXXX` (Data Streams → your stream).
     → this goes into the client script (`MEASUREMENT_ID`).
   - **Property ID** — the **numeric** ID (Admin → Property Settings →
     Property Id, e.g. `452109876`).
     → this goes into a Script Property (`GA_PROPERTY_ID`). It is **not**
     the `G-XXXX` measurement ID.

> Subdomain tracking works out of the box: gtag sends the real hostname with
> every event, so `fold.sankhacooray.com`, `v3.sankhacooray.com`, etc. show up
> as distinct `hostName` values in the same property. No cross-domain config
> is required for per-site breakdowns. (If you later want *stitched* user
> journeys across subdomains, add them under Admin → Data Streams →
> Configure tag settings → Configure your domains — optional.)

---

## 2. Copy this project into your personal Google account

From this folder (`analytics-sankhacooray-com`):

```bash
npm install
npx clasp login            # log in as your PERSONAL Google account
npx clasp create --type standalone \
                 --title "Sankha Analytics Proxy" \
                 --rootDir ./src
```

`clasp create` writes a `.clasp.json` with the new script ID (it's gitignored;
`.clasp.json.example` is the committed template). Then push the code:

```bash
npm run push
```

---

## 3. Configure the script & enable the API

```bash
npm run open               # opens the Apps Script editor in the browser
```

In the editor:

1. **⚙️ Project Settings → Script Properties → Add script property:**
   | Name              | Value                          |
   |-------------------|--------------------------------|
   | `GA_PROPERTY_ID`  | your **numeric** property ID (e.g. `452109876`) |
   | `CACHE_TTL_SECONDS` | *(optional)* `300` — default is fine |
2. **Enable the Analytics Data API:** run `testFetchStats` once (function
   dropdown → Run). On first run, accept the OAuth consent
   (`analytics.readonly`). If you see *"API has not been used…"*, click the
   link in the error to enable **Analytics Data API** on the linked GCP
   project, then run again.
3. A successful run logs the full network blob (View → Logs / Cmd+Enter).

> The script runs **as you** (the deploying user). Because it's your own
> property, you already have access — no extra grant needed. (If you ever
> deploy it under a *different* account, add that account as **Viewer** in
> GA4 Admin → Property Access Management.)

---

## 4. Deploy as a public web app

```bash
npm run deploy
```

When prompted (first deploy only), choose:
- **Execute as:** Me
- **Who has access:** Anyone

Copy the resulting **`/exec` URL** — that's your **proxy URL**.

```bash
npm run url                # re-print deployment URLs any time
```

> **Keep the URL stable across updates.** `clasp` mints a *new* `/exec` URL
> each time you `create-deployment`. To redeploy into the *same* URL:
> ```bash
> clasp list-deployments          # note the deployment ID
> clasp push
> clasp deploy --deploymentId <DEPLOYMENT_ID>
> ```

---

## 5. Wire the two values into the sites

Edit **`sankhacooray-com/js/sankha-analytics.js`** (top of the file) and
replace the two placeholders:

```js
var CONFIG = {
  MEASUREMENT_ID: 'G-XXXXXXXXXX',                                   // ← step 1
  PROXY_URL: 'https://script.google.com/macros/s/AKfyc…/exec',      // ← step 4
  SHOW_BADGE: true
};
```

That's the **only** file you edit — every page on every site already loads
it from `https://sankhacooray.com/js/sankha-analytics.js`, so this one change
turns on both tracking and the badge network-wide.

---

## 6. Deploy the sites

The `<script>` tag is already added before `</body>` on all 20 pages across
the repos. Commit and push each site (they deploy via GitHub Pages):

```bash
# the shared script lives in the main repo — push it first so subdomains can load it
cd sankhacooray-com && git add js/sankha-analytics.js index.html profile/index.html … && git commit -m "Add network analytics + fame badge" && git push
# then each subdomain repo:
cd ../fold-sankhacooray-com && git add index.html && git commit -m "Add analytics snippet" && git push
# …repeat for the rest
```

> Push **`sankhacooray-com`** first: the subdomains load the shared script
> from the main domain, so it must be live for them to pick up tracking and
> the badge.

---

## Verifying

- **Tracking:** open any site, then GA4 → **Reports → Realtime** — you should
  appear, with the right `hostName`.
- **Badge:** within a few minutes of real traffic, the corner pill shows
  "*N visitors today · #k of M*". Until the property has data it stays hidden
  (fail-soft) — that's expected on day one.
- **Proxy directly:** visit
  `…/exec?host=fold.sankhacooray.com` in a browser — you should get JSON.
  Add `&refresh=1` to bypass the cache while testing.

## Claude activity — "developing now" badge

Optional add-on, served from this **same** deployment (no second Apps
Script project). A Claude Code hook on your machine pings the proxy on
every session; `dev.sankhacooray.com` shows a live dot + token/session
counts. Pro/Max subscription usage is invisible to the Console Usage API,
so token counts are read locally from the session transcript — no API key
involved. Nothing but the session id, event, and rolled-up token totals
ever leaves your machine (no project names or file paths).

**1. Set the ingest secret** (Project Settings → Script Properties):

```bash
openssl rand -hex 16        # generate a secret
```

| Name                  | Value                         |
|-----------------------|-------------------------------|
| `CLAUDE_INGEST_TOKEN` | the generated secret          |

Ingest fails closed: if this property is unset, all pings are rejected.
No redeploy is needed for the `?source=claude` route — just `npm run push`
if the deployment predates `Claude.js`.

**2. Drop the local config** (machine-only, never committed):

```bash
cp hooks/claude-activity.example.json ~/.claude/claude-activity.json
# edit it: proxyUrl = this deployment's /exec URL, token = the same secret
```

**3. Wire the hook** into `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "python3 /Users/sankha/Projects/sankhacooray/analytics-sankhacooray-com/hooks/claude-activity-ping.py" }] }],
    "Stop":         [{ "hooks": [{ "type": "command", "command": "python3 /Users/sankha/Projects/sankhacooray/analytics-sankhacooray-com/hooks/claude-activity-ping.py" }] }],
    "SessionEnd":   [{ "hooks": [{ "type": "command", "command": "python3 /Users/sankha/Projects/sankhacooray/analytics-sankhacooray-com/hooks/claude-activity-ping.py" }] }]
  }
}
```

**4. Point the dev page at the proxy.** In
`dev-sankhacooray-com/index.html`, set `CLAUDE_PROXY_URL` to this
deployment's `/exec` URL (the page appends `?source=claude`). Empty =
panel stays hidden.

**Verify:** start a Claude Code session, then open
`…/exec?source=claude` — you should get JSON with `activeNow: true`. The
dev page's "building with claude" panel goes live within ~60s (its poll
interval).

## Custom configurations later

Because you own the GA4 property and the proxy, you can extend `Reports.js`
with any GA4 Data API report (new dimensions, events, device/source
breakdowns) and surface them in the badge via `sankha-analytics.js`. The
response shape in `Code.js` (`buildResponse_`) is the contract the client
reads — keep those field names stable and the sites keep working.
