import React, { useMemo, useState } from 'react';
import { AlertTriangle, Download, PackagePlus, Plus, Trash2 } from 'lucide-react';
import type { Expense, Ingredient, PaymentMode, Role, StockPurchase } from '../shared/types';
import { formatCurrency } from '../shared/calculations';
import { exportExpensesCsv, exportInventoryCsv } from '../utils/exportUtils';

interface ExpensesInventoryViewProps {
  role: Role;
  expenses: Expense[];
  inventory: Ingredient[];
  purchases: StockPurchase[];
  onMutate: (opts: {
    method: 'POST' | 'PATCH' | 'DELETE';
    path: string;
    body?: unknown;
    label: string;
  }) => Promise<unknown>;
}

const EXPENSE_CATEGORIES = [
  'Milk & Dairy',
  'Vegetables & Fresh',
  'Meat & Frozen',
  'Packaging & Cups',
  'Gas & Electricity',
  'Rent & Maintenance',
  'Staff & Wages',
  'Other',
];

export const ExpensesInventoryView: React.FC<ExpensesInventoryViewProps> = ({
  role,
  expenses,
  inventory,
  purchases,
  onMutate,
}) => {
  const today = new Date().toISOString().slice(0, 10);
  const currentMonth = today.slice(0, 7);

  // Expense form
  const [expDate, setExpDate] = useState(today);
  const [expCat, setExpCat] = useState(EXPENSE_CATEGORIES[0]);
  const [expDesc, setExpDesc] = useState('');
  const [expAmt, setExpAmt] = useState('');
  const [expMode, setExpMode] = useState<PaymentMode>('cash');

  // Stock purchase form
  const [purIngId, setPurIngId] = useState(inventory[0]?.id || '');
  const [purQty, setPurQty] = useState('');
  const [purCost, setPurCost] = useState('');
  const [purSupplier, setPurSupplier] = useState('');

  // New ingredient form
  const [newIngName, setNewIngName] = useState('');
  const [newIngUnit, setNewIngUnit] = useState('pcs');
  const [newIngStock, setNewIngStock] = useState('0');
  const [newIngMin, setNewIngMin] = useState('10');

  const monthlyExpenseTotal = useMemo(
    () => expenses.filter((e) => e.date.startsWith(currentMonth)).reduce((s, e) => s + e.amount, 0),
    [expenses, currentMonth]
  );

  const lowStockItems = useMemo(
    () => inventory.filter((i) => i.stock <= i.minStock),
    [inventory]
  );

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!expAmt || Number(expAmt) <= 0) return;
    await onMutate({
      method: 'POST',
      path: '/api/expenses',
      body: {
        date: expDate,
        category: expCat,
        description: expDesc,
        amount: Number(expAmt),
        paymentMode: expMode,
      },
      label: `Log expense ${expCat}`,
    });
    setExpDesc('');
    setExpAmt('');
  };

  const handlePurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!purIngId || Number(purQty) <= 0) return;
    await onMutate({
      method: 'POST',
      path: '/api/inventory/purchase',
      body: {
        ingredientId: purIngId,
        quantity: Number(purQty),
        totalCost: Number(purCost) || 0,
        supplier: purSupplier,
        date: today,
      },
      label: 'Record stock purchase',
    });
    setPurQty('');
    setPurCost('');
    setPurSupplier('');
  };

  const handleAddIngredient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newIngName.trim()) return;
    await onMutate({
      method: 'POST',
      path: '/api/inventory',
      body: {
        name: newIngName.trim(),
        unit: newIngUnit.trim(),
        stock: Number(newIngStock) || 0,
        minStock: Number(newIngMin) || 0,
      },
      label: `Add ingredient ${newIngName}`,
    });
    setNewIngName('');
    setNewIngStock('0');
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      {/* Low Stock Alert Strip */}
      {lowStockItems.length > 0 && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-bold text-red-900">
              Low Stock Alert ({lowStockItems.length} ingredients)
            </h3>
            <p className="text-xs text-red-800 mt-0.5">
              {lowStockItems.map((i) => `${i.name} (${i.stock} ${i.unit})`).join(' · ')}
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* EXPENSES SECTION */}
        <section className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">Expenses Log</h2>
              <p className="text-xs text-slate-500 font-mono">
                This month ({currentMonth}): {formatCurrency(monthlyExpenseTotal)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => exportExpensesCsv(expenses)}
              className="h-9 px-3 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </button>
          </div>

          <form onSubmit={handleAddExpense} className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
            <input
              type="date"
              value={expDate}
              onChange={(e) => setExpDate(e.target.value)}
              aria-label="Expense date"
              className="h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs"
            />
            <select
              value={expCat}
              onChange={(e) => setExpCat(e.target.value)}
              aria-label="Expense category"
              className="h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs font-medium"
            >
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              value={expMode}
              onChange={(e) => setExpMode(e.target.value as PaymentMode)}
              aria-label="Expense payment mode"
              className="h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs font-medium"
            >
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="card">Card</option>
            </select>
            <input
              type="text"
              value={expDesc}
              onChange={(e) => setExpDesc(e.target.value)}
              placeholder="Description (e.g. 10L Milk)"
              aria-label="Expense description"
              className="col-span-2 sm:col-span-2 h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs"
            />
            <div className="flex gap-1.5">
              <input
                type="number"
                step="0.01"
                min="1"
                required
                value={expAmt}
                onChange={(e) => setExpAmt(e.target.value)}
                placeholder="₹ Amt"
                aria-label="Expense amount"
                className="w-full h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs font-mono"
              />
              <button
                type="submit"
                aria-label="Add expense"
                className="h-9 px-3 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 shrink-0 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </form>

          <div className="max-h-96 overflow-y-auto divide-y divide-slate-100">
            {expenses.length === 0 ? (
              <p className="py-8 text-center text-xs text-slate-400">No expenses logged yet.</p>
            ) : (
              expenses.slice(0, 60).map((e) => (
                <div key={e.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-slate-900">
                      {e.category} {e.description ? `· ${e.description}` : ''}
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono">
                      {e.date} · {e.paymentMode.toUpperCase()} · {e.createdByName}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-mono font-bold text-slate-900 tabular-nums">
                      {formatCurrency(e.amount)}
                    </span>
                    {role === 'owner' && (
                      <button
                        type="button"
                        aria-label={`Delete expense ${e.description || e.category}`}
                        onClick={() =>
                          void onMutate({
                            method: 'DELETE',
                            path: `/api/expenses/${e.id}`,
                            label: 'Delete expense',
                          })
                        }
                        className="w-7 h-7 rounded-md text-slate-400 hover:text-red-600 flex items-center justify-center cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* INVENTORY SECTION */}
        <section className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">Ingredient Stock &amp; Purchases</h2>
              <p className="text-xs text-slate-500">
                Sales automatically deduct recipe ingredients when bills close.
              </p>
            </div>
            <button
              type="button"
              onClick={() => exportInventoryCsv(inventory)}
              className="h-9 px-3 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              CSV
            </button>
          </div>

          <form onSubmit={handlePurchase} className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
            <select
              value={purIngId}
              onChange={(e) => setPurIngId(e.target.value)}
              aria-label="Purchase ingredient"
              className="col-span-2 h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs font-medium"
            >
              {inventory.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.unit})
                </option>
              ))}
            </select>
            <input
              type="number"
              step="0.01"
              min="0.01"
              required
              value={purQty}
              onChange={(e) => setPurQty(e.target.value)}
              placeholder="+ Qty"
              aria-label="Purchase quantity"
              className="h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs font-mono"
            />
            <input
              type="number"
              step="0.01"
              min="0"
              value={purCost}
              onChange={(e) => setPurCost(e.target.value)}
              placeholder="Total ₹"
              aria-label="Purchase total cost"
              className="h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs font-mono"
            />
            <input
              type="text"
              value={purSupplier}
              onChange={(e) => setPurSupplier(e.target.value)}
              placeholder="Supplier (optional)"
              aria-label="Supplier name"
              className="col-span-2 sm:col-span-3 h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs"
            />
            <button
              type="submit"
              className="h-9 px-3 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 inline-flex items-center justify-center gap-1 cursor-pointer"
            >
              <PackagePlus className="w-3.5 h-3.5" />
              Add Stock
            </button>
          </form>

          {role === 'owner' && (
            <form onSubmit={handleAddIngredient} className="flex flex-wrap gap-2 items-center">
              <input
                type="text"
                value={newIngName}
                onChange={(e) => setNewIngName(e.target.value)}
                placeholder="New ingredient name"
                aria-label="New ingredient name"
                className="flex-1 min-w-[140px] h-9 px-2.5 rounded-lg border border-slate-300 text-xs"
              />
              <input
                type="text"
                value={newIngUnit}
                onChange={(e) => setNewIngUnit(e.target.value)}
                placeholder="Unit (pcs/ml)"
                aria-label="New ingredient unit"
                className="w-20 h-9 px-2.5 rounded-lg border border-slate-300 text-xs"
              />
              <input
                type="number"
                value={newIngStock}
                onChange={(e) => setNewIngStock(e.target.value)}
                placeholder="Init"
                aria-label="Initial stock"
                className="w-16 h-9 px-2 rounded-lg border border-slate-300 text-xs font-mono"
              />
              <input
                type="number"
                value={newIngMin}
                onChange={(e) => setNewIngMin(e.target.value)}
                placeholder="Min"
                aria-label="Min stock alert"
                className="w-16 h-9 px-2 rounded-lg border border-slate-300 text-xs font-mono"
              />
              <button
                type="submit"
                className="h-9 px-3 rounded-lg border border-slate-900 text-xs font-semibold text-slate-900 hover:bg-slate-50 cursor-pointer"
              >
                + Ingredient
              </button>
            </form>
          )}

          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-xs text-left">
              <thead className="text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="py-2 pr-2">Ingredient</th>
                  <th className="py-2 px-2 text-right">Stock</th>
                  <th className="py-2 px-2 text-right">Alert Min</th>
                  <th className="py-2 pl-2 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {inventory.map((ing) => {
                  const low = ing.stock <= ing.minStock;
                  return (
                    <tr key={ing.id}>
                      <td className="py-2.5 pr-2 font-medium text-slate-900">{ing.name}</td>
                      <td className="py-2.5 px-2 text-right font-mono font-bold tabular-nums">
                        {ing.stock} {ing.unit}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono text-slate-500 tabular-nums">
                        {ing.minStock}
                      </td>
                      <td className="py-2.5 pl-2 text-right">
                        <span className={low ? 'text-red-700 font-bold' : 'text-emerald-700 font-medium'}>
                          {low ? 'Low Stock' : 'OK'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {purchases.length > 0 && (
            <div className="pt-2 border-t border-slate-100">
              <h3 className="text-xs font-bold text-slate-700 mb-1.5">Recent Purchases</h3>
              <div className="space-y-1 max-h-28 overflow-y-auto">
                {purchases.slice(0, 10).map((p) => (
                  <div key={p.id} className="text-[11px] text-slate-600 flex justify-between">
                    <span>
                      +{p.quantity} {p.unit} {p.ingredientName}
                      {p.supplier ? ` (${p.supplier})` : ''}
                    </span>
                    <span className="font-mono">{formatCurrency(p.totalCost)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
