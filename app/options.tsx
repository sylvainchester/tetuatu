import { useEffect, useState } from 'react';
import { Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';

import {
  addStudentForAdmin,
  fetchWhitelistByEmail,
  listStudentsForAdmin,
  type AccessWhitelistRow
} from '@/lib/accessControl';
import registerForWebPushAsync from '@/lib/impostor/registerForWebPushAsync';
import { supabase } from '@/lib/supabase';

export default function OptionsScreen() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [entry, setEntry] = useState<AccessWhitelistRow | null>(null);
  const [students, setStudents] = useState<AccessWhitelistRow[]>([]);
  const [studentEmail, setStudentEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [info, setInfo] = useState('');
  const [sessionUserId, setSessionUserId] = useState('');
  const [sessionEmail, setSessionEmail] = useState('');
  const [notifInfo, setNotifInfo] = useState('');
  const [notifError, setNotifError] = useState('');
  const [notifSaving, setNotifSaving] = useState(false);
  const [notifPermission, setNotifPermission] = useState<'default' | 'granted' | 'denied' | 'unsupported'>('default');

  async function loadAccess() {
    setLoading(true);
    setError('');
    try {
      const { data } = await supabase.auth.getSession();
      const session = data.session;
      const user = session?.user;
      if (!session || !user?.email) {
        router.replace('/');
        return;
      }
      setSessionUserId(user.id);
      setSessionEmail(user.email);
      const access = await fetchWhitelistByEmail(user.email);
      if (!access) {
        setEntry(null);
        setStudents([]);
        setLoading(false);
        return;
      }
      setEntry(access);
      if (access.role === 'admin') {
        const list = await listStudentsForAdmin(user.email);
        setStudents(list);
      } else {
        setStudents([]);
      }
    } catch (err: any) {
      setError(err.message || 'Erreur chargement options.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAccess();
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web') {
      setNotifPermission('unsupported');
      return;
    }
    if (typeof Notification === 'undefined') {
      setNotifPermission('unsupported');
      return;
    }
    setNotifPermission(Notification.permission as any);
  }, []);

  async function handleAddStudent() {
    if (!sessionUserId || !sessionEmail) return;
    setSaving(true);
    setError('');
    setInfo('');
    try {
      await addStudentForAdmin({
        adminUserId: sessionUserId,
        adminEmail: sessionEmail,
        studentEmail
      });
      setStudentEmail('');
      setInfo('Eleve ajoute a la whitelist.');
      const list = await listStudentsForAdmin(sessionEmail);
      setStudents(list);
    } catch (err: any) {
      setError(err.message || 'Erreur ajout eleve.');
    } finally {
      setSaving(false);
    }
  }

  async function handleEnableNotifications() {
    setNotifSaving(true);
    setNotifError('');
    setNotifInfo('');
    try {
      const subscription = await registerForWebPushAsync(true);
      if (Platform.OS === 'web' && typeof Notification !== 'undefined') {
        setNotifPermission(Notification.permission as any);
      }
      if (subscription) {
        setNotifInfo('Notifications activées. Tu recevras les alertes de correction.');
      } else {
        setNotifError("Notifications non activées. Vérifie l'autorisation du navigateur.");
      }
    } catch (err: any) {
      setNotifError(err.message || "Impossible d'activer les notifications.");
    } finally {
      setNotifSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.background} />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.back}>Retour</Text>
          </Pressable>
          <Text style={styles.title}>Options</Text>
          <Text style={styles.subtitle}>Gestion whitelist prof / eleve.</Text>
        </View>

        {loading ? (
          <View style={styles.block}>
            <Text style={styles.muted}>Chargement...</Text>
          </View>
        ) : null}

        {!loading && !entry ? (
          <View style={styles.block}>
            <Text style={styles.error}>Acces refuse: profil non autorise.</Text>
          </View>
        ) : null}

        {!loading && entry ? (
          <View style={styles.block}>
            <Text style={styles.label}>Ton role</Text>
            <Text style={styles.value}>{entry.role === 'admin' ? 'Admin' : 'Eleve'}</Text>
            <Text style={styles.muted}>Les identites affichent les profils, pas les emails.</Text>
          </View>
        ) : null}

        {!loading && entry ? (
          <View style={styles.block}>
            <Text style={styles.sectionTitle}>Notifications</Text>
            <Text style={styles.value}>
              Statut navigateur:{' '}
              {notifPermission === 'granted'
                ? 'Autorisées'
                : notifPermission === 'denied'
                  ? 'Refusées'
                  : notifPermission === 'unsupported'
                    ? 'Non supportées'
                    : 'Non demandées'}
            </Text>
            <Pressable
              style={[styles.button, (notifSaving || notifPermission === 'unsupported') && styles.buttonDisabled]}
              onPress={handleEnableNotifications}
              disabled={notifSaving || notifPermission === 'unsupported'}
            >
              <Text style={styles.buttonText}>
                {notifSaving ? 'Activation...' : 'Activer les notifications'}
              </Text>
            </Pressable>
            {notifInfo ? <Text style={styles.info}>{notifInfo}</Text> : null}
            {notifError ? <Text style={styles.error}>{notifError}</Text> : null}
          </View>
        ) : null}

        {!loading && entry?.role === 'admin' ? (
          <View style={styles.block}>
            <Text style={styles.sectionTitle}>Ajouter un eleve</Text>
            <TextInput
              value={studentEmail}
              onChangeText={setStudentEmail}
              style={styles.input}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="email.eleve@domaine.com"
              placeholderTextColor="#6f7a87"
            />
            <Pressable style={[styles.button, saving && styles.buttonDisabled]} disabled={saving} onPress={handleAddStudent}>
              <Text style={styles.buttonText}>{saving ? 'Ajout...' : 'Ajouter a ma whitelist'}</Text>
            </Pressable>
            <Pressable style={styles.dashboardButton} onPress={() => router.push('/prof/dashboard')}>
              <Text style={styles.dashboardButtonText}>Ouvrir dashboard prof</Text>
            </Pressable>
          </View>
        ) : null}

        {!loading && entry?.role === 'admin' ? (
          <View style={styles.block}>
            <Text style={styles.sectionTitle}>Mes eleves</Text>
            {!students.length ? <Text style={styles.muted}>Aucun eleve pour le moment.</Text> : null}
            {students.map((student) => (
              <View key={student.id} style={styles.studentRow}>
                <Text style={styles.studentEmail}>{student.profile_username || 'Profil inconnu'}</Text>
                <Text style={styles.studentMeta}>
                  {student.role === 'admin' ? 'Admin' : 'Eleve'} • {student.created_at.slice(0, 10)}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {info ? (
          <View style={styles.block}>
            <Text style={styles.info}>{info}</Text>
          </View>
        ) : null}
        {error ? (
          <View style={styles.block}>
            <Text style={styles.error}>{error}</Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#0b0f1a'
  },
  background: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0b0f1a'
  },
  container: {
    padding: 20,
    paddingBottom: 40,
    gap: 14
  },
  header: {
    marginBottom: 6
  },
  back: {
    color: '#e2e8f0',
    marginBottom: 8
  },
  title: {
    fontSize: 26,
    color: '#f8fafc',
    fontFamily: 'serif'
  },
  subtitle: {
    marginTop: 6,
    color: '#94a3b8'
  },
  block: {
    backgroundColor: '#111827',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
    gap: 8
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#f8fafc'
  },
  label: {
    color: '#94a3b8',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1
  },
  value: {
    color: '#f8fafc',
    marginBottom: 4
  },
  input: {
    backgroundColor: '#0b1220',
    borderWidth: 1,
    borderColor: '#1e293b',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    color: '#e2e8f0',
    fontSize: 18,
    lineHeight: 24
  },
  button: {
    marginTop: 8,
    backgroundColor: '#22c55e',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center'
  },
  buttonDisabled: {
    opacity: 0.6
  },
  buttonText: {
    color: '#052e16',
    fontWeight: '700'
  },
  dashboardButton: {
    marginTop: 6,
    backgroundColor: '#1e40af',
    paddingVertical: 11,
    borderRadius: 12,
    alignItems: 'center'
  },
  dashboardButtonText: {
    color: '#dbeafe',
    fontWeight: '700'
  },
  studentRow: {
    borderTopWidth: 1,
    borderTopColor: '#1f2937',
    paddingTop: 8
  },
  studentEmail: {
    color: '#f8fafc'
  },
  studentMeta: {
    color: '#94a3b8',
    fontSize: 12
  },
  muted: {
    color: '#94a3b8'
  },
  error: {
    color: '#fca5a5'
  },
  info: {
    color: '#93c5fd'
  }
});
