import React, { useState } from 'react';
import { Coffee, Eye, EyeOff, Lock, User } from 'lucide-react';
import type { UserPublic } from '../shared/types';
import { apiRequest } from '../services/posClient';

interface LoginScreenProps {
  onSuccess: (token: string, user: UserPublic) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onSuccess }) => {
  const [username, setUsername] = useState('owner');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submitLogin = async (u: string, p: string) => {
    setError('');
    setLoading(true);
    try {
      const res = await apiRequest<{ token: string; user: UserPublic }>('POST', '/api/auth/login', {
        username: u,
        password: p,
      });
      onSuccess(res.token, res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void submitLogin(username, password);
  };

  const quickFill = (u: string, p: string) => {
    setUsername(u);
    setPassword(p);
    setError('');
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-4 sm:p-6">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-11 h-11 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0">
            <Coffee className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">BrewDesk POS</h1>
            <p className="text-xs text-slate-500">Cloud Cafe Billing &amp; Table Management</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="login-username" className="block text-xs font-semibold text-slate-700 mb-1.5">
              Staff Username
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="login-username"
                type="text"
                autoComplete="username"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="owner / cashier / waiter"
                className="w-full h-11 pl-10 pr-3.5 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/15 focus:border-slate-900"
              />
            </div>
          </div>

          <div>
            <label htmlFor="login-password" className="block text-xs font-semibold text-slate-700 mb-1.5">
              Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="w-full h-11 pl-10 pr-11 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/15 focus:border-slate-900"
              />
              <button
                type="button"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-700"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div role="alert" className="rounded-lg bg-red-50 border border-red-200 px-3.5 py-2.5 text-xs font-medium text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full h-11 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-60 transition-colors cursor-pointer"
          >
            {loading ? 'Signing in...' : 'Sign In to POS'}
          </button>
        </form>

        <div className="mt-6 pt-5 border-t border-slate-100">
          <p className="text-xs font-medium text-slate-500 mb-2.5">Quick Fill Staff Accounts</p>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => quickFill('owner', 'owner123')}
              className="py-2 px-2.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-left transition-colors"
            >
              <div className="text-xs font-semibold text-slate-900">Owner</div>
              <div className="text-[11px] text-slate-500 font-mono">PIN 1234</div>
            </button>
            <button
              type="button"
              onClick={() => quickFill('cashier', 'cashier123')}
              className="py-2 px-2.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-left transition-colors"
            >
              <div className="text-xs font-semibold text-slate-900">Cashier</div>
              <div className="text-[11px] text-slate-500 font-mono">Bills / Pay</div>
            </button>
            <button
              type="button"
              onClick={() => quickFill('waiter', 'waiter123')}
              className="py-2 px-2.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-left transition-colors"
            >
              <div className="text-xs font-semibold text-slate-900">Waiter</div>
              <div className="text-[11px] text-slate-500 font-mono">Orders Only</div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
