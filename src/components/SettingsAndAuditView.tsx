import React, { useState } from 'react';
import {
  Database,
  Download,
  HardDriveUpload,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import type {
  AddonOption,
  AuditLogEntry,
  BackupMetadata,
  Bill,
  CafeSettings,
  Expense,
  Ingredient,
  MenuItem,
  Role,
  UserPublic,
} from '../shared/types';
import { formatCurrency } from '../shared/calculations';
import { getStoredToken } from '../services/posClient';
import { exportExpensesCsv, exportSalesCsv } from '../utils/exportUtils';

interface SettingsAndAuditViewProps {
  storageMode: 'mongodb' | 'local-persistent';
  settings: CafeSettings;
  menu: MenuItem[];
  inventory: Ingredient[];
  users: UserPublic[];
  backups: BackupMetadata[];
  auditLogs: AuditLogEntry[];
  bills: Bill[];
  expenses: Expense[];
  onMutate: (opts: {
    method: 'POST' | 'PATCH' | 'DELETE';
    path: string;
    body?: unknown;
    label: string;
  }) => Promise<unknown>;
}

export const SettingsAndAuditView: React.FC<SettingsAndAuditViewProps> = ({
  storageMode,
  settings,
  menu,
  inventory,
  users,
  backups,
  auditLogs,
  bills,
  expenses,
  onMutate,
}) => {
  const [tab, setTab] = useState<'cafe' | 'menu' | 'users' | 'backups' | 'audit'>('cafe');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  // Cafe form state
  const [cafeForm, setCafeForm] = useState({
    cafeName: settings.cafeName,
    address: settings.address,
    phone: settings.phone,
    gstin: settings.gstin,
    tableCount: settings.tableCount,
    gstRate: settings.gstRate,
    upiId: settings.upiId,
    paperSize: settings.paperSize,
    receiptFooter: settings.receiptFooter,
    newOwnerPin: '',
  });
  const [globalAddons, setGlobalAddons] = useState<AddonOption[]>(settings.globalAddons);
  const [newAddonName, setNewAddonName] = useState('');
  const [newAddonPrice, setNewAddonPrice] = useState('0');

  // New menu item state
  const [newItemName, setNewItemName] = useState('');
  const [newItemCat, setNewItemCat] = useState('Burgers');
  const [newItemPrice, setNewItemPrice] = useState('');
  const [newItemTax, setNewItemTax] = useState(String(settings.gstRate));
  const [recipeEditorItem, setRecipeEditorItem] = useState<MenuItem | null>(null);

  // New user state
  const [newUsername, setNewUsername] = useState('');
  const [newUserFullName, setNewUserFullName] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserRole, setNewUserRole] = useState<Role>('waiter');

  // Audit search
  const [auditSearch, setAuditSearch] = useState('');

  const flash = (msg: string) => {
    setError('');
    setNotice(msg);
    setTimeout(() => setNotice(''), 3500);
  };

  const handleSaveCafe = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await onMutate({
        method: 'PATCH',
        path: '/api/settings',
        body: { ...cafeForm, globalAddons },
        label: 'Update cafe settings',
      });
      setCafeForm((prev) => ({ ...prev, newOwnerPin: '' }));
      flash('Cafe & printer settings saved to server.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    }
  };

  const handleAddGlobalAddon = () => {
    if (!newAddonName.trim()) return;
    setGlobalAddons((prev) => [
      ...prev,
      { id: `addon-${Date.now()}`, name: newAddonName.trim(), price: Number(newAddonPrice) || 0 },
    ]);
    setNewAddonName('');
    setNewAddonPrice('0');
  };

  const handleCreateMenuItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await onMutate({
        method: 'POST',
        path: '/api/menu',
        body: {
          name: newItemName,
          category: newItemCat,
          price: Number(newItemPrice) || 0,
          taxPercent: Number(newItemTax) || settings.gstRate,
          addons: globalAddons,
        },
        label: `Add menu item ${newItemName}`,
      });
      setNewItemName('');
      setNewItemPrice('');
      flash('Menu item added.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add item');
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await onMutate({
        method: 'POST',
        path: '/api/users',
        body: {
          username: newUsername,
          name: newUserFullName,
          password: newUserPassword,
          role: newUserRole,
        },
        label: `Create user ${newUsername}`,
      });
      setNewUsername('');
      setNewUserFullName('');
      setNewUserPassword('');
      flash('Staff account created.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user');
    }
  };

  const handleDownloadBackup = async (backupId?: string) => {
    const token = getStoredToken();
    const url = backupId ? `/api/backups/export?id=${encodeURIComponent(backupId)}` : '/api/backups/export';
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      setError('Failed to download backup');
      return;
    }
    const blob = await res.blob();
    const dlUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = dlUrl;
    a.download = `brewdesk-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(dlUrl);
  };

  const handleRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      await onMutate({
        method: 'POST',
        path: '/api/backups/restore',
        body: { backup: parsed },
        label: 'Restore full JSON backup',
      });
      flash('Full database restored from backup.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid backup JSON file');
    } finally {
      e.target.value = '';
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl overflow-x-auto">
          {(
            [
              { id: 'cafe', label: 'Cafe & Printer' },
              { id: 'menu', label: 'Menu & Recipes' },
              { id: 'users', label: 'Staff Users' },
              { id: 'backups', label: 'Backups & Export' },
              { id: 'audit', label: 'Audit Log' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-3.5 py-2 text-xs font-semibold rounded-lg whitespace-nowrap cursor-pointer ${
                tab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="text-xs text-slate-500 flex items-center gap-1.5">
          <Database className="w-3.5 h-3.5" />
          Storage: {storageMode === 'mongodb' ? 'Cloud MongoDB' : 'Durable Server Store'}
        </div>
      </div>

      {notice && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-2.5 text-xs font-semibold text-emerald-800">
          {notice}
        </div>
      )}
      {error && (
        <div role="alert" className="rounded-xl bg-red-50 border border-red-200 px-4 py-2.5 text-xs font-semibold text-red-700">
          {error}
        </div>
      )}

      {/* TAB 1: CAFE & PRINTER */}
      {tab === 'cafe' && (
        <form onSubmit={handleSaveCafe} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-5">
          <h2 className="text-base font-bold text-slate-900">Cafe Profile, GST &amp; Thermal Printer</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label htmlFor="set-name" className="block text-xs font-semibold text-slate-700 mb-1">
                Cafe Name
              </label>
              <input
                id="set-name"
                type="text"
                required
                value={cafeForm.cafeName}
                onChange={(e) => setCafeForm({ ...cafeForm, cafeName: e.target.value })}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
              />
            </div>
            <div>
              <label htmlFor="set-address" className="block text-xs font-semibold text-slate-700 mb-1">
                Address
              </label>
              <input
                id="set-address"
                type="text"
                value={cafeForm.address}
                onChange={(e) => setCafeForm({ ...cafeForm, address: e.target.value })}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
              />
            </div>
            <div>
              <label htmlFor="set-phone" className="block text-xs font-semibold text-slate-700 mb-1">
                Phone
              </label>
              <input
                id="set-phone"
                type="text"
                value={cafeForm.phone}
                onChange={(e) => setCafeForm({ ...cafeForm, phone: e.target.value })}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
              />
            </div>
            <div>
              <label htmlFor="set-gstin" className="block text-xs font-semibold text-slate-700 mb-1">
                GSTIN
              </label>
              <input
                id="set-gstin"
                type="text"
                value={cafeForm.gstin}
                onChange={(e) => setCafeForm({ ...cafeForm, gstin: e.target.value })}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono uppercase"
              />
            </div>
            <div>
              <label htmlFor="set-upi" className="block text-xs font-semibold text-slate-700 mb-1">
                Merchant UPI ID (for Dynamic QR)
              </label>
              <input
                id="set-upi"
                type="text"
                value={cafeForm.upiId}
                onChange={(e) => setCafeForm({ ...cafeForm, upiId: e.target.value })}
                placeholder="yourcafe@okaxis"
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
              />
            </div>
            <div>
              <label htmlFor="set-tables" className="block text-xs font-semibold text-slate-700 mb-1">
                Number of Tables
              </label>
              <input
                id="set-tables"
                type="number"
                min={1}
                max={40}
                value={cafeForm.tableCount}
                onChange={(e) => setCafeForm({ ...cafeForm, tableCount: Number(e.target.value) })}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
              />
            </div>
            <div>
              <label htmlFor="set-gst" className="block text-xs font-semibold text-slate-700 mb-1">
                Default GST Rate (%)
              </label>
              <input
                id="set-gst"
                type="number"
                step="0.5"
                min={0}
                max={28}
                value={cafeForm.gstRate}
                onChange={(e) => setCafeForm({ ...cafeForm, gstRate: Number(e.target.value) })}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
              />
            </div>
            <div>
              <label htmlFor="set-paper" className="block text-xs font-semibold text-slate-700 mb-1">
                Thermal Paper Size
              </label>
              <select
                id="set-paper"
                value={cafeForm.paperSize}
                onChange={(e) =>
                  setCafeForm({ ...cafeForm, paperSize: e.target.value as '58mm' | '80mm' })
                }
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm bg-white"
              >
                <option value="80mm">80mm Thermal</option>
                <option value="58mm">58mm Thermal</option>
              </select>
            </div>
            <div>
              <label htmlFor="set-pin" className="block text-xs font-semibold text-slate-700 mb-1">
                Change Owner Void PIN (leave blank to keep)
              </label>
              <input
                id="set-pin"
                type="password"
                value={cafeForm.newOwnerPin}
                onChange={(e) => setCafeForm({ ...cafeForm, newOwnerPin: e.target.value })}
                placeholder="Min 4 digits"
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
              />
            </div>
          </div>

          <div>
            <label htmlFor="set-footer" className="block text-xs font-semibold text-slate-700 mb-1">
              Receipt Footer Message
            </label>
            <input
              id="set-footer"
              type="text"
              value={cafeForm.receiptFooter}
              onChange={(e) => setCafeForm({ ...cafeForm, receiptFooter: e.target.value })}
              className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
            />
          </div>

          <div className="pt-3 border-t border-slate-200 space-y-2.5">
            <h3 className="text-xs font-bold text-slate-800">Global Add-ons List</h3>
            <div className="flex flex-wrap gap-2">
              {globalAddons.map((a) => (
                <div
                  key={a.id}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs"
                >
                  <span className="font-medium text-slate-900">{a.name}</span>
                  <span className="font-mono text-slate-500">
                    {a.price > 0 ? `+₹${a.price}` : 'Free'}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove add-on ${a.name}`}
                    onClick={() =>
                      setGlobalAddons((prev) => prev.filter((item) => item.id !== a.id))
                    }
                    className="text-slate-400 hover:text-red-600 cursor-pointer"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2 max-w-md">
              <input
                type="text"
                value={newAddonName}
                onChange={(e) => setNewAddonName(e.target.value)}
                placeholder="Add-on name (e.g. Extra cheese)"
                aria-label="New add-on name"
                className="flex-1 h-9 px-3 rounded-lg border border-slate-300 text-xs"
              />
              <input
                type="number"
                value={newAddonPrice}
                onChange={(e) => setNewAddonPrice(e.target.value)}
                placeholder="₹"
                aria-label="New add-on price"
                className="w-20 h-9 px-2.5 rounded-lg border border-slate-300 text-xs font-mono"
              />
              <button
                type="button"
                onClick={handleAddGlobalAddon}
                className="h-9 px-3 rounded-lg border border-slate-300 text-xs font-semibold hover:bg-slate-50 cursor-pointer"
              >
                Add
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="h-11 px-6 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 inline-flex items-center gap-2 cursor-pointer"
          >
            <Save className="w-4 h-4" />
            Save All Settings
          </button>
        </form>
      )}

      {/* TAB 2: MENU & RECIPES */}
      {tab === 'menu' && (
        <div className="space-y-5">
          <form
            onSubmit={handleCreateMenuItem}
            className="bg-white border border-slate-200 rounded-2xl p-4 grid grid-cols-2 sm:grid-cols-5 gap-2.5 items-end"
          >
            <div className="col-span-2 sm:col-span-2">
              <label htmlFor="new-item-name" className="block text-[11px] font-semibold text-slate-600 mb-1">
                New Menu Item Name
              </label>
              <input
                id="new-item-name"
                type="text"
                required
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                placeholder="e.g. Classic Brownie"
                className="w-full h-9 px-3 rounded-lg border border-slate-300 text-xs"
              />
            </div>
            <div>
              <label htmlFor="new-item-cat" className="block text-[11px] font-semibold text-slate-600 mb-1">
                Category
              </label>
              <input
                id="new-item-cat"
                type="text"
                required
                value={newItemCat}
                onChange={(e) => setNewItemCat(e.target.value)}
                className="w-full h-9 px-3 rounded-lg border border-slate-300 text-xs"
              />
            </div>
            <div>
              <label htmlFor="new-item-price" className="block text-[11px] font-semibold text-slate-600 mb-1">
                Price (₹)
              </label>
              <input
                id="new-item-price"
                type="number"
                step="0.01"
                required
                value={newItemPrice}
                onChange={(e) => setNewItemPrice(e.target.value)}
                className="w-full h-9 px-3 rounded-lg border border-slate-300 text-xs font-mono"
              />
            </div>
            <div className="flex gap-2">
              <input
                type="number"
                step="0.5"
                value={newItemTax}
                onChange={(e) => setNewItemTax(e.target.value)}
                aria-label="Tax percent"
                placeholder="GST%"
                className="w-16 h-9 px-2 rounded-lg border border-slate-300 text-xs font-mono"
              />
              <button
                type="submit"
                className="flex-1 h-9 px-3 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 inline-flex items-center justify-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Add
              </button>
            </div>
          </form>

          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4">Item</th>
                    <th className="py-3 px-4">Category</th>
                    <th className="py-3 px-4">Price (₹)</th>
                    <th className="py-3 px-4">Tax %</th>
                    <th className="py-3 px-4">Availability</th>
                    <th className="py-3 px-4">Recipe</th>
                    <th className="py-3 px-4 text-right">Delete</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {menu.map((item) => (
                    <tr key={item.id}>
                      <td className="py-2.5 px-4 font-semibold text-slate-900">
                        {item.name}
                        {item.priceUnset && (
                          <span className="ml-2 text-[11px] font-bold text-amber-700">Set Price</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-slate-600">{item.category}</td>
                      <td className="py-2.5 px-4">
                        <input
                          type="number"
                          step="1"
                          defaultValue={item.price}
                          aria-label={`Price for ${item.name}`}
                          onBlur={(e) => {
                            const val = Number(e.target.value);
                            if (Number.isFinite(val) && val !== item.price) {
                              void onMutate({
                                method: 'PATCH',
                                path: `/api/menu/${item.id}`,
                                body: { price: val },
                                label: `Update price ${item.name}`,
                              });
                            }
                          }}
                          className="w-24 h-8 px-2 rounded-lg border border-slate-300 font-mono text-xs"
                        />
                      </td>
                      <td className="py-2.5 px-4">
                        <input
                          type="number"
                          step="0.5"
                          defaultValue={item.taxPercent}
                          aria-label={`Tax percent for ${item.name}`}
                          onBlur={(e) => {
                            const val = Number(e.target.value);
                            if (Number.isFinite(val) && val !== item.taxPercent) {
                              void onMutate({
                                method: 'PATCH',
                                path: `/api/menu/${item.id}`,
                                body: { taxPercent: val },
                                label: `Update tax ${item.name}`,
                              });
                            }
                          }}
                          className="w-16 h-8 px-2 rounded-lg border border-slate-300 font-mono text-xs"
                        />
                      </td>
                      <td className="py-2.5 px-4">
                        <button
                          type="button"
                          onClick={() =>
                            void onMutate({
                              method: 'PATCH',
                              path: `/api/menu/${item.id}`,
                              body: { soldOut: !item.soldOut },
                              label: `Toggle soldOut ${item.name}`,
                            })
                          }
                          className={`px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer ${
                            item.soldOut
                              ? 'bg-red-50 text-red-700 border border-red-200'
                              : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          }`}
                        >
                          {item.soldOut ? 'Sold Out' : 'Available'}
                        </button>
                      </td>
                      <td className="py-2.5 px-4">
                        <button
                          type="button"
                          onClick={() => setRecipeEditorItem(item)}
                          className="text-xs font-semibold text-slate-700 underline hover:text-slate-900 cursor-pointer"
                        >
                          {item.recipe.length} ing
                        </button>
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <button
                          type="button"
                          aria-label={`Delete ${item.name}`}
                          onClick={() =>
                            void onMutate({
                              method: 'DELETE',
                              path: `/api/menu/${item.id}`,
                              label: `Delete ${item.name}`,
                            })
                          }
                          className="w-8 h-8 rounded-lg text-slate-400 hover:text-red-600 inline-flex items-center justify-center cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {recipeEditorItem && (
            <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900">
                  Recipe Stock Deduction · {recipeEditorItem.name}
                </h3>
                <button
                  type="button"
                  onClick={() => setRecipeEditorItem(null)}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-900"
                >
                  Close
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {inventory.map((ing) => {
                  const existing = recipeEditorItem.recipe.find((r) => r.ingredientId === ing.id);
                  return (
                    <div key={ing.id} className="flex items-center justify-between p-2 rounded-lg border border-slate-200 text-xs">
                      <span>
                        {ing.name} ({ing.unit})
                      </span>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        defaultValue={existing?.quantity || 0}
                        onBlur={(e) => {
                          const qty = Number(e.target.value) || 0;
                          const nextRecipe = recipeEditorItem.recipe.filter(
                            (r) => r.ingredientId !== ing.id
                          );
                          if (qty > 0) nextRecipe.push({ ingredientId: ing.id, quantity: qty });
                          setRecipeEditorItem({ ...recipeEditorItem, recipe: nextRecipe });
                          void onMutate({
                            method: 'PATCH',
                            path: `/api/menu/${recipeEditorItem.id}`,
                            body: { recipe: nextRecipe },
                            label: `Update recipe ${recipeEditorItem.name}`,
                          });
                        }}
                        className="w-20 h-7 px-2 rounded border border-slate-300 font-mono text-right"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: STAFF USERS */}
      {tab === 'users' && (
        <div className="space-y-5">
          <form
            onSubmit={handleCreateUser}
            className="bg-white border border-slate-200 rounded-2xl p-4 grid grid-cols-2 sm:grid-cols-5 gap-2.5 items-end"
          >
            <div>
              <label htmlFor="u-username" className="block text-[11px] font-semibold text-slate-600 mb-1">
                Username
              </label>
              <input
                id="u-username"
                type="text"
                required
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                className="w-full h-9 px-3 rounded-lg border border-slate-300 text-xs"
              />
            </div>
            <div>
              <label htmlFor="u-name" className="block text-[11px] font-semibold text-slate-600 mb-1">
                Full Name
              </label>
              <input
                id="u-name"
                type="text"
                required
                value={newUserFullName}
                onChange={(e) => setNewUserFullName(e.target.value)}
                className="w-full h-9 px-3 rounded-lg border border-slate-300 text-xs"
              />
            </div>
            <div>
              <label htmlFor="u-pass" className="block text-[11px] font-semibold text-slate-600 mb-1">
                Password
              </label>
              <input
                id="u-pass"
                type="password"
                required
                minLength={4}
                value={newUserPassword}
                onChange={(e) => setNewUserPassword(e.target.value)}
                className="w-full h-9 px-3 rounded-lg border border-slate-300 text-xs"
              />
            </div>
            <div>
              <label htmlFor="u-role" className="block text-[11px] font-semibold text-slate-600 mb-1">
                Role
              </label>
              <select
                id="u-role"
                value={newUserRole}
                onChange={(e) => setNewUserRole(e.target.value as Role)}
                className="w-full h-9 px-2.5 rounded-lg border border-slate-300 text-xs bg-white"
              >
                <option value="waiter">Waiter (Orders only)</option>
                <option value="cashier">Cashier (Bills &amp; Pay)</option>
                <option value="owner">Owner (Full access)</option>
              </select>
            </div>
            <button
              type="submit"
              className="h-9 px-4 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 cursor-pointer"
            >
              Add Staff
            </button>
          </form>

          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Name</th>
                  <th className="py-3 px-4">Username</th>
                  <th className="py-3 px-4">Role</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Toggle Active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="py-3 px-4 font-semibold text-slate-900">{u.name}</td>
                    <td className="py-3 px-4 font-mono text-slate-600">{u.username}</td>
                    <td className="py-3 px-4 uppercase font-semibold text-slate-700">{u.role}</td>
                    <td className="py-3 px-4">
                      <span className={u.active ? 'text-emerald-700 font-semibold' : 'text-slate-400'}>
                        {u.active ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          void onMutate({
                            method: 'PATCH',
                            path: `/api/users/${u.id}`,
                            body: { active: !u.active },
                            label: `Toggle user ${u.username}`,
                          })
                        }
                        className="px-3 py-1 rounded-lg border border-slate-200 text-xs font-semibold hover:bg-slate-50 cursor-pointer"
                      >
                        {u.active ? 'Disable' : 'Enable'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: BACKUPS & RESTORE */}
      {tab === 'backups' && (
        <div className="space-y-5">
          <div className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">Cloud Backups &amp; Exports</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Automatic daily backups run once per day. Download JSON anytime or restore from an older snapshot.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  void onMutate({ method: 'POST', path: '/api/backups/run', label: 'Run manual backup' })
                }
                className="h-10 px-4 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-800 hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <ShieldCheck className="w-4 h-4" />
                Snapshot Now
              </button>
              <button
                type="button"
                onClick={() => void handleDownloadBackup()}
                className="h-10 px-4 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                Download Full JSON
              </button>
              <label className="h-10 px-4 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 text-xs font-semibold hover:bg-amber-100 inline-flex items-center gap-1.5 cursor-pointer">
                <HardDriveUpload className="w-4 h-4" />
                Restore JSON
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={handleRestoreFile}
                  className="hidden"
                />
              </label>
              <button
                type="button"
                onClick={() => exportSalesCsv(bills)}
                className="h-10 px-3.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Export Sales CSV
              </button>
              <button
                type="button"
                onClick={() => exportExpensesCsv(expenses)}
                className="h-10 px-3.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Export Expenses CSV
              </button>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Snapshot Time</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4">Records</th>
                  <th className="py-3 px-4 text-right">Size</th>
                  <th className="py-3 px-4 text-right">Download</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {backups.map((b) => (
                  <tr key={b.id}>
                    <td className="py-3 px-4 font-mono text-slate-900">
                      {new Date(b.createdAt).toLocaleString('en-IN')}
                    </td>
                    <td className="py-3 px-4 uppercase font-semibold text-slate-600">{b.type}</td>
                    <td className="py-3 px-4 text-slate-600">
                      {b.counts.bills} bills · {b.counts.menu} menu · {b.counts.expenses} expenses
                    </td>
                    <td className="py-3 px-4 text-right font-mono">
                      {(b.sizeBytes / 1024).toFixed(1)} KB
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => void handleDownloadBackup(b.id)}
                        className="px-3 py-1 rounded-lg border border-slate-200 text-xs font-semibold hover:bg-slate-50 cursor-pointer"
                      >
                        JSON
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 5: AUDIT LOG */}
      {tab === 'audit' && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">Staff &amp; System Audit Log</h2>
              <p className="text-xs text-slate-500">Every order, KOT, discount, void, bill, and setting change.</p>
            </div>
            <input
              type="search"
              value={auditSearch}
              onChange={(e) => setAuditSearch(e.target.value)}
              placeholder="Filter by user, action, details..."
              aria-label="Filter audit logs"
              className="h-9 px-3 rounded-lg border border-slate-200 text-xs w-full sm:w-64"
            />
          </div>
          <div className="max-h-[520px] overflow-y-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 sticky top-0">
                <tr>
                  <th className="py-2.5 px-4">Timestamp</th>
                  <th className="py-2.5 px-4">User</th>
                  <th className="py-2.5 px-4">Action</th>
                  <th className="py-2.5 px-4">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {auditLogs
                  .filter((a) => {
                    const q = auditSearch.trim().toLowerCase();
                    if (!q) return true;
                    return (
                      a.userName.toLowerCase().includes(q) ||
                      a.action.toLowerCase().includes(q) ||
                      a.details.toLowerCase().includes(q)
                    );
                  })
                  .slice(0, 200)
                  .map((a) => (
                    <tr key={a.id}>
                      <td className="py-2.5 px-4 font-mono text-slate-500 whitespace-nowrap">
                        {new Date(a.timestamp).toLocaleString('en-IN')}
                      </td>
                      <td className="py-2.5 px-4 font-medium text-slate-900 whitespace-nowrap">
                        {a.userName} <span className="text-slate-400">({a.role})</span>
                      </td>
                      <td className="py-2.5 px-4 font-mono font-semibold text-slate-700 whitespace-nowrap">
                        {a.action}
                      </td>
                      <td className="py-2.5 px-4 text-slate-700">{a.details}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
