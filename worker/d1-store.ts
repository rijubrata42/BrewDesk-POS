import type { BackupMetadata, PosStateSnapshot, UserPublic } from '../src/shared/types';
import type { PosRealtimeHub } from './hub';
import { createWorkerSeedState, todayDateStr, type FullDbState } from './seed';

export interface WorkerEnv {
  DB: D1Database;
  BACKUPS_BUCKET: R2Bucket;
  POS_HUB: DurableObjectNamespace<PosRealtimeHub>;
  JWT_SECRET?: string;
  ALLOWED_ORIGINS?: string;
}

export function buildPublicSnapshot(state: FullDbState): PosStateSnapshot {
  const publicUsers: UserPublic[] = state.users.map(({ passwordHash: _ph, ...u }) => u);
  return {
    storageMode: 'cloudflare-d1',
    settings: state.settings,
    menu: state.menu,
    tables: state.tables,
    orders: state.orders,
    kots: state.kots,
    bills: state.bills,
    expenses: state.expenses,
    inventory: state.inventory,
    purchases: state.purchases,
    daySessions: state.daySessions,
    auditLogs: state.auditLogs,
    users: publicUsers,
    backups: state.backups,
    lastUpdatedAt: state.lastUpdatedAt,
  };
}

export async function loadOrInitD1State(db: D1Database, envJwtSecret?: string): Promise<FullDbState> {
  const row = await db
    .prepare('SELECT state_json FROM pos_snapshot WHERE id = ?1')
    .bind('main')
    .first<{ state_json: string }>();

  if (row?.state_json) {
    return JSON.parse(row.state_json) as FullDbState;
  }

  const seeded = await createWorkerSeedState(envJwtSecret);
  await persistToD1(db, seeded);
  return seeded;
}

export async function persistToD1(db: D1Database, state: FullDbState): Promise<void> {
  const stmts: D1PreparedStatement[] = [
    db
      .prepare('INSERT OR REPLACE INTO pos_snapshot (id, state_json, updated_at) VALUES (?1, ?2, ?3)')
      .bind('main', JSON.stringify(state), state.lastUpdatedAt),

    db.prepare('DELETE FROM users'),
    db.prepare('DELETE FROM menu_items'),
    db.prepare('DELETE FROM cafe_tables'),
    db.prepare('DELETE FROM orders'),
    db.prepare('DELETE FROM kots'),
    db.prepare('DELETE FROM bills'),
    db.prepare('DELETE FROM expenses'),
    db.prepare('DELETE FROM inventory'),
    db.prepare('DELETE FROM stock_purchases'),
    db.prepare('DELETE FROM day_sessions'),
    db.prepare('DELETE FROM audit_logs'),
    db.prepare('DELETE FROM backups'),
  ];

  for (const u of state.users) {
    stmts.push(
      db
        .prepare(
          'INSERT INTO users (id, username, name, role, active, created_at, password_hash) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)'
        )
        .bind(u.id, u.username, u.name, u.role, u.active ? 1 : 0, u.createdAt, u.passwordHash)
    );
  }

  for (const m of state.menu) {
    stmts.push(
      db
        .prepare(
          'INSERT INTO menu_items (id, name, category, price, price_unset, tax_percent, sold_out, addons_json, recipe_json, default_notes, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)'
        )
        .bind(
          m.id,
          m.name,
          m.category,
          m.price,
          m.priceUnset ? 1 : 0,
          m.taxPercent,
          m.soldOut ? 1 : 0,
          JSON.stringify(m.addons),
          JSON.stringify(m.recipe),
          m.defaultNotes || '',
          m.sortOrder
        )
    );
  }

  for (const t of state.tables) {
    stmts.push(
      db
        .prepare('INSERT INTO cafe_tables (id, number, label, active_order_id) VALUES (?1, ?2, ?3, ?4)')
        .bind(t.id, t.number, t.label, t.activeOrderId)
    );
  }

  for (const o of state.orders.slice(0, 250)) {
    stmts.push(
      db
        .prepare(
          'INSERT INTO orders (id, order_type, table_id, table_label, token_number, status, items_json, discount_type, discount_value, created_at, updated_at, created_by, created_by_name, void_reason) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)'
        )
        .bind(
          o.id,
          o.orderType,
          o.tableId,
          o.tableLabel,
          o.tokenNumber,
          o.status,
          JSON.stringify(o.items),
          o.discountType,
          o.discountValue,
          o.createdAt,
          o.updatedAt,
          o.createdBy,
          o.createdByName,
          o.voidReason || null
        )
    );
  }

  for (const k of state.kots.slice(0, 200)) {
    stmts.push(
      db
        .prepare(
          'INSERT INTO kots (id, kot_number, order_id, order_type, table_label, token_number, status, items_json, created_at, updated_at, created_by_name) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)'
        )
        .bind(
          k.id,
          k.kotNumber,
          k.orderId,
          k.orderType,
          k.tableLabel,
          k.tokenNumber,
          k.status,
          JSON.stringify(k.items),
          k.createdAt,
          k.updatedAt,
          k.createdByName
        )
    );
  }

  for (const b of state.bills.slice(0, 500)) {
    stmts.push(
      db
        .prepare(
          'INSERT INTO bills (id, bill_number, bill_seq, order_id, order_type, table_label, token_number, items_json, subtotal, discount_amount, taxable_amount, cgst_amount, sgst_amount, total_gst, grand_total, payments_json, status, void_reason, voided_at, voided_by_name, split_label, created_at, closed_by, closed_by_name) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24)'
        )
        .bind(
          b.id,
          b.billNumber,
          b.billSeq,
          b.orderId,
          b.orderType,
          b.tableLabel,
          b.tokenNumber,
          JSON.stringify(b.items),
          b.subtotal,
          b.discountAmount,
          b.taxableAmount,
          b.cgstAmount,
          b.sgstAmount,
          b.totalGst,
          b.grandTotal,
          JSON.stringify(b.payments),
          b.status,
          b.voidReason || null,
          b.voidedAt || null,
          b.voidedByName || null,
          b.splitLabel || null,
          b.createdAt,
          b.closedBy,
          b.closedByName
        )
    );
  }

  for (const e of state.expenses.slice(0, 300)) {
    stmts.push(
      db
        .prepare(
          'INSERT INTO expenses (id, date, category, description, amount, payment_mode, created_by_name, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)'
        )
        .bind(e.id, e.date, e.category, e.description, e.amount, e.paymentMode, e.createdByName, e.createdAt)
    );
  }

  for (const i of state.inventory) {
    stmts.push(
      db
        .prepare(
          'INSERT INTO inventory (id, name, unit, stock, min_stock, cost_per_unit, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)'
        )
        .bind(i.id, i.name, i.unit, i.stock, i.minStock, i.costPerUnit, i.updatedAt)
    );
  }

  for (const p of state.purchases.slice(0, 200)) {
    stmts.push(
      db
        .prepare(
          'INSERT INTO stock_purchases (id, ingredient_id, ingredient_name, unit, quantity, total_cost, supplier, date, created_by_name, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)'
        )
        .bind(
          p.id,
          p.ingredientId,
          p.ingredientName,
          p.unit,
          p.quantity,
          p.totalCost,
          p.supplier,
          p.date,
          p.createdByName,
          p.createdAt
        )
    );
  }

  for (const d of state.daySessions.slice(0, 120)) {
    stmts.push(
      db
        .prepare(
          'INSERT INTO day_sessions (id, date, status, opening_cash, expected_cash, counted_cash, cash_difference, opened_by_name, opened_at, closed_by_name, closed_at, notes) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)'
        )
        .bind(
          d.id,
          d.date,
          d.status,
          d.openingCash,
          d.expectedCash,
          d.countedCash,
          d.cashDifference,
          d.openedByName,
          d.openedAt,
          d.closedByName || null,
          d.closedAt || null,
          d.notes || null
        )
    );
  }

  for (const a of state.auditLogs.slice(0, 250)) {
    stmts.push(
      db
        .prepare(
          'INSERT INTO audit_logs (id, timestamp, user_id, username, user_name, role, action, details, entity_type, entity_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)'
        )
        .bind(
          a.id,
          a.timestamp,
          a.userId,
          a.username,
          a.userName,
          a.role,
          a.action,
          a.details,
          a.entityType,
          a.entityId
        )
    );
  }

  for (const bkp of state.backups) {
    stmts.push(
      db
        .prepare(
          'INSERT INTO backups (id, created_at, date_key, type, size_bytes, r2_key, counts_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)'
        )
        .bind(
          bkp.id,
          bkp.createdAt,
          bkp.dateKey,
          bkp.type,
          bkp.sizeBytes,
          bkp.r2Key || `backups/${bkp.id}.json`,
          JSON.stringify(bkp.counts)
        )
    );
  }

  // Execute in chunks of 80 statements to stay comfortably within D1 batch limits
  const chunkSize = 80;
  for (let i = 0; i < stmts.length; i += chunkSize) {
    await db.batch(stmts.slice(i, i + chunkSize));
  }
}

export async function saveBackupToR2(
  bucket: R2Bucket,
  state: FullDbState,
  type: 'auto' | 'manual'
): Promise<BackupMetadata> {
  const now = new Date();
  const dateKey = todayDateStr();
  const id = `bkp-${dateKey}-${now.getTime()}`;
  const r2Key = `backups/${id}.json`;
  const payload = JSON.stringify(state, null, 2);
  const sizeBytes = new TextEncoder().encode(payload).byteLength;

  await bucket.put(r2Key, payload, {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: { type, dateKey, createdAt: now.toISOString() },
  });

  return {
    id,
    createdAt: now.toISOString(),
    dateKey,
    type,
    sizeBytes,
    r2Key,
    counts: {
      orders: state.orders.length,
      bills: state.bills.length,
      menu: state.menu.length,
      expenses: state.expenses.length,
      inventory: state.inventory.length,
    },
  };
}
