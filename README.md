# AutoGaragify

AutoGaragify is an original shop-management website for independent automotive repair businesses. It models common industry workflows without using Tekmetric code, branding, copy, layouts, private APIs, or proprietary assets.

**Production:** [https://autogaragify.com](https://autogaragify.com) (Vercel)  
**Local:** `http://localhost:3000`

## Go Live Checklist (AI calling)

Complete **in order** before flipping the dialer:

- [ ] Env vars set (see `.env.example` / `npx tsx scripts/check-env.ts`)
- [ ] Assistant registered (`npx tsx scripts/register-assistant.ts` → `TELNYX_ASSISTANT_ID`)
- [ ] Webhook configured in Telnyx portal → `POST /api/telnyx/webhook` (public key verify on)
- [ ] Inbound test passed (call `/demo-call` number; AI answers)
- [ ] Outbound dry-run passed (`DIALER_DRY_RUN=true`, tick or campaign start; `contact_logs.outcome=dry_run`)
- [ ] Outbound live test passed (`DIALER_DRY_RUN=false`, single Call now)
- [ ] DNC + transfer flows verified
- [ ] Legal review completed
- [ ] **`DIALER_ENABLED=true` only after all above**

## Production (Vercel)

The live app deploys from this repo to Vercel and serves **autogaragify.com**.

Set these in **Vercel → Project → Settings → Environment Variables** (Production):

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | Hosted Postgres (sslmode=require) |
| `APP_URL` | Yes | `https://autogaragify.com` |
| `GARAGEOS_SECRET_KEY` | Strongly recommended | Encrypts shop-pasted Resend/Twilio/Zapier secrets at rest |
| `RESEND_API_KEY` + `EMAIL_FROM` | For auth email | Signup verify + 2FA codes (platform email) |
| `CLOUDINARY_URL` | Optional | Inspection photo/video uploads |
| `STRIPE_SECRET_KEY` | Optional | Card Checkout / Terminal |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Optional | Stripe.js |
| Twilio / accounting / MOTOR | Optional | Or paste per-shop in **Ops** (stored in Postgres) |

Shop owners can also connect **Resend, Twilio, and Zapier** in **Ops** without redeploying. Those shop credentials are stored in Postgres and used for customer messaging and accounting sync. Auth emails still use the Vercel `RESEND_*` env vars.

After changing Vercel env vars, redeploy. After changing Ops-pasted credentials, no redeploy is needed.

Public booking URLs look like:

`https://autogaragify.com/book/{shopId}`

## Local development (Windows)

Requirements: Node.js 20+, npm 10+, and PostgreSQL 15+ (local or hosted).

```powershell
cd AutoGaragify
copy .env.example .env.local
npm.cmd install
npm.cmd run dev -- -p 3000
```

Open **http://localhost:3000**. AutoGaragify creates its PostgreSQL tables automatically, then presents a one-time secure shop-owner setup.

## Functional areas

- Responsive dashboard, global search and job-board navigation
- Customers, vehicles, fleets, credits, tags and history
- Appointments and public online booking with availability rules
- Repair orders, estimates, customer approval links
- Digital inspections (Cloudinary media when configured)
- Inventory, tires, vendors, purchase orders and receiving
- Invoices, A/R, payments, Stripe Checkout/Terminal (when keyed)
- Marketing campaigns, service reminders, review requests
- Accounting journal CSV + Zapier/webhook sync
- Automations with delays, approvals and job queue
- Multi-location scoping, roles, 2FA, audit log, PWA shell
- JSON backup/export and validated merge restore
- **Telnyx AI inbound/outbound voice**, campaigns, transcripts, compliance

## Architecture

Next.js App Router, React, TypeScript, PostgreSQL, Drizzle ORM, Zod, route handlers and a custom responsive UI. Domain records are typed JSON documents in an indexed PostgreSQL `records` table. Writes create audit entries.

- `GET /api/bootstrap` — workspace load (+ due automation release)
- `POST/DELETE /api/records` — validated mutations
- `GET /api/export` — portable JSON backup
- `POST /api/integrations/credentials` — save/test shop provider credentials

## Security and external services

Password authentication, HTTP-only sessions, shop-scoped data and role checks are enforced server-side. Production already runs behind HTTPS on Vercel with secure cookies when `NODE_ENV=production`.

Messaging, card processing, financing, licensed labor data, parts ordering and accounting need vendor accounts and compliance:

- Use PCI-hosted payment flows; never store raw card data.
- Collect messaging consent and honor opt-outs.
- License vehicle/labor/OEM data rather than scraping.
- Store production attachments in access-controlled object storage.

Without credentials, adapters stay in sandbox/local mode and do not contact external systems.

## AI Calling Setup

### Architecture overview

```
Inbound DID ──► Telnyx Call Control ──► POST /api/telnyx/webhook
                                            ├─ verify TELNYX_PUBLIC_KEY
                                            ├─ answer + AI assistant (or TTS fallback)
                                            └─ transcript / tools / hangup → contact_logs

Outbound campaign ──► /api/dialer/tick (CRON_SECRET)
                         ├─ DIALER_ENABLED / dry-run / guards
                         ├─ placeOutboundCall (Telnyx AI)
                         └─ contact_logs + sales_leads updates

Tools mid-call ──► POST /api/telnyx/tools ──► mark_interested / DNC / transfer / book_demo
```

Health: `GET /api/telnyx/health` → `{ telnyxConfigured, assistantConfigured, dialerEnabled, dryRun }`.

### Environment variables

Typed in `lib/config.ts` (defaults applied; missing required vars warn once, never throw). Catalog also in `.env.example`.

| Variable | Default | Notes |
|---|---|---|
| `TELNYX_API_KEY` | — | Mission Control API key |
| `TELNYX_CONNECTION_ID` | — | Call Control / AI connection |
| `TELNYX_FROM_NUMBER` | — | E.164 DID (demo + outbound CLI) |
| `TELNYX_PUBLIC_KEY` | — | Webhook Ed25519 verify (**required** for webhook) |
| `TELNYX_ASSISTANT_ID` | — | From register-assistant script |
| `SALES_TRANSFER_NUMBER` | — | Human warm transfer |
| `DIALER_ENABLED` | `false` | Master outbound switch |
| `DIALER_MAX_CONCURRENT` | `5` | Max simultaneous outbound AI calls |
| `DIALER_DAILY_CAP` | `20` | Max outbound dials / shop / day |
| `DIALER_DRY_RUN` | `false` | Log would-dial; write `outcome=dry_run` |
| `US_STATE_BLOCKLIST` | empty | Comma-separated US codes |
| `CRON_SECRET` | — | Bearer for `/api/dialer/tick` |
| `LEADS_IMPORT_SHOP_ID` | — | Default shop for cron / DID map |
| `SLACK_WEBHOOK_URL` | — | Optional handoff alerts |
| `AI_PROMPT_VERSION` | `v1` | `prompts/agent.<version>.md` |

```powershell
npx tsx scripts/check-env.ts
```

Also set `APP_URL` to the public origin so tool + webhook URLs resolve.

### Register the AI assistant (one time)

```powershell
npx tsx scripts/register-assistant.ts
```

Paste `TELNYX_ASSISTANT_ID` into env and redeploy.

### Webhook config (Telnyx portal)

1. Number → Call Control application / connection.
2. Webhook URL: `https://YOUR_DOMAIN/api/telnyx/webhook`
3. Ensure account public key matches `TELNYX_PUBLIC_KEY` (unsigned/invalid → **401**).
4. If `TELNYX_ASSISTANT_ID` is missing, inbound answers with TTS *“AutoGaragify is not available right now”* and hangs up.

### Dry-run testing

1. Keep `DIALER_ENABLED=true` only in a safe lab, or test guards with dry-run.
2. Set `DIALER_DRY_RUN=true`.
3. Start a campaign / hit `/api/dialer/tick` with `Authorization: Bearer $CRON_SECRET`.
4. Confirm logs show `would_dial` and `contact_logs.outcome=dry_run` — **no Telnyx call**.

### Prompt versioning

- Files: `prompts/agent.v1.md`, `prompts/agent.v2.md`, …
- Active version: `AI_PROMPT_VERSION` (default `v1`); missing file falls back to v1.
- UI: `/admin/prompts` (Owner/Manager) — list, paste new version, activate (writes file + runtime override).

### Inbound-first launch

1. Public page: `/demo-call` (linked in header + footer) shows `TELNYX_FROM_NUMBER`.
2. `/campaigns` includes an **Inbound** pseudo-campaign (aggregates `direction=inbound` logs).
3. Unmatched shop inbound still answers and logs with `shop_id=null`.

### Campaigns & transcripts

1. Import B2B leads on `/leads/import`.
2. Assign campaign → **Start campaign** (needs dialer on + ≥1 `new` lead; reason shown inline).
3. Pause / Resume / Done via `/campaigns` or `POST /api/campaigns/[id]/{start|pause|resume|done}`.
4. Transcripts: `/leads/[id]/transcript` (chat log + recording link).
5. Compliance desk: `/compliance` (violations, DNC add/remove, state blocklist).

### Compliance checklist

- [ ] B2B-only targets
- [ ] First outbound assistant utterance contains **AI** or **automated** (else hangup + `compliance_violations.missing_ai_disclosure`)
- [ ] DNC forever (`do_not_call` + `dnc_phones`)
- [ ] `US_STATE_BLOCKLIST` configured where needed
- [ ] Transcripts + recording URLs retained
- [ ] Legal review before `DIALER_ENABLED=true`
