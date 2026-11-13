import React, { useEffect, useState } from 'react';
import { CheckCircle2, ChefHat, Clock, Flame, Printer } from 'lucide-react';
import type { KotStatus, KotTicket } from '../shared/types';
import { formatElapsed } from '../shared/calculations';

interface KitchenDisplayProps {
  kots: KotTicket[];
  onUpdateStatus: (kotId: string, status: KotStatus) => Promise<void>;
  onPrintKot: (kot: KotTicket) => void;
}

export const KitchenDisplay: React.FC<KitchenDisplayProps> = ({
  kots,
  onUpdateStatus,
  onPrintKot,
}) => {
  const [nowMs, setNowMs] = useState(Date.now());
  const [showReadyHistory, setShowReadyHistory] = useState(true);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);

  const columns: { status: KotStatus; title: string; nextLabel?: string; nextStatus?: KotStatus }[] = [
    { status: 'new', title: 'New Orders', nextLabel: 'Start Preparing', nextStatus: 'preparing' },
    { status: 'preparing', title: 'Preparing', nextLabel: 'Mark Ready', nextStatus: 'ready' },
    { status: 'ready', title: 'Ready to Serve' },
  ];

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Live Kitchen Display (KDS)</h2>
          <p className="text-xs text-slate-500">
            Updates in real time across all counter and kitchen screens.
          </p>
        </div>
        <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={showReadyHistory}
            onChange={(e) => setShowReadyHistory(e.target.checked)}
            className="rounded border-slate-300"
          />
          Show Ready Tickets
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {columns
          .filter((col) => (col.status === 'ready' ? showReadyHistory : true))
          .map((col) => {
            const list = kots.filter((k) => k.status === col.status).slice(0, 30);
            return (
              <div
                key={col.status}
                className="bg-white border border-slate-200 rounded-2xl flex flex-col min-h-[360px]"
              >
                <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {col.status === 'new' && <Flame className="w-4 h-4 text-amber-600" />}
                    {col.status === 'preparing' && <ChefHat className="w-4 h-4 text-slate-700" />}
                    {col.status === 'ready' && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                    <h3 className="text-sm font-bold text-slate-900">{col.title}</h3>
                  </div>
                  <span className="text-xs font-mono font-bold text-slate-500">{list.length}</span>
                </div>

                <div className="p-3 space-y-3 flex-1 overflow-y-auto">
                  {list.length === 0 ? (
                    <div className="py-12 text-center text-xs text-slate-400">No tickets</div>
                  ) : (
                    list.map((kot) => (
                      <div
                        key={kot.id}
                        className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-2.5"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-sm font-bold text-slate-900">
                              KOT #{kot.kotNumber} · {kot.tableLabel}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {kot.orderType === 'dine_in' ? 'Dine-in' : 'Takeaway'} · {kot.createdByName}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-amber-700 inline-flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {formatElapsed(kot.createdAt, nowMs)}
                            </span>
                            <button
                              type="button"
                              aria-label={`Print KOT #${kot.kotNumber}`}
                              onClick={() => onPrintKot(kot)}
                              className="w-8 h-8 rounded-lg border border-slate-200 bg-white flex items-center justify-center text-slate-600 hover:text-slate-900 cursor-pointer"
                            >
                              <Printer className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <ul className="space-y-1.5 border-t border-slate-200 pt-2">
                          {kot.items.map((it, idx) => (
                            <li key={idx} className="text-xs">
                              <div className="flex justify-between font-semibold text-slate-900">
                                <span>{it.name}</span>
                                <span className="font-mono">x{it.qty}</span>
                              </div>
                              {it.addons.length > 0 && (
                                <div className="text-[11px] text-slate-600">+ {it.addons.join(', ')}</div>
                              )}
                              {it.notes && (
                                <div className="text-[11px] font-semibold text-amber-800">
                                  Note: {it.notes}
                                </div>
                              )}
                            </li>
                          ))}
                        </ul>

                        {col.nextStatus && col.nextLabel && (
                          <button
                            type="button"
                            onClick={() => void onUpdateStatus(kot.id, col.nextStatus!)}
                            className={`w-full h-9 rounded-lg text-xs font-bold text-white transition-colors cursor-pointer ${
                              col.status === 'new'
                                ? 'bg-slate-900 hover:bg-slate-800'
                                : 'bg-emerald-600 hover:bg-emerald-700'
                            }`}
                          >
                            {col.nextLabel}
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
};
