import { Platform } from 'react-native';

export function getPushApiBase() {
  const configured = (process.env.EXPO_PUBLIC_PUSH_API_URL || '').trim();
  if (Platform.OS === 'web') {
    if (
      typeof window !== 'undefined' &&
      window.location?.origin &&
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ) {
      return `${window.location.origin}/api`;
    }
  }
  if (configured) return configured.replace(/\/$/, '');
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.location?.origin) {
      return `${window.location.origin}/api`;
    }
    return '/api';
  }
  return '';
}
