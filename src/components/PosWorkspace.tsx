import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  ArrowRight,
  Clock,
  Minus,
  Percent,
  Plus,
  Search,
  Send,
  ShoppingBag,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import type {
  AddonOption,
  Bill,
  CafeSettings,
  DiscountType,
  KotTicket,
  MenuItem,
  Order,
  OrderItem,
  PaymentEntry,
  PaymentMode,
  Role,
  TableInfo,
} from '../shared/types';
import {
  calculateOrderTotals,
  formatCurrency,
  formatElapsed,
  getLineUnitPrice,
} from '../shared/calculations';
import { PaymentModal } from './PaymentModal';
import { CustomizeItemModal, ShiftSwapModal, VoidPinModal } from './TableActionsModal';

interface PosWorkspaceProps {
  role: Role;
  settings: CafeSettings;
  menu: MenuItem[];
  tables: TableInfo[];
  orders: Order[];
  selectedOrderId: string | null;
  onSelectOrderId: (id: string | null) => void;
  onMutate: <T>(opts: {
    method: 'POST' | 'PATCH' | 'DELETE';
    path: string;
    body?: unknown;
    label: string;
    optimistic?: () => void;
  }) => Promise<T | null>;
  onBillCreated: (bill: Bill) => void;
  onKotCreated: (kot: KotTicket) => void;
  onNavigateToMenuSettings?: () => void;
}

export const PosWorkspace: React.FC<PosWorkspaceProps> = ({
  role,
  settings,
  menu,
  tables,
  orders,
  selectedOrderId,
  onSelectOrderId,
  onMutate,
  onBillCreated,
  onKotCreated,
  onNavigateToMenuSettings,
}) => {
  const [activeCategory, setActiveCategory] = useState<string>('All');
  const [search, setSearch] = useState('');
  const [mobilePane, setMobilePane] = useState<'tables' | 'menu' | 'ticket'>('tables');
  const [nowMs, setNowMs] = useState(Date.now());
  const [feedbackErr, setFeedbackErr] = useState('');

  const [showPayment, setShowPayment] = useState(false);
  const [shiftSwapMode, setShiftSwapMode] = useState<'shift' | 'swap' | null>(null);
  const [voidItemTarget, setVoidItemTarget] = useState<OrderItem | null>(null);
  const [voidOrderTarget, setVoidOrderTarget] = useState<Order | null>(null);
  const [customizeMenuTarget, setCustomizeMenuTarget] = useState<MenuItem | null>(null);
  const [customizeLineTarget, setCustomizeLineTarget] = useState<OrderItem | null>(null);

  const [showDiscountBox, setShowDiscountBox] = useState(false);
  const [discType, setDiscType] = useState<DiscountType>('flat');
  const [discVal, setDiscVal] = useState('');

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);

  const openOrders = useMemo(() => orders.filter((o) => o.status === 'open'), [orders]);
  const openTakeaways = useMemo(
    () => openOrders.filter((o) => o.orderType === 'takeaway'),
    [openOrders]
  );

  const activeOrder = useMemo(
    () => openOrders.find((o) => o.id === selectedOrderId) || null,
    [openOrders, selectedOrderId]
  );

  const activeTable = useMemo(
    () => (activeOrder?.tableId ? tables.find((t) => t.id === activeOrder.tableId) || null : null),
    [activeOrder, tables]
  );

  const categories = useMemo(() => {
    const cats = Array.from(new Set(menu.map((m) => m.category)));
    return ['All', ...cats];
  }, [menu]);

  const filteredMenu = useMemo(() => {
    const q = search.trim().toLowerCase();
    return menu
      .filter((m) => (activeCategory === 'All' ? true : m.category === activeCategory))
      .filter((m) => (q ? m.name.toLowerCase().includes(q) || m.category.toLowerCase().includes(q) : true))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [menu, activeCategory, search]);

  const totals = useMemo(() => {
    if (!activeOrder) return null;
    return calculateOrderTotals(
      activeOrder.items,
      activeOrder.discountType,
      activeOrder.discountValue,
      settings.gstRate
    );
  }, [activeOrder, settings.gstRate]);

  const unsentCount = useMemo(() => {
    if (!activeOrder) return 0;
    return activeOrder.items.reduce((sum, it) => sum + Math.max(0, it.qty - it.sentQty), 0);
  }, [activeOrder]);

  const canBillOrDiscount = role === 'owner' || role === 'cashier';

  const handleSelectTable = async (table: TableInfo) => {
    setFeedbackErr('');
    if (table.activeOrderId) {
      onSelectOrderId(table.activeOrderId);
      setMobilePane('menu');
      return;
    }
    const res = await onMutate<{ order: Order }>({
      method: 'POST',
      path: '/api/orders/open',
      body: { orderType: 'dine_in', tableId: table.id },
      label: `Open ${table.label}`,
    });
    if (res?.order) {
      onSelectOrderId(res.order.id);
      setMobilePane('menu');
    }
  };

  const handleNewTakeaway = async () => {
    setFeedbackErr('');
    const res = await onMutate<{ order: Order }>({
      method: 'POST',
      path: '/api/orders/open',
      body: { orderType: 'takeaway' },
      label: 'New Takeaway Order',
    });
    if (res?.order) {
      onSelectOrderId(res.order.id);
      setMobilePane('menu');
    }
  };

  const handleAddItem = async (item: MenuItem, addons: AddonOption[] = [], notes = '') => {
    setFeedbackErr('');
    if (!activeOrder) {
      setFeedbackErr('Select a table or open a takeaway token first.');
      setMobilePane('tables');
      return;
    }
    if (item.soldOut) {
      setFeedbackErr(`${item.name} is sold out.`);
      return;
    }
    if (item.priceUnset || item.price <= 0) {
      setFeedbackErr(`Set the price for ${item.name} in Settings -> Menu first.`);
      return;
    }
    try {
      await onMutate({
        method: 'POST',
        path: `/api/orders/${activeOrder.id}/items`,
        body: { action: 'add', menuItemId: item.id, addons, notes },
        label: `Add ${item.name}`,
      });
    } catch (err) {
      setFeedbackErr(err instanceof Error ? err.message : 'Could not add item');
    }
  };

  const handleQtyChange = async (line: OrderItem, delta: number) => {
    if (!activeOrder) return;
    setFeedbackErr('');
    if (line.qty + delta < line.sentQty) {
      setVoidItemTarget(line);
      return;
    }
    try {
      await onMutate({
        method: 'POST',
        path: `/api/orders/${activeOrder.id}/items`,
        body: { action: 'qty', itemId: line.id, delta },
        label: `Qty ${delta > 0 ? '+' : ''}${delta} ${line.name}`,
      });
    } catch (err) {
      setFeedbackErr(err instanceof Error ? err.message : 'Failed to adjust quantity');
    }
  };

  const handleSendKot = async () => {
    if (!activeOrder) return;
    setFeedbackErr('');
    try {
      const res = await onMutate<{ kot: KotTicket }>({
        method: 'POST',
        path: `/api/orders/${activeOrder.id}/kot`,
        label: `Send KOT for ${activeOrder.tableLabel}`,
      });
      if (res?.kot) onKotCreated(res.kot);
    } catch (err) {
      setFeedbackErr(err instanceof Error ? err.message : 'Could not send KOT');
    }
  };

  const handleApplyDiscount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrder) return;
    setFeedbackErr('');
    try {
      await onMutate({
        method: 'POST',
        path: `/api/orders/${activeOrder.id}/discount`,
        body: { discountType: discType, discountValue: Number(discVal) || 0 },
        label: `Discount on ${activeOrder.tableLabel}`,
      });
      setShowDiscountBox(false);
    } catch (err) {
      setFeedbackErr(err instanceof Error ? err.message : 'Discount failed');
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Mobile Pane Switcher */}
      <div className="lg:hidden grid grid-cols-3 gap-1 p-2 bg-white border-b border-slate-200">
        <button
          type="button"
          onClick={() => setMobilePane('tables')}
          className={`py-2 text-xs font-semibold rounded-lg ${
            mobilePane === 'tables' ? 'bg-slate-900 text-white' : 'text-slate-600 bg-slate-100'
          }`}
        >
          Tables ({tables.filter((t) => t.activeOrderId).length})
        </button>
        <button
          type="button"
          onClick={() => setMobilePane('menu')}
          className={`py-2 text-xs font-semibold rounded-lg ${
            mobilePane === 'menu' ? 'bg-slate-900 text-white' : 'text-slate-600 bg-slate-100'
          }`}
        >
          Menu
        </button>
        <button
          type="button"
          onClick={() => setMobilePane('ticket')}
          className={`py-2 text-xs font-semibold rounded-lg ${
            mobilePane === 'ticket' ? 'bg-slate-900 text-white' : 'text-slate-600 bg-slate-100'
          }`}
        >
          Ticket {activeOrder ? `(${activeOrder.items.reduce((s, i) => s + i.qty, 0)})` : ''}
        </button>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 min-h-0 overflow-hidden">
        {/* LEFT PANE: Tables & Takeaway Tokens */}
        <section
          aria-label="Tables and takeaway orders"
          className={`${
            mobilePane === 'tables' ? 'flex' : 'hidden'
          } lg:flex lg:col-span-3 flex-col border-r border-slate-200 bg-white min-h-0 overflow-hidden`}
        >
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Floor Tables</h2>
              <p className="text-[11px] text-slate-500">
                {tables.filter((t) => !t.activeOrderId).length} free · {tables.filter((t) => t.activeOrderId).length} busy
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleNewTakeaway()}
              className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              Takeaway
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 gap-2.5">
              {tables.map((table) => {
                const order = table.activeOrderId
                  ? openOrders.find((o) => o.id === table.activeOrderId)
                  : undefined;
                const isSelected = Boolean(order && order.id === selectedOrderId);
                const tTotals = order
                  ? calculateOrderTotals(
                      order.items,
                      order.discountType,
                      order.discountValue,
                      settings.gstRate
                    )
                  : null;

                return (
                  <button
                    key={table.id}
                    type="button"
                    onClick={() => void handleSelectTable(table)}
                    className={`p-3 rounded-xl border text-left transition-all min-h-[82px] flex flex-col justify-between cursor-pointer ${
                      isSelected
                        ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                        : order
                        ? 'border-amber-300 bg-amber-50/70 text-slate-900 hover:bg-amber-50'
                        : 'border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className="text-sm font-bold">{table.label}</span>
                      {order ? (
                        <span
                          className={`text-[11px] font-mono inline-flex items-center gap-1 ${
                            isSelected ? 'text-amber-300' : 'text-amber-700'
                          }`}
                        >
                          <Clock className="w-3 h-3" />
                          {formatElapsed(order.createdAt, nowMs)}
                        </span>
                      ) : (
                        <span
                          className={`text-[11px] font-medium ${
                            isSelected ? 'text-slate-300' : 'text-emerald-600'
                          }`}
                        >
                          Free
                        </span>
                      )}
                    </div>

                    {order && tTotals ? (
                      <div className="mt-2">
                        <div className="text-sm font-mono font-bold tabular-nums">
                          {formatCurrency(tTotals.grandTotal)}
                        </div>
                        <div className={`text-[11px] ${isSelected ? 'text-slate-300' : 'text-slate-500'}`}>
                          {order.items.reduce((s, i) => s + i.qty, 0)} items
                        </div>
                      </div>
                    ) : (
                      <div className={`text-[11px] mt-2 ${isSelected ? 'text-slate-300' : 'text-slate-400'}`}>
                        Tap to open
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {openTakeaways.length > 0 && (
              <div className="pt-2 border-t border-slate-200">
                <h3 className="text-xs font-bold text-slate-700 mb-2">Active Takeaway Tokens</h3>
                <div className="space-y-2">
                  {openTakeaways.map((tk) => {
                    const isSelected = tk.id === selectedOrderId;
                    const tkTotals = calculateOrderTotals(
                      tk.items,
                      tk.discountType,
                      tk.discountValue,
                      settings.gstRate
                    );
                    return (
                      <button
                        key={tk.id}
                        type="button"
                        onClick={() => {
                          onSelectOrderId(tk.id);
                          setMobilePane('menu');
                        }}
                        className={`w-full p-2.5 rounded-xl border flex items-center justify-between text-left cursor-pointer ${
                          isSelected
                            ? 'border-slate-900 bg-slate-900 text-white'
                            : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-900'
                        }`}
                      >
                        <div>
                          <div className="text-xs font-bold">{tk.tableLabel}</div>
                          <div className={`text-[11px] ${isSelected ? 'text-slate-300' : 'text-slate-500'}`}>
                            {tk.items.reduce((s, i) => s + i.qty, 0)} items · {formatElapsed(tk.createdAt, nowMs)}
                          </div>
                        </div>
                        <div className="text-xs font-mono font-bold tabular-nums">
                          {formatCurrency(tkTotals.grandTotal)}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* CENTER PANE: Fast Menu Grid */}
        <section
          aria-label="Cafe menu"
          className={`${
            mobilePane === 'menu' ? 'flex' : 'hidden'
          } lg:flex lg:col-span-5 flex-col bg-slate-50 border-r border-slate-200 min-h-0 overflow-hidden`}
        >
          <div className="p-3 bg-white border-b border-slate-200 space-y-2.5">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search burgers, fries, coffee..."
                aria-label="Search menu items"
                className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-200 bg-slate-50 text-sm focus:bg-white focus:outline-none focus:border-slate-900"
              />
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setActiveCategory(cat)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    activeCategory === cat
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {feedbackErr && (
            <div role="alert" className="mx-3 mt-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs font-medium text-red-700">
              {feedbackErr}
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {filteredMenu.map((item) => {
                const needsPrice = Boolean(item.priceUnset || item.price <= 0);
                return (
                  <div
                    key={item.id}
                    className={`rounded-xl border bg-white flex flex-col justify-between transition-all ${
                      item.soldOut
                        ? 'border-slate-200 opacity-60'
                        : 'border-slate-200 hover:border-slate-400'
                    }`}
                  >
                    <button
                      type="button"
                      disabled={item.soldOut}
                      onClick={() => {
                        if (needsPrice && onNavigateToMenuSettings && role === 'owner') {
                          onNavigateToMenuSettings();
                          return;
                        }
                        void handleAddItem(item);
                      }}
                      className="p-3 text-left flex-1 flex flex-col justify-between cursor-pointer disabled:cursor-not-allowed"
                    >
                      <div>
                        <div className="text-[11px] font-medium text-slate-500">{item.category}</div>
                        <div className="text-sm font-bold text-slate-900 mt-0.5 leading-snug">
                          {item.name}
                        </div>
                      </div>

                      <div className="mt-3 flex items-center justify-between">
                        {item.soldOut ? (
                          <span className="text-xs font-bold text-red-600">Sold Out</span>
                        ) : needsPrice ? (
                          <span className="text-xs font-bold text-amber-700">
                            {role === 'owner' ? 'Set Price' : 'Price Unset'}
                          </span>
                        ) : (
                          <span className="text-sm font-mono font-bold text-slate-900 tabular-nums">
                            {formatCurrency(item.price)}
                          </span>
                        )}
                      </div>
                    </button>

                    <div className="px-3 py-1.5 border-t border-slate-100 flex justify-end min-h-[29px]">
                      {!item.soldOut && !needsPrice ? (
                        <button
                          type="button"
                          onClick={() => setCustomizeMenuTarget(item)}
                          aria-label={`Customize ${item.name}`}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-900 py-0.5 cursor-pointer"
                        >
                          <SlidersHorizontal className="w-3 h-3" />
                          Add-ons
                        </button>
                      ) : needsPrice && role === 'owner' && onNavigateToMenuSettings ? (
                        <button
                          type="button"
                          onClick={onNavigateToMenuSettings}
                          className="text-[11px] font-semibold text-amber-700 hover:text-amber-900 py-0.5 cursor-pointer"
                        >
                          Edit in Menu
                        </button>
                      ) : (
                        <span className="text-[11px] text-slate-400 py-0.5">
                          {item.soldOut ? 'Unavailable' : 'Price pending'}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* RIGHT PANE: Active Order Ticket */}
        <section
          aria-label="Active order ticket"
          className={`${
            mobilePane === 'ticket' ? 'flex' : 'hidden'
          } lg:flex lg:col-span-4 flex-col bg-white min-h-0 overflow-hidden`}
        >
          {!activeOrder ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
              <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mb-3">
                <ShoppingBag className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-bold text-slate-900">No Table or Token Selected</h3>
              <p className="text-xs text-slate-500 mt-1 max-w-xs">
                Tap any table on the left or start a Takeaway token to add items in 2 taps.
              </p>
            </div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-slate-900">{activeOrder.tableLabel}</h2>
                    <span className="text-xs text-slate-500 font-mono">
                      · {formatElapsed(activeOrder.createdAt, nowMs)}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Opened by {activeOrder.createdByName}
                  </p>
                </div>

                <div className="flex items-center gap-1.5">
                  {activeTable && (
                    <>
                      <button
                        type="button"
                        title="Shift or merge table"
                        aria-label="Shift or merge table"
                        onClick={() => setShiftSwapMode('shift')}
                        className="h-8 px-2.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1 cursor-pointer"
                      >
                        <ArrowRight className="w-3.5 h-3.5" />
                        Shift
                      </button>
                      <button
                        type="button"
                        title="Swap table"
                        aria-label="Swap table"
                        onClick={() => setShiftSwapMode('swap')}
                        className="h-8 px-2.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1 cursor-pointer"
                      >
                        <ArrowLeftRight className="w-3.5 h-3.5" />
                        Swap
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    title="Void entire order (Owner PIN)"
                    aria-label="Void order"
                    onClick={() => setVoidOrderTarget(activeOrder)}
                    className="h-8 w-8 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 flex items-center justify-center cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Order Items List */}
              <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
                {activeOrder.items.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-500">
                    Order is empty. Tap items from the menu to add them immediately.
                  </div>
                ) : (
                  activeOrder.items.map((line) => {
                    const unsent = Math.max(0, line.qty - line.sentQty);
                    const lineTotal = getLineUnitPrice(line) * line.qty;
                    return (
                      <div key={line.id} className="px-4 py-3 flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-slate-900 truncate">
                              {line.name}
                            </span>
                            {unsent > 0 ? (
                              <span className="text-[11px] font-semibold text-amber-700 shrink-0">
                                {unsent} new
                              </span>
                            ) : (
                              <span className="text-[11px] font-medium text-emerald-700 shrink-0">
                                KOT sent
                              </span>
                            )}
                          </div>
                          {line.addons.length > 0 && (
                            <div className="text-[11px] text-slate-600 mt-0.5">
                              +{line.addons.map((a) => `${a.name}${a.price > 0 ? ` (+₹${a.price})` : ''}`).join(', ')}
                            </div>
                          )}
                          {line.notes && (
                            <div className="text-[11px] text-amber-800 font-medium mt-0.5">
                              Note: {line.notes}
                            </div>
                          )}
                          <div className="mt-1 flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => setCustomizeLineTarget(line)}
                              className="text-[11px] font-semibold text-slate-500 hover:text-slate-900 underline cursor-pointer"
                            >
                              Add-ons / Note
                            </button>
                            {line.sentQty > 0 && (
                              <button
                                type="button"
                                onClick={() => setVoidItemTarget(line)}
                                className="text-[11px] font-semibold text-red-600 hover:text-red-800 cursor-pointer"
                              >
                                Void (PIN)
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              aria-label={`Decrease quantity of ${line.name}`}
                              onClick={() => void handleQtyChange(line, -1)}
                              className="w-9 h-9 rounded-lg border border-slate-300 flex items-center justify-center text-slate-800 hover:bg-slate-100 cursor-pointer"
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <span className="w-7 text-center font-mono text-sm font-bold tabular-nums">
                              {line.qty}
                            </span>
                            <button
                              type="button"
                              aria-label={`Increase quantity of ${line.name}`}
                              onClick={() => void handleQtyChange(line, 1)}
                              className="w-9 h-9 rounded-lg border border-slate-300 flex items-center justify-center text-slate-800 hover:bg-slate-100 cursor-pointer"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <span className="text-xs font-mono font-bold text-slate-900 tabular-nums">
                            {formatCurrency(lineTotal)}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Totals & Actions Footer */}
              {totals && (
                <div className="border-t border-slate-200 bg-slate-50 p-4 space-y-3">
                  {canBillOrDiscount && (
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => {
                          setDiscType(activeOrder.discountType);
                          setDiscVal(activeOrder.discountValue ? String(activeOrder.discountValue) : '');
                          setShowDiscountBox((v) => !v);
                        }}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 hover:text-slate-900 cursor-pointer"
                      >
                        <Percent className="w-3.5 h-3.5" />
                        {activeOrder.discountValue > 0 ? 'Edit Discount' : 'Add Discount'}
                      </button>
                      {activeOrder.discountValue > 0 && (
                        <span className="text-xs font-mono font-semibold text-emerald-700">
                          -{formatCurrency(totals.discountAmount)}
                        </span>
                      )}
                    </div>
                  )}

                  {showDiscountBox && canBillOrDiscount && (
                    <form onSubmit={handleApplyDiscount} className="flex gap-1.5">
                      <select
                        aria-label="Discount type"
                        value={discType}
                        onChange={(e) => setDiscType(e.target.value as DiscountType)}
                        className="h-9 px-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold"
                      >
                        <option value="flat">₹ Flat</option>
                        <option value="percent">% Off</option>
                      </select>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={discVal}
                        onChange={(e) => setDiscVal(e.target.value)}
                        placeholder="Amount"
                        aria-label="Discount value"
                        className="flex-1 h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs font-mono"
                      />
                      <button
                        type="submit"
                        className="px-3 h-9 rounded-lg bg-slate-900 text-white text-xs font-semibold"
                      >
                        Apply
                      </button>
                    </form>
                  )}

                  <div className="space-y-1 text-xs text-slate-600">
                    <div className="flex justify-between">
                      <span>Subtotal</span>
                      <span className="font-mono tabular-nums">{formatCurrency(totals.subtotal)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>CGST + SGST ({settings.gstRate}%)</span>
                      <span className="font-mono tabular-nums">{formatCurrency(totals.totalGst)}</span>
                    </div>
                    <div className="flex justify-between text-base font-bold text-slate-900 pt-1 border-t border-slate-200">
                      <span>Grand Total</span>
                      <span className="font-mono tabular-nums">{formatCurrency(totals.grandTotal)}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      type="button"
                      disabled={unsentCount === 0}
                      onClick={() => void handleSendKot()}
                      className="h-11 rounded-xl border border-slate-900 bg-white text-slate-900 text-xs font-bold hover:bg-slate-100 disabled:opacity-40 inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:cursor-not-allowed"
                    >
                      <Send className="w-3.5 h-3.5" />
                      Send KOT {unsentCount > 0 ? `(${unsentCount})` : ''}
                    </button>

                    {canBillOrDiscount ? (
                      <button
                        type="button"
                        disabled={activeOrder.items.length === 0}
                        onClick={() => setShowPayment(true)}
                        className="h-11 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                      >
                        Settle &amp; Bill
                      </button>
                    ) : (
                      <div className="h-11 rounded-xl bg-slate-200 text-slate-600 text-[11px] font-semibold flex items-center justify-center text-center px-2">
                        Cashier / Owner settles bills
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {/* MODALS */}
      {showPayment && activeOrder && (
        <PaymentModal
          order={activeOrder}
          settings={settings}
          onClose={() => setShowPayment(false)}
          onSettleFull={async (payments: PaymentEntry[]) => {
            const res = await onMutate<{ bill: Bill }>({
              method: 'POST',
              path: `/api/orders/${activeOrder.id}/close-bill`,
              body: { payments },
              label: `Close bill ${activeOrder.tableLabel}`,
            });
            setShowPayment(false);
            onSelectOrderId(null);
            if (res?.bill) onBillCreated(res.bill);
          }}
          onSplitEqual={async (peopleCount: number, splitModes: PaymentMode[]) => {
            const res = await onMutate<{ bills: Bill[] }>({
              method: 'POST',
              path: `/api/orders/${activeOrder.id}/split-bill`,
              body: { mode: 'equal', peopleCount, splitModes },
              label: `Equal split ${activeOrder.tableLabel}`,
            });
            setShowPayment(false);
            onSelectOrderId(null);
            if (res?.bills?.[0]) onBillCreated(res.bills[0]);
          }}
          onSplitByItems={async (itemQtys: Record<string, number>, payments: PaymentEntry[]) => {
            const res = await onMutate<{ bills: Bill[] }>({
              method: 'POST',
              path: `/api/orders/${activeOrder.id}/split-bill`,
              body: { mode: 'items', itemQtys, payments },
              label: `Item split ${activeOrder.tableLabel}`,
            });
            setShowPayment(false);
            if (res?.bills?.[0]) onBillCreated(res.bills[0]);
          }}
        />
      )}

      {shiftSwapMode && activeTable && (
        <ShiftSwapModal
          mode={shiftSwapMode}
          sourceTable={activeTable}
          tables={tables}
          onClose={() => setShiftSwapMode(null)}
          onConfirm={async (targetTableId) => {
            if (shiftSwapMode === 'shift') {
              await onMutate({
                method: 'POST',
                path: '/api/tables/shift',
                body: { fromTableId: activeTable.id, toTableId: targetTableId },
                label: `Shift ${activeTable.label}`,
              });
            } else {
              await onMutate({
                method: 'POST',
                path: '/api/tables/swap',
                body: { tableAId: activeTable.id, tableBId: targetTableId },
                label: `Swap ${activeTable.label}`,
              });
            }
          }}
        />
      )}

      {voidItemTarget && activeOrder && (
        <VoidPinModal
          title={`Void ${voidItemTarget.name}`}
          subtitle="This item was sent to the kitchen. Owner PIN and reason are required."
          maxQty={voidItemTarget.qty}
          onClose={() => setVoidItemTarget(null)}
          onConfirm={async (reason, ownerPin, qty) => {
            await onMutate({
              method: 'POST',
              path: `/api/orders/${activeOrder.id}/void-item`,
              body: { itemId: voidItemTarget.id, qtyToVoid: qty || 1, reason, ownerPin },
              label: `Void ${voidItemTarget.name}`,
            });
          }}
        />
      )}

      {voidOrderTarget && (
        <VoidPinModal
          title={`Void Entire Order · ${voidOrderTarget.tableLabel}`}
          subtitle="Requires Owner PIN and reason. Logged permanently in audit history."
          onClose={() => setVoidOrderTarget(null)}
          onConfirm={async (reason, ownerPin) => {
            await onMutate({
              method: 'POST',
              path: `/api/orders/${voidOrderTarget.id}/void-order`,
              body: { reason, ownerPin },
              label: `Void order ${voidOrderTarget.tableLabel}`,
            });
            onSelectOrderId(null);
          }}
        />
      )}

      {customizeMenuTarget && (
        <CustomizeItemModal
          menuItem={customizeMenuTarget}
          globalAddons={settings.globalAddons}
          onClose={() => setCustomizeMenuTarget(null)}
          onConfirm={async (addons, notes) => {
            await handleAddItem(customizeMenuTarget, addons, notes);
          }}
        />
      )}

      {customizeLineTarget && activeOrder && (
        <CustomizeItemModal
          orderItem={customizeLineTarget}
          menuItem={menu.find((m) => m.id === customizeLineTarget.menuItemId)}
          globalAddons={settings.globalAddons}
          onClose={() => setCustomizeLineTarget(null)}
          onConfirm={async (addons, notes) => {
            await onMutate({
              method: 'POST',
              path: `/api/orders/${activeOrder.id}/items`,
              body: { action: 'update_line', itemId: customizeLineTarget.id, addons, notes },
              label: `Update ${customizeLineTarget.name}`,
            });
          }}
        />
      )}
    </div>
  );
};
