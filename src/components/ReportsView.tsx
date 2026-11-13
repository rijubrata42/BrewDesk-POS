import React, { useMemo, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import type { Bill, Expense, MenuItem, Role } from '../shared/types';
import { computeReports, formatCurrency } from '../shared/calculations';
import { exportExpensesCsv, exportSalesCsv } from '../utils/exportUtils';

interface ReportsViewProps {
  role: Role;
  bills: Bill[];
  expenses: Expense[];
  menu: MenuItem[];
}

function isoDateOffset(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const ReportsView: React.FC<ReportsViewProps> = ({ role, bills, expenses, menu }) => {
  const today = isoDateOffset(0);
  const [preset, setPreset] = useState<'today' | 'yesterday' | '7d' | 'month' | 'custom'>('today');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [subTab, setSubTab] = useState<'overview' | 'items' | 'tax' | 'voids'>('overview');

  const applyPreset = (p: 'today' | 'yesterday' | '7d' | 'month' | 'custom') => {
    setPreset(p);
    if (p === 'today') {
      setStartDate(today);
      setEndDate(today);
    } else if (p === 'yesterday') {
      const y = isoDateOffset(1);
      setStartDate(y);
      setEndDate(y);
    } else if (p === '7d') {
      setStartDate(isoDateOffset(6));
      setEndDate(today);
    } else if (p === 'month') {
      const d = new Date();
      setStartDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`);
      setEndDate(today);
    }
  };

  const report = useMemo(
    () => computeReports({ bills, expenses, menu, startDate, endDate }),
    [bills, expenses, menu, startDate, endDate]
  );

  const maxHourly = Math.max(1, ...report.hourlySales.map((h) => h.sales));
  const maxDaily = Math.max(
    1,
    ...report.dailySales.map((d) => Math.max(d.sales, d.expenses))
  );

  const totalPayments =
    report.paymentSplit.cash + report.paymentSplit.upi + report.paymentSplit.card;

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      {/* Header & Date Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-slate-200 rounded-2xl p-4 no-print">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: 'today', label: 'Today' },
              { id: 'yesterday', label: 'Yesterday' },
              { id: '7d', label: '7 Days' },
              { id: 'month', label: 'This Month' },
              { id: 'custom', label: 'Custom' },
            ] as const
          ).map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => applyPreset(p.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                preset === p.id
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {p.label}
            </button>
          ))}
          {preset === 'custom' && (
            <div className="flex items-center gap-1.5 ml-1">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                aria-label="Report start date"
                className="h-8 px-2 rounded-lg border border-slate-300 text-xs"
              />
              <span className="text-xs text-slate-400">to</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                aria-label="Report end date"
                className="h-8 px-2 rounded-lg border border-slate-300 text-xs"
              />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() =>
              exportSalesCsv(
                bills.filter(
                  (b) =>
                    b.createdAt.slice(0, 10) >= startDate &&
                    b.createdAt.slice(0, 10) <= endDate
                ),
                `sales-${startDate}-to-${endDate}.csv`
              )
            }
            className="h-9 px-3 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Sales CSV
          </button>
          {role === 'owner' && (
            <button
              type="button"
              onClick={() =>
                exportExpensesCsv(
                  expenses.filter((e) => e.date >= startDate && e.date <= endDate),
                  `expenses-${startDate}-to-${endDate}.csv`
                )
              }
              className="h-9 px-3 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Expenses CSV
            </button>
          )}
          <button
            type="button"
            onClick={() => window.print()}
            className="h-9 px-3.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            Export PDF
          </button>
        </div>
      </div>

      {/* Printable Report Container */}
      <div className="print-area space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Sales &amp; Financial Report ({startDate} to {endDate})
            </h2>
            <p className="text-xs text-slate-500">
              Paid invoices excluding voided bills · All amounts in INR
            </p>
          </div>
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          <div className="bg-white border border-slate-200 rounded-xl p-3.5">
            <div className="text-[11px] font-medium text-slate-500">Total Sales</div>
            <div className="text-lg font-mono font-bold text-slate-900 tabular-nums mt-1">
              {formatCurrency(report.totalSales)}
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-3.5">
            <div className="text-[11px] font-medium text-slate-500">Paid Bills</div>
            <div className="text-lg font-mono font-bold text-slate-900 tabular-nums mt-1">
              {report.billCount}
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-3.5">
            <div className="text-[11px] font-medium text-slate-500">Avg Bill</div>
            <div className="text-lg font-mono font-bold text-slate-900 tabular-nums mt-1">
              {formatCurrency(report.avgBill)}
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-3.5">
            <div className="text-[11px] font-medium text-slate-500">GST Collected</div>
            <div className="text-lg font-mono font-bold text-slate-900 tabular-nums mt-1">
              {formatCurrency(report.gstCollected)}
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-3.5">
            <div className="text-[11px] font-medium text-slate-500">Discounts</div>
            <div className="text-lg font-mono font-bold text-amber-700 tabular-nums mt-1">
              {formatCurrency(report.totalDiscounts)}
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-3.5">
            <div className="text-[11px] font-medium text-slate-500">Expenses</div>
            <div className="text-lg font-mono font-bold text-red-700 tabular-nums mt-1">
              {formatCurrency(report.totalExpenses)}
            </div>
          </div>
          {role === 'owner' && (
            <div className="bg-slate-900 text-white rounded-xl p-3.5">
              <div className="text-[11px] font-medium text-slate-300">Net Profit</div>
              <div
                className={`text-lg font-mono font-bold tabular-nums mt-1 ${
                  report.netProfit >= 0 ? 'text-emerald-400' : 'text-red-400'
                }`}
              >
                {formatCurrency(report.netProfit)}
              </div>
            </div>
          )}
        </div>

        {/* Report Section Tabs */}
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl w-fit no-print">
          {(
            [
              { id: 'overview', label: 'Charts & Payments' },
              { id: 'items', label: 'Items & Categories' },
              { id: 'tax', label: 'GST & Staff' },
              { id: 'voids', label: `Voids (${report.voidedBillCount})` },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSubTab(t.id)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap cursor-pointer ${
                subTab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {subTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Sales by Hour SVG Chart */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5">
              <h3 className="text-sm font-bold text-slate-900 mb-3">Sales by Hour</h3>
              <div className="h-48 flex items-end gap-1 pt-4">
                {report.hourlySales.map((h) => {
                  const pct = Math.max(3, Math.round((h.sales / maxHourly) * 100));
                  return (
                    <div key={h.hour} className="flex-1 flex flex-col items-center h-full">
                      <div className="flex-1 w-full flex items-end">
                        <div
                          title={`${h.label}: ${formatCurrency(h.sales)} (${h.bills} bills)`}
                          style={{ height: `${h.sales > 0 ? pct : 4}%` }}
                          className={`w-full rounded-t-sm transition-colors ${
                            h.sales > 0 ? 'bg-slate-900 hover:bg-amber-600' : 'bg-slate-100'
                          }`}
                        />
                      </div>
                      <span className="h-4 text-[10px] font-mono text-slate-400 mt-1 leading-4">
                        {h.hour % 4 === 0 ? String(h.hour).padStart(2, '0') : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Payment Mode Split */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
              <h3 className="text-sm font-bold text-slate-900">Payment Mode Split</h3>
              {(['cash', 'upi', 'card'] as const).map((mode) => {
                const amt = report.paymentSplit[mode] || 0;
                const pct = totalPayments > 0 ? Math.round((amt / totalPayments) * 100) : 0;
                return (
                  <div key={mode} className="space-y-1.5">
                    <div className="flex justify-between text-xs font-semibold">
                      <span className="uppercase text-slate-700">{mode}</span>
                      <span className="font-mono tabular-nums text-slate-900">
                        {formatCurrency(amt)} ({pct}%)
                      </span>
                    </div>
                    <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        style={{ width: `${pct}%` }}
                        className={`h-full rounded-full ${
                          mode === 'upi'
                            ? 'bg-emerald-600'
                            : mode === 'card'
                            ? 'bg-amber-600'
                            : 'bg-slate-900'
                        }`}
                      />
                    </div>
                  </div>
                );
              })}

              {/* Daily Sales vs Expenses */}
              <div className="pt-3 border-t border-slate-100">
                <h4 className="text-xs font-bold text-slate-700 mb-2">Daily Sales vs Expenses</h4>
                {report.dailySales.length === 0 ? (
                  <p className="text-xs text-slate-400">No activity in selected dates.</p>
                ) : (
                  <div className="space-y-2 max-h-32 overflow-y-auto">
                    {report.dailySales.map((d) => (
                      <div key={d.date} className="text-xs flex items-center gap-3">
                        <span className="font-mono text-slate-500 w-24 shrink-0">{d.date}</span>
                        <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            style={{ width: `${Math.round((d.sales / maxDaily) * 100)}%` }}
                            className="h-full bg-slate-900"
                          />
                        </div>
                        <span className="font-mono font-semibold text-slate-900 w-24 text-right tabular-nums">
                          {formatCurrency(d.sales)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {subTab === 'items' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white border border-slate-200 rounded-2xl p-5">
              <h3 className="text-sm font-bold text-slate-900 mb-3">Item-wise Sales</h3>
              <table className="w-full text-xs text-left">
                <thead className="text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="py-2">Item</th>
                    <th className="py-2 text-right">Qty</th>
                    <th className="py-2 text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {report.itemSales.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="py-6 text-center text-slate-400">
                        No items sold in this period.
                      </td>
                    </tr>
                  ) : (
                    report.itemSales.map((it) => (
                      <tr key={it.name}>
                        <td className="py-2 font-medium text-slate-900">
                          {it.name} <span className="text-slate-400">· {it.category}</span>
                        </td>
                        <td className="py-2 text-right font-mono tabular-nums">{it.qty}</td>
                        <td className="py-2 text-right font-mono font-bold tabular-nums">
                          {formatCurrency(it.revenue)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-5">
              <h3 className="text-sm font-bold text-slate-900 mb-3">Category-wise Sales</h3>
              <table className="w-full text-xs text-left">
                <thead className="text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="py-2">Category</th>
                    <th className="py-2 text-right">Qty</th>
                    <th className="py-2 text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {report.categorySales.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="py-6 text-center text-slate-400">
                        No category data.
                      </td>
                    </tr>
                  ) : (
                    report.categorySales.map((c) => (
                      <tr key={c.category}>
                        <td className="py-2 font-semibold text-slate-900">{c.category}</td>
                        <td className="py-2 text-right font-mono tabular-nums">{c.qty}</td>
                        <td className="py-2 text-right font-mono font-bold tabular-nums">
                          {formatCurrency(c.revenue)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {subTab === 'tax' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white border border-slate-200 rounded-2xl p-5">
              <h3 className="text-sm font-bold text-slate-900 mb-3">GST Tax Report (CGST / SGST)</h3>
              <table className="w-full text-xs text-left">
                <thead className="text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="py-2">GST Rate</th>
                    <th className="py-2 text-right">Taxable</th>
                    <th className="py-2 text-right">CGST</th>
                    <th className="py-2 text-right">SGST</th>
                    <th className="py-2 text-right">Total Tax</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {report.taxBreakdown.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-slate-400">
                        No taxable bills in range.
                      </td>
                    </tr>
                  ) : (
                    report.taxBreakdown.map((t) => (
                      <tr key={t.rate}>
                        <td className="py-2 font-mono font-bold">{t.rate}%</td>
                        <td className="py-2 text-right font-mono tabular-nums">
                          {formatCurrency(t.taxable)}
                        </td>
                        <td className="py-2 text-right font-mono tabular-nums">
                          {formatCurrency(t.cgst)}
                        </td>
                        <td className="py-2 text-right font-mono tabular-nums">
                          {formatCurrency(t.sgst)}
                        </td>
                        <td className="py-2 text-right font-mono font-bold tabular-nums">
                          {formatCurrency(t.totalTax)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-5">
              <h3 className="text-sm font-bold text-slate-900 mb-3">Staff-wise Sales</h3>
              <table className="w-full text-xs text-left">
                <thead className="text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="py-2">Staff Member</th>
                    <th className="py-2 text-right">Bills</th>
                    <th className="py-2 text-right">Sales</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {report.staffSales.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="py-6 text-center text-slate-400">
                        No staff sales recorded.
                      </td>
                    </tr>
                  ) : (
                    report.staffSales.map((s) => (
                      <tr key={s.staffName}>
                        <td className="py-2 font-semibold text-slate-900">{s.staffName}</td>
                        <td className="py-2 text-right font-mono tabular-nums">{s.bills}</td>
                        <td className="py-2 text-right font-mono font-bold tabular-nums">
                          {formatCurrency(s.sales)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {subTab === 'voids' && (
          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <h3 className="text-sm font-bold text-slate-900 mb-3">Voided Bills Report</h3>
            <table className="w-full text-xs text-left">
              <thead className="text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="py-2">Bill #</th>
                  <th className="py-2">Date</th>
                  <th className="py-2">Table / Token</th>
                  <th className="py-2">Reason</th>
                  <th className="py-2">Authorized By</th>
                  <th className="py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.voidedBills.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-slate-400">
                      No voided bills in this period.
                    </td>
                  </tr>
                ) : (
                  report.voidedBills.map((b) => (
                    <tr key={b.id}>
                      <td className="py-2 font-mono font-bold text-red-700">{b.billNumber}</td>
                      <td className="py-2 font-mono text-slate-500">
                        {new Date(b.createdAt).toLocaleString('en-IN')}
                      </td>
                      <td className="py-2">{b.tableLabel}</td>
                      <td className="py-2 text-slate-700">{b.voidReason || '—'}</td>
                      <td className="py-2">{b.voidedByName || 'Owner'}</td>
                      <td className="py-2 text-right font-mono font-bold tabular-nums">
                        {formatCurrency(b.grandTotal)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
