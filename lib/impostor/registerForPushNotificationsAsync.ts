import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowAlert: false, // Do not show alert when app is open
        shouldPlaySound: true,  // Play sound
        shouldSetBadge: false,
        shouldShowBanner: false, // Do not show banner
        shouldShowList: false,
    }),
});

async function registerForPushNotificationsAsync() {
    let token;

    if (Platform.OS === 'web') {
        return null;
    }

    if (Platform.OS === 'android') {
        try {
            const packageName = Constants?.expoConfig?.android?.package;

            // v8: Final Game Channels (WAV Check & First Turn Fix)

            // 1. Creation (ajugar)
            await Notifications.setNotificationChannelAsync('channel_creation_v8', {
                name: 'Partida Creada',
                importance: Notifications.AndroidImportance.MAX,
                vibrationPattern: [0, 250, 250, 250],
                sound: 'ajugar',
            });

            // 2. Game Start (vengaya)
            await Notifications.setNotificationChannelAsync('channel_start_v8', {
                name: 'Partida Iniciada',
                importance: Notifications.AndroidImportance.MAX,
                vibrationPattern: [0, 250, 250, 250],
                sound: 'vengaya',
            });

            // 3. Player Turn (sound_turn.ogg)
            await Notifications.setNotificationChannelAsync('channel_turn_v8', {
                name: 'Tu Turno',
                importance: Notifications.AndroidImportance.MAX,
                vibrationPattern: [0, 250, 250, 250],
                sound: 'sound_turn',
            });

            // 4. Voting Phase (sound_vote.ogg)
            await Notifications.setNotificationChannelAsync('channel_vote_v8', {
                name: 'Fase de Votación',
                importance: Notifications.AndroidImportance.MAX,
                vibrationPattern: [0, 250, 250, 250],
                sound: 'sound_vote',
            });

            // 5. Result (ca)
            await Notifications.setNotificationChannelAsync('channel_result_v8', {
                name: 'Resultado',
                importance: Notifications.AndroidImportance.MAX,
                vibrationPattern: [0, 250, 250, 250],
                sound: 'ca',
            });

            // v9: Final Game Channels (Stable OGG)

            // 1. Creation (ajugar)
            await Notifications.setNotificationChannelAsync('channel_creation_v9', {
                name: 'Partida Creada',
                importance: Notifications.AndroidImportance.MAX,
                vibrationPattern: [0, 250, 250, 250],
                sound: 'ajugar',
            });

            // 2. Game Start (vengaya)
            await Notifications.setNotificationChannelAsync('channel_start_v9', {
                name: 'Partida Iniciada',
                importance: Notifications.AndroidImportance.MAX,
                vibrationPattern: [0, 250, 250, 250],
                sound: 'vengaya',
            });

            // 3. Player Turn (sound_turn)
            await Notifications.setNotificationChannelAsync('channel_turn_v9', {
                name: 'Tu Turno',
                importance: Notifications.AndroidImportance.MAX,
                vibrationPattern: [0, 250, 250, 250],
                sound: 'sound_turn',
            });

            // 4. Voting Phase (sound_vote)
            await Notifications.setNotificationChannelAsync('channel_vote_v9', {
                name: 'Fase de Votación',
                importance: Notifications.AndroidImportance.MAX,
                vibrationPattern: [0, 250, 250, 250],
                sound: 'sound_vote',
            });

            // 5. Result (ca)
            await Notifications.setNotificationChannelAsync('channel_result_v9', {
                name: 'Resultado',
                importance: Notifications.AndroidImportance.MAX,
                vibrationPattern: [0, 250, 250, 250],
                sound: 'ca',
            });

            // v10: Final Game Channels (Clean Slate after Test)

            // 1. Creation (ajugar)
            await Notifications.setNotificationChannelAsync('channel_creation_v10', {
                name: 'Partida Creada',
                importance: Notifications.AndroidImportance.MAX,
                vibrationPattern: [0, 250, 250, 250],
                sound: 'ajugar',
            });

            // 2. Game Start (vengaya)
            await Notifications.setNotificationChannelAsync('channel_start_v10', {
                name: 'Partida Iniciada',
                importance: Notifications.AndroidImportance.MAX,
                vibrationPattern: [0, 250, 250, 250],
                sound: 'vengaya',
            });

            // 3. Player Turn (sound_turn)
            await Notifications.setNotificationChannelAsync('channel_turn_v10', {
                name: 'Tu Turno',
                importance: Notifications.AndroidImportance.MAX,
                vibrationPattern: [0, 250, 250, 250],
                sound: 'sound_turn',
            });

            // 4. Voting Phase (sound_vote)
            await Notifications.setNotificationChannelAsync('channel_vote_v10', {
                name: 'Fase de Votación',
                importance: Notifications.AndroidImportance.MAX,
                vibrationPattern: [0, 250, 250, 250],
                sound: 'sound_vote',
            });

            // 5. Result (ca)
            await Notifications.setNotificationChannelAsync('channel_result_v10', {
                name: 'Resultado',
                importance: Notifications.AndroidImportance.MAX,
                vibrationPattern: [0, 250, 250, 250],
                sound: 'ca',
            });

            // v11: Final Game Channels (Reverted Names, New Version)

            // 1. Creation (ajugar)
            await Notifications.setNotificationChannelAsync('channel_creation_v11', {
                name: 'Partida Creada',
                importance: Notifications.AndroidImportance.MAX,
                vibrationPattern: [0, 250, 250, 250],
                sound: 'ajugar',
            });

            // 2. Game Start (vengaya)
            await Notifications.setNotificationChannelAsync('channel_start_v11', {
                name: 'Partida Iniciada',
                importance: Notifications.AndroidImportance.MAX,
                vibrationPattern: [0, 250, 250, 250],
                sound: 'vengaya',
            });

            // 3. Player Turn (turn_event)
            await Notifications.setNotificationChannelAsync('channel_turn_event_v1', {
                name: 'Aviso Turno',
                importance: Notifications.AndroidImportance.MAX,
                vibrationPattern: [0, 250, 250, 250],
                sound: 'turn_event',
            });

            // 4. Voting Phase (vote_event)
            await Notifications.setNotificationChannelAsync('channel_vote_event_v1', {
                name: 'Aviso Votacion',
                importance: Notifications.AndroidImportance.MAX,
                vibrationPattern: [0, 250, 250, 250],
                sound: 'vote_event',
            });

            // 5. Result (ca)
            await Notifications.setNotificationChannelAsync('channel_result_v11', {
                name: 'Resultado',
                importance: Notifications.AndroidImportance.MAX,
                vibrationPattern: [0, 250, 250, 250],
                sound: 'ca',
            });
            if (packageName) {
                await Notifications.setNotificationChannelAsync('channel_result_v4', {
                    name: 'Game Result',
                    importance: Notifications.AndroidImportance.MAX,
                    vibrationPattern: [0, 250, 250, 250],
                    sound: `android.resource://${packageName}/raw/ca`,
                    audioAttributes: {
                        usage: Notifications.AndroidAudioUsage.NOTIFICATION_EVENT,
                        contentType: Notifications.AndroidAudioContentType.SONIFICATION,
                    }
                });
            }
        } catch (error) {
            console.log("Error creating channels:", error);
        }
    }

    if (Device.isDevice) {
        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;
        if (existingStatus !== 'granted') {
            const { status } = await Notifications.requestPermissionsAsync();
            finalStatus = status;
        }
        if (finalStatus !== 'granted') {
            console.log('Permission not granted for push notifications');
            return;
        }

        try {
            const projectId = Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
            if (!projectId) {
                token = (await Notifications.getExpoPushTokenAsync()).data;
            } else {
                token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
            }
        } catch (e) {
            token = (await Notifications.getExpoPushTokenAsync()).data;
        }
        console.log('Expo Push Token:', token);
    } else {
        console.log('Must use physical device for Push Notifications');
    }

    return token;
}

export default registerForPushNotificationsAsync;
