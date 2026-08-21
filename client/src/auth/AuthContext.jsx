import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getToken, setToken } from '../api/client';
import * as authApi from '../api/auth';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return null;
    }
    try {
      const data = await authApi.me();
      setUser(data.user);
      setError(null);
      return data.user;
    } catch (err) {
      setToken(null);
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(async ({ email, password }) => {
    setError(null);
    try {
      const data = await authApi.login({ email, password });
      setToken(data.token);
      setUser(data.user);
      return data.user;
    } catch (err) {
      const msg = (err && err.response && err.response.data && err.response.data.error) || 'Login failed';
      setError(msg);
      throw err;
    }
  }, []);

  const register = useCallback(async (payload) => {
    setError(null);
    try {
      const data = await authApi.register(payload);
      setToken(data.token);
      setUser(data.user);
      return data.user;
    } catch (err) {
      const msg = (err && err.response && err.response.data && err.response.data.error) || 'Registration failed';
      setError(msg);
      throw err;
    }
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(() => ({
    user,
    loading,
    error,
    isAuthenticated: Boolean(user),
    role: user ? user.role : null,
    login,
    register,
    logout,
    refresh,
  }), [user, loading, error, login, register, logout, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
