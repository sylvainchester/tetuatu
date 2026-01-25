import { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { router } from 'expo-router';
import * as Linking from 'expo-linking';

import { ensureProfileUsername } from '@/lib/profile';
import { supabase } from '@/lib/supabase';
import { useGameStore } from '@/store/impostor/useGameStore';

const initialForm = {
  email: '',
  password: '',
  username: ''
};

export default function HubScreen() {
  const [session, setSession] = useState<Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session']>(null);
  const [form, setForm] = useState(initialForm);
  const [isRegister, setIsRegister] = useState(false);
  const [authError, setAuthError] = useState('');
  const [profileName, setProfileName] = useState('');
  const { ensureUser, logout: logoutImpostor, isLoading: impostorLoading, error: impostorError } = useGameStore();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => {
      subscription.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    async function handleDeepLink(url: string | null) {
      if (!url) return;
      const fragment = url.split('#')[1] || '';
      const query = url.split('?')[1] || '';
      const raw = fragment || query;
      if (!raw) return;
      const params = new URLSearchParams(raw);
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      if (accessToken && refreshToken) {
        await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken
        });
        router.replace('/reset');
      }
    }

    Linking.getInitialURL().then(handleDeepLink);
    const sub = Linking.addEventListener('url', ({ url }) => {
      handleDeepLink(url);
    });
    return () => {
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (!session?.user) {
      setProfileName('');
      return;
    }
    ensureProfileUsername(session.user).then((name) => setProfileName(name));
  }, [session]);

  const usernameLabel = useMemo(() => (isRegister ? 'Pseudo' : 'Pseudo (facultatif)'), [isRegister]);

  async function handleAuth() {
    setAuthError('');
    try {
      if (isRegister) {
        const { data, error } = await supabase.auth.signUp({
          email: form.email,
          password: form.password
        });
        if (error) throw error;
        if (data.user) {
          await ensureProfileUsername(data.user, form.username);
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: form.email,
          password: form.password
        });
        if (error) throw error;
        if (data.user) {
          await ensureProfileUsername(data.user);
        }
      }
      setForm(initialForm);
    } catch (err: any) {
      setAuthError(err.message || 'Erreur auth');
    }
  }

  async function handleRecovery() {
    setAuthError('');
    if (!form.email.trim()) {
      setAuthError('Email requis pour le reset.');
      return;
    }
    try {
      const redirectTo = Linking.createURL('/reset');
      const { error } = await supabase.auth.resetPasswordForEmail(form.email, { redirectTo });
      if (error) throw error;
      setAuthError('Email de reinitialisation envoye.');
    } catch (err: any) {
      setAuthError(err.message || 'Erreur recovery');
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    await logoutImpostor();
  }

  async function handleEnterImpostor() {
    const name = profileName;
    if (!name) {
      setAuthError('Pseudo manquant pour imposteur.');
      return;
    }
    const ok = await ensureUser(name);
    if (ok) {
      router.push('/impostor/lobby');
    }
  }

  if (!session) {
    return (
      <SafeAreaView style={styles.authSafe}>
        <View style={styles.authBackground}>
          <View style={styles.authGlow} />
        </View>
        <View style={styles.authCard}>
          <Text style={styles.authTitle}>Tetuatu</Text>
          <Text style={styles.authSubtitle}>Coinche + Imposteur, une seule connexion.</Text>

          <View style={styles.authField}>
            <Text style={styles.authLabel}>Email</Text>
            <TextInput
              autoCapitalize="none"
              keyboardType="email-address"
              value={form.email}
              onChangeText={(value) => setForm((prev) => ({ ...prev, email: value }))}
              style={styles.authInput}
              placeholder="toi@email.fr"
              placeholderTextColor="#6f7a87"
            />
          </View>

          <View style={styles.authField}>
            <Text style={styles.authLabel}>Mot de passe</Text>
            <TextInput
              secureTextEntry
              value={form.password}
              onChangeText={(value) => setForm((prev) => ({ ...prev, password: value }))}
              style={styles.authInput}
              placeholder="••••••••"
              placeholderTextColor="#6f7a87"
            />
          </View>

          <View style={styles.authField}>
            <Text style={styles.authLabel}>{usernameLabel}</Text>
            <TextInput
              value={form.username}
              onChangeText={(value) => setForm((prev) => ({ ...prev, username: value }))}
              style={styles.authInput}
              placeholder="Ton pseudo"
              placeholderTextColor="#6f7a87"
            />
          </View>

          {authError ? <Text style={styles.authError}>{authError}</Text> : null}

          <Pressable style={styles.authButton} onPress={handleAuth}>
            <Text style={styles.authButtonText}>{isRegister ? 'Creer un compte' : 'Connexion'}</Text>
          </Pressable>
          {!isRegister ? (
            <Pressable onPress={handleRecovery}>
              <Text style={styles.authRecovery}>Mot de passe oublie ?</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={() => setIsRegister((prev) => !prev)}>
            <Text style={styles.authToggle}>
              {isRegister ? 'Deja un compte ? Se connecter' : 'Pas de compte ? S inscrire'}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.hubSafe}>
      <View style={styles.hubBackground}>
        <View style={styles.hubGlow} />
      </View>
      <View style={styles.hubHeader}>
        <View>
          <Text style={styles.hubTitle}>Salut {profileName || 'joueur'}.</Text>
          <Text style={styles.hubSubtitle}>Choisis ton terrain de jeu.</Text>
        </View>
        <Pressable style={styles.logout} onPress={handleSignOut}>
          <Text style={styles.logoutText}>Logout</Text>
        </Pressable>
      </View>

      <View style={styles.hubGrid}>
        <Pressable style={styles.card} onPress={() => router.push('/coinche')}>
          <Text style={styles.cardTitle}>Coinche</Text>
          <Text style={styles.cardMeta}>Tables rapides, robots prets.</Text>
          <View style={styles.cardAction}>
            <Text style={styles.cardActionText}>Entrer</Text>
          </View>
        </Pressable>
        <Pressable style={[styles.card, styles.cardAlt]} onPress={handleEnterImpostor}>
          <Text style={styles.cardTitle}>Imposteur</Text>
          <Text style={styles.cardMeta}>Parties bluff, votes, score.</Text>
          <View style={styles.cardAction}>
            <Text style={styles.cardActionText}>{impostorLoading ? 'Connexion...' : 'Entrer'}</Text>
          </View>
        </Pressable>
        {impostorError ? <Text style={styles.errorText}>{impostorError}</Text> : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  authSafe: {
    flex: 1,
    backgroundColor: '#0b0f1a',
    justifyContent: 'center',
    alignItems: 'center'
  },
  authBackground: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0b0f1a'
  },
  authGlow: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: '#1f2a44',
    opacity: 0.5,
    top: -40,
    right: -60
  },
  authCard: {
    width: '88%',
    backgroundColor: '#111827',
    padding: 24,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#24304f'
  },
  authTitle: {
    fontSize: 30,
    fontFamily: 'serif',
    color: '#f8fafc'
  },
  authSubtitle: {
    marginTop: 6,
    fontSize: 14,
    color: '#94a3b8'
  },
  authField: {
    marginTop: 16
  },
  authLabel: {
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: '#94a3b8'
  },
  authInput: {
    marginTop: 8,
    backgroundColor: '#0b1220',
    borderWidth: 1,
    borderColor: '#1e293b',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    color: '#e2e8f0'
  },
  authError: {
    marginTop: 12,
    color: '#fca5a5'
  },
  authButton: {
    marginTop: 18,
    backgroundColor: '#f59e0b',
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center'
  },
  authButtonText: {
    color: '#1f2937',
    fontWeight: '700'
  },
  authToggle: {
    marginTop: 12,
    textAlign: 'center',
    color: '#94a3b8'
  },
  authRecovery: {
    marginTop: 10,
    textAlign: 'center',
    color: '#f8fafc'
  },
  hubSafe: {
    flex: 1,
    backgroundColor: '#0b0f1a'
  },
  hubBackground: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0b0f1a'
  },
  hubGlow: {
    position: 'absolute',
    width: 340,
    height: 340,
    borderRadius: 170,
    backgroundColor: '#1d4ed8',
    opacity: 0.12,
    top: -80,
    left: -80
  },
  hubHeader: {
    paddingHorizontal: 24,
    paddingTop: 28,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  hubTitle: {
    fontSize: 28,
    fontFamily: 'serif',
    color: '#f8fafc'
  },
  hubSubtitle: {
    marginTop: 6,
    color: '#94a3b8'
  },
  logout: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#111827'
  },
  logoutText: {
    color: '#f8fafc',
    fontSize: 12
  },
  hubGrid: {
    marginTop: 24,
    paddingHorizontal: 24,
    gap: 16
  },
  card: {
    backgroundColor: '#111827',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#1f2937'
  },
  cardAlt: {
    borderColor: '#312e81'
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#f8fafc'
  },
  cardMeta: {
    marginTop: 6,
    color: '#94a3b8'
  },
  cardAction: {
    marginTop: 16,
    alignSelf: 'flex-start',
    backgroundColor: '#f59e0b',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12
  },
  cardActionText: {
    color: '#1f2937',
    fontWeight: '700'
  },
  errorText: {
    color: '#fca5a5'
  }
});
