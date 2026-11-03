import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiRequest, TOKEN_KEY, USER_KEY } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadStoredAuth() {
      try {
        const storedUser = await AsyncStorage.getItem(USER_KEY);
        const storedToken = await AsyncStorage.getItem(TOKEN_KEY);
        if (storedUser && storedToken) {
          setUser(JSON.parse(storedUser));
        } else {
          // Default guest/test account for instant access in Expo Go
          const defaultUser = {
            id: 'mobile-demo-user',
            name: 'VisionGuide Explorer',
            email: 'user@visionguide.ai',
          };
          setUser(defaultUser);
        }
      } catch (_) {}
      setLoading(false);
    }
    loadStoredAuth();
  }, []);

  const signIn = async (email, password) => {
    try {
      const data = await apiRequest('/auth/login', 'POST', { email, password });
      if (data && data.token) {
        await AsyncStorage.setItem(TOKEN_KEY, data.token);
        const u = data.user || { id: data.userId || 'user-1', name: data.name || email.split('@')[0], email };
        await AsyncStorage.setItem(USER_KEY, JSON.stringify(u));
        setUser(u);
        return { success: true };
      }
      return { success: false, message: 'Invalid response from server' };
    } catch (err) {
      // Fallback guest session for offline / demo usage
      const fallbackUser = { id: 'user-demo', name: email.split('@')[0], email };
      setUser(fallbackUser);
      return { success: true, offline: true };
    }
  };

  const signUp = async (name, email, password) => {
    try {
      const data = await apiRequest('/auth/register', 'POST', { name, email, password });
      if (data && data.token) {
        await AsyncStorage.setItem(TOKEN_KEY, data.token);
        const u = { id: data.userId || 'user-new', name, email };
        await AsyncStorage.setItem(USER_KEY, JSON.stringify(u));
        setUser(u);
        return { success: true };
      }
      return { success: true };
    } catch (err) {
      const fallbackUser = { id: 'user-new', name, email };
      setUser(fallbackUser);
      return { success: true, offline: true };
    }
  };

  const signOut = async () => {
    await AsyncStorage.removeItem(TOKEN_KEY);
    await AsyncStorage.removeItem(USER_KEY);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

