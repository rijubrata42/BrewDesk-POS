import { DurableObject } from 'cloudflare:workers';
import {
  calculateOrderTotals,
  round2,
  splitOrderBySelectedItems,
  splitOrderEqually,
} from '../src/shared/calculations';
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
  UserPublic,
  UserRecord,
} from '../src/shared/types';
import { hashSecret, signJwt, verifyJwt, verifySecret } from './crypto';
import {
  buildPublicSnapshot,
  loadOrInitD1State,
  persistToD1,
  saveBackupToR2,
  type WorkerEnv,
} from './d1-store';
import { todayDateStr, type FullDbState } from './seed';

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function addAudit(
  draft: FullDbState,
  user: UserPublic,
  action: string,
  details: string,
  entityType: string,
  entityId: string
): void {
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

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function filterSnapshotForRole(state: FullDbState, role: Role) {
  const snap = buildPublicSnapshot(state);
  if (role === 'waiter') {
    return { ...snap, expenses: [], users: [], backups: [] };
  }
  if (role === 'cashier') {
    return { ...snap, users: [], backups: [] };
  }
  return snap;
}

export class PosRealtimeHub extends DurableObject<WorkerEnv> {
  private stateCache: FullDbState | null = null;
  private mutationQueue: Promise<unknown> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: WorkerEnv) {
    super(ctx, env);
  }

  private async ensureState(): Promise<FullDbState> {
    if (!this.stateCache) {
      this.stateCache = await loadOrInitD1State(this.env.DB, this.env.JWT_SECRET);
      // Ensure daily automatic backup exists on cold start
      await this.ensureDailyBackupInternal();
    }
    return this.stateCache;
  }

  private getJwtSecret(state: FullDbState): string {
    return this.env.JWT_SECRET?.trim() || state.jwtSecret;
  }

  private async mutate<T>(fn: (draft: FullDbState) => T | Promise<T>): Promise<T> {
    const run = this.mutationQueue.then(async () => {
      const current = await this.ensureState();
      const result = await fn(current);
      current.lastUpdatedAt = new Date().toISOString();
      await persistToD1(this.env.DB, current);
      return result;
    });
    this.mutationQueue = run.catch(() => undefined);
    return run;
  }

  private broadcast(event: string, data?: unknown): void {
    if (!this.stateCache) return;
    const sockets = this.ctx.getWebSockets();
    if (sockets.length === 0) return;
    const payload = JSON.stringify({
      type: 'state:sync',
      event,
      data,
      state: buildPublicSnapshot(this.stateCache),
    });
    for (const ws of sockets) {
      try {
        ws.send(payload);
      } catch {
        // Dead socket will be cleaned up on close/error
      }
    }
  }

  private async ensureDailyBackupInternal(): Promise<boolean> {
    const current = this.stateCache;
    if (!current) return false;
    const today = todayDateStr();
    const hasToday = current.backups.some((b) => b.dateKey === today && b.type === 'auto');
    if (hasToday) return false;

    const meta = await saveBackupToR2(this.env.BACKUPS_BUCKET, current, 'auto');
    current.backups = [meta, ...current.backups].slice(0, 30);
    current.lastUpdatedAt = new Date().toISOString();
    await persistToD1(this.env.DB, current);
    return true;
  }

  async runScheduledBackup(): Promise<{ created: boolean; backupId?: string }> {
    const created = await this.mutationQueue.then(async () => {
      await this.ensureState();
      return this.ensureDailyBackupInternal();
    });
    if (created) {
      this.broadcast('backups:updated');
      return { created: true, backupId: this.stateCache?.backups[0]?.id };
    }
    return { created: false };
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      const text = typeof message === 'string' ? message : new TextDecoder().decode(message);
      const parsed = JSON.parse(text);
      if (parsed?.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
      }
    } catch {
      // Ignore malformed client frames
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      // Already closed
    }
  }

  private async authenticate(req: Request, state: FullDbState): Promise<UserPublic | null> {
    const header = req.headers.get('Authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) return null;
    const decoded = await verifyJwt(token, this.getJwtSecret(state));
    if (!decoded) return null;
    const found = state.users.find((u) => u.id === decoded.sub && u.active);
    if (!found) return null;
    const { passwordHash: _ph, ...pub } = found;
    return pub;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // WebSocket real-time hub upgrade on /ws
    if (pathname === '/ws') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('Expected WebSocket upgrade', { status: 426 });
      }
      const state = await this.ensureState();
      const token = url.searchParams.get('token') || '';
      const decoded = await verifyJwt(token, this.getJwtSecret(state));
      const user = decoded ? state.users.find((u) => u.id === decoded.sub && u.active) : undefined;
      if (!user) {
        return new Response('Unauthorized', { status: 401 });
      }

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.send(
        JSON.stringify({
          type: 'state:init',
          state: filterSnapshotForRole(state, user.role),
        })
      );
      return new Response(null, { status: 101, webSocket: client });
    }

    if (pathname === '/api/health' && request.method === 'GET') {
      await this.ensureState();
      return jsonResponse({
        ok: true,
        storageMode: 'cloudflare-d1',
        timestamp: new Date().toISOString(),
      });
    }

    const state = await this.ensureState();

    // --- LOGIN ---
    if (pathname === '/api/auth/login' && request.method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as { username?: unknown; password?: unknown };
      if (typeof body.username !== 'string' || typeof body.password !== 'string') {
        return jsonResponse({ error: 'Username and password are required' }, 400);
      }
      const cleanUser = body.username.trim().toLowerCase();
      const user = state.users.find((u) => u.username.toLowerCase() === cleanUser && u.active);
      if (!user || !(await verifySecret(body.password, user.passwordHash))) {
        return jsonResponse({ error: 'Invalid username or password' }, 401);
      }
      const { passwordHash: _ph, ...pub } = user;
      const token = await signJwt(pub, this.getJwtSecret(state));
      await this.mutate((draft) => {
        addAudit(draft, pub, 'USER_LOGIN', `${pub.name} (${pub.role}) signed in`, 'user', pub.id);
      });
      return jsonResponse({ token, user: pub });
    }

    // Authenticated routes
    const authUser = await this.authenticate(request, state);
    if (!authUser) {
      return jsonResponse({ error: 'Authentication required' }, 401);
    }

    if (pathname === '/api/auth/me' && request.method === 'GET') {
      return jsonResponse({ user: authUser });
    }

    if (pathname === '/api/state' && request.method === 'GET') {
      return jsonResponse(filterSnapshotForRole(state, authUser.role));
    }

    const parseBody = async <T = Record<string, unknown>>(): Promise<T> => {
      return (await request.json().catch(() => ({}))) as T;
    };

    // --- OPEN ORDER ---
    if (pathname === '/api/orders/open' && request.method === 'POST') {
      const { orderType, tableId } = await parseBody<{ orderType?: string; tableId?: string }>();
      if (orderType !== 'dine_in' && orderType !== 'takeaway') {
        return jsonResponse({ error: 'Invalid orderType' }, 400);
      }
      try {
        const order = await this.mutate((draft) => {
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
            const nextOrder: Order = {
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
              createdBy: authUser.id,
              createdByName: authUser.name,
            };
            draft.orders.unshift(nextOrder);
            table.activeOrderId = nextOrder.id;
            addAudit(draft, authUser, 'ORDER_OPENED', `Opened ${table.label}`, 'order', nextOrder.id);
            return nextOrder;
          } else {
            const tokenNumber = draft.nextTokenSeq++;
            const nextOrder: Order = {
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
              createdBy: authUser.id,
              createdByName: authUser.name,
            };
            draft.orders.unshift(nextOrder);
            addAudit(draft, authUser, 'TAKEAWAY_OPENED', `Opened Takeaway #${tokenNumber}`, 'order', nextOrder.id);
            return nextOrder;
          }
        });
        this.broadcast('orders:updated', { orderId: order.id });
        return jsonResponse({ order, state: buildPublicSnapshot(this.stateCache!) });
      } catch (err) {
        return jsonResponse({ error: err instanceof Error ? err.message : 'Failed to open order' }, 400);
      }
    }

    // --- ORDER ITEMS ---
    const itemsMatch = pathname.match(/^\/api\/orders\/([^/]+)\/items$/);
    if (itemsMatch && request.method === 'POST') {
      const orderId = decodeURIComponent(itemsMatch[1]);
      const { action, menuItemId, itemId, delta, addons, notes } = await parseBody<{
        action?: string;
        menuItemId?: string;
        itemId?: string;
        delta?: number;
        addons?: { id: string; name: string; price: number }[];
        notes?: string;
      }>();
      try {
        const updatedOrder = await this.mutate((draft) => {
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
              .map((a) => a.id)
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
            addAudit(draft, authUser, 'ITEM_ADDED', `Added ${menuItem.name} to ${order.tableLabel}`, 'order', order.id);
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
        this.broadcast('orders:updated', { orderId: updatedOrder.id });
        return jsonResponse({ order: updatedOrder, state: buildPublicSnapshot(this.stateCache!) });
      } catch (err) {
        return jsonResponse({ error: err instanceof Error ? err.message : 'Failed to update items' }, 400);
      }
    }

    // --- DISCOUNT (Owner / Cashier) ---
    const discountMatch = pathname.match(/^\/api\/orders\/([^/]+)\/discount$/);
    if (discountMatch && request.method === 'POST') {
      if (authUser.role !== 'owner' && authUser.role !== 'cashier') {
        return jsonResponse({ error: `Permission denied for role: ${authUser.role}` }, 403);
      }
      const orderId = decodeURIComponent(discountMatch[1]);
      const { discountType, discountValue } = await parseBody<{
        discountType?: string;
        discountValue?: number;
      }>();
      if (discountType !== 'flat' && discountType !== 'percent') {
        return jsonResponse({ error: 'Invalid discountType' }, 400);
      }
      const val = Number(discountValue);
      if (!Number.isFinite(val) || val < 0) {
        return jsonResponse({ error: 'Invalid discountValue' }, 400);
      }
      try {
        const order = await this.mutate((draft) => {
          const ord = draft.orders.find((o) => o.id === orderId && o.status === 'open');
          if (!ord) throw new Error('Open order not found');
          ord.discountType = discountType as DiscountType;
          ord.discountValue = discountType === 'percent' ? Math.min(100, val) : val;
          ord.updatedAt = new Date().toISOString();
          addAudit(
            draft,
            authUser,
            'DISCOUNT_APPLIED',
            `Applied ${discountType === 'percent' ? `${ord.discountValue}%` : `Rs.${ord.discountValue}`} discount on ${ord.tableLabel}`,
            'order',
            ord.id
          );
          return ord;
        });
        this.broadcast('orders:updated', { orderId: order.id });
        return jsonResponse({ order, state: buildPublicSnapshot(this.stateCache!) });
      } catch (err) {
        return jsonResponse({ error: err instanceof Error ? err.message : 'Discount failed' }, 400);
      }
    }

    // --- SEND KOT ---
    const kotMatch = pathname.match(/^\/api\/orders\/([^/]+)\/kot$/);
    if (kotMatch && request.method === 'POST') {
      const orderId = decodeURIComponent(kotMatch[1]);
      try {
        const kot = await this.mutate((draft) => {
          const ord = draft.orders.find((o) => o.id === orderId && o.status === 'open');
          if (!ord) throw new Error('Open order not found');
          const unsentItems = ord.items.filter((it) => it.qty > it.sentQty);
          if (unsentItems.length === 0) throw new Error('No new items to send to kitchen');
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
            createdByName: authUser.name,
          };
          for (const it of unsentItems) it.sentQty = it.qty;
          ord.updatedAt = now;
          draft.kots.unshift(ticket);
          addAudit(draft, authUser, 'KOT_SENT', `Sent KOT #${kotNumber} for ${ord.tableLabel}`, 'kot', ticket.id);
          return ticket;
        });
        this.broadcast('kots:updated', { kotId: kot.id });
        return jsonResponse({ kot, state: buildPublicSnapshot(this.stateCache!) });
      } catch (err) {
        return jsonResponse({ error: err instanceof Error ? err.message : 'KOT failed' }, 400);
      }
    }

    // --- KOT STATUS ---
    const kotStatusMatch = pathname.match(/^\/api\/kots\/([^/]+)\/status$/);
    if (kotStatusMatch && request.method === 'PATCH') {
      const kotId = decodeURIComponent(kotStatusMatch[1]);
      const { status } = await parseBody<{ status?: string }>();
      if (status !== 'new' && status !== 'preparing' && status !== 'ready') {
        return jsonResponse({ error: 'Invalid KOT status' }, 400);
      }
      try {
        const kot = await this.mutate((draft) => {
          const found = draft.kots.find((k) => k.id === kotId);
          if (!found) throw new Error('KOT ticket not found');
          found.status = status as KotStatus;
          found.updatedAt = new Date().toISOString();
          addAudit(draft, authUser, 'KOT_STATUS', `KOT #${found.kotNumber} -> ${status}`, 'kot', found.id);
          return found;
        });
        this.broadcast('kots:updated', { kotId: kot.id });
        return jsonResponse({ kot, state: buildPublicSnapshot(this.stateCache!) });
      } catch (err) {
        return jsonResponse({ error: err instanceof Error ? err.message : 'KOT update failed' }, 400);
      }
    }

    // --- VOID ITEM (Owner PIN) ---
    const voidItemMatch = pathname.match(/^\/api\/orders\/([^/]+)\/void-item$/);
    if (voidItemMatch && request.method === 'POST') {
      const orderId = decodeURIComponent(voidItemMatch[1]);
      const { itemId, qtyToVoid, reason, ownerPin } = await parseBody<{
        itemId?: string;
        qtyToVoid?: number;
        reason?: string;
        ownerPin?: string;
      }>();
      if (typeof reason !== 'string' || reason.trim().length < 3) {
        return jsonResponse({ error: 'Void reason (at least 3 chars) is required' }, 400);
      }
      if (!ownerPin || !(await verifySecret(ownerPin.trim(), state.ownerPinHash))) {
        return jsonResponse({ error: 'Invalid Owner PIN' }, 403);
      }
      try {
        const order = await this.mutate((draft) => {
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
            authUser,
            'ITEM_VOIDED',
            `Voided ${voidCount}x ${line.name} on ${ord.tableLabel}. Reason: ${reason.trim()}`,
            'order',
            ord.id
          );
          return ord;
        });
        this.broadcast('orders:updated', { orderId: order.id });
        return jsonResponse({ order, state: buildPublicSnapshot(this.stateCache!) });
      } catch (err) {
        return jsonResponse({ error: err instanceof Error ? err.message : 'Void item failed' }, 400);
      }
    }

    // --- VOID ORDER (Owner PIN) ---
    const voidOrderMatch = pathname.match(/^\/api\/orders\/([^/]+)\/void-order$/);
    if (voidOrderMatch && request.method === 'POST') {
      const orderId = decodeURIComponent(voidOrderMatch[1]);
      const { reason, ownerPin } = await parseBody<{ reason?: string; ownerPin?: string }>();
      if (typeof reason !== 'string' || reason.trim().length < 3) {
        return jsonResponse({ error: 'Void reason is required' }, 400);
      }
      if (!ownerPin || !(await verifySecret(ownerPin.trim(), state.ownerPinHash))) {
        return jsonResponse({ error: 'Invalid Owner PIN' }, 403);
      }
      try {
        await this.mutate((draft) => {
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
            authUser,
            'ORDER_VOIDED',
            `Voided open order ${ord.tableLabel}. Reason: ${reason.trim()}`,
            'order',
            ord.id
          );
        });
        this.broadcast('orders:updated', { orderId });
        return jsonResponse({ state: buildPublicSnapshot(this.stateCache!) });
      } catch (err) {
        return jsonResponse({ error: err instanceof Error ? err.message : 'Void order failed' }, 400);
      }
    }

    // --- SHIFT TABLE ---
    if (pathname === '/api/tables/shift' && request.method === 'POST') {
      const { fromTableId, toTableId } = await parseBody<{ fromTableId?: string; toTableId?: string }>();
      if (!fromTableId || !toTableId || fromTableId === toTableId) {
        return jsonResponse({ error: 'Select two distinct tables' }, 400);
      }
      try {
        await this.mutate((draft) => {
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
            for (const k of draft.kots) if (k.orderId === fromOrd.id) k.tableLabel = toT.label;
            addAudit(draft, authUser, 'TABLE_SHIFTED', `Shifted ${fromT.label} -> ${toT.label}`, 'table', toT.id);
          } else {
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
            addAudit(draft, authUser, 'TABLE_MERGED', `Merged ${fromT.label} into ${toT.label}`, 'table', toT.id);
          }
        });
        this.broadcast('tables:updated');
        return jsonResponse({ state: buildPublicSnapshot(this.stateCache!) });
      } catch (err) {
        return jsonResponse({ error: err instanceof Error ? err.message : 'Shift failed' }, 400);
      }
    }

    // --- SWAP TABLES ---
    if (pathname === '/api/tables/swap' && request.method === 'POST') {
      const { tableAId, tableBId } = await parseBody<{ tableAId?: string; tableBId?: string }>();
      if (!tableAId || !tableBId || tableAId === tableBId) {
        return jsonResponse({ error: 'Select two distinct tables' }, 400);
      }
      try {
        await this.mutate((draft) => {
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
          addAudit(draft, authUser, 'TABLE_SWAPPED', `Swapped ${tA.label} <-> ${tB.label}`, 'table', tA.id);
        });
        this.broadcast('tables:updated');
        return jsonResponse({ state: buildPublicSnapshot(this.stateCache!) });
      } catch (err) {
        return jsonResponse({ error: err instanceof Error ? err.message : 'Swap failed' }, 400);
      }
    }

    // --- CLOSE BILL (Owner / Cashier) ---
    const closeBillMatch = pathname.match(/^\/api\/orders\/([^/]+)\/close-bill$/);
    if (closeBillMatch && request.method === 'POST') {
      if (authUser.role !== 'owner' && authUser.role !== 'cashier') {
        return jsonResponse({ error: `Permission denied for role: ${authUser.role}` }, 403);
      }
      const orderId = decodeURIComponent(closeBillMatch[1]);
      const { payments } = await parseBody<{ payments?: { mode: string; amount: number }[] }>();
      if (!Array.isArray(payments) || payments.length === 0) {
        return jsonResponse({ error: 'At least one payment entry is required' }, 400);
      }
      try {
        const bill = await this.mutate((draft) => {
          const ord = draft.orders.find((o) => o.id === orderId && o.status === 'open');
          if (!ord) throw new Error('Open order not found');
          const activeItems = ord.items.filter((it) => it.qty > 0);
          if (activeItems.length === 0) throw new Error('Cannot close an empty order');
          const totals = calculateOrderTotals(activeItems, ord.discountType, ord.discountValue, draft.settings.gstRate);
          const cleanPayments: PaymentEntry[] = payments.map((p) => ({
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
            closedBy: authUser.id,
            closedByName: authUser.name,
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
            authUser,
            'BILL_CLOSED',
            `Closed ${billNumber} (${ord.tableLabel}) for Rs.${totals.grandTotal}`,
            'bill',
            newBill.id
          );
          return newBill;
        });
        this.broadcast('bills:created', { billId: bill.id });
        return jsonResponse({ bill, state: buildPublicSnapshot(this.stateCache!) });
      } catch (err) {
        return jsonResponse({ error: err instanceof Error ? err.message : 'Failed to close bill' }, 400);
      }
    }

    // --- SPLIT BILL (Owner / Cashier) ---
    const splitBillMatch = pathname.match(/^\/api\/orders\/([^/]+)\/split-bill$/);
    if (splitBillMatch && request.method === 'POST') {
      if (authUser.role !== 'owner' && authUser.role !== 'cashier') {
        return jsonResponse({ error: `Permission denied for role: ${authUser.role}` }, 403);
      }
      const orderId = decodeURIComponent(splitBillMatch[1]);
      const { mode, itemQtys, payments, peopleCount, splitModes } = await parseBody<{
        mode?: string;
        itemQtys?: Record<string, number>;
        payments?: { mode: string; amount: number }[];
        peopleCount?: number;
        splitModes?: PaymentEntry['mode'][];
      }>();

      try {
        const createdBills = await this.mutate((draft) => {
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
            const cleanPayments: PaymentEntry[] = (payments || []).map((p) => ({
              mode: p.mode as PaymentEntry['mode'],
              amount: round2(Number(p.amount) || 0),
            }));
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
              closedBy: authUser.id,
              closedByName: authUser.name,
            };
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
            addAudit(draft, authUser, 'BILL_SPLIT_ITEMS', `Partial item split ${billNumber} on ${ord.tableLabel}`, 'bill', bill.id);
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
                closedBy: authUser.id,
                closedByName: authUser.name,
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
            addAudit(draft, authUser, 'BILL_SPLIT_EQUAL', `Split ${ord.tableLabel} equally ${count} ways`, 'order', ord.id);
            return outBills;
          }

          throw new Error('Invalid split mode');
        });

        this.broadcast('bills:created');
        return jsonResponse({ bills: createdBills, state: buildPublicSnapshot(this.stateCache!) });
      } catch (err) {
        return jsonResponse({ error: err instanceof Error ? err.message : 'Split bill failed' }, 400);
      }
    }

    // --- VOID CLOSED BILL (Owner only + PIN) ---
    const voidBillMatch = pathname.match(/^\/api\/bills\/([^/]+)\/void$/);
    if (voidBillMatch && request.method === 'POST') {
      if (authUser.role !== 'owner') {
        return jsonResponse({ error: `Permission denied for role: ${authUser.role}` }, 403);
      }
      const billId = decodeURIComponent(voidBillMatch[1]);
      const { reason, ownerPin } = await parseBody<{ reason?: string; ownerPin?: string }>();
      if (typeof reason !== 'string' || reason.trim().length < 3) {
        return jsonResponse({ error: 'Void reason is required' }, 400);
      }
      if (!ownerPin || !(await verifySecret(ownerPin.trim(), state.ownerPinHash))) {
        return jsonResponse({ error: 'Invalid Owner PIN' }, 403);
      }
      try {
        const bill = await this.mutate((draft) => {
          const found = draft.bills.find((b) => b.id === billId);
          if (!found) throw new Error('Bill not found');
          if (found.status === 'voided') throw new Error('Bill is already voided');
          found.status = 'voided';
          found.voidReason = reason.trim();
          found.voidedAt = new Date().toISOString();
          found.voidedByName = authUser.name;
          addAudit(
            draft,
            authUser,
            'BILL_VOIDED',
            `Voided closed bill ${found.billNumber} (Rs.${found.grandTotal}). Reason: ${reason.trim()}`,
            'bill',
            found.id
          );
          return found;
        });
        this.broadcast('bills:updated', { billId: bill.id });
        return jsonResponse({ bill, state: buildPublicSnapshot(this.stateCache!) });
      } catch (err) {
        return jsonResponse({ error: err instanceof Error ? err.message : 'Void bill failed' }, 400);
      }
    }

    // --- DAY OPEN / CLOSE ---
    if (pathname === '/api/day/open' && request.method === 'POST') {
      if (authUser.role !== 'owner' && authUser.role !== 'cashier') {
        return jsonResponse({ error: `Permission denied for role: ${authUser.role}` }, 403);
      }
      const body = await parseBody<{ openingCash?: number }>();
      const openingCash = round2(Number(body.openingCash) || 0);
      if (openingCash < 0) return jsonResponse({ error: 'Opening cash cannot be negative' }, 400);
      try {
        const session = await this.mutate((draft) => {
          const existingOpen = draft.daySessions.find((d) => d.status === 'open');
          if (existingOpen) throw new Error('A day register is already open');
          const s = {
            id: uid('day'),
            date: todayDateStr(),
            status: 'open' as const,
            openingCash,
            expectedCash: openingCash,
            countedCash: null,
            cashDifference: null,
            openedByName: authUser.name,
            openedAt: new Date().toISOString(),
          };
          draft.daySessions.unshift(s);
          addAudit(draft, authUser, 'DAY_OPENED', `Opened register with Rs.${openingCash}`, 'day', s.id);
          return s;
        });
        this.broadcast('day:updated');
        return jsonResponse({ session, state: buildPublicSnapshot(this.stateCache!) });
      } catch (err) {
        return jsonResponse({ error: err instanceof Error ? err.message : 'Failed to open day' }, 400);
      }
    }

    if (pathname === '/api/day/close' && request.method === 'POST') {
      if (authUser.role !== 'owner' && authUser.role !== 'cashier') {
        return jsonResponse({ error: `Permission denied for role: ${authUser.role}` }, 403);
      }
      const body = await parseBody<{ countedCash?: number; notes?: string }>();
      const countedCash = round2(Number(body.countedCash));
      const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
      if (!Number.isFinite(countedCash) || countedCash < 0) {
        return jsonResponse({ error: 'Valid countedCash is required' }, 400);
      }
      try {
        const session = await this.mutate((draft) => {
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
          openSess.closedByName = authUser.name;
          openSess.closedAt = new Date().toISOString();
          openSess.notes = notes;
          addAudit(
            draft,
            authUser,
            'DAY_CLOSED',
            `Closed register. Expected Rs.${expectedCash}, Counted Rs.${countedCash}, Diff Rs.${openSess.cashDifference}`,
            'day',
            openSess.id
          );
          return openSess;
        });
        this.broadcast('day:updated');
        return jsonResponse({ session, state: buildPublicSnapshot(this.stateCache!) });
      } catch (err) {
        return jsonResponse({ error: err instanceof Error ? err.message : 'Failed to close day' }, 400);
      }
    }

    // --- MENU (Owner only) ---
    if (pathname === '/api/menu' && request.method === 'POST') {
      if (authUser.role !== 'owner') {
        return jsonResponse({ error: `Permission denied for role: ${authUser.role}` }, 403);
      }
      const { name, category, price, taxPercent, soldOut, addons, recipe, defaultNotes } = await parseBody<{
        name?: string;
        category?: string;
        price?: number;
        taxPercent?: number;
        soldOut?: boolean;
        addons?: FullDbState['menu'][0]['addons'];
        recipe?: FullDbState['menu'][0]['recipe'];
        defaultNotes?: string;
      }>();
      if (typeof name !== 'string' || !name.trim() || typeof category !== 'string' || !category.trim()) {
        return jsonResponse({ error: 'Name and category are required' }, 400);
      }
      const numPrice = round2(Number(price) || 0);
      const numTax = Number.isFinite(Number(taxPercent)) ? Number(taxPercent) : state.settings.gstRate;
      const item = await this.mutate((draft) => {
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
        addAudit(draft, authUser, 'MENU_ADDED', `Added menu item ${next.name} (Rs.${next.price})`, 'menu', next.id);
        return next;
      });
      this.broadcast('menu:updated');
      return jsonResponse({ item, state: buildPublicSnapshot(this.stateCache!) });
    }

    const menuItemMatch = pathname.match(/^\/api\/menu\/([^/]+)$/);
    if (menuItemMatch && request.method === 'PATCH') {
      if (authUser.role !== 'owner') {
        return jsonResponse({ error: `Permission denied for role: ${authUser.role}` }, 403);
      }
      const id = decodeURIComponent(menuItemMatch[1]);
      const patch = await parseBody<Record<string, unknown>>();
      try {
        const item = await this.mutate((draft) => {
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
          addAudit(
            draft,
            authUser,
            'MENU_UPDATED',
            `Updated menu item ${found.name} (Rs.${found.price}, soldOut=${found.soldOut})`,
            'menu',
            found.id
          );
          return found;
        });
        this.broadcast('menu:updated');
        return jsonResponse({ item, state: buildPublicSnapshot(this.stateCache!) });
      } catch (err) {
        return jsonResponse({ error: err instanceof Error ? err.message : 'Menu update failed' }, 400);
      }
    }

    if (menuItemMatch && request.method === 'DELETE') {
      if (authUser.role !== 'owner') {
        return jsonResponse({ error: `Permission denied for role: ${authUser.role}` }, 403);
      }
      const id = decodeURIComponent(menuItemMatch[1]);
      await this.mutate((draft) => {
        const found = draft.menu.find((m) => m.id === id);
        draft.menu = draft.menu.filter((m) => m.id !== id);
        if (found) addAudit(draft, authUser, 'MENU_DELETED', `Deleted menu item ${found.name}`, 'menu', id);
      });
      this.broadcast('menu:updated');
      return jsonResponse({ state: buildPublicSnapshot(this.stateCache!) });
    }

    // --- EXPENSES ---
    if (pathname === '/api/expenses' && request.method === 'POST') {
      if (authUser.role !== 'owner' && authUser.role !== 'cashier') {
        return jsonResponse({ error: `Permission denied for role: ${authUser.role}` }, 403);
      }
      const { date, category, description, amount, paymentMode } = await parseBody<{
        date?: string;
        category?: string;
        description?: string;
        amount?: number;
        paymentMode?: string;
      }>();
      const numAmt = round2(Number(amount));
      if (!category || !Number.isFinite(numAmt) || numAmt <= 0) {
        return jsonResponse({ error: 'Category and positive amount are required' }, 400);
      }
      const exp = await this.mutate((draft) => {
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
          createdByName: authUser.name,
          createdAt: new Date().toISOString(),
        };
        draft.expenses.unshift(entry);
        addAudit(draft, authUser, 'EXPENSE_LOGGED', `Logged expense ${entry.category}: Rs.${entry.amount}`, 'expense', entry.id);
        return entry;
      });
      this.broadcast('expenses:updated');
      return jsonResponse({ expense: exp, state: buildPublicSnapshot(this.stateCache!) });
    }

    const expenseMatch = pathname.match(/^\/api\/expenses\/([^/]+)$/);
    if (expenseMatch && request.method === 'DELETE') {
      if (authUser.role !== 'owner') {
        return jsonResponse({ error: `Permission denied for role: ${authUser.role}` }, 403);
      }
      const id = decodeURIComponent(expenseMatch[1]);
      await this.mutate((draft) => {
        const found = draft.expenses.find((e) => e.id === id);
        draft.expenses = draft.expenses.filter((e) => e.id !== id);
        if (found) addAudit(draft, authUser, 'EXPENSE_DELETED', `Deleted expense ${found.category} Rs.${found.amount}`, 'expense', id);
      });
      this.broadcast('expenses:updated');
      return jsonResponse({ state: buildPublicSnapshot(this.stateCache!) });
    }

    // --- INVENTORY & PURCHASES ---
    if (pathname === '/api/inventory' && request.method === 'POST') {
      if (authUser.role !== 'owner') {
        return jsonResponse({ error: `Permission denied for role: ${authUser.role}` }, 403);
      }
      const { name, unit, stock, minStock, costPerUnit } = await parseBody<Record<string, unknown>>();
      if (!name || !unit) return jsonResponse({ error: 'Ingredient name and unit are required' }, 400);
      const ing = await this.mutate((draft) => {
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
        addAudit(draft, authUser, 'INGREDIENT_ADDED', `Added ingredient ${entry.name}`, 'inventory', entry.id);
        return entry;
      });
      this.broadcast('inventory:updated');
      return jsonResponse({ ingredient: ing, state: buildPublicSnapshot(this.stateCache!) });
    }

    const invMatch = pathname.match(/^\/api\/inventory\/([^/]+)$/);
    if (invMatch && invMatch[1] !== 'purchase' && request.method === 'PATCH') {
      if (authUser.role !== 'owner') {
        return jsonResponse({ error: `Permission denied for role: ${authUser.role}` }, 403);
      }
      const id = decodeURIComponent(invMatch[1]);
      const patch = await parseBody<Record<string, unknown>>();
      try {
        const ing = await this.mutate((draft) => {
          const found = draft.inventory.find((i) => i.id === id);
          if (!found) throw new Error('Ingredient not found');
          if (patch.stock !== undefined) found.stock = round2(Number(patch.stock));
          if (patch.minStock !== undefined) found.minStock = round2(Number(patch.minStock));
          if (patch.costPerUnit !== undefined) found.costPerUnit = round2(Number(patch.costPerUnit));
          if (typeof patch.name === 'string' && patch.name.trim()) found.name = patch.name.trim();
          found.updatedAt = new Date().toISOString();
          addAudit(
            draft,
            authUser,
            'INGREDIENT_UPDATED',
            `Updated stock for ${found.name} -> ${found.stock} ${found.unit}`,
            'inventory',
            found.id
          );
          return found;
        });
        this.broadcast('inventory:updated');
        return jsonResponse({ ingredient: ing, state: buildPublicSnapshot(this.stateCache!) });
      } catch (err) {
        return jsonResponse({ error: err instanceof Error ? err.message : 'Update failed' }, 400);
      }
    }

    if (pathname === '/api/inventory/purchase' && request.method === 'POST') {
      if (authUser.role !== 'owner' && authUser.role !== 'cashier') {
        return jsonResponse({ error: `Permission denied for role: ${authUser.role}` }, 403);
      }
      const { ingredientId, quantity, totalCost, supplier, date } = await parseBody<{
        ingredientId?: string;
        quantity?: number;
        totalCost?: number;
        supplier?: string;
        date?: string;
      }>();
      const qty = round2(Number(quantity));
      const cost = round2(Number(totalCost) || 0);
      if (!ingredientId || !Number.isFinite(qty) || qty <= 0) {
        return jsonResponse({ error: 'Ingredient and positive quantity are required' }, 400);
      }
      try {
        const purchase = await this.mutate((draft) => {
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
            createdByName: authUser.name,
            createdAt: now,
          };
          draft.purchases.unshift(entry);
          addAudit(
            draft,
            authUser,
            'STOCK_PURCHASED',
            `Added +${qty} ${ing.unit} of ${ing.name} (Rs.${cost})`,
            'purchase',
            entry.id
          );
          return entry;
        });
        this.broadcast('inventory:updated');
        return jsonResponse({ purchase, state: buildPublicSnapshot(this.stateCache!) });
      } catch (err) {
        return jsonResponse({ error: err instanceof Error ? err.message : 'Purchase failed' }, 400);
      }
    }

    // --- USERS (Owner only) ---
    if (pathname === '/api/users' && request.method === 'POST') {
      if (authUser.role !== 'owner') {
        return jsonResponse({ error: `Permission denied for role: ${authUser.role}` }, 403);
      }
      const { username, name, password, role } = await parseBody<{
        username?: string;
        name?: string;
        password?: string;
        role?: string;
      }>();
      if (
        typeof username !== 'string' ||
        username.trim().length < 2 ||
        typeof name !== 'string' ||
        !name.trim() ||
        typeof password !== 'string' ||
        password.length < 4 ||
        (role !== 'owner' && role !== 'cashier' && role !== 'waiter')
      ) {
        return jsonResponse(
          { error: 'Valid username, name, password (min 4 chars), and role are required' },
          400
        );
      }
      try {
        const passwordHash = await hashSecret(password);
        const created = await this.mutate((draft) => {
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
            passwordHash,
          };
          draft.users.push(rec);
          addAudit(draft, authUser, 'USER_CREATED', `Created ${rec.role} account: ${rec.username}`, 'user', rec.id);
          const { passwordHash: _ph, ...pub } = rec;
          return pub;
        });
        this.broadcast('users:updated');
        return jsonResponse({ user: created, state: buildPublicSnapshot(this.stateCache!) });
      } catch (err) {
        return jsonResponse({ error: err instanceof Error ? err.message : 'Create user failed' }, 400);
      }
    }

    const userMatch = pathname.match(/^\/api\/users\/([^/]+)$/);
    if (userMatch && request.method === 'PATCH') {
      if (authUser.role !== 'owner') {
        return jsonResponse({ error: `Permission denied for role: ${authUser.role}` }, 403);
      }
      const id = decodeURIComponent(userMatch[1]);
      const { name, role, active, password } = await parseBody<{
        name?: string;
        role?: string;
        active?: boolean;
        password?: string;
      }>();
      try {
        const nextHash = typeof password === 'string' && password.length >= 4 ? await hashSecret(password) : null;
        await this.mutate((draft) => {
          const user = draft.users.find((u) => u.id === id);
          if (!user) throw new Error('User not found');
          if (user.id === authUser.id && active === false) {
            throw new Error('Cannot deactivate your own active owner account');
          }
          if (typeof name === 'string' && name.trim()) user.name = name.trim();
          if (role === 'owner' || role === 'cashier' || role === 'waiter') user.role = role;
          if (typeof active === 'boolean') user.active = active;
          if (nextHash) user.passwordHash = nextHash;
          addAudit(draft, authUser, 'USER_UPDATED', `Updated account ${user.username}`, 'user', user.id);
        });
        this.broadcast('users:updated');
        return jsonResponse({ state: buildPublicSnapshot(this.stateCache!) });
      } catch (err) {
        return jsonResponse({ error: err instanceof Error ? err.message : 'Update user failed' }, 400);
      }
    }

    // --- SETTINGS (Owner only) ---
    if (pathname === '/api/settings' && request.method === 'PATCH') {
      if (authUser.role !== 'owner') {
        return jsonResponse({ error: `Permission denied for role: ${authUser.role}` }, 403);
      }
      const patch = await parseBody<Record<string, unknown>>();
      try {
        const nextPinHash =
          typeof patch.newOwnerPin === 'string' && patch.newOwnerPin.trim().length >= 4
            ? await hashSecret(patch.newOwnerPin.trim())
            : null;
        await this.mutate((draft) => {
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
          if (nextPinHash) draft.ownerPinHash = nextPinHash;

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
          addAudit(draft, authUser, 'SETTINGS_UPDATED', 'Updated cafe settings', 'settings', 'main');
        });
        this.broadcast('settings:updated');
        return jsonResponse({ state: buildPublicSnapshot(this.stateCache!) });
      } catch (err) {
        return jsonResponse({ error: err instanceof Error ? err.message : 'Settings update failed' }, 400);
      }
    }

    // --- BACKUPS & RESTORE (Cloudflare R2 + D1, Owner only) ---
    if (pathname === '/api/backups/run' && request.method === 'POST') {
      if (authUser.role !== 'owner') {
        return jsonResponse({ error: `Permission denied for role: ${authUser.role}` }, 403);
      }
      const meta = await this.mutate(async (draft) => {
        const created = await saveBackupToR2(this.env.BACKUPS_BUCKET, draft, 'manual');
        draft.backups = [created, ...draft.backups].slice(0, 30);
        addAudit(draft, authUser, 'BACKUP_CREATED', `Saved R2 backup ${created.id}`, 'backup', created.id);
        return created;
      });
      this.broadcast('backups:updated');
      return jsonResponse({ backup: meta, state: buildPublicSnapshot(this.stateCache!) });
    }

    if (pathname === '/api/backups/export' && request.method === 'GET') {
      if (authUser.role !== 'owner') {
        return jsonResponse({ error: `Permission denied for role: ${authUser.role}` }, 403);
      }
      const id = url.searchParams.get('id');
      if (id) {
        const meta = state.backups.find((b) => b.id === id);
        const r2Key = meta?.r2Key || `backups/${id}.json`;
        const obj = await this.env.BACKUPS_BUCKET.get(r2Key);
        if (!obj) {
          return jsonResponse({ error: 'Backup not found in Cloudflare R2' }, 404);
        }
        return new Response(obj.body, {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Content-Disposition': `attachment; filename="brewdesk-backup-${id}.json"`,
          },
        });
      }
      return new Response(JSON.stringify(state, null, 2), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="brewdesk-backup-${todayDateStr()}.json"`,
        },
      });
    }

    if (pathname === '/api/backups/restore' && request.method === 'POST') {
      if (authUser.role !== 'owner') {
        return jsonResponse({ error: `Permission denied for role: ${authUser.role}` }, 403);
      }
      const body = await parseBody<{ backup?: FullDbState }>();
      const payload = body.backup;
      if (
        !payload ||
        !payload.settings ||
        !Array.isArray(payload.menu) ||
        !Array.isArray(payload.tables) ||
        !Array.isArray(payload.users)
      ) {
        return jsonResponse({ error: 'Invalid backup JSON file structure' }, 400);
      }
      await this.mutate((draft) => {
        Object.assign(draft, payload);
        addAudit(draft, authUser, 'BACKUP_RESTORED', 'Restored full D1 database from JSON backup', 'backup', 'restore');
      });
      this.broadcast('state:restored');
      return jsonResponse({ state: buildPublicSnapshot(this.stateCache!) });
    }

    return jsonResponse({ error: 'Not found' }, 404);
  }
}
