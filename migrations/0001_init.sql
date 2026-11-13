-- Cloudflare D1 schema for BrewDesk POS
-- Apply locally:  npx wrangler d1 migrations apply brewdesk-pos-db --local
-- Apply remotely: npx wrangler d1 migrations apply brewdesk-pos-db --remote

CREATE TABLE IF NOT EXISTS pos_snapshot (
  id TEXT PRIMARY KEY,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS menu_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price REAL NOT NULL,
  price_unset INTEGER NOT NULL DEFAULT 0,
  tax_percent REAL NOT NULL DEFAULT 5,
  sold_out INTEGER NOT NULL DEFAULT 0,
  addons_json TEXT NOT NULL,
  recipe_json TEXT NOT NULL,
  default_notes TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cafe_tables (
  id TEXT PRIMARY KEY,
  number INTEGER NOT NULL,
  label TEXT NOT NULL,
  active_order_id TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_type TEXT NOT NULL,
  table_id TEXT,
  table_label TEXT NOT NULL,
  token_number INTEGER,
  status TEXT NOT NULL,
  items_json TEXT NOT NULL,
  discount_type TEXT NOT NULL,
  discount_value REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  void_reason TEXT
);

CREATE TABLE IF NOT EXISTS kots (
  id TEXT PRIMARY KEY,
  kot_number INTEGER NOT NULL,
  order_id TEXT NOT NULL,
  order_type TEXT NOT NULL,
  table_label TEXT NOT NULL,
  token_number INTEGER,
  status TEXT NOT NULL,
  items_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bills (
  id TEXT PRIMARY KEY,
  bill_number TEXT NOT NULL UNIQUE,
  bill_seq INTEGER NOT NULL,
  order_id TEXT NOT NULL,
  order_type TEXT NOT NULL,
  table_label TEXT NOT NULL,
  token_number INTEGER,
  items_json TEXT NOT NULL,
  subtotal REAL NOT NULL,
  discount_amount REAL NOT NULL,
  taxable_amount REAL NOT NULL,
  cgst_amount REAL NOT NULL,
  sgst_amount REAL NOT NULL,
  total_gst REAL NOT NULL,
  grand_total REAL NOT NULL,
  payments_json TEXT NOT NULL,
  status TEXT NOT NULL,
  void_reason TEXT,
  voided_at TEXT,
  voided_by_name TEXT,
  split_label TEXT,
  created_at TEXT NOT NULL,
  closed_by TEXT NOT NULL,
  closed_by_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  amount REAL NOT NULL,
  payment_mode TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  stock REAL NOT NULL,
  min_stock REAL NOT NULL,
  cost_per_unit REAL NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_purchases (
  id TEXT PRIMARY KEY,
  ingredient_id TEXT NOT NULL,
  ingredient_name TEXT NOT NULL,
  unit TEXT NOT NULL,
  quantity REAL NOT NULL,
  total_cost REAL NOT NULL,
  supplier TEXT NOT NULL,
  date TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS day_sessions (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  status TEXT NOT NULL,
  opening_cash REAL NOT NULL,
  expected_cash REAL NOT NULL,
  counted_cash REAL,
  cash_difference REAL,
  opened_by_name TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  closed_by_name TEXT,
  closed_at TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  user_name TEXT NOT NULL,
  role TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS backups (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  date_key TEXT NOT NULL,
  type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  counts_json TEXT NOT NULL
);
