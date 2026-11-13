import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { Banknote, CreditCard, QrCode, Split, X } from 'lucide-react';
import type { CafeSettings, Order, PaymentEntry, PaymentMode } from '../shared/types';
import {
  calculateOrderTotals,
  formatCurrency,
  generateUpiUri,
  round2,
  splitOrderBySelectedItems,
  splitOrderEqually,
} from '../shared/calculations';

interface PaymentModalProps {
  order: Order;
  settings: CafeSettings;
  onClose: () => void;
  onSettleFull: (payments: PaymentEntry[]) => Promise<void>;
  onSplitEqual: (peopleCount: number, splitModes: PaymentMode[]) => Promise<void>;
  onSplitByItems: (itemQtys: Record<string, number>, payments: PaymentEntry[]) => Promise<void>;
}

export const PaymentModal: React.FC<PaymentModalProps> = ({
  order,
  settings,
  onClose,
  onSettleFull,
  onSplitEqual,
  onSplitByItems,
}) => {
  const [tab, setTab] = useState<'full' | 'equal' | 'items'>('full');
  const [mode, setMode] = useState<PaymentMode | 'split'>('cash');
  const [cashAmt, setCashAmt] = useState('0');
  const [upiAmt, setUpiAmt] = useState('0');
  const [cardAmt, setCardAmt] = useState('0');

  const [peopleCount, setPeopleCount] = useState(2);
  const [equalModes, setEqualModes] = useState<PaymentMode[]>(['cash', 'upi']);
  const [selectedQtys, setSelectedQtys] = useState<Record<string, number>>({});
  const [splitPayMode, setSplitPayMode] = useState<PaymentMode>('upi');
  const [qrUrl, setQrUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const totals = useMemo(
    () =>
      calculateOrderTotals(
        order.items,
        order.discountType,
        order.discountValue,
        settings.gstRate
      ),
    [order, settings.gstRate]
  );

  const itemSplitResult = useMemo(
    () =>
      splitOrderBySelectedItems(
        order.items,
        selectedQtys,
        totals.discountAmount,
        totals.subtotal,
        settings.gstRate
      ),
    [order.items, selectedQtys, totals.discountAmount, totals.subtotal, settings.gstRate]
  );

  const activeQrAmount =
    tab === 'full' && mode === 'upi'
      ? totals.grandTotal
      : tab === 'items' && splitPayMode === 'upi'
      ? itemSplitResult.totals.grandTotal
      : 0;

  useEffect(() => {
    if (activeQrAmount <= 0 || !settings.upiId) {
      setQrUrl('');
      return;
    }
    const uri = generateUpiUri({
      upiId: settings.upiId,
      cafeName: settings.cafeName,
      amount: activeQrAmount,
      billRef: order.tableLabel,
    });
    QRCode.toDataURL(uri, { width: 170, margin: 1 })
      .then(setQrUrl)
      .catch(() => setQrUrl(''));
  }, [activeQrAmount, settings.upiId, settings.cafeName, order.tableLabel]);

  useEffect(() => {
    setCashAmt(totals.grandTotal.toFixed(2));
    setUpiAmt('0');
    setCardAmt('0');
  }, [totals.grandTotal]);

  const equalShares = useMemo(
    () => splitOrderEqually(totals.grandTotal, peopleCount),
    [totals.grandTotal, peopleCount]
  );

  const handleSettle = async () => {
    setError('');
    setSubmitting(true);
    try {
      if (tab === 'full') {
        let payments: PaymentEntry[];
        if (mode === 'split') {
          payments = [
            { mode: 'cash' as const, amount: round2(Number(cashAmt) || 0) },
            { mode: 'upi' as const, amount: round2(Number(upiAmt) || 0) },
            { mode: 'card' as const, amount: round2(Number(cardAmt) || 0) },
          ].filter((p) => p.amount > 0);
          const sum = round2(payments.reduce((s, p) => s + p.amount, 0));
          if (Math.abs(sum - totals.grandTotal) > 0.5) {
            throw new Error(`Split payments (${formatCurrency(sum)}) must equal ${formatCurrency(totals.grandTotal)}`);
          }
        } else {
          payments = [{ mode, amount: totals.grandTotal }];
        }
        await onSettleFull(payments);
      } else if (tab === 'equal') {
        const modes = Array.from({ length: peopleCount }, (_, idx) => equalModes[idx] || 'cash');
        await onSplitEqual(peopleCount, modes);
      } else {
        if (itemSplitResult.selectedItems.length === 0) {
          throw new Error('Select at least one item to settle');
        }
        await onSplitByItems(selectedQtys, [
          { mode: splitPayMode, amount: itemSplitResult.totals.grandTotal },
        ]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Settlement failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Settle Bill · {order.tableLabel}
            </h2>
            <p className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
              Grand Total {formatCurrency(totals.grandTotal)} (incl. GST {formatCurrency(totals.totalGst)})
            </p>
          </div>
          <button
            type="button"
            aria-label="Close payment modal"
            onClick={onClose}
            className="w-9 h-9 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 pt-3">
          <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-xl">
            <button
              type="button"
              onClick={() => setTab('full')}
              className={`py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                tab === 'full' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              Full Bill
            </button>
            <button
              type="button"
              onClick={() => setTab('equal')}
              className={`py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                tab === 'equal' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              Split Equally
            </button>
            <button
              type="button"
              onClick={() => setTab('items')}
              className={`py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                tab === 'items' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              Split by Items
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4 max-h-[65vh] overflow-y-auto">
          {tab === 'full' && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(
                  [
                    { id: 'cash', label: 'Cash', icon: Banknote },
                    { id: 'upi', label: 'UPI QR', icon: QrCode },
                    { id: 'card', label: 'Card', icon: CreditCard },
                    { id: 'split', label: 'Split Pay', icon: Split },
                  ] as const
                ).map((m) => {
                  const Icon = m.icon;
                  const active = mode === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setMode(m.id)}
                      className={`h-14 rounded-xl border flex flex-col items-center justify-center gap-1 text-xs font-semibold transition-colors cursor-pointer ${
                        active
                          ? 'border-slate-900 bg-slate-900 text-white'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      {m.label}
                    </button>
                  );
                })}
              </div>

              {mode === 'upi' && qrUrl && (
                <div className="flex flex-col items-center p-4 rounded-xl bg-slate-50 border border-slate-200">
                  <img src={qrUrl} alt="Dynamic UPI QR" className="w-40 h-40 rounded-lg bg-white p-2 border border-slate-200" referrerPolicy="no-referrer" />
                  <p className="text-xs font-semibold text-slate-800 mt-2 font-mono">
                    {formatCurrency(totals.grandTotal)} · {settings.upiId}
                  </p>
                </div>
              )}

              {mode === 'split' && (
                <div className="grid grid-cols-3 gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200">
                  <div>
                    <label htmlFor="split-cash" className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Cash (₹)
                    </label>
                    <input
                      id="split-cash"
                      type="number"
                      step="0.01"
                      value={cashAmt}
                      onChange={(e) => setCashAmt(e.target.value)}
                      className="w-full h-10 px-2.5 rounded-lg border border-slate-300 bg-white font-mono text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="split-upi" className="block text-[11px] font-semibold text-slate-600 mb-1">
                      UPI (₹)
                    </label>
                    <input
                      id="split-upi"
                      type="number"
                      step="0.01"
                      value={upiAmt}
                      onChange={(e) => setUpiAmt(e.target.value)}
                      className="w-full h-10 px-2.5 rounded-lg border border-slate-300 bg-white font-mono text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="split-card" className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Card (₹)
                    </label>
                    <input
                      id="split-card"
                      type="number"
                      step="0.01"
                      value={cardAmt}
                      onChange={(e) => setCardAmt(e.target.value)}
                      className="w-full h-10 px-2.5 rounded-lg border border-slate-300 bg-white font-mono text-sm"
                    />
                  </div>
                </div>
              )}
            </>
          )}

          {tab === 'equal' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-800">Split between guests</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPeopleCount((c) => Math.max(2, c - 1))}
                    className="w-9 h-9 rounded-lg border border-slate-300 font-bold text-slate-800"
                  >
                    -
                  </button>
                  <span className="w-8 text-center font-mono font-bold text-sm">{peopleCount}</span>
                  <button
                    type="button"
                    onClick={() => setPeopleCount((c) => Math.min(12, c + 1))}
                    className="w-9 h-9 rounded-lg border border-slate-300 font-bold text-slate-800"
                  >
                    +
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                {equalShares.map((share, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-3 rounded-xl border border-slate-200 bg-slate-50"
                  >
                    <div>
                      <div className="text-xs font-semibold text-slate-800">Guest {idx + 1}</div>
                      <div className="text-sm font-mono font-bold text-slate-900 tabular-nums">
                        {formatCurrency(share)}
                      </div>
                    </div>
                    <select
                      aria-label={`Payment mode for guest ${idx + 1}`}
                      value={equalModes[idx] || 'cash'}
                      onChange={(e) => {
                        const next = [...equalModes];
                        next[idx] = e.target.value as PaymentMode;
                        setEqualModes(next);
                      }}
                      className="h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold"
                    >
                      <option value="cash">Cash</option>
                      <option value="upi">UPI</option>
                      <option value="card">Card</option>
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'items' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">
                Select quantities to settle now. Unselected items remain open on {order.tableLabel}.
              </p>
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                {order.items.map((it) => {
                  const picked = selectedQtys[it.id] || 0;
                  return (
                    <div key={it.id} className="flex items-center justify-between p-3 bg-white">
                      <div>
                        <div className="text-sm font-medium text-slate-900">{it.name}</div>
                        <div className="text-xs text-slate-500 font-mono">
                          Open qty: {it.qty} · {formatCurrency(it.unitPrice)} each
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedQtys((prev) => ({
                              ...prev,
                              [it.id]: Math.max(0, (prev[it.id] || 0) - 1),
                            }))
                          }
                          className="w-8 h-8 rounded-lg border border-slate-300 font-bold"
                        >
                          -
                        </button>
                        <span className="w-6 text-center font-mono text-sm font-bold">{picked}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedQtys((prev) => ({
                              ...prev,
                              [it.id]: Math.min(it.qty, (prev[it.id] || 0) + 1),
                            }))
                          }
                          className="w-8 h-8 rounded-lg border border-slate-300 font-bold"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div>
                  <div className="text-xs text-slate-500">Selected Split Total</div>
                  <div className="text-base font-mono font-bold text-slate-900">
                    {formatCurrency(itemSplitResult.totals.grandTotal)}
                  </div>
                </div>
                <select
                  aria-label="Payment mode for item split"
                  value={splitPayMode}
                  onChange={(e) => setSplitPayMode(e.target.value as PaymentMode)}
                  className="h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs font-semibold"
                >
                  <option value="upi">UPI</option>
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                </select>
              </div>
              {qrUrl && (
                <div className="flex justify-center">
                  <img src={qrUrl} alt="Split UPI QR" className="w-32 h-32 rounded-lg border border-slate-200 p-1" referrerPolicy="no-referrer" />
                </div>
              )}
            </div>
          )}

          {error && (
            <div role="alert" className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs font-medium text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-slate-200 flex gap-2 bg-slate-50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 h-11 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void handleSettle()}
            className="flex-1 h-11 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-60 cursor-pointer"
          >
            {submitting
              ? 'Completing...'
              : tab === 'full'
              ? `Complete Payment · ${formatCurrency(totals.grandTotal)}`
              : tab === 'equal'
              ? `Settle ${peopleCount} Split Bills`
              : `Settle Selected · ${formatCurrency(itemSplitResult.totals.grandTotal)}`}
          </button>
        </div>
      </div>
    </div>
  );
};
