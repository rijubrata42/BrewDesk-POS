# BrewDesk POS — Cloud Cafe Billing & Table Management

BrewDesk POS is an installable Progressive Web App (PWA) built with React, TypeScript, Express, WebSockets (`ws`), and MongoDB persistence (with a durable atomic server store fallback when no MongoDB URI is configured). Every order item, quantity adjustment, KOT, bill settlement, expense, and setting is written immediately to the server and broadcast in real time over WebSockets to all connected devices.

## Features

- **Real-Time Multi-Device Sync**: WebSocket (`/ws`) broadcasts every change across counter laptops, kitchen tablets, and waiter phones instantly.
- **Offline Resilience**: When the internet drops, an amber offline banner appears, the screen remains usable, and mutations are queued locally in order and replayed automatically to the server once connectivity returns.
- **Role-Based Access Control (JWT + bcrypt)**:
  - **Owner**: Full access (profit reports, menu & recipe editing, bill/item voiding, staff management, backups, settings).
  - **Cashier**: Take orders, apply discounts, settle/split bills, log expenses, record stock purchases, open/close day register.
  - **Waiter**: Take dine-in/takeaway orders, send KOTs, shift/swap tables. Cannot close bills, apply discounts, or view profit.
- **Menu & Order Taking**: Preloaded Burgers, Sandwiches, Sides, and Beverages (including `Chocolate Shake` ready for price setup), add-ons (`Extra cheese +20`, `No onion`, etc.), kitchen notes, 2-tap item add, and 3-tap bill settlement.
- **Tables & KDS**: Live Free/Occupied table grid with elapsed timers, Takeaway tokens, Shift/Merge table, Swap tables, Equal & Item-level Split Bill, KOT printing, and a 3-column Kitchen Display (`New`, `Preparing`, `Ready`).
- **Billing & GST**: Sequential `INV-XXXX` invoice numbers, CGST/SGST split, GSTIN, dynamic UPI QR codes, 58mm & 80mm thermal receipt printing, WhatsApp receipt sharing, immutable closed bills, and Day-Open / Day-Close cash drawer reconciliation.
- **Expenses, Inventory & Reports**: Monthly expense tracking, low-stock ingredient alerts, purchase logging, automatic recipe stock deduction on billing, date-range reports (charts, item/category/payment/staff/tax/void reports), CSV & PDF export.

## Default Staff Credentials (Change in Settings)

- **Owner**: `owner` / `owner123` (Owner Void PIN: `1234`)
- **Cashier**: `cashier` / `cashier123`
- **Waiter**: `waiter` / `waiter123`

## Setup & Environment Variables

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env` and configure:
   - `MONGODB_URI`: Your MongoDB Atlas connection string (e.g. `mongodb+srv://user:pass@cluster.mongodb.net/?retryWrites=true&w=majority`).
   - `MONGODB_DB_NAME`: Database name (defaults to `brewdesk_pos`).
   - `JWT_SECRET`: Strong random secret for signing 7-day JWT sessions.
   - `APP_URL`: Public deployment URL.
3. Run in development:
   ```bash
   npm run dev
   ```
4. Build and run in production:
   ```bash
   npm run build
   npm start
   ```

## How Data Is Stored & Backed Up

- **Primary Persistence**: When `MONGODB_URI` is set, every mutation writes atomically to MongoDB (`pos_snapshot` plus mirrored collections `menu`, `tables`, `orders`, `kots`, `bills`, `expenses`, `inventory`, `audit_logs`, and `backups`). If `MONGODB_URI` is omitted, the server writes atomically via temp-file swap to `data/pos-db.json`.
- **Automatic Daily Backups**: The server checks on startup and hourly thereafter; once per day it saves a full JSON snapshot to `data/backups/backup-YYYY-MM-DD-...json` (and into the MongoDB `backups` collection when connected).
- **Manual Backups & Exports**: Owners can go to **Settings → Backups & Export** to create an instant snapshot, download the full database as JSON, or export Sales, Expenses, and Inventory as CSV.

## Restoring From a Backup

1. Sign in as **Owner**.
2. Open **Settings → Backups & Export**.
3. Click **Restore JSON** and select a previously downloaded `.json` backup file.
4. The server validates the backup schema, replaces the live database state atomically, logs `BACKUP_RESTORED` in the Audit Log, and broadcasts the restored state to all connected devices immediately.
