import { Platform } from 'react-native';

export function getPushApiBase() {
  const configured = (process.env.EXPO_PUBLIC_PUSH_API_URL || '').trim();
  if (configured) return configured.replace(/\/$/, '');
  if (Platform.OS === 'web') return '/api';
  return '';
}
