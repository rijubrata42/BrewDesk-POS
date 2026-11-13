import { Router, type Response } from 'express';
import bcrypt from 'bcryptjs';
import {
  calculateOrderTotals,
  round2,
  splitOrderBySelectedItems,
  splitOrderEqually,
} from '../shared/calculations';
import type {
  AuditLogEntry,
  Bill,
  DiscountType,
  KotStatus,
  KotTicket,
  Order,
  OrderItem,
  PaymentEntry,
  Role,
  UserRecord,
} from '../shared/types';
import { db } from './db';
import {
  requireAuth,
  requireRole,
  signToken,
  verifyOwnerPin,
  type AuthedRequest,
} from './auth';
import { todayDateStr, type FullDbState } from './seed';

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function addAudit(
  draft: FullDbState,
  req: AuthedRequest,
  action: string,
  details: string,
  entityType: string,
  entityId: string
): void {
  const user = req.user!;
  const entry: AuditLogEntry = {
    id: uid('aud'),
    timestamp: new Date().toISOString(),
    userId: user.id,
    username: user.username,
    userName: user.name,
    role: user.role,
    action,
    details,
    entityType,
    entityId,
  };
  draft.auditLogs = [entry, ...draft.auditLogs].slice(0, 2000);
}

function deductInventoryForItems(draft: FullDbState, items: OrderItem[]): void {
  const now = new Date().toISOString();
  for (const line of items) {
    if (line.qty <= 0) continue;
    const menuItem = draft.menu.find((m) => m.id === line.menuItemId);
    if (!menuItem || !menuItem.recipe || menuItem.recipe.length === 0) continue;
    for (const ingReq of menuItem.recipe) {
      const ing = draft.inventory.find((i) => i.id === ingReq.ingredientId);
      if (ing) {
        ing.stock = Math.max(0, round2(ing.stock - ingReq.quantity * line.qty));
        ing.updatedAt = now;
      }
    }
  }
}

export function createApiRouter(broadcast: (event: string, data?: unknown) => void): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      storageMode: db.getStorageMode(),
      timestamp: new Date().toISOString(),
    });
  });

  // --- AUTH ---
  router.post('/auth/login', async (req, res: Response) => {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }
    const cleanUser = username.trim().toLowerCase();
    const state = db.getState();
    const user = state.users.find((u) => u.username.toLowerCase() === cleanUser && u.active);
    if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }
    const { passwordHash: _ph, ...pub } = user;
    const token = signToken(pub);
    await db.mutate((draft) => {
      draft.auditLogs = [
        {
          id: uid('aud'),
          timestamp: new Date().toISOString(),
          userId: pub.id,
          username: pub.username,
          userName: pub.name,
          role: pub.role,
          action: 'USER_LOGIN',
          details: `${pub.name} (${pub.role}) signed in`,
          entityType: 'user',
          entityId: pub.id,
        },
        ...draft.auditLogs,
      ].slice(0, 2000);
    });
    res.json({ token, user: pub });
  });

  router.get('/auth/me', requireAuth, (req: AuthedRequest, res: Response) => {
    res.json({ user: req.user });
  });

  // --- FULL SNAPSHOT ---
  router.get('/state', requireAuth, (req: AuthedRequest, res: Response) => {
    const snap = db.getPublicSnapshot();
    // Role-based filtering for sensitive owner-only financial/admin lists
    if (req.user?.role === 'waiter') {
      res.json({
        ...snap,
        expenses: [],
        users: [],
        backups: [],
      });
      return;
    }
    if (req.user?.role === 'cashier') {
      res.json({
        ...snap,
        users: [],
        backups: [],
      });
      return;
    }
    res.json(snap);
  });

  // --- ORDERS & TABLES ---
  router.post('/orders/open', requireAuth, async (req: AuthedRequest, res: Response) => {
    const { orderType, tableId } = req.body || {};
    if (orderType !== 'dine_in' && orderType !== 'takeaway') {
      res.status(400).json({ error: 'Invalid orderType' });
      return;
    }

    try {
      const result = await db.mutate((draft) => {
        const now = new Date().toISOString();
        const today = todayDateStr();
        if (draft.tokenDate !== today) {
          draft.tokenDate = today;
          draft.nextTokenSeq = 1;
        }

        if (orderType === 'dine_in') {
          const table = draft.tables.find((t) => t.id === tableId);
          if (!table) throw new Error('Table not found');
          if (table.activeOrderId) {
            const existing = draft.orders.find((o) => o.id === table.activeOrderId && o.status === 'open');
            if (existing) return existing;
          }
          const order: Order = {
            id: uid('ord'),
            orderType: 'dine_in',
            tableId: table.id,
            tableLabel: table.label,
            tokenNumber: null,
            status: 'open',
            items: [],
            discountType: 'flat',
            discountValue: 0,
            createdAt: now,
            updatedAt: now,
            createdBy: req.user!.id,
            createdByName: req.user!.name,
          };
          draft.orders.unshift(order);
          table.activeOrderId = order.id;
          addAudit(draft, req, 'ORDER_OPENED', `Opened ${table.label}`, 'order', order.id);
          return order;
        } else {
          const tokenNumber = draft.nextTokenSeq++;
          const order: Order = {
            id: uid('ord'),
            orderType: 'takeaway',
            tableId: null,
            tableLabel: `Takeaway #${tokenNumber}`,
            tokenNumber,
            status: 'open',
            items: [],
            discountType: 'flat',
            discountValue: 0,
            createdAt: now,
            updatedAt: now,
            createdBy: req.user!.id,
            createdByName: req.user!.name,
          };
          draft.orders.unshift(order);
          addAudit(draft, req, 'TAKEAWAY_OPENED', `Opened Takeaway #${tokenNumber}`, 'order', order.id);
          return order;
        }
      });

      broadcast('orders:updated', { orderId: result.id });
      res.json({ order: result, state: db.getPublicSnapshot() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to open order' });
    }
  });

  // Add item or adjust quantity/notes/addons
  router.post('/orders/:orderId/items', requireAuth, async (req: AuthedRequest, res: Response) => {
    const { orderId } = req.params;
    const { action, menuItemId, itemId, delta, addons, notes } = req.body || {};

    try {
      const updatedOrder = await db.mutate((draft) => {
        const order = draft.orders.find((o) => o.id === orderId && o.status === 'open');
        if (!order) throw new Error('Open order not found');
        const now = new Date().toISOString();

        if (action === 'add') {
          const menuItem = draft.menu.find((m) => m.id === menuItemId);
          if (!menuItem) throw new Error('Menu item not found');
          if (menuItem.soldOut) throw new Error(`${menuItem.name} is marked Sold Out`);
          if (menuItem.priceUnset || menuItem.price <= 0) {
            throw new Error(`Set price for ${menuItem.name} in Menu before billing`);
          }

          const cleanAddons = Array.isArray(addons) ? addons : [];
          const cleanNotes = typeof notes === 'string' ? notes.trim().slice(0, 140) : '';
          const addonKey = cleanAddons
            .map((a: { id: string }) => a.id)
            .sort()
            .join(',');

          const existing = order.items.find(
            (it) =>
              it.menuItemId === menuItem.id &&
              it.notes === cleanNotes &&
              it.addons.map((a) => a.id).sort().join(',') === addonKey
          );

          if (existing) {
            existing.qty += 1;
          } else {
            order.items.push({
              id: uid('oi'),
              menuItemId: menuItem.id,
              name: menuItem.name,
              category: menuItem.category,
              unitPrice: menuItem.price,
              taxPercent: menuItem.taxPercent,
              qty: 1,
              sentQty: 0,
              addons: cleanAddons,
              notes: cleanNotes,
              voidedQty: 0,
              voidReasons: [],
            });
          }
          order.updatedAt = now;
          addAudit(draft, req, 'ITEM_ADDED', `Added ${menuItem.name} to ${order.tableLabel}`, 'order', order.id);
          return order;
        }

        if (action === 'qty') {
          const line = order.items.find((it) => it.id === itemId);
          if (!line) throw new Error('Order line not found');
          const change = Number(delta);
          if (!Number.isFinite(change)) throw new Error('Invalid quantity delta');
          const nextQty = line.qty + change;
          if (nextQty < line.sentQty) {
            throw new Error('Cannot reduce below KOT sent quantity without Owner PIN void');
          }
          if (nextQty <= 0) {
            order.items = order.items.filter((it) => it.id !== itemId);
          } else {
            line.qty = nextQty;
          }
          order.updatedAt = now;
          return order;
        }

        if (action === 'update_line') {
          const line = order.items.find((it) => it.id === itemId);
          if (!line) throw new Error('Order line not found');
          if (typeof notes === 'string') line.notes = notes.trim().slice(0, 140);
          if (Array.isArray(addons)) line.addons = addons;
          order.updatedAt = now;
          return order;
        }

        throw new Error('Invalid item action');
      });

      broadcast('orders:updated', { orderId: updatedOrder.id });
      res.json({ order: updatedOrder, state: db.getPublicSnapshot() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update items' });
    }
  });

  // Apply discount (Owner or Cashier only — Waiter forbidden)
  router.post(
    '/orders/:orderId/discount',
    requireAuth,
    requireRole('owner', 'cashier'),
    async (req: AuthedRequest, res: Response) => {
      const { orderId } = req.params;
      const { discountType, discountValue } = req.body || {};
      if (discountType !== 'flat' && discountType !== 'percent') {
        res.status(400).json({ error: 'Invalid discountType' });
        return;
      }
      const val = Number(discountValue);
      if (!Number.isFinite(val) || val < 0) {
        res.status(400).json({ error: 'Invalid discountValue' });
        return;
      }

      try {
        const order = await db.mutate((draft) => {
          const ord = draft.orders.find((o) => o.id === orderId && o.status === 'open');
          if (!ord) throw new Error('Open order not found');
          ord.discountType = discountType as DiscountType;
          ord.discountValue = discountType === 'percent' ? Math.min(100, val) : val;
          ord.updatedAt = new Date().toISOString();
          addAudit(
            draft,
            req,
            'DISCOUNT_APPLIED',
            `Applied ${discountType === 'percent' ? `${ord.discountValue}%` : `Rs.${ord.discountValue}`} discount on ${ord.tableLabel}`,
            'order',
            ord.id
          );
          return ord;
        });

        broadcast('orders:updated', { orderId: order.id });
        res.json({ order, state: db.getPublicSnapshot() });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Discount failed' });
      }
    }
  );

  // Send KOT to Kitchen
  router.post('/orders/:orderId/kot', requireAuth, async (req: AuthedRequest, res: Response) => {
    const { orderId } = req.params;
    try {
      const kot = await db.mutate((draft) => {
        const ord = draft.orders.find((o) => o.id === orderId && o.status === 'open');
        if (!ord) throw new Error('Open order not found');

        const unsentItems = ord.items.filter((it) => it.qty > it.sentQty);
        if (unsentItems.length === 0) {
          throw new Error('No new items to send to kitchen');
        }

        const now = new Date().toISOString();
        const kotNumber = draft.nextKotSeq++;
        const ticket: KotTicket = {
          id: uid('kot'),
          kotNumber,
          orderId: ord.id,
          orderType: ord.orderType,
          tableLabel: ord.tableLabel,
          tokenNumber: ord.tokenNumber,
          status: 'new',
          items: unsentItems.map((it) => ({
            name: it.name,
            qty: it.qty - it.sentQty,
            addons: it.addons.map((a) => a.name),
            notes: it.notes,
          })),
          createdAt: now,
          updatedAt: now,
          createdByName: req.user!.name,
        };

        for (const it of unsentItems) {
          it.sentQty = it.qty;
        }
        ord.updatedAt = now;
        draft.kots.unshift(ticket);
        addAudit(draft, req, 'KOT_SENT', `Sent KOT #${kotNumber} for ${ord.tableLabel}`, 'kot', ticket.id);
        return ticket;
      });

      broadcast('kots:updated', { kotId: kot.id });
      res.json({ kot, state: db.getPublicSnapshot() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'KOT failed' });
    }
  });

  // Update Kitchen Display Ticket Status
  router.patch('/kots/:kotId/status', requireAuth, async (req: AuthedRequest, res: Response) => {
    const { kotId } = req.params;
    const { status } = req.body || {};
    if (status !== 'new' && status !== 'preparing' && status !== 'ready') {
      res.status(400).json({ error: 'Invalid KOT status' });
      return;
    }

    try {
      const kot = await db.mutate((draft) => {
        const found = draft.kots.find((k) => k.id === kotId);
        if (!found) throw new Error('KOT ticket not found');
        found.status = status as KotStatus;
        found.updatedAt = new Date().toISOString();
        addAudit(draft, req, 'KOT_STATUS', `KOT #${found.kotNumber} -> ${status}`, 'kot', found.id);
        return found;
      });

      broadcast('kots:updated', { kotId: kot.id });
      res.json({ kot, state: db.getPublicSnapshot() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'KOT update failed' });
    }
  });

  // Void sent KOT item (requires reason + Owner PIN)
  router.post('/orders/:orderId/void-item', requireAuth, async (req: AuthedRequest, res: Response) => {
    const { orderId } = req.params;
    const { itemId, qtyToVoid, reason, ownerPin } = req.body || {};

    if (typeof reason !== 'string' || reason.trim().length < 3) {
      res.status(400).json({ error: 'Void reason (at least 3 chars) is required' });
      return;
    }
    if (!verifyOwnerPin(ownerPin)) {
      res.status(403).json({ error: 'Invalid Owner PIN' });
      return;
    }

    try {
      const order = await db.mutate((draft) => {
        const ord = draft.orders.find((o) => o.id === orderId && o.status === 'open');
        if (!ord) throw new Error('Open order not found');
        const line = ord.items.find((it) => it.id === itemId);
        if (!line) throw new Error('Item not found');

        const voidCount = Math.min(line.qty, Math.max(1, Math.floor(Number(qtyToVoid) || 1)));
        line.qty -= voidCount;
        line.sentQty = Math.min(line.sentQty, line.qty);
        line.voidedQty += voidCount;
        line.voidReasons.push(`${voidCount}x: ${reason.trim()}`);
        ord.updatedAt = new Date().toISOString();

        addAudit(
          draft,
          req,
          'ITEM_VOIDED',
          `Voided ${voidCount}x ${line.name} on ${ord.tableLabel}. Reason: ${reason.trim()}`,
          'order',
          ord.id
        );
        return ord;
      });

      broadcast('orders:updated', { orderId: order.id });
      res.json({ order, state: db.getPublicSnapshot() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Void item failed' });
    }
  });

  // Void whole open order (requires reason + Owner PIN)
  router.post('/orders/:orderId/void-order', requireAuth, async (req: AuthedRequest, res: Response) => {
    const { orderId } = req.params;
    const { reason, ownerPin } = req.body || {};

    if (typeof reason !== 'string' || reason.trim().length < 3) {
      res.status(400).json({ error: 'Void reason is required' });
      return;
    }
    if (!verifyOwnerPin(ownerPin)) {
      res.status(403).json({ error: 'Invalid Owner PIN' });
      return;
    }

    try {
      await db.mutate((draft) => {
        const ord = draft.orders.find((o) => o.id === orderId && o.status === 'open');
        if (!ord) throw new Error('Open order not found');
        ord.status = 'voided';
        ord.voidReason = reason.trim();
        ord.updatedAt = new Date().toISOString();

        if (ord.tableId) {
          const t = draft.tables.find((tb) => tb.id === ord.tableId);
          if (t && t.activeOrderId === ord.id) t.activeOrderId = null;
        }
        addAudit(
          draft,
          req,
          'ORDER_VOIDED',
          `Voided open order ${ord.tableLabel}. Reason: ${reason.trim()}`,
          'order',
          ord.id
        );
      });

      broadcast('orders:updated', { orderId });
      res.json({ state: db.getPublicSnapshot() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Void order failed' });
    }
  });

  // Shift Table (moves or merges into target table)
  router.post('/tables/shift', requireAuth, async (req: AuthedRequest, res: Response) => {
    const { fromTableId, toTableId } = req.body || {};
    if (!fromTableId || !toTableId || fromTableId === toTableId) {
      res.status(400).json({ error: 'Select two distinct tables' });
      return;
    }

    try {
      await db.mutate((draft) => {
        const fromT = draft.tables.find((t) => t.id === fromTableId);
        const toT = draft.tables.find((t) => t.id === toTableId);
        if (!fromT || !toT) throw new Error('Table not found');
        if (!fromT.activeOrderId) throw new Error(`${fromT.label} has no open order`);

        const fromOrd = draft.orders.find((o) => o.id === fromT.activeOrderId && o.status === 'open');
        if (!fromOrd) throw new Error('Source order not found');
        const now = new Date().toISOString();

        if (!toT.activeOrderId) {
          fromOrd.tableId = toT.id;
          fromOrd.tableLabel = toT.label;
          fromOrd.updatedAt = now;
          toT.activeOrderId = fromOrd.id;
          fromT.activeOrderId = null;
          for (const k of draft.kots) {
            if (k.orderId === fromOrd.id) k.tableLabel = toT.label;
          }
          addAudit(draft, req, 'TABLE_SHIFTED', `Shifted ${fromT.label} -> ${toT.label}`, 'table', toT.id);
        } else {
          // Merge into busy target table
          const toOrd = draft.orders.find((o) => o.id === toT.activeOrderId && o.status === 'open');
          if (!toOrd) throw new Error('Target order not found');

          for (const srcItem of fromOrd.items) {
            if (srcItem.qty <= 0) continue;
            const addonKey = srcItem.addons.map((a) => a.id).sort().join(',');
            const match = toOrd.items.find(
              (ti) =>
                ti.menuItemId === srcItem.menuItemId &&
                ti.notes === srcItem.notes &&
                ti.addons.map((a) => a.id).sort().join(',') === addonKey
            );
            if (match) {
              match.qty += srcItem.qty;
              match.sentQty += srcItem.sentQty;
              match.voidedQty += srcItem.voidedQty;
            } else {
              toOrd.items.push({ ...srcItem });
            }
          }
          toOrd.updatedAt = now;
          fromOrd.status = 'voided';
          fromOrd.voidReason = `Merged into ${toT.label}`;
          fromOrd.updatedAt = now;
          fromT.activeOrderId = null;
          for (const k of draft.kots) {
            if (k.orderId === fromOrd.id) {
              k.orderId = toOrd.id;
              k.tableLabel = toT.label;
            }
          }
          addAudit(draft, req, 'TABLE_MERGED', `Merged ${fromT.label} into ${toT.label}`, 'table', toT.id);
        }
      });

      broadcast('tables:updated');
      res.json({ state: db.getPublicSnapshot() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Shift failed' });
    }
  });

  // Swap two tables
  router.post('/tables/swap', requireAuth, async (req: AuthedRequest, res: Response) => {
    const { tableAId, tableBId } = req.body || {};
    if (!tableAId || !tableBId || tableAId === tableBId) {
      res.status(400).json({ error: 'Select two distinct tables' });
      return;
    }

    try {
      await db.mutate((draft) => {
        const tA = draft.tables.find((t) => t.id === tableAId);
        const tB = draft.tables.find((t) => t.id === tableBId);
        if (!tA || !tB) throw new Error('Table not found');

        const ordA = tA.activeOrderId
          ? draft.orders.find((o) => o.id === tA.activeOrderId && o.status === 'open')
          : undefined;
        const ordB = tB.activeOrderId
          ? draft.orders.find((o) => o.id === tB.activeOrderId && o.status === 'open')
          : undefined;

        const now = new Date().toISOString();
        tA.activeOrderId = ordB ? ordB.id : null;
        tB.activeOrderId = ordA ? ordA.id : null;

        if (ordA) {
          ordA.tableId = tB.id;
          ordA.tableLabel = tB.label;
          ordA.updatedAt = now;
          for (const k of draft.kots) if (k.orderId === ordA.id) k.tableLabel = tB.label;
        }
        if (ordB) {
          ordB.tableId = tA.id;
          ordB.tableLabel = tA.label;
          ordB.updatedAt = now;
          for (const k of draft.kots) if (k.orderId === ordB.id) k.tableLabel = tA.label;
        }

        addAudit(draft, req, 'TABLE_SWAPPED', `Swapped ${tA.label} <-> ${tB.label}`, 'table', tA.id);
      });

      broadcast('tables:updated');
      res.json({ state: db.getPublicSnapshot() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Swap failed' });
    }
  });

  // Close & Settle Full Bill (Owner or Cashier only)
  router.post(
    '/orders/:orderId/close-bill',
    requireAuth,
    requireRole('owner', 'cashier'),
    async (req: AuthedRequest, res: Response) => {
      const { orderId } = req.params;
      const { payments } = req.body || {};

      if (!Array.isArray(payments) || payments.length === 0) {
        res.status(400).json({ error: 'At least one payment entry is required' });
        return;
      }

      try {
        const bill = await db.mutate((draft) => {
          const ord = draft.orders.find((o) => o.id === orderId && o.status === 'open');
          if (!ord) throw new Error('Open order not found');
          const activeItems = ord.items.filter((it) => it.qty > 0);
          if (activeItems.length === 0) throw new Error('Cannot close an empty order');

          const totals = calculateOrderTotals(
            activeItems,
            ord.discountType,
            ord.discountValue,
            draft.settings.gstRate
          );

          const cleanPayments: PaymentEntry[] = payments.map((p: { mode: string; amount: number }) => ({
            mode: p.mode as PaymentEntry['mode'],
            amount: round2(Number(p.amount) || 0),
          }));
          const paidSum = round2(cleanPayments.reduce((s, p) => s + p.amount, 0));
          if (Math.abs(paidSum - totals.grandTotal) > 1) {
            throw new Error(`Payment total Rs.${paidSum} does not match bill total Rs.${totals.grandTotal}`);
          }

          const seq = draft.nextBillSeq++;
          const billNumber = `INV-${String(seq).padStart(4, '0')}`;
          const now = new Date().toISOString();

          const newBill: Bill = {
            id: uid('bill'),
            billNumber,
            billSeq: seq,
            orderId: ord.id,
            orderType: ord.orderType,
            tableLabel: ord.tableLabel,
            tokenNumber: ord.tokenNumber,
            items: activeItems.map((it) => ({ ...it })),
            subtotal: totals.subtotal,
            discountAmount: totals.discountAmount,
            taxableAmount: totals.taxableAmount,
            cgstAmount: totals.cgstAmount,
            sgstAmount: totals.sgstAmount,
            totalGst: totals.totalGst,
            grandTotal: totals.grandTotal,
            payments: cleanPayments,
            status: 'paid',
            createdAt: now,
            closedBy: req.user!.id,
            closedByName: req.user!.name,
          };

          draft.bills.unshift(newBill);
          ord.status = 'billed';
          ord.updatedAt = now;

          if (ord.tableId) {
            const tbl = draft.tables.find((t) => t.id === ord.tableId);
            if (tbl && tbl.activeOrderId === ord.id) tbl.activeOrderId = null;
          }

          deductInventoryForItems(draft, activeItems);
          addAudit(
            draft,
            req,
            'BILL_CLOSED',
            `Closed ${billNumber} (${ord.tableLabel}) for Rs.${totals.grandTotal}`,
            'bill',
            newBill.id
          );
          return newBill;
        });

        broadcast('bills:created', { billId: bill.id });
        res.json({ bill, state: db.getPublicSnapshot() });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to close bill' });
      }
    }
  );

  // Split Bill (by selected items OR equally across N people)
  router.post(
    '/orders/:orderId/split-bill',
    requireAuth,
    requireRole('owner', 'cashier'),
    async (req: AuthedRequest, res: Response) => {
      const { orderId } = req.params;
      const { mode, itemQtys, payments, peopleCount, splitModes } = req.body || {};

      try {
        const createdBills = await db.mutate((draft) => {
          const ord = draft.orders.find((o) => o.id === orderId && o.status === 'open');
          if (!ord) throw new Error('Open order not found');
          const activeItems = ord.items.filter((it) => it.qty > 0);
          if (activeItems.length === 0) throw new Error('Order has no items');
          const now = new Date().toISOString();

          if (mode === 'items') {
            const fullTotals = calculateOrderTotals(
              activeItems,
              ord.discountType,
              ord.discountValue,
              draft.settings.gstRate
            );
            const { selectedItems, totals } = splitOrderBySelectedItems(
              activeItems,
              itemQtys || {},
              fullTotals.discountAmount,
              fullTotals.subtotal,
              draft.settings.gstRate
            );
            if (selectedItems.length === 0) throw new Error('Select at least one item to split');

            const cleanPayments: PaymentEntry[] = (payments || []).map(
              (p: { mode: string; amount: number }) => ({
                mode: p.mode as PaymentEntry['mode'],
                amount: round2(Number(p.amount) || 0),
              })
            );
            const paidSum = round2(cleanPayments.reduce((s, p) => s + p.amount, 0));
            if (Math.abs(paidSum - totals.grandTotal) > 1) {
              throw new Error(`Payment Rs.${paidSum} must match split total Rs.${totals.grandTotal}`);
            }

            const seq = draft.nextBillSeq++;
            const billNumber = `INV-${String(seq).padStart(4, '0')}`;
            const bill: Bill = {
              id: uid('bill'),
              billNumber,
              billSeq: seq,
              orderId: ord.id,
              orderType: ord.orderType,
              tableLabel: ord.tableLabel,
              tokenNumber: ord.tokenNumber,
              items: selectedItems,
              subtotal: totals.subtotal,
              discountAmount: totals.discountAmount,
              taxableAmount: totals.taxableAmount,
              cgstAmount: totals.cgstAmount,
              sgstAmount: totals.sgstAmount,
              totalGst: totals.totalGst,
              grandTotal: totals.grandTotal,
              payments: cleanPayments,
              status: 'paid',
              splitLabel: 'Item Split',
              createdAt: now,
              closedBy: req.user!.id,
              closedByName: req.user!.name,
            };

            // Subtract billed quantities from open order
            for (const sel of selectedItems) {
              const target = ord.items.find((it) => it.id === sel.id);
              if (target) {
                target.qty = Math.max(0, target.qty - sel.qty);
                target.sentQty = Math.min(target.sentQty, target.qty);
              }
            }
            ord.items = ord.items.filter((it) => it.qty > 0);
            ord.updatedAt = now;

            if (ord.items.length === 0) {
              ord.status = 'billed';
              if (ord.tableId) {
                const tbl = draft.tables.find((t) => t.id === ord.tableId);
                if (tbl && tbl.activeOrderId === ord.id) tbl.activeOrderId = null;
              }
            }

            draft.bills.unshift(bill);
            deductInventoryForItems(draft, selectedItems);
            addAudit(draft, req, 'BILL_SPLIT_ITEMS', `Partial item split ${billNumber} on ${ord.tableLabel}`, 'bill', bill.id);
            return [bill];
          }

          if (mode === 'equal') {
            const count = Math.max(2, Math.min(20, Math.floor(Number(peopleCount) || 2)));
            const totals = calculateOrderTotals(
              activeItems,
              ord.discountType,
              ord.discountValue,
              draft.settings.gstRate
            );
            const shares = splitOrderEqually(totals.grandTotal, count);
            const ratioShares = shares.map((s) => (totals.grandTotal > 0 ? s / totals.grandTotal : 1 / count));
            const outBills: Bill[] = [];

            for (let i = 0; i < count; i++) {
              const seq = draft.nextBillSeq++;
              const billNumber = `INV-${String(seq).padStart(4, '0')}`;
              const ratio = ratioShares[i];
              const payMode = (Array.isArray(splitModes) && splitModes[i]) || 'cash';
              const bill: Bill = {
                id: uid('bill'),
                billNumber,
                billSeq: seq,
                orderId: ord.id,
                orderType: ord.orderType,
                tableLabel: ord.tableLabel,
                tokenNumber: ord.tokenNumber,
                items: i === 0 ? activeItems.map((it) => ({ ...it })) : [],
                subtotal: round2(totals.subtotal * ratio),
                discountAmount: round2(totals.discountAmount * ratio),
                taxableAmount: round2(totals.taxableAmount * ratio),
                cgstAmount: round2(totals.cgstAmount * ratio),
                sgstAmount: round2(totals.sgstAmount * ratio),
                totalGst: round2(totals.totalGst * ratio),
                grandTotal: shares[i],
                payments: [{ mode: payMode, amount: shares[i] }],
                status: 'paid',
                splitLabel: `Equal Split ${i + 1}/${count}`,
                createdAt: now,
                closedBy: req.user!.id,
                closedByName: req.user!.name,
              };
              draft.bills.unshift(bill);
              outBills.push(bill);
            }

            ord.status = 'billed';
            ord.updatedAt = now;
            if (ord.tableId) {
              const tbl = draft.tables.find((t) => t.id === ord.tableId);
              if (tbl && tbl.activeOrderId === ord.id) tbl.activeOrderId = null;
            }
            deductInventoryForItems(draft, activeItems);
            addAudit(draft, req, 'BILL_SPLIT_EQUAL', `Split ${ord.tableLabel} equally ${count} ways`, 'order', ord.id);
            return outBills;
          }

          throw new Error('Invalid split mode');
        });

        broadcast('bills:created');
        res.json({ bills: createdBills, state: db.getPublicSnapshot() });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Split bill failed' });
      }
    }
  );

  // Void closed bill (Owner only + Owner PIN + reason)
  router.post(
    '/bills/:billId/void',
    requireAuth,
    requireRole('owner'),
    async (req: AuthedRequest, res: Response) => {
      const { billId } = req.params;
      const { reason, ownerPin } = req.body || {};
      if (typeof reason !== 'string' || reason.trim().length < 3) {
        res.status(400).json({ error: 'Void reason is required' });
        return;
      }
      if (!verifyOwnerPin(ownerPin)) {
        res.status(403).json({ error: 'Invalid Owner PIN' });
        return;
      }

      try {
        const bill = await db.mutate((draft) => {
          const found = draft.bills.find((b) => b.id === billId);
          if (!found) throw new Error('Bill not found');
          if (found.status === 'voided') throw new Error('Bill is already voided');
          found.status = 'voided';
          found.voidReason = reason.trim();
          found.voidedAt = new Date().toISOString();
          found.voidedByName = req.user!.name;
          addAudit(
            draft,
            req,
            'BILL_VOIDED',
            `Voided closed bill ${found.billNumber} (Rs.${found.grandTotal}). Reason: ${reason.trim()}`,
            'bill',
            found.id
          );
          return found;
        });

        broadcast('bills:updated', { billId: bill.id });
        res.json({ bill, state: db.getPublicSnapshot() });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Void bill failed' });
      }
    }
  );

  // --- DAY OPEN / CLOSE ---
  router.post(
    '/day/open',
    requireAuth,
    requireRole('owner', 'cashier'),
    async (req: AuthedRequest, res: Response) => {
      const openingCash = round2(Number(req.body?.openingCash) || 0);
      if (openingCash < 0) {
        res.status(400).json({ error: 'Opening cash cannot be negative' });
        return;
      }

      try {
        const session = await db.mutate((draft) => {
          const existingOpen = draft.daySessions.find((d) => d.status === 'open');
          if (existingOpen) throw new Error('A day register is already open');
          const now = new Date().toISOString();
          const s = {
            id: uid('day'),
            date: todayDateStr(),
            status: 'open' as const,
            openingCash,
            expectedCash: openingCash,
            countedCash: null,
            cashDifference: null,
            openedByName: req.user!.name,
            openedAt: now,
          };
          draft.daySessions.unshift(s);
          addAudit(draft, req, 'DAY_OPENED', `Opened register with Rs.${openingCash}`, 'day', s.id);
          return s;
        });
        broadcast('day:updated');
        res.json({ session, state: db.getPublicSnapshot() });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to open day' });
      }
    }
  );

  router.post(
    '/day/close',
    requireAuth,
    requireRole('owner', 'cashier'),
    async (req: AuthedRequest, res: Response) => {
      const countedCash = round2(Number(req.body?.countedCash));
      const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() : '';
      if (!Number.isFinite(countedCash) || countedCash < 0) {
        res.status(400).json({ error: 'Valid countedCash is required' });
        return;
      }

      try {
        const session = await db.mutate((draft) => {
          const openSess = draft.daySessions.find((d) => d.status === 'open');
          if (!openSess) throw new Error('No open day register found');
          const openMs = new Date(openSess.openedAt).getTime();

          const cashSales = draft.bills
            .filter((b) => b.status === 'paid' && new Date(b.createdAt).getTime() >= openMs)
            .reduce(
              (sum, b) =>
                sum + b.payments.filter((p) => p.mode === 'cash').reduce((ps, p) => ps + p.amount, 0),
              0
            );

          const cashExpenses = draft.expenses
            .filter((e) => e.paymentMode === 'cash' && new Date(e.createdAt).getTime() >= openMs)
            .reduce((sum, e) => sum + e.amount, 0);

          const expectedCash = round2(openSess.openingCash + cashSales - cashExpenses);
          openSess.expectedCash = expectedCash;
          openSess.countedCash = countedCash;
          openSess.cashDifference = round2(countedCash - expectedCash);
          openSess.status = 'closed';
          openSess.closedByName = req.user!.name;
          openSess.closedAt = new Date().toISOString();
          openSess.notes = notes;

          addAudit(
            draft,
            req,
            'DAY_CLOSED',
            `Closed register. Expected Rs.${expectedCash}, Counted Rs.${countedCash}, Diff Rs.${openSess.cashDifference}`,
            'day',
            openSess.id
          );
          return openSess;
        });

        broadcast('day:updated');
        res.json({ session, state: db.getPublicSnapshot() });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to close day' });
      }
    }
  );

  // --- MENU (Owner only) ---
  router.post('/menu', requireAuth, requireRole('owner'), async (req: AuthedRequest, res: Response) => {
    const { name, category, price, taxPercent, soldOut, addons, recipe, defaultNotes } = req.body || {};
    if (typeof name !== 'string' || !name.trim() || typeof category !== 'string' || !category.trim()) {
      res.status(400).json({ error: 'Name and category are required' });
      return;
    }
    const numPrice = round2(Number(price) || 0);
    const numTax = Number.isFinite(Number(taxPercent)) ? Number(taxPercent) : db.getState().settings.gstRate;

    const item = await db.mutate((draft) => {
      const next = {
        id: uid('item'),
        name: name.trim(),
        category: category.trim(),
        price: numPrice,
        priceUnset: numPrice <= 0,
        taxPercent: numTax,
        soldOut: Boolean(soldOut),
        addons: Array.isArray(addons) ? addons : [],
        recipe: Array.isArray(recipe) ? recipe : [],
        defaultNotes: typeof defaultNotes === 'string' ? defaultNotes.trim() : '',
        sortOrder: draft.menu.length + 1,
      };
      draft.menu.push(next);
      addAudit(draft, req, 'MENU_ADDED', `Added menu item ${next.name} (Rs.${next.price})`, 'menu', next.id);
      return next;
    });

    broadcast('menu:updated');
    res.json({ item, state: db.getPublicSnapshot() });
  });

  router.patch('/menu/:id', requireAuth, requireRole('owner'), async (req: AuthedRequest, res: Response) => {
    const { id } = req.params;
    const patch = req.body || {};
    try {
      const item = await db.mutate((draft) => {
        const found = draft.menu.find((m) => m.id === id);
        if (!found) throw new Error('Menu item not found');
        if (typeof patch.name === 'string' && patch.name.trim()) found.name = patch.name.trim();
        if (typeof patch.category === 'string' && patch.category.trim()) found.category = patch.category.trim();
        if (patch.price !== undefined) {
          const p = round2(Number(patch.price));
          if (!Number.isFinite(p) || p < 0) throw new Error('Invalid price');
          found.price = p;
          found.priceUnset = p <= 0;
        }
        if (patch.taxPercent !== undefined) found.taxPercent = Number(patch.taxPercent);
        if (patch.soldOut !== undefined) found.soldOut = Boolean(patch.soldOut);
        if (Array.isArray(patch.addons)) found.addons = patch.addons;
        if (Array.isArray(patch.recipe)) found.recipe = patch.recipe;
        if (typeof patch.defaultNotes === 'string') found.defaultNotes = patch.defaultNotes.trim();

        addAudit(draft, req, 'MENU_UPDATED', `Updated menu item ${found.name} (Rs.${found.price}, soldOut=${found.soldOut})`, 'menu', found.id);
        return found;
      });
      broadcast('menu:updated');
      res.json({ item, state: db.getPublicSnapshot() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Menu update failed' });
    }
  });

  router.delete('/menu/:id', requireAuth, requireRole('owner'), async (req: AuthedRequest, res: Response) => {
    const { id } = req.params;
    await db.mutate((draft) => {
      const found = draft.menu.find((m) => m.id === id);
      draft.menu = draft.menu.filter((m) => m.id !== id);
      if (found) addAudit(draft, req, 'MENU_DELETED', `Deleted menu item ${found.name}`, 'menu', id);
    });
    broadcast('menu:updated');
    res.json({ state: db.getPublicSnapshot() });
  });

  // --- EXPENSES ---
  router.post(
    '/expenses',
    requireAuth,
    requireRole('owner', 'cashier'),
    async (req: AuthedRequest, res: Response) => {
      const { date, category, description, amount, paymentMode } = req.body || {};
      const numAmt = round2(Number(amount));
      if (!category || !Number.isFinite(numAmt) || numAmt <= 0) {
        res.status(400).json({ error: 'Category and positive amount are required' });
        return;
      }

      const exp = await db.mutate((draft) => {
        const entry = {
          id: uid('exp'),
          date: typeof date === 'string' && date ? date : todayDateStr(),
          category: String(category).trim(),
          description: String(description || '').trim(),
          amount: numAmt,
          paymentMode: (paymentMode === 'upi' || paymentMode === 'card' ? paymentMode : 'cash') as
            | 'cash'
            | 'upi'
            | 'card',
          createdByName: req.user!.name,
          createdAt: new Date().toISOString(),
        };
        draft.expenses.unshift(entry);
        addAudit(draft, req, 'EXPENSE_LOGGED', `Logged expense ${entry.category}: Rs.${entry.amount}`, 'expense', entry.id);
        return entry;
      });

      broadcast('expenses:updated');
      res.json({ expense: exp, state: db.getPublicSnapshot() });
    }
  );

  router.delete('/expenses/:id', requireAuth, requireRole('owner'), async (req: AuthedRequest, res: Response) => {
    const { id } = req.params;
    await db.mutate((draft) => {
      const found = draft.expenses.find((e) => e.id === id);
      draft.expenses = draft.expenses.filter((e) => e.id !== id);
      if (found) addAudit(draft, req, 'EXPENSE_DELETED', `Deleted expense ${found.category} Rs.${found.amount}`, 'expense', id);
    });
    broadcast('expenses:updated');
    res.json({ state: db.getPublicSnapshot() });
  });

  // --- INVENTORY & PURCHASES ---
  router.post(
    '/inventory',
    requireAuth,
    requireRole('owner'),
    async (req: AuthedRequest, res: Response) => {
      const { name, unit, stock, minStock, costPerUnit } = req.body || {};
      if (!name || !unit) {
        res.status(400).json({ error: 'Ingredient name and unit are required' });
        return;
      }
      const ing = await db.mutate((draft) => {
        const entry = {
          id: uid('ing'),
          name: String(name).trim(),
          unit: String(unit).trim(),
          stock: round2(Number(stock) || 0),
          minStock: round2(Number(minStock) || 0),
          costPerUnit: round2(Number(costPerUnit) || 0),
          updatedAt: new Date().toISOString(),
        };
        draft.inventory.push(entry);
        addAudit(draft, req, 'INGREDIENT_ADDED', `Added ingredient ${entry.name}`, 'inventory', entry.id);
        return entry;
      });
      broadcast('inventory:updated');
      res.json({ ingredient: ing, state: db.getPublicSnapshot() });
    }
  );

  router.patch(
    '/inventory/:id',
    requireAuth,
    requireRole('owner'),
    async (req: AuthedRequest, res: Response) => {
      const { id } = req.params;
      const patch = req.body || {};
      try {
        const ing = await db.mutate((draft) => {
          const found = draft.inventory.find((i) => i.id === id);
          if (!found) throw new Error('Ingredient not found');
          if (patch.stock !== undefined) found.stock = round2(Number(patch.stock));
          if (patch.minStock !== undefined) found.minStock = round2(Number(patch.minStock));
          if (patch.costPerUnit !== undefined) found.costPerUnit = round2(Number(patch.costPerUnit));
          if (typeof patch.name === 'string' && patch.name.trim()) found.name = patch.name.trim();
          found.updatedAt = new Date().toISOString();
          addAudit(draft, req, 'INGREDIENT_UPDATED', `Updated stock for ${found.name} -> ${found.stock} ${found.unit}`, 'inventory', found.id);
          return found;
        });
        broadcast('inventory:updated');
        res.json({ ingredient: ing, state: db.getPublicSnapshot() });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Update failed' });
      }
    }
  );

  router.post(
    '/inventory/purchase',
    requireAuth,
    requireRole('owner', 'cashier'),
    async (req: AuthedRequest, res: Response) => {
      const { ingredientId, quantity, totalCost, supplier, date } = req.body || {};
      const qty = round2(Number(quantity));
      const cost = round2(Number(totalCost) || 0);
      if (!ingredientId || !Number.isFinite(qty) || qty <= 0) {
        res.status(400).json({ error: 'Ingredient and positive quantity are required' });
        return;
      }

      try {
        const purchase = await db.mutate((draft) => {
          const ing = draft.inventory.find((i) => i.id === ingredientId);
          if (!ing) throw new Error('Ingredient not found');
          const now = new Date().toISOString();
          ing.stock = round2(ing.stock + qty);
          if (cost > 0) ing.costPerUnit = round2(cost / qty);
          ing.updatedAt = now;

          const entry = {
            id: uid('pur'),
            ingredientId: ing.id,
            ingredientName: ing.name,
            unit: ing.unit,
            quantity: qty,
            totalCost: cost,
            supplier: String(supplier || '').trim(),
            date: typeof date === 'string' && date ? date : todayDateStr(),
            createdByName: req.user!.name,
            createdAt: now,
          };
          draft.purchases.unshift(entry);
          addAudit(draft, req, 'STOCK_PURCHASED', `Added +${qty} ${ing.unit} of ${ing.name} (Rs.${cost})`, 'purchase', entry.id);
          return entry;
        });
        broadcast('inventory:updated');
        res.json({ purchase, state: db.getPublicSnapshot() });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Purchase failed' });
      }
    }
  );

  // --- USERS (Owner only) ---
  router.post('/users', requireAuth, requireRole('owner'), async (req: AuthedRequest, res: Response) => {
    const { username, name, password, role } = req.body || {};
    if (
      typeof username !== 'string' ||
      username.trim().length < 2 ||
      typeof name !== 'string' ||
      !name.trim() ||
      typeof password !== 'string' ||
      password.length < 4 ||
      (role !== 'owner' && role !== 'cashier' && role !== 'waiter')
    ) {
      res.status(400).json({ error: 'Valid username, name, password (min 4 chars), and role are required' });
      return;
    }

    try {
      const created = await db.mutate((draft) => {
        const cleanUsername = username.trim().toLowerCase();
        if (draft.users.some((u) => u.username.toLowerCase() === cleanUsername)) {
          throw new Error('Username already exists');
        }
        const rec: UserRecord = {
          id: uid('user'),
          username: cleanUsername,
          name: name.trim(),
          role: role as Role,
          active: true,
          createdAt: new Date().toISOString(),
          passwordHash: bcrypt.hashSync(password, 10),
        };
        draft.users.push(rec);
        addAudit(draft, req, 'USER_CREATED', `Created ${rec.role} account: ${rec.username}`, 'user', rec.id);
        const { passwordHash: _ph, ...pub } = rec;
        return pub;
      });
      broadcast('users:updated');
      res.json({ user: created, state: db.getPublicSnapshot() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Create user failed' });
    }
  });

  router.patch('/users/:id', requireAuth, requireRole('owner'), async (req: AuthedRequest, res: Response) => {
    const { id } = req.params;
    const { name, role, active, password } = req.body || {};
    try {
      await db.mutate((draft) => {
        const user = draft.users.find((u) => u.id === id);
        if (!user) throw new Error('User not found');
        if (user.id === req.user!.id && active === false) {
          throw new Error('Cannot deactivate your own active owner account');
        }
        if (typeof name === 'string' && name.trim()) user.name = name.trim();
        if (role === 'owner' || role === 'cashier' || role === 'waiter') user.role = role;
        if (typeof active === 'boolean') user.active = active;
        if (typeof password === 'string' && password.length >= 4) {
          user.passwordHash = bcrypt.hashSync(password, 10);
        }
        addAudit(draft, req, 'USER_UPDATED', `Updated account ${user.username}`, 'user', user.id);
      });
      broadcast('users:updated');
      res.json({ state: db.getPublicSnapshot() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Update user failed' });
    }
  });

  // --- SETTINGS (Owner only) ---
  router.patch('/settings', requireAuth, requireRole('owner'), async (req: AuthedRequest, res: Response) => {
    const patch = req.body || {};
    try {
      await db.mutate((draft) => {
        const s = draft.settings;
        if (typeof patch.cafeName === 'string' && patch.cafeName.trim()) s.cafeName = patch.cafeName.trim();
        if (typeof patch.address === 'string') s.address = patch.address.trim();
        if (typeof patch.phone === 'string') s.phone = patch.phone.trim();
        if (typeof patch.gstin === 'string') s.gstin = patch.gstin.trim().toUpperCase();
        if (typeof patch.upiId === 'string') s.upiId = patch.upiId.trim();
        if (typeof patch.receiptFooter === 'string') s.receiptFooter = patch.receiptFooter.trim();
        if (patch.paperSize === '58mm' || patch.paperSize === '80mm') s.paperSize = patch.paperSize;
        if (patch.gstRate !== undefined) {
          const r = Number(patch.gstRate);
          if (Number.isFinite(r) && r >= 0 && r <= 28) s.gstRate = r;
        }
        if (Array.isArray(patch.globalAddons)) s.globalAddons = patch.globalAddons;
        if (typeof patch.newOwnerPin === 'string' && patch.newOwnerPin.trim().length >= 4) {
          draft.ownerPinHash = bcrypt.hashSync(patch.newOwnerPin.trim(), 10);
        }

        if (patch.tableCount !== undefined) {
          const count = Math.max(1, Math.min(40, Math.floor(Number(patch.tableCount))));
          s.tableCount = count;
          while (draft.tables.length < count) {
            const num = draft.tables.length + 1;
            draft.tables.push({ id: `table-${num}`, number: num, label: `T${num}`, activeOrderId: null });
          }
          while (draft.tables.length > count) {
            const last = draft.tables[draft.tables.length - 1];
            if (last.activeOrderId) {
              throw new Error(`Cannot remove ${last.label} while it has an open order`);
            }
            draft.tables.pop();
          }
        }
        addAudit(draft, req, 'SETTINGS_UPDATED', 'Updated cafe settings', 'settings', 'main');
      });
      broadcast('settings:updated');
      res.json({ state: db.getPublicSnapshot() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Settings update failed' });
    }
  });

  // --- BACKUPS & RESTORE (Owner only) ---
  router.post('/backups/run', requireAuth, requireRole('owner'), async (req: AuthedRequest, res: Response) => {
    const meta = await db.createBackup('manual');
    await db.mutate((draft) => {
      addAudit(draft, req, 'BACKUP_CREATED', `Created manual backup ${meta.id}`, 'backup', meta.id);
    });
    broadcast('backups:updated');
    res.json({ backup: meta, state: db.getPublicSnapshot() });
  });

  router.get('/backups/export', requireAuth, requireRole('owner'), (req: AuthedRequest, res: Response) => {
    const id = typeof req.query.id === 'string' ? req.query.id : undefined;
    const payload = db.getBackupPayload(id);
    if (!payload) {
      res.status(404).json({ error: 'Backup not found' });
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="brewdesk-backup-${todayDateStr()}.json"`
    );
    res.send(JSON.stringify(payload, null, 2));
  });

  router.post('/backups/restore', requireAuth, requireRole('owner'), async (req: AuthedRequest, res: Response) => {
    const payload = req.body?.backup as FullDbState | undefined;
    if (
      !payload ||
      !payload.settings ||
      !Array.isArray(payload.menu) ||
      !Array.isArray(payload.tables) ||
      !Array.isArray(payload.users)
    ) {
      res.status(400).json({ error: 'Invalid backup JSON file structure' });
      return;
    }

    await db.replaceFullState(payload);
    await db.mutate((draft) => {
      addAudit(draft, req, 'BACKUP_RESTORED', 'Restored full database from JSON backup', 'backup', 'restore');
    });
    broadcast('state:restored');
    res.json({ state: db.getPublicSnapshot() });
  });

  return router;
}
