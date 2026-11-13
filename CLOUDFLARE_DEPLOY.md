# Deploying BrewDesk POS on Cloudflare (Pages + Workers + D1 + R2 + DNS)

This repository includes a full Cloudflare-native backend (`worker/`) alongside the React PWA frontend (`src/`).

## Architecture Mapping

| Layer | Cloudflare Service | Purpose |
| --- | --- | --- |
| **Frontend** | **Cloudflare Pages** | Hosts the React + Vite PWA (`dist/`) with `public/_headers` security rules |
| **Backend + Real-Time** | **Cloudflare Workers + Durable Objects** | Runs `/api/*` REST endpoints and Hibernatable WebSockets (`/ws`) via `PosRealtimeHub` |
| **Database** | **Cloudflare D1** | Persistent edge SQLite (`migrations/0001_init.sql`) updated atomically on every tap |
| **Backup Storage** | **Cloudflare R2** | Stores automatic daily JSON snapshots (Cron `0 2 * * *`) & manual backups |
| **Domain & Security** | **Cloudflare DNS + SSL/TLS + WAF** | Custom domain routing, Full (strict) HTTPS, HSTS, WebSockets, login rate limiting |

---

## Step 1: Provision Cloudflare D1 & R2

```bash
# Authenticate Wrangler once
npx wrangler login

# 1. Create Cloudflare D1 database
npx wrangler d1 create brewdesk-pos-db
```

Copy the `database_id` printed by Wrangler into `wrangler.toml`:
```toml
[[d1_databases]]
binding = "DB"
database_name = "brewdesk-pos-db"
database_id = "<YOUR_D1_DATABASE_ID>"
```

Apply the SQL schema migration to your remote D1 database:
```bash
npx wrangler d1 migrations apply brewdesk-pos-db --remote
```

Create the Cloudflare R2 bucket for backups:
```bash
npx wrangler r2 bucket create brewdesk-pos-backups
```

---

## Step 2: Set Worker Secret & Deploy Backend

```bash
# Generate and store a strong JWT secret (do NOT put secrets in wrangler.toml)
npx wrangler secret put JWT_SECRET

# Deploy the Cloudflare Worker, Durable Object (PosRealtimeHub), D1/R2 bindings, and Cron Trigger
npm run cf:deploy:worker
```

Note the deployed Worker URL (e.g. `https://brewdesk-pos-worker.<your-subdomain>.workers.dev`).

---

## Step 3: Deploy Frontend on Cloudflare Pages

### Option A — Same Custom Domain (Recommended, Zero CORS)
1. Deploy the `dist/` build to Cloudflare Pages:
   ```bash
   npm run build
   npx wrangler pages deploy dist --project-name brewdesk-pos
   ```
   *(Or connect your Git repository in Cloudflare Dashboard → Workers & Pages → Create → Pages with build command `npm run build` and output directory `dist`.)*
2. Attach your custom domain (e.g. `pos.yourcafe.com`) to the **Pages** project.
3. Under your domain in Cloudflare Dashboard → **Workers Routes**, add two routes pointing to `brewdesk-pos-worker`:
   - `pos.yourcafe.com/api/*` → `brewdesk-pos-worker`
   - `pos.yourcafe.com/ws` → `brewdesk-pos-worker`
4. Leave `VITE_API_BASE_URL` and `VITE_WS_BASE_URL` blank — frontend requests go to `https://pos.yourcafe.com/api/*` and `wss://pos.yourcafe.com/ws` on the exact same origin.

### Option B — Separate Frontend & API Subdomains
If hosting frontend at `pos.yourcafe.com` and Worker at `api.yourcafe.com`:
1. Set Pages build environment variables:
   - `VITE_API_BASE_URL=https://api.yourcafe.com`
   - `VITE_WS_BASE_URL=wss://api.yourcafe.com`
2. Restrict `ALLOWED_ORIGINS` in `wrangler.toml`:
   ```toml
   ALLOWED_ORIGINS = "https://pos.yourcafe.com"
   ```
3. Redeploy both Worker and Pages.

---

## Step 4: Configure Cloudflare DNS & Security

In the Cloudflare Dashboard for your domain:
1. **DNS**:
   - Ensure `pos` (CNAME to `<project>.pages.dev`) and any `api` record have **Proxy status = Proxied (Orange Cloud)** so traffic passes through Cloudflare's edge security.
2. **SSL/TLS**:
   - Set Encryption Mode to **Full (strict)**.
   - Enable **Always Use HTTPS** and **Automatic HTTPS Rewrites**.
   - Enable **HSTS** (`Strict-Transport-Security` is also set in `public/_headers`).
3. **Network**:
   - Ensure **WebSockets** is toggled **ON** (enabled by default on Cloudflare zones; required for `/ws` real-time sync).
4. **Security → WAF / Rate Limiting**:
   - Add a Rate Limiting rule for `URI Path equals /api/auth/login` (e.g., max 10 requests per minute per IP) to protect staff logins from brute-force attempts.
   - Optionally enable **Bot Fight Mode** and **Cloudflare Zero Trust Access** if you want an extra OTP/email gate in front of staff login.

---

## Step 5: First Login & Cafe Setup

1. Open `https://pos.yourcafe.com` and install the PWA on your counter laptop, kitchen tablet, and waiter phones.
2. Sign in with `owner` / `owner123` (Owner Void PIN `1234`), verify **Storage: Cloudflare D1 + R2** in **Settings**, and immediately:
   - Change all default staff passwords (**Settings → Staff Users**) and Owner Void PIN (**Settings → Cafe & Printer**).
   - Enter your **Cafe Name**, **GSTIN**, **UPI ID**, **Table Count**, and **58mm/80mm** printer size.
   - Set the price for **Chocolate Shake** under **Settings → Menu & Recipes**.
