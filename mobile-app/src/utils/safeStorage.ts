import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Web-safe key/value cache.
 *
 * expo-secure-store has no web implementation (`setValueWithKeyAsync` is not a
 * function in the browser), which crashed login & theme persistence in the
 * browser preview. On web we fall back to localStorage; device builds keep the
 * encrypted SecureStore. All calls are non-throwing — this cache is
 * best-effort and must never break auth or settings flows.
 */
export const safeStore = {
  async getItem(key: string): Promise<string | null> {
    try {
      if (Platform.OS === 'web') {
        return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
      }
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  async setItem(key: string, value: string): Promise<void> {
    try {
      if (Platform.OS === 'web') {
        if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
        return;
      }
      await SecureStore.setItemAsync(key, value);
    } catch {
      /* best-effort */
    }
  },
  async deleteItem(key: string): Promise<void> {
    try {
      if (Platform.OS === 'web') {
        if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
        return;
      }
      await SecureStore.deleteItemAsync(key);
    } catch {
      /* best-effort */
    }
  },
};
