export function getBackendUrl(): string {
  const envUrl = process.env.EXPO_PUBLIC_BACKEND_URL;
  if (envUrl) {
    return envUrl;
  }
  if (typeof window !== 'undefined' && window.location?.hostname) {
    const protocol = window.location.protocol === 'https:' ? 'https' : 'http';
    const port = process.env.EXPO_PUBLIC_BACKEND_PORT || '3001';
    return `${protocol}://${window.location.hostname}:${port}`;
  }
  return '';
}
