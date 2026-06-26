# LeaveBot — Slack Leave Management (first variation)

A Slack app for applying for leave, checking balance, and viewing the holiday calendar,
with a two-layer (L1 → L2) approval flow derived from the org chart.

Runs on **Socket Mode** — no public URL, no ngrok. In-memory data (resets on restart).

---

## What it does

- `/leave` opens a modal menu: **Apply for Leave**, **My Balance**, **Holiday Calendar**.
- **Apply** form: leave type (Sick / Casual), start date, optional end date, reason.
- **Rules enforced at submit** (validation errors shown inline, you fix and resubmit):
  - Sick → today only (no backdating, no future).
  - Casual single-day → at least 1 day notice.
  - Casual multi-day → at least 5 days notice.
  - Can't exceed your balance; weekends & holidays aren't deducted.
- **Approval routing** (from the chart):
  - Team member → L1 lead, then L2 (AD). e.g. Neel → Thisya → AD.
  - L1 lead → single L2 (AD).
  - Asif / Manoj → Abhi only (single approval).
  - AD / Abhi → auto-approved + logged.
- Approvers act via **Approve / Reject** buttons in a DM; reject asks for a reason.
- Applicant is notified at every step; balance deducts on **final** approval.
- Dummy balances (Sick 8, Casual 12) and a sample holiday list.

---

## Setup (~10 min)

### 1. Create the Slack app from the manifest
- Go to https://api.slack.com/apps → **Create New App** → **From a manifest** → pick your workspace.
- Paste the contents of `slack-app-manifest.yaml`. Create.

### 2. Get the App-Level token (for Socket Mode)
- **Basic Information** → **App-Level Tokens** → **Generate Token and Scopes**.
- Add scope `connections:write`. Generate. Copy the `xapp-...` token → `SLACK_APP_TOKEN`.

### 3. Install to workspace & get the Bot token
- **OAuth & Permissions** → **Install to Workspace** → Allow.
- Copy **Bot User OAuth Token** (`xoxb-...`) → `SLACK_BOT_TOKEN`.

### 4. Configure env
```bash
cp .env.example .env
# edit .env: paste both tokens, set DEMO_USER_ID to your own Slack member ID
# (Slack profile → ... → Copy member ID)
```

### 5. Run
```bash
npm install
npm start          # "⚡ LeaveBot running (Socket Mode)."
npm test           # optional: runs the rule/logic self-test (no Slack needed)
```

### 6. Try it
In any Slack channel or your own DM with the bot, type `/leave`.

---

## Testing the full flow solo (demo mode)

With `DEMO_MODE=true`, every DM (applicant confirmations **and** approver requests) is sent
to your own `DEMO_USER_ID`, and you "act as" whoever `DEMO_PERSONA` is set to. So you can
play out the entire chain from your own DMs.

| `DEMO_PERSONA` | Flow you'll see |
|----------------|-----------------|
| `Neel`  | Apply → approve as Thisya (L1) → approve as AD (L2) → approved |
| `Siya`  | Apply → single AD (L2) approval |
| `Asif`  | Apply → single Abhi approval |
| `AD`    | Apply → auto-approved + logged instantly |

Change `DEMO_PERSONA` in `.env` and restart to test each path.

---

## Going to real (multi-person) mode

1. Set `DEMO_MODE=false`.
2. Fill in real Slack member IDs in `slackIds.js` (or via `SLACK_ID_<NAME>` env vars).
3. Now the person who runs `/leave` is identified by their Slack ID, and approver DMs
   go to the real approvers.

---

## Intentionally NOT in v1 (easy next steps)

- **Persistence** — everything is in-memory; restart wipes balances/requests. Swap `store.js`
  for SQLite/Postgres/Google Sheets when you want durability.
- **Half-days**, leave cancellation/withdrawal, approver delegation, escalation timeouts.
- **App Home dashboard** for leads (pending queue, team-on-leave view) — currently approvals
  live in DMs only.
- **Real holiday source** — `HOLIDAYS` in `store.js` is sample data.
- Concurrency/locking — fine for a demo, not for high volume.

## File map

| File | Purpose |
|------|---------|
| `app.js` | Bolt wiring: command, buttons, submits, approval routing |
| `directory.js` | Org hierarchy + approval chains |
| `slackIds.js` | Name → Slack member ID (real mode only) |
| `leaveRules.js` | Pure validation + date math (unit-tested) |
| `store.js` | In-memory balances, requests, holidays |
| `views.js` | Block Kit modal & message builders |
| `selftest.js` | Logic tests (`npm test`) |
| `slack-app-manifest.yaml` | One-paste app creation |
