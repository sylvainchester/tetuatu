import { DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import Head from 'expo-router/head';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import 'react-native-reanimated';
import axios from 'axios';

import { getImpostorApiBase, getImpostorAuthHeaders } from '@/lib/impostor/api';
import registerForPushNotificationsAsync from '@/lib/impostor/registerForPushNotificationsAsync';
import { useGameStore } from '@/store/impostor/useGameStore';

export const unstable_settings = {
  anchor: 'index',
};

export default function RootLayout() {
  const { setPushToken, pushToken, user } = useGameStore();

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

    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/service-worker.js').catch(() => {});
    });
  }, []);

  useEffect(() => {
    registerForPushNotificationsAsync().then((token) => {
      if (token) {
        setPushToken(token);
      }
    });
  }, [setPushToken]);

  useEffect(() => {
    const apiUrl = getImpostorApiBase();
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

  return (
    <ThemeProvider value={DefaultTheme}>
      <Head>
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <meta name="theme-color" content="#E6F4FE" />
      </Head>
      <Stack>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="reset" options={{ headerShown: false }} />
        <Stack.Screen name="coinche/index" options={{ headerShown: false }} />
        <Stack.Screen name="coinche/game/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="impostor/lobby" options={{ headerShown: false }} />
        <Stack.Screen name="impostor/game/[id]" options={{ title: 'El Impostor', headerStyle: { backgroundColor: '#1a1a2e' }, headerTintColor: '#fff' }} />
      </Stack>
      <StatusBar style="dark" />
    </ThemeProvider>
  );
}
