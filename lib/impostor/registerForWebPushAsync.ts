import axios from 'axios';
import { Platform } from 'react-native';

import { getImpostorApiBase, getImpostorAuthHeaders } from '@/lib/impostor/api';

function urlBase64ToUint8Array(base64String: string) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }

    return outputArray;
}

export default async function registerForWebPushAsync() {
    if (Platform.OS !== 'web') return null;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return null;

    const registration = await navigator.serviceWorker.register('/service-worker.js');
    const ready = await navigator.serviceWorker.ready;
    const existing = await ready.pushManager.getSubscription();

    let subscription = existing;
    if (!subscription) {
        const apiUrl = getImpostorApiBase();
        if (!apiUrl) return null;
        const { data } = await axios.get(`${apiUrl}/push/vapid-public-key`);
        const publicKey = data?.publicKey;
        if (!publicKey) return null;

        subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey)
        });
    }

    if (subscription) {
        const apiUrl = getImpostorApiBase();
        if (!apiUrl) return null;
        const headers = await getImpostorAuthHeaders();
        if (!headers) return null;
        await axios.post(`${apiUrl}/push/subscribe`, { subscription }, { headers });
    }

    return subscription;
}
