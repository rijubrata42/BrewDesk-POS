import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ChefHat,
  ClipboardList,
  LogOut,
  Package,
  RefreshCw,
  Receipt,
  Settings,
  Store,
  WifiOff,
} from 'lucide-react';
import type {
  Bill,
  KotStatus,
  KotTicket,
  PosStateSnapshot,
  UserPublic,
} from './shared/types';
import {
  apiRequest,
  clearAuthSession,
  getStoredToken,
  getStoredUser,
  getWsUrl,
  isNetworkError,
  loadCachedState,
  loadOfflineQueue,
  saveCachedState,
  saveOfflineQueue,
  setAuthSession,
  type QueuedMutation,
} from './services/posClient';
import { LoginScreen } from './components/LoginScreen';
import { PWAInstallButton } from './components/PWAInstallButton';
import { PosWorkspace } from './components/PosWorkspace';
import { KitchenDisplay } from './components/KitchenDisplay';
import { BillsAndRegisterView } from './components/BillsAndRegisterView';
import { ExpensesInventoryView } from './components/ExpensesInventoryView';
import { ReportsView } from './components/ReportsView';
import { SettingsAndAuditView } from './components/SettingsAndAuditView';
import { ReceiptModal } from './components/ReceiptModal';

type NavTab = 'pos' | 'kitchen' | 'bills' | 'stock' | 'reports' | 'settings';

export default function App() {
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  const [user, setUser] = useState<UserPublic | null>(() => getStoredUser());
  const [state, setState] = useState<PosStateSnapshot | null>(() => loadCachedState());
  const [loading, setLoading] = useState<boolean>(Boolean(getStoredToken()));
  const [activeTab, setActiveTab] = useState<NavTab>('pos');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [offlineQueue, setOfflineQueue] = useState<QueuedMutation[]>(() => loadOfflineQueue());
  const [syncingQueue, setSyncingQueue] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [globalError, setGlobalError] = useState('');

  const [receiptBill, setReceiptBill] = useState<Bill | null>(null);
  const [receiptKot, setReceiptKot] = useState<KotTicket | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const flushingRef = useRef(false);

  const updateSnapshot = useCallback((next: PosStateSnapshot) => {
    setState(next);
    saveCachedState(next);
  }, []);

  const handleLogout = useCallback(() => {
    clearAuthSession();
    setToken(null);
    setUser(null);
    setState(null);
    setSelectedOrderId(null);
    setActiveTab('pos');
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const fetchFullState = useCallback(async () => {
    if (!getStoredToken()) return;
    try {
      const snap = await apiRequest<PosStateSnapshot>('GET', '/api/state');
      updateSnapshot(snap);
      setIsOnline(true);
      setGlobalError('');
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 401) {
        handleLogout();
      } else if (isNetworkError(err)) {
        setIsOnline(false);
      }
    } finally {
      setLoading(false);
    }
  }, [handleLogout, updateSnapshot]);

  const flushOfflineQueue = useCallback(async () => {
    if (flushingRef.current || !getStoredToken()) return;
    const queue = loadOfflineQueue();
    if (queue.length === 0) return;

    flushingRef.current = true;
    setSyncingQueue(true);
    try {
      const remaining = [...queue];
      while (remaining.length > 0) {
        const next = remaining[0];
        try {
          const res = await apiRequest<{ state?: PosStateSnapshot }>(
            next.method,
            next.path,
            next.body
          );
          remaining.shift();
          saveOfflineQueue(remaining);
          setOfflineQueue([...remaining]);
          if (res?.state) updateSnapshot(res.state);
          setIsOnline(true);
        } catch (err) {
          if (isNetworkError(err)) {
            setIsOnline(false);
            break;
          }
          // Server validation error on queued item — drop invalid item and alert user
          remaining.shift();
          saveOfflineQueue(remaining);
          setOfflineQueue([...remaining]);
          setGlobalError(
            `Skipped offline action "${next.label}": ${
              err instanceof Error ? err.message : 'Server rejected'
            }`
          );
        }
      }
      if (remaining.length === 0) {
        await fetchFullState();
      }
    } finally {
      flushingRef.current = false;
      setSyncingQueue(false);
    }
  }, [fetchFullState, updateSnapshot]);

  // Connectivity listeners
  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true);
      void flushOfflineQueue();
    };
    const onOffline = () => {
      setIsOnline(false);
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [flushOfflineQueue]);

  // Initial load + WebSocket real-time sync
  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }

    void fetchFullState().then(() => flushOfflineQueue());

    let disposed = false;
    const connectWs = () => {
      if (disposed || !getStoredToken()) return;
      const wsUrl = getWsUrl(token);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
        setIsOnline(true);
        void flushOfflineQueue();
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if ((msg.type === 'state:init' || msg.type === 'state:sync') && msg.state) {
            updateSnapshot(msg.state as PosStateSnapshot);
          }
        } catch {
          // Ignore invalid WS frames
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (!disposed) {
          reconnectTimerRef.current = window.setTimeout(connectWs, 3000);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connectWs();

    return () => {
      disposed = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [token, fetchFullState, flushOfflineQueue, updateSnapshot]);

  const handleMutate = useCallback(
    async <T,>(opts: {
      method: 'POST' | 'PATCH' | 'DELETE';
      path: string;
      body?: unknown;
      label: string;
    }): Promise<T | null> => {
      try {
        const res = await apiRequest<T & { state?: PosStateSnapshot }>(
          opts.method,
          opts.path,
          opts.body
        );
        if (res?.state) updateSnapshot(res.state);
        setIsOnline(true);
        setGlobalError('');
        return res;
      } catch (err) {
        if (isNetworkError(err)) {
          setIsOnline(false);
          const item: QueuedMutation = {
            id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            method: opts.method,
            path: opts.path,
            body: opts.body,
            label: opts.label,
            queuedAt: new Date().toISOString(),
          };
          const nextQueue = [...loadOfflineQueue(), item];
          saveOfflineQueue(nextQueue);
          setOfflineQueue(nextQueue);
          return null;
        }
        throw err;
      }
    },
    [updateSnapshot]
  );

  if (!token || !user) {
    return (
      <LoginScreen
        onSuccess={(newToken, newUser) => {
          setAuthSession(newToken, newUser);
          setToken(newToken);
          setUser(newUser);
          setLoading(true);
        }}
      />
    );
  }

  if (loading && !state) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-center space-y-2">
          <div className="w-8 h-8 border-2 border-slate-900 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs font-medium text-slate-500">Syncing cafe database...</p>
        </div>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-6 max-w-sm text-center space-y-3">
          <p className="text-sm font-bold text-slate-900">Unable to load POS state</p>
          <button
            type="button"
            onClick={() => void fetchFullState()}
            className="h-10 px-4 rounded-lg bg-slate-900 text-white text-xs font-semibold"
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  const navItems: { id: NavTab; label: string; icon: React.ComponentType<{ className?: string }>; roles: UserPublic['role'][] }[] = [
    { id: 'pos', label: 'POS & Tables', icon: Store, roles: ['owner', 'cashier', 'waiter'] },
    { id: 'kitchen', label: 'Kitchen', icon: ChefHat, roles: ['owner', 'cashier', 'waiter'] },
    { id: 'bills', label: 'Bills & Day', icon: Receipt, roles: ['owner', 'cashier'] },
    { id: 'stock', label: 'Expenses & Stock', icon: Package, roles: ['owner', 'cashier'] },
    { id: 'reports', label: 'Reports', icon: ClipboardList, roles: ['owner', 'cashier'] },
    { id: 'settings', label: 'Settings', icon: Settings, roles: ['owner'] },
  ];

  const visibleNav = navItems.filter((item) => item.roles.includes(user.role));

  return (
    <div className="min-h-screen h-screen flex flex-col bg-slate-50 overflow-hidden">
      {/* TOP BAR (3-Zone Contract) */}
      <header className="h-12 md:h-14 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4 shrink-0 no-print">
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-base sm:text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
            {state.settings.cafeName}
          </span>
        </div>

        <nav className="hidden md:flex items-center gap-5 overflow-x-auto">
          {visibleNav.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`py-1.5 text-sm font-semibold whitespace-nowrap shrink-0 border-b-2 transition-colors cursor-pointer ${
                  active
                    ? 'border-slate-900 text-slate-900'
                    : 'border-transparent text-slate-500 hover:text-slate-900'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-2.5 shrink-0">
          <PWAInstallButton />
          <span className="hidden sm:inline text-xs text-slate-500 whitespace-nowrap">
            {user.name} · {user.role}
          </span>
          <button
            type="button"
            onClick={handleLogout}
            aria-label="Sign out"
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Sign Out</span>
          </button>
        </div>
      </header>

      {/* OFFLINE / PENDING SYNC BANNER */}
      {(!isOnline || offlineQueue.length > 0) && (
        <div
          role="status"
          className="bg-amber-500 text-white px-4 py-2 text-xs font-semibold flex flex-wrap items-center justify-between gap-2 shrink-0 no-print"
        >
          <div className="flex items-center gap-2">
            <WifiOff className="w-4 h-4 shrink-0" />
            <span>
              {!isOnline
                ? 'Offline Mode — Screen remains usable. Actions are saved locally and will sync in order when connection returns.'
                : `${offlineQueue.length} pending offline action(s) waiting to sync to server.`}
            </span>
          </div>
          {offlineQueue.length > 0 && (
            <button
              type="button"
              disabled={syncingQueue}
              onClick={() => void flushOfflineQueue()}
              className="px-3 py-1 rounded-md bg-white text-amber-900 font-bold text-xs inline-flex items-center gap-1 cursor-pointer"
            >
              <RefreshCw className={`w-3 h-3 ${syncingQueue ? 'animate-spin' : ''}`} />
              {syncingQueue ? 'Syncing...' : `Sync Now (${offlineQueue.length})`}
            </button>
          )}
        </div>
      )}

      {globalError && (
        <div
          role="alert"
          className="bg-red-50 border-b border-red-200 px-4 py-2 text-xs font-medium text-red-700 flex items-center justify-between shrink-0 no-print"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{globalError}</span>
          </div>
          <button
            type="button"
            onClick={() => setGlobalError('')}
            className="text-red-700 font-bold px-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* MAIN WORKSPACE */}
      <main className="flex-1 min-h-0 overflow-y-auto pb-16 md:pb-0">
        {activeTab === 'pos' && (
          <PosWorkspace
            role={user.role}
            settings={state.settings}
            menu={state.menu}
            tables={state.tables}
            orders={state.orders}
            selectedOrderId={selectedOrderId}
            onSelectOrderId={setSelectedOrderId}
            onMutate={handleMutate}
            onBillCreated={(bill) => setReceiptBill(bill)}
            onKotCreated={(kot) => setReceiptKot(kot)}
            onNavigateToMenuSettings={
              user.role === 'owner' ? () => setActiveTab('settings') : undefined
            }
          />
        )}

        {activeTab === 'kitchen' && (
          <KitchenDisplay
            kots={state.kots}
            onUpdateStatus={async (kotId: string, status: KotStatus) => {
              await handleMutate({
                method: 'PATCH',
                path: `/api/kots/${kotId}/status`,
                body: { status },
                label: `KOT ${status}`,
              });
            }}
            onPrintKot={(kot) => setReceiptKot(kot)}
          />
        )}

        {activeTab === 'bills' && (
          <BillsAndRegisterView
            role={user.role}
            settings={state.settings}
            bills={state.bills}
            expenses={state.expenses}
            daySessions={state.daySessions}
            onOpenDay={async (openingCash) => {
              await handleMutate({
                method: 'POST',
                path: '/api/day/open',
                body: { openingCash },
                label: 'Open day register',
              });
            }}
            onCloseDay={async (countedCash, notes) => {
              await handleMutate({
                method: 'POST',
                path: '/api/day/close',
                body: { countedCash, notes },
                label: 'Close day register',
              });
            }}
            onVoidBill={async (billId, reason, ownerPin) => {
              await handleMutate({
                method: 'POST',
                path: `/api/bills/${billId}/void`,
                body: { reason, ownerPin },
                label: 'Void bill',
              });
            }}
            onViewReceipt={(bill) => setReceiptBill(bill)}
          />
        )}

        {activeTab === 'stock' && (
          <ExpensesInventoryView
            role={user.role}
            expenses={state.expenses}
            inventory={state.inventory}
            purchases={state.purchases}
            onMutate={handleMutate}
          />
        )}

        {activeTab === 'reports' && (
          <ReportsView
            role={user.role}
            bills={state.bills}
            expenses={state.expenses}
            menu={state.menu}
          />
        )}

        {activeTab === 'settings' && user.role === 'owner' && (
          <SettingsAndAuditView
            storageMode={state.storageMode}
            settings={state.settings}
            menu={state.menu}
            inventory={state.inventory}
            users={state.users}
            backups={state.backups}
            auditLogs={state.auditLogs}
            bills={state.bills}
            expenses={state.expenses}
            onMutate={handleMutate}
          />
        )}
      </main>

      {/* MOBILE BOTTOM NAVIGATION */}
      <nav
        aria-label="Mobile navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 h-12 bg-white border-t border-slate-200 flex items-center justify-around px-1 no-print"
      >
        {visibleNav.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`flex flex-col items-center justify-center min-w-[44px] h-11 rounded-lg text-[10px] font-semibold ${
                active ? 'text-slate-900' : 'text-slate-400'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="truncate max-w-[56px] leading-tight">{item.label.split(' ')[0]}</span>
            </button>
          );
        })}
      </nav>

      {/* RECEIPT / KOT PRINT MODAL */}
      {(receiptBill || receiptKot) && (
        <ReceiptModal
          bill={receiptBill}
          kot={receiptKot}
          settings={state.settings}
          onClose={() => {
            setReceiptBill(null);
            setReceiptKot(null);
          }}
        />
      )}

      {/* Keep wsConnected referenced for connectivity state */}
      <span className="sr-only" data-ws-connected={wsConnected ? 'true' : 'false'} />
    </div>
  );
}
