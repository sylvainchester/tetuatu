import { DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import Head from 'expo-router/head';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import 'react-native-reanimated';
import axios from 'axios';

import { getImpostorAuthHeaders } from '@/lib/impostor/api';
import registerForPushNotificationsAsync from '@/lib/impostor/registerForPushNotificationsAsync';
import { getPushApiBase } from '@/lib/pushApi';
import { useWakeLock } from '@/lib/wakeLock';
import { useGameStore } from '@/store/impostor/useGameStore';

export const unstable_settings = {
  anchor: 'index',
};

export default function RootLayout() {
  const { setPushToken, pushToken, user } = useGameStore();
  const { enable, disable } = useWakeLock();
  const [updateReady, setUpdateReady] = useState(false);
  const [applyingUpdate, setApplyingUpdate] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
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
      <Stack>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="reset" options={{ headerShown: false }} />
        <Stack.Screen name="tests" options={{ headerShown: false }} />
        <Stack.Screen name="tests-corrections" options={{ headerShown: false }} />
        <Stack.Screen name="reservations" options={{ headerShown: false }} />
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
  }
});
