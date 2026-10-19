import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { safeStore } from '../utils/safeStorage';

const THEME_KEY = 'user_theme_preference';

export interface ThemeColors {
  background: string;
  card: string;
  surface: string;
  text: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  textMuted: string;
  border: string;
  borderLight: string;
  accent: string;
  accentLight: string;
  accentBg: string;
  success: string;
  successBg: string;
  danger: string;
  dangerBg: string;
  warning: string;
  warningBg: string;
  info: string;
  infoBg: string;
  purple: string;
  pink: string;
  cyan: string;
  sidebarBg: string;
  sidebarText: string;
  sidebarActive: string;
  sidebarHover: string;
  sidebarSection: string;
  modalOverlay: string;
  statusBar: 'light' | 'dark';
  switchTrack: string;
  shimmer: string;
}

const dark: ThemeColors = {
  background: '#111827',
  card: '#1F2937',
  surface: '#1a2333',
  text: '#FFFFFF',
  textPrimary: '#e5e7eb',
  textSecondary: '#9CA3AF',
  textTertiary: '#6b7280',
  textMuted: '#9ca3af',
  border: '#374151',
  borderLight: '#2a3547',
  accent: '#FF6600',
  accentLight: '#ff8533',
  accentBg: '#33200f',
  success: '#34d399',
  successBg: '#0b2e22',
  danger: '#f87171',
  dangerBg: '#3a1212',
  warning: '#fbbf24',
  warningBg: '#3a2a0a',
  info: '#FF6600',
  infoBg: '#33200f',
  purple: '#a78bfa',
  pink: '#f472b6',
  cyan: '#22d3ee',
  sidebarBg: '#0f172a',
  sidebarText: '#cbd5e1',
  sidebarActive: '#FF6600',
  sidebarHover: '#1e293b',
  sidebarSection: '#64748b',
  modalOverlay: 'rgba(0,0,0,0.6)',
  statusBar: 'light',
  switchTrack: '#4b5563',
  shimmer: '#263449',
};

const light: ThemeColors = {
  background: '#f1f5f9',
  card: '#ffffff',
  surface: '#f8fafc',
  text: '#111827',
  textPrimary: '#1e293b',
  textSecondary: '#64748b',
  textTertiary: '#94a3b8',
  textMuted: '#9ca3af',
  border: '#e5e7eb',
  borderLight: '#f3f4f6',
  accent: '#FF6600',
  accentLight: '#ff8533',
  accentBg: '#fff1e6',
  success: '#16a34a',
  successBg: '#f0fdf4',
  danger: '#dc2626',
  dangerBg: '#fef2f2',
  warning: '#f59e0b',
  warningBg: '#fffbeb',
  info: '#FF6600',
  infoBg: '#fff1e6',
  purple: '#8b5cf6',
  pink: '#ec4899',
  cyan: '#06b6d4',
  sidebarBg: '#1e293b',
  sidebarText: '#cbd5e1',
  sidebarActive: '#FF6600',
  sidebarHover: '#334155',
  sidebarSection: '#64748b',
  modalOverlay: 'rgba(0,0,0,0.5)',
  statusBar: 'dark',
  switchTrack: '#cbd5e1',
  shimmer: '#e2e8f0',
};

interface ThemeContextType {
  colors: ThemeColors;
  isDark: boolean;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType>({
  colors: dark,
  isDark: true,
  toggleTheme: () => {},
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const systemScheme = useColorScheme();
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const stored = await safeStore.getItem(THEME_KEY);
        if (stored === 'light') setIsDark(false);
        else if (stored === 'dark') setIsDark(true);
        else setIsDark(systemScheme !== 'light');
      } catch {
        setIsDark(systemScheme !== 'light');
      }
    })();
  }, []);

  const toggleTheme = useCallback(() => {
    setIsDark((prev) => {
      const next = !prev;
      safeStore.setItem(THEME_KEY, next ? 'dark' : 'light').catch(() => {});
      return next;
    });
  }, []);

  const value: ThemeContextType = {
    colors: isDark ? dark : light,
    isDark,
    toggleTheme,
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => useContext(ThemeContext);
