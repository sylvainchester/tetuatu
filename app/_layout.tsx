import { DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import Head from 'expo-router/head';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import 'react-native-reanimated';
import axios from 'axios';

import { getImpostorAuthHeaders } from '@/lib/impostor/api';
import registerForWebPushAsync from '@/lib/impostor/registerForWebPushAsync';
import registerForPushNotificationsAsync from '@/lib/impostor/registerForPushNotificationsAsync';
import { getPushApiBase } from '@/lib/pushApi';
import { supabase } from '@/lib/supabase';
import { useWakeLock } from '@/lib/wakeLock';
import { useGameStore } from '@/store/impostor/useGameStore';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

export const unstable_settings = {
  anchor: 'index',
};

export default function RootLayout() {
  const { setPushToken, pushToken, user } = useGameStore();
  const { enable, disable } = useWakeLock();
  const [updateReady, setUpdateReady] = useState(false);
  const [applyingUpdate, setApplyingUpdate] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [installPromptEvent, setInstallPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [installDismissed, setInstallDismissed] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [webNotifPermission, setWebNotifPermission] = useState<'default' | 'denied' | 'granted' | null>(null);
  const [enablingWebNotif, setEnablingWebNotif] = useState(false);
  const [webNotifError, setWebNotifError] = useState('');
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const swFingerprintRef = useRef<string | null>(null);

  useEffect(() => {
    enable();
    return () => {
      disable();
    };
  }, [enable, disable]);

  useEffect(() => {
    if (Platform.OS !== 'web') {
      return;
    }
    if (process.env.NODE_ENV !== 'production') {
      return;
    }
    if (!('serviceWorker' in navigator)) {
      return;
    }

    let refreshing = false;
    const onControllerChange = () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    };

    let updateTimer: ReturnType<typeof setInterval> | null = null;

    const hashText = (value: string) => {
      let hash = 0;
      for (let i = 0; i < value.length; i += 1) {
        hash = (hash * 31 + value.charCodeAt(i)) | 0;
      }
      return String(hash);
    };

    const readServiceWorkerFingerprint = async () => {
      try {
        const response = await fetch('/service-worker.js', { cache: 'no-store' });
        if (!response.ok) return null;
        const source = await response.text();
        return hashText(source);
      } catch {
        return null;
      }
    };

    const syncWaitingWorker = (registration: ServiceWorkerRegistration) => {
      if (registration.waiting) {
        setWaitingWorker(registration.waiting);
        setUpdateReady(true);
      } else {
        setUpdateReady(false);
        setWaitingWorker(null);
      }
    };

    const start = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/service-worker.js');
        registrationRef.current = registration;
        registration.update().catch(() => {});
        syncWaitingWorker(registration);
        const firstFingerprint = await readServiceWorkerFingerprint();
        if (firstFingerprint) {
          swFingerprintRef.current = firstFingerprint;
        }

        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              setWaitingWorker(installing);
              setUpdateReady(true);
            }
          });
        });

        updateTimer = setInterval(async () => {
          registration.update().catch(() => {});
          syncWaitingWorker(registration);
          const latestFingerprint = await readServiceWorkerFingerprint();
          if (!latestFingerprint) return;
          if (!swFingerprintRef.current) {
            swFingerprintRef.current = latestFingerprint;
            return;
          }
          if (swFingerprintRef.current !== latestFingerprint) {
            setUpdateReady(true);
          }
        }, 60000);
      } catch {
        // Ignore registration errors in non-supporting environments.
      }
    };

    start();
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      if (updateTimer) {
        clearInterval(updateTimer);
      }
      registrationRef.current = null;
      swFingerprintRef.current = null;
    };
  }, []);

  useEffect(() => {
    registerForPushNotificationsAsync().then((token) => {
      if (token) {
        setPushToken(token);
      }
    });
  }, [setPushToken]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setHasSession(Boolean(data.session));
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setHasSession(Boolean(session));
    });
    return () => {
      subscription.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    const detectStandalone = () => {
      const inStandaloneDisplayMode = window.matchMedia('(display-mode: standalone)').matches;
      const iosStandalone = Boolean((navigator as any).standalone);
      setIsStandalone(inStandaloneDisplayMode || iosStandalone);
    };

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPromptEvent(event as BeforeInstallPromptEvent);
      setInstallDismissed(false);
    };

    const handleAppInstalled = () => {
      setIsStandalone(true);
      setInstallPromptEvent(null);
      setInstallDismissed(true);
    };

    detectStandalone();
    const displayModeMedia = window.matchMedia('(display-mode: standalone)');
    if (typeof displayModeMedia.addEventListener === 'function') {
      displayModeMedia.addEventListener('change', detectStandalone);
    } else if (typeof (displayModeMedia as any).addListener === 'function') {
      (displayModeMedia as any).addListener(detectStandalone);
    }
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      if (typeof displayModeMedia.removeEventListener === 'function') {
        displayModeMedia.removeEventListener('change', detectStandalone);
      } else if (typeof (displayModeMedia as any).removeListener === 'function') {
        (displayModeMedia as any).removeListener(detectStandalone);
      }
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    if (typeof Notification === 'undefined') {
      setWebNotifPermission(null);
      return;
    }

    const syncPermission = () => {
      setWebNotifPermission(Notification.permission);
      if (Notification.permission === 'granted') {
        setWebNotifError('');
      }
    };

    syncPermission();
    document.addEventListener('visibilitychange', syncPermission);
    window.addEventListener('focus', syncPermission);
    return () => {
      document.removeEventListener('visibilitychange', syncPermission);
      window.removeEventListener('focus', syncPermission);
    };
  }, []);

  useEffect(() => {
    const apiUrl = getPushApiBase();
    if (!apiUrl || !user || !pushToken) {
      return;
    }
    getImpostorAuthHeaders()
      .then((headers) => {
        if (!headers) return;
        return axios.post(
          `${apiUrl}/users/push-token`,
          { token: pushToken },
          { headers }
        );
      })
      .catch((err) => console.log('Failed to save push token', err));
  }, [pushToken, user]);

  function applyUpdate() {
    if (Platform.OS !== 'web') return;
    setApplyingUpdate(true);
    if (waitingWorker) {
      waitingWorker.postMessage({ type: 'SKIP_WAITING' });
      return;
    }
    window.location.reload();
  }

  async function handleInstallApp() {
    if (!installPromptEvent) return;
    await installPromptEvent.prompt();
    const choice = await installPromptEvent.userChoice.catch(() => null);
    if (choice?.outcome === 'accepted') {
      setInstallDismissed(true);
      setInstallPromptEvent(null);
    }
  }

  async function handleEnableWebNotifications() {
    if (Platform.OS !== 'web') return;
    if (!hasSession) return;
    if (typeof Notification === 'undefined') return;

    setEnablingWebNotif(true);
    setWebNotifError('');
    try {
      if (Notification.permission === 'denied') {
        setWebNotifError('Notificações bloqueadas no navegador. Ative nas configurações do site.');
        return;
      }
      const subscription = await registerForWebPushAsync();
      setWebNotifPermission(Notification.permission);
      if (!subscription || Notification.permission !== 'granted') {
        setWebNotifError('Permissão necessária para receber lembretes.');
      }
    } catch (err: any) {
      setWebNotifError(err?.message || 'Não foi possível ativar as notificações.');
    } finally {
      setEnablingWebNotif(false);
    }
  }

  const showInstallBanner = Platform.OS === 'web' && !isStandalone && !installDismissed;
  const showWebNotifBanner = Platform.OS === 'web' && hasSession && webNotifPermission !== 'granted';
  const webNotifBannerTop = updateReady ? (showInstallBanner ? 136 : 72) : (showInstallBanner ? 72 : 8);

  return (
    <ThemeProvider value={DefaultTheme}>
      <Head>
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png?v=20260307" />
        <meta name="theme-color" content="#E6F4FE" />
        <style>{`
          * {
            box-sizing: border-box;
          }
          html, body, #root {
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            background: #0b0f1a;
            overflow: hidden !important;
            overscroll-behavior: none;
          }
          html, body, #root {
            position: fixed;
            inset: 0;
          }
          #root > div {
            width: 100%;
            height: 100%;
            overflow: hidden;
          }
          body {
            touch-action: none;
          }
        `}</style>
      </Head>
      {Platform.OS === 'web' && updateReady ? (
        <View style={styles.updateBanner}>
          <Text style={styles.updateText}>Nouvelle version disponible.</Text>
          <Pressable style={[styles.updateButton, applyingUpdate && styles.updateButtonDisabled]} onPress={applyUpdate} disabled={applyingUpdate}>
            <Text style={styles.updateButtonText}>{applyingUpdate ? 'Mise à jour...' : 'Mettre à jour'}</Text>
          </Pressable>
        </View>
      ) : null}
      {showInstallBanner ? (
        <View style={[styles.installBanner, updateReady && styles.installBannerWithUpdate]}>
          <Pressable
            style={[styles.installButton, !installPromptEvent && styles.installButtonDisabled]}
            onPress={handleInstallApp}
            disabled={!installPromptEvent}>
            <Text style={styles.installButtonText}>INSTALAR O APLICATIVO</Text>
          </Pressable>
        </View>
      ) : null}
      {showWebNotifBanner ? (
        <View style={[styles.notifBanner, { top: webNotifBannerTop }]}>
          <Text style={styles.notifTitle}>Ative as notificações para receber lembretes.</Text>
          <Pressable style={[styles.notifButton, enablingWebNotif && styles.notifButtonDisabled]} onPress={handleEnableWebNotifications} disabled={enablingWebNotif}>
            <Text style={styles.notifButtonText}>{enablingWebNotif ? 'ATIVANDO...' : 'ATIVAR NOTIFICAÇÕES'}</Text>
          </Pressable>
          {webNotifError ? <Text style={styles.notifErrorText}>{webNotifError}</Text> : null}
        </View>
      ) : null}
      <Stack>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="reset" options={{ headerShown: false }} />
        <Stack.Screen name="tests" options={{ headerShown: false }} />
        <Stack.Screen name="tests-corrections" options={{ headerShown: false }} />
        <Stack.Screen name="reservations" options={{ headerShown: false }} />
        <Stack.Screen name="fino/index" options={{ headerShown: false }} />
        <Stack.Screen name="fino/game/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="notes/index" options={{ headerShown: false }} />
        <Stack.Screen name="notes/new" options={{ headerShown: false }} />
        <Stack.Screen name="notes/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="options" options={{ headerShown: false }} />
        <Stack.Screen name="prof/dashboard" options={{ headerShown: false }} />
        <Stack.Screen name="coinche/index" options={{ headerShown: false }} />
        <Stack.Screen name="coinche/game/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="impostor/lobby" options={{ headerShown: false }} />
        <Stack.Screen name="impostor/game/[id]" options={{ title: 'El Impostor', headerStyle: { backgroundColor: '#1a1a2e' }, headerTintColor: '#fff' }} />
      </Stack>
      <StatusBar style="dark" />
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  updateBanner: {
    position: 'absolute',
    top: 8,
    left: 8,
    right: 8,
    zIndex: 9999,
    backgroundColor: '#0f172a',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10
  },
  updateText: {
    color: '#e2e8f0',
    fontWeight: '600'
  },
  updateButton: {
    backgroundColor: '#22c55e',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  updateButtonDisabled: {
    opacity: 0.6
  },
  updateButtonText: {
    color: '#052e16',
    fontWeight: '800'
  },
  installBanner: {
    position: 'absolute',
    top: 8,
    left: 8,
    right: 8,
    zIndex: 9998,
    backgroundColor: '#fff7eb',
    borderColor: '#d5c3a1',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10
  },
  installBannerWithUpdate: {
    top: 72
  },
  installButton: {
    backgroundColor: '#171717',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center'
  },
  installButtonDisabled: {
    opacity: 0.6
  },
  installButtonText: {
    color: '#fff5e6',
    fontWeight: '800'
  },
  notifBanner: {
    position: 'absolute',
    left: 8,
    right: 8,
    zIndex: 9997,
    backgroundColor: '#10233f',
    borderColor: '#2d4f76',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10
  },
  notifTitle: {
    color: '#dbeafe',
    fontWeight: '700'
  },
  notifButton: {
    backgroundColor: '#0ea5e9',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center'
  },
  notifButtonDisabled: {
    opacity: 0.65
  },
  notifButtonText: {
    color: '#06243a',
    fontWeight: '900'
  },
  notifErrorText: {
    color: '#fecaca',
    fontWeight: '600'
  }
});
