import React, { useMemo, useState } from 'react';
import { Banknote, Ban, MessageCircle, Printer, Search } from 'lucide-react';
import type { Bill, CafeSettings, DaySession, Expense, Role } from '../shared/types';
import { buildWhatsAppBillLink, formatCurrency, round2 } from '../shared/calculations';
import { VoidPinModal } from './TableActionsModal';

interface BillsAndRegisterViewProps {
  role: Role;
  settings: CafeSettings;
  bills: Bill[];
  expenses: Expense[];
  daySessions: DaySession[];
  onOpenDay: (openingCash: number) => Promise<void>;
  onCloseDay: (countedCash: number, notes: string) => Promise<void>;
  onVoidBill: (billId: string, reason: string, ownerPin: string) => Promise<void>;
  onViewReceipt: (bill: Bill) => void;
}

export const BillsAndRegisterView: React.FC<BillsAndRegisterViewProps> = ({
  role,
  settings,
  bills,
  expenses,
  daySessions,
  onOpenDay,
  onCloseDay,
  onVoidBill,
  onViewReceipt,
}) => {
  const [search, setSearch] = useState('');
  const [openingCash, setOpeningCash] = useState('1000');
  const [countedCash, setCountedCash] = useState('');
  const [closeNotes, setCloseNotes] = useState('');
  const [voidTarget, setVoidTarget] = useState<Bill | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const openSession = daySessions.find((d) => d.status === 'open') || null;
  const canManageRegister = role === 'owner' || role === 'cashier';

  const expectedCashLive = useMemo(() => {
    if (!openSession) return 0;
    const openMs = new Date(openSession.openedAt).getTime();
    const cashSales = bills
      .filter((b) => b.status === 'paid' && new Date(b.createdAt).getTime() >= openMs)
      .reduce(
        (s, b) => s + b.payments.filter((p) => p.mode === 'cash').reduce((ps, p) => ps + p.amount, 0),
        0
      );
    const cashExp = expenses
      .filter((e) => e.paymentMode === 'cash' && new Date(e.createdAt).getTime() >= openMs)
      .reduce((s, e) => s + e.amount, 0);
    return round2(openSession.openingCash + cashSales - cashExp);
  }, [openSession, bills, expenses]);

  const filteredBills = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bills.filter((b) =>
      q
        ? b.billNumber.toLowerCase().includes(q) ||
          b.tableLabel.toLowerCase().includes(q) ||
          b.closedByName.toLowerCase().includes(q)
        : true
    );
  }, [bills, search]);

  const handleOpenDay = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await onOpenDay(Number(openingCash) || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open register');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCloseDay = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await onCloseDay(Number(countedCash), closeNotes);
      setCountedCash('');
      setCloseNotes('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to close register');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      {/* Day Open / Close Register */}
      {canManageRegister && (
        <section className="bg-white border border-slate-200 rounded-2xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-800 flex items-center justify-center">
                <Banknote className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">Day Register &amp; Cash Drawer</h2>
                <p className="text-xs text-slate-500">
                  {openSession
                    ? `Open since ${new Date(openSession.openedAt).toLocaleString('en-IN')} · Opened by ${openSession.openedByName}`
                    : 'Register is currently closed'}
                </p>
              </div>
            </div>
            <span
              className={`text-xs font-bold ${
                openSession ? 'text-emerald-700' : 'text-slate-500'
              }`}
            >
              {openSession ? 'Register Open' : 'Register Closed'}
            </span>
          </div>

          {error && (
            <div role="alert" className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}

          {!openSession ? (
            <form onSubmit={handleOpenDay} className="flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="opening-cash" className="block text-xs font-semibold text-slate-700 mb-1">
                  Opening Cash Float (₹)
                </label>
                <input
                  id="opening-cash"
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={openingCash}
                  onChange={(e) => setOpeningCash(e.target.value)}
                  className="h-10 w-44 px-3 rounded-lg border border-slate-300 font-mono text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="h-10 px-5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 cursor-pointer"
              >
                Open Day Register
              </button>
            </form>
          ) : (
            <form onSubmit={handleCloseDay} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-[11px] text-slate-500">Expected Cash in Drawer</div>
                <div className="text-base font-mono font-bold text-slate-900 tabular-nums mt-0.5">
                  {formatCurrency(expectedCashLive)}
                </div>
              </div>
              <div>
                <label htmlFor="counted-cash" className="block text-xs font-semibold text-slate-700 mb-1">
                  Counted Cash (₹)
                </label>
                <input
                  id="counted-cash"
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={countedCash}
                  onChange={(e) => setCountedCash(e.target.value)}
                  placeholder={expectedCashLive.toFixed(2)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 font-mono text-sm"
                />
              </div>
              <div>
                <label htmlFor="close-notes" className="block text-xs font-semibold text-slate-700 mb-1">
                  Closing Notes
                </label>
                <input
                  id="close-notes"
                  type="text"
                  value={closeNotes}
                  onChange={(e) => setCloseNotes(e.target.value)}
                  placeholder="Optional variance note"
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="h-10 px-4 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 cursor-pointer"
              >
                Close Day &amp; Reconcile
              </button>
            </form>
          )}

          {daySessions.filter((d) => d.status === 'closed').length > 0 && (
            <div className="mt-4 pt-4 border-t border-slate-100">
              <h3 className="text-xs font-bold text-slate-700 mb-2">Recent Day Closings</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-200">
                      <th className="py-2 pr-3">Date</th>
                      <th className="py-2 pr-3 text-right">Opening</th>
                      <th className="py-2 pr-3 text-right">Expected</th>
                      <th className="py-2 pr-3 text-right">Counted</th>
                      <th className="py-2 pr-3 text-right">Diff</th>
                      <th className="py-2">Closed By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {daySessions
                      .filter((d) => d.status === 'closed')
                      .slice(0, 7)
                      .map((d) => (
                        <tr key={d.id}>
                          <td className="py-2 pr-3 font-medium">{d.date}</td>
                          <td className="py-2 pr-3 text-right font-mono">{formatCurrency(d.openingCash)}</td>
                          <td className="py-2 pr-3 text-right font-mono">{formatCurrency(d.expectedCash)}</td>
                          <td className="py-2 pr-3 text-right font-mono">{formatCurrency(d.countedCash || 0)}</td>
                          <td
                            className={`py-2 pr-3 text-right font-mono font-bold ${
                              (d.cashDifference || 0) === 0
                                ? 'text-emerald-700'
                                : 'text-amber-700'
                            }`}
                          >
                            {formatCurrency(d.cashDifference || 0)}
                          </td>
                          <td className="py-2 text-slate-600">{d.closedByName}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Closed Bills Ledger */}
      <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">Closed Bills Ledger</h2>
            <p className="text-xs text-slate-500">
              Immutable invoices · Closed bills cannot be edited (Owner PIN required to void).
            </p>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search INV-0001, table..."
              aria-label="Search bills"
              className="w-full h-9 pl-9 pr-3 rounded-lg border border-slate-200 text-xs"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="py-3 px-4 font-semibold">Bill #</th>
                <th className="py-3 px-4 font-semibold">Date &amp; Time</th>
                <th className="py-3 px-4 font-semibold">Table / Token</th>
                <th className="py-3 px-4 font-semibold">Payment</th>
                <th className="py-3 px-4 font-semibold text-right">GST</th>
                <th className="py-3 px-4 font-semibold text-right">Total</th>
                <th className="py-3 px-4 font-semibold">Status</th>
                <th className="py-3 px-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredBills.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-400">
                    No closed bills yet.
                  </td>
                </tr>
              ) : (
                filteredBills.slice(0, 100).map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-mono font-bold text-slate-900">{b.billNumber}</td>
                    <td className="py-3 px-4 text-slate-600 font-mono">
                      {new Date(b.createdAt).toLocaleString('en-IN')}
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-800">
                      {b.tableLabel}
                      {b.splitLabel ? ` · ${b.splitLabel}` : ''}
                    </td>
                    <td className="py-3 px-4 uppercase font-mono text-slate-600">
                      {b.payments.map((p) => p.mode).join('+')}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-600">
                      {formatCurrency(b.totalGst)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold tabular-nums text-slate-900">
                      {formatCurrency(b.grandTotal)}
                    </td>
                    <td className="py-3 px-4">
                      {b.status === 'paid' ? (
                        <span className="text-emerald-700 font-semibold">Paid</span>
                      ) : (
                        <span className="text-red-700 font-semibold">Voided</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onViewReceipt(b)}
                          aria-label={`View receipt ${b.billNumber}`}
                          className="h-8 px-2.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100 inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          Receipt
                        </button>
                        <a
                          href={buildWhatsAppBillLink({ bill: b, settings })}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Share ${b.billNumber} on WhatsApp`}
                          className="h-8 w-8 rounded-lg border border-slate-200 text-emerald-700 hover:bg-emerald-50 inline-flex items-center justify-center"
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                        </a>
                        {role === 'owner' && b.status === 'paid' && (
                          <button
                            type="button"
                            onClick={() => setVoidTarget(b)}
                            aria-label={`Void bill ${b.billNumber}`}
                            className="h-8 px-2.5 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Ban className="w-3.5 h-3.5" />
                            Void
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {voidTarget && (
        <VoidPinModal
          title={`Void Bill ${voidTarget.billNumber}`}
          subtitle={`Bill amount ${formatCurrency(voidTarget.grandTotal)}. Requires reason and Owner PIN.`}
          onClose={() => setVoidTarget(null)}
          onConfirm={async (reason, ownerPin) => {
            await onVoidBill(voidTarget.id, reason, ownerPin);
          }}
        />
      )}
    </div>
  );
};
