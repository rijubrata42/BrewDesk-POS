import React, { useState } from 'react';
import { ArrowLeftRight, ArrowRight, ShieldAlert, X } from 'lucide-react';
import type { AddonOption, MenuItem, OrderItem, TableInfo } from '../shared/types';
import { formatCurrency } from '../shared/calculations';

interface ShiftSwapModalProps {
  mode: 'shift' | 'swap';
  sourceTable: TableInfo;
  tables: TableInfo[];
  onClose: () => void;
  onConfirm: (targetTableId: string) => Promise<void>;
}

export const ShiftSwapModal: React.FC<ShiftSwapModalProps> = ({
  mode,
  sourceTable,
  tables,
  onClose,
  onConfirm,
}) => {
  const [targetId, setTargetId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const candidates = tables.filter((t) => t.id !== sourceTable.id);

  const submit = async () => {
    if (!targetId) return;
    setLoading(true);
    setError('');
    try {
      await onConfirm(targetId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            {mode === 'shift' ? (
              <ArrowRight className="w-4 h-4 text-slate-700" />
            ) : (
              <ArrowLeftRight className="w-4 h-4 text-slate-700" />
            )}
            <h3 className="text-base font-bold text-slate-900">
              {mode === 'shift' ? `Shift / Merge ${sourceTable.label}` : `Swap ${sourceTable.label} With`}
            </h3>
          </div>
          <button
            type="button"
            aria-label="Close modal"
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          <p className="text-xs text-slate-500">
            {mode === 'shift'
              ? 'Select a free table to move this order, or an occupied table to merge both orders together.'
              : 'Select any table to swap orders cleanly between the two tables.'}
          </p>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-60 overflow-y-auto">
            {candidates.map((t) => {
              const selected = targetId === t.id;
              const busy = Boolean(t.activeOrderId);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTargetId(t.id)}
                  className={`p-3 rounded-xl border text-center transition-colors cursor-pointer ${
                    selected
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : busy
                      ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
                      : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
                  }`}
                >
                  <div className="text-sm font-bold">{t.label}</div>
                  <div className={`text-[10px] mt-0.5 ${selected ? 'text-slate-300' : 'text-slate-500'}`}>
                    {busy ? (mode === 'shift' ? 'Merge' : 'Occupied') : 'Free'}
                  </div>
                </button>
              );
            })}
          </div>
          {error && <p className="text-xs text-red-600 font-medium">{error}</p>}
        </div>

        <div className="p-4 border-t border-slate-200 flex gap-2 bg-slate-50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 h-10 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!targetId || loading}
            onClick={() => void submit()}
            className="flex-1 h-10 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-50"
          >
            {loading ? 'Processing...' : mode === 'shift' ? 'Confirm Shift / Merge' : 'Confirm Swap'}
          </button>
        </div>
      </div>
    </div>
  );
};

interface VoidPinModalProps {
  title: string;
  subtitle: string;
  maxQty?: number;
  onClose: () => void;
  onConfirm: (reason: string, ownerPin: string, qty?: number) => Promise<void>;
}

export const VoidPinModal: React.FC<VoidPinModalProps> = ({
  title,
  subtitle,
  maxQty,
  onClose,
  onConfirm,
}) => {
  const [reason, setReason] = useState('');
  const [ownerPin, setOwnerPin] = useState('');
  const [qty, setQty] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await onConfirm(reason, ownerPin, qty);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Void authorization failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-sm overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2 text-red-700">
            <ShieldAlert className="w-4 h-4" />
            <h3 className="text-sm font-bold">{title}</h3>
          </div>
          <button
            type="button"
            aria-label="Close void modal"
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3.5">
          <p className="text-xs text-slate-600">{subtitle}</p>

          {maxQty && maxQty > 1 && (
            <div>
              <label htmlFor="void-qty" className="block text-xs font-semibold text-slate-700 mb-1">
                Quantity to Void (max {maxQty})
              </label>
              <input
                id="void-qty"
                type="number"
                min={1}
                max={maxQty}
                value={qty}
                onChange={(e) => setQty(Math.min(maxQty, Math.max(1, Number(e.target.value) || 1)))}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
              />
            </div>
          )}

          <div>
            <label htmlFor="void-reason" className="block text-xs font-semibold text-slate-700 mb-1">
              Void Reason (logged in Audit Log)
            </label>
            <input
              id="void-reason"
              type="text"
              required
              minLength={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Customer changed mind / wrong item"
              className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
            />
          </div>

          <div>
            <label htmlFor="void-pin" className="block text-xs font-semibold text-slate-700 mb-1">
              Owner PIN
            </label>
            <input
              id="void-pin"
              type="password"
              inputMode="numeric"
              required
              value={ownerPin}
              onChange={(e) => setOwnerPin(e.target.value)}
              placeholder="Enter 4-digit Owner PIN"
              className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
            />
          </div>

          {error && (
            <div role="alert" className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-slate-200 flex gap-2 bg-slate-50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 h-10 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="flex-1 h-10 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 disabled:opacity-60"
          >
            {loading ? 'Authorizing...' : 'Confirm Void'}
          </button>
        </div>
      </form>
    </div>
  );
};

interface CustomizeItemModalProps {
  menuItem?: MenuItem;
  orderItem?: OrderItem;
  globalAddons: AddonOption[];
  onClose: () => void;
  onConfirm: (addons: AddonOption[], notes: string) => Promise<void>;
}

export const CustomizeItemModal: React.FC<CustomizeItemModalProps> = ({
  menuItem,
  orderItem,
  globalAddons,
  onClose,
  onConfirm,
}) => {
  const initialAddons = orderItem?.addons || [];
  const [selected, setSelected] = useState<AddonOption[]>(initialAddons);
  const [notes, setNotes] = useState(orderItem?.notes || menuItem?.defaultNotes || '');
  const [saving, setSaving] = useState(false);

  const availableAddons =
    menuItem && menuItem.addons.length > 0 ? menuItem.addons : globalAddons;

  const toggleAddon = (a: AddonOption) => {
    setSelected((prev) =>
      prev.some((p) => p.id === a.id) ? prev.filter((p) => p.id !== a.id) : [...prev, a]
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onConfirm(selected, notes);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h3 className="text-sm font-bold text-slate-900">
            Customize · {menuItem?.name || orderItem?.name}
          </h3>
          <button
            type="button"
            aria-label="Close customize modal"
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <div className="text-xs font-semibold text-slate-700 mb-2">Add-ons &amp; Modifiers</div>
            <div className="space-y-1.5">
              {availableAddons.map((a) => {
                const checked = selected.some((s) => s.id === a.id);
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => toggleAddon(a)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border text-xs font-medium transition-colors ${
                      checked
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
                    }`}
                  >
                    <span>{a.name}</span>
                    <span className="font-mono">
                      {a.price > 0 ? `+${formatCurrency(a.price)}` : 'Free'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label htmlFor="kitchen-note" className="block text-xs font-semibold text-slate-700 mb-1.5">
              Kitchen Note
            </label>
            <input
              id="kitchen-note"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Less ice, extra crispy, pack separately"
              className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
            />
          </div>
        </div>

        <div className="p-4 border-t border-slate-200 flex gap-2 bg-slate-50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 h-10 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="flex-1 h-10 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
          >
            {saving ? 'Saving...' : orderItem ? 'Update Item' : 'Add to Order'}
          </button>
        </div>
      </div>
    </div>
  );
};
