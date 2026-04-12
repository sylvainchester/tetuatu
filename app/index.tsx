import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { router } from 'expo-router';
import * as Linking from 'expo-linking';

import { fetchWhitelistByEmail } from '@/lib/accessControl';
import { ensureProfileUsername } from '@/lib/profile';
import { supabase } from '@/lib/supabase';
import { useGameStore } from '@/store/impostor/useGameStore';

const initialForm = {
  email: '',
  password: '',
  username: ''
};

function mapAuthErrorMessage(raw?: string) {
  const message = String(raw || '');
  if (!message) return 'Erro de autenticação';
  const lower = message.toLowerCase();
  if (lower.includes('row-level security policy') || lower.includes('violates row level security')) {
    return 'Permissão de perfil ausente no banco (RLS). Verifique as policies da tabela profiles no Supabase.';
  }
  return message;
}

function deriveFallbackName(email?: string | null, metadataUsername?: string | null) {
  const fromMetadata = (metadataUsername || '').trim();
  if (fromMetadata) return fromMetadata;
  const local = (email || '').split('@')[0]?.trim() || '';
  return local || 'jogador';
}

export default function HubScreen() {
  const [session, setSession] = useState<Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session']>(null);
  const [form, setForm] = useState(initialForm);
  const [isRegister, setIsRegister] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authInfo, setAuthInfo] = useState('');
  const [profileName, setProfileName] = useState('');
  const [accessRole, setAccessRole] = useState<'admin' | 'manager' | 'employee' | 'member' | 'eleve' | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { ensureUser, logout: logoutImpostor, isLoading: impostorLoading, error: impostorError } = useGameStore();
  const displayName = profileName
    ? `${profileName.charAt(0).toUpperCase()}${profileName.slice(1)}`
    : 'joueur';

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data, error }) => {
      if (error) {
        await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
        setSession(null);
        setAccessChecked(true);
        setAuthError('Sessão expirada. Entre novamente.');
        return;
      }
      setSession(data.session);
    });
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
      const type = params.get('type') || '';
      if (accessToken && refreshToken) {
        await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken
        });
        if (type === 'recovery') {
          router.replace('/reset');
        } else {
          router.replace('/');
          if (type === 'signup') {
            setAuthInfo('Cadastro confirmado. Você já pode entrar.');
          }
        }
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
      setAccessRole(null);
      setAccessChecked(true);
      return;
    }
    setAccessChecked(false);
    (async () => {
      const [nameResult, accessResult] = await Promise.allSettled([
        ensureProfileUsername(session.user),
        session.user.email ? fetchWhitelistByEmail(session.user.email) : Promise.resolve(null)
      ]);

      if (nameResult.status === 'fulfilled') {
        setProfileName(nameResult.value);
      } else {
        setProfileName(deriveFallbackName(session.user.email, session.user.user_metadata?.username || null));
      }

      if (accessResult.status === 'rejected') {
        setAuthError(mapAuthErrorMessage(accessResult.reason?.message) || 'Erro ao verificar acesso.');
        setAccessChecked(true);
        return;
      }

      const access = accessResult.value;
      if (!access) {
        await supabase.auth.signOut();
        await logoutImpostor();
        setAuthError('Acesso negado: e-mail não autorizado.');
        setAccessChecked(true);
        return;
      }

      setAccessRole(access.role);
      setAccessChecked(true);
    })().catch((err: any) => {
      setAuthError(mapAuthErrorMessage(err?.message) || 'Erro ao verificar acesso.');
      setAccessChecked(true);
    });
  }, [session, logoutImpostor]);

  useEffect(() => {
    if (!accessChecked) return;
    if (!['manager', 'employee'].includes(accessRole || '')) return;
    router.replace('/reservations');
  }, [accessChecked, accessRole]);

  const usernameLabel = useMemo(() => 'Apelido', []);

  async function handleAuth() {
    setAuthError('');
    setAuthInfo('');
    try {
      if (isRegister) {
        const username = form.username.trim();
        if (!username) {
          setAuthError('Apelido obrigatório para criar uma conta.');
          return;
        }
        const { data, error } = await supabase.auth.signUp({
          email: form.email,
          password: form.password,
          options: {
            data: { username }
          }
        });
        if (error) throw error;
        if (data.session) {
          setAuthInfo('Conta criada com sucesso. Você já está conectado.');
        } else {
          setAuthInfo('Conta criada. Confirme seu e-mail para finalizar o cadastro.');
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
      setAuthError(mapAuthErrorMessage(err?.message));
    }
  }

  async function handleRecovery() {
    setAuthError('');
    setAuthInfo('');
    if (!form.email.trim()) {
      setAuthError('E-mail obrigatório para redefinir a senha.');
      return;
    }
    try {
      const redirectTo = Linking.createURL('/reset');
      const { error } = await supabase.auth.resetPasswordForEmail(form.email, { redirectTo });
      if (error) throw error;
      setAuthInfo('E-mail de redefinição enviado.');
    } catch (err: any) {
      setAuthError(mapAuthErrorMessage(err?.message) || 'Erro na recuperação');
    }
  }

  async function handleSignOut() {
    setMenuOpen(false);
    setAuthError('');
    const [supabaseResult] = await Promise.allSettled([
      supabase.auth.signOut({ scope: 'local' }),
      logoutImpostor()
    ]);
    if (supabaseResult.status === 'rejected') {
      setAuthError('Não foi possível sair. Tente novamente.');
      return;
    }
    router.replace('/');
  }

  async function handleEnterImpostor() {
    const name = profileName;
    if (!name) {
      setAuthError('Apelido ausente para Impostor.');
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

          <View style={styles.authField}>
            <Text style={styles.authLabel}>E-mail</Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              autoComplete="off"
              keyboardType="email-address"
              value={form.email}
              onChangeText={(value) => setForm((prev) => ({ ...prev, email: value }))}
              style={styles.authInput}
              placeholder="voce@email.com"
              placeholderTextColor="#6f7a87"
            />
          </View>

          <View style={styles.authField}>
            <Text style={styles.authLabel}>Senha</Text>
            <TextInput
              secureTextEntry={!showPassword}
              autoCorrect={false}
              spellCheck={false}
              autoComplete="off"
              value={form.password}
              onChangeText={(value) => setForm((prev) => ({ ...prev, password: value }))}
              style={styles.authInput}
              placeholder="••••••••"
              placeholderTextColor="#6f7a87"
            />
            <Pressable style={styles.passwordToggleRow} onPress={() => setShowPassword((prev) => !prev)}>
              <View style={[styles.passwordToggleBox, showPassword && styles.passwordToggleBoxActive]} />
              <Text style={styles.passwordToggleLabel}>Mostrar senha</Text>
            </Pressable>
          </View>

          {isRegister ? (
            <View style={styles.authField}>
              <Text style={styles.authLabel}>{usernameLabel}</Text>
              <TextInput
                autoCorrect={false}
                spellCheck={false}
                autoComplete="off"
                value={form.username}
                onChangeText={(value) => setForm((prev) => ({ ...prev, username: value }))}
                style={styles.authInput}
                placeholder="Seu apelido"
                placeholderTextColor="#6f7a87"
              />
            </View>
          ) : null}

          {authError ? <Text style={styles.authError}>{authError}</Text> : null}
          {authInfo ? <Text style={styles.authInfo}>{authInfo}</Text> : null}

          <Pressable style={styles.authButton} onPress={handleAuth}>
            <Text style={styles.authButtonText}>{isRegister ? 'Criar conta' : 'Entrar'}</Text>
          </Pressable>
          {!isRegister ? (
            <Pressable onPress={handleRecovery}>
              <Text style={styles.authRecovery}>Esqueceu a senha?</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => {
              setIsRegister((prev) => !prev);
              setAuthError('');
              setAuthInfo('');
            }}
          >
            <Text style={styles.authToggle}>
              {isRegister ? 'Já tem conta? Entrar' : 'Não tem conta? Cadastre-se'}
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
          <Text style={styles.hubTitle}>Salut {displayName}.</Text>
          <Text style={styles.hubSubtitle}>
            Choisis ton terrain de jeu. {accessRole ? `Role: ${accessRole}.` : ''}
          </Text>
        </View>
        <View style={styles.menuWrapper}>
          <Pressable style={styles.menuButton} onPress={() => setMenuOpen((prev) => !prev)}>
            <View style={styles.menuLine} />
            <View style={styles.menuLine} />
            <View style={styles.menuLine} />
            <View style={styles.menuLine} />
          </Pressable>
          {menuOpen ? (
            <View style={styles.menuPanel}>
              <Pressable
                style={styles.menuItem}
                onPress={() => {
                  setMenuOpen(false);
                  router.push('/options');
                }}
              >
                <Text style={styles.menuItemText}>Options</Text>
              </Pressable>
              <Pressable style={styles.menuItem} onPress={handleSignOut}>
                <Text style={styles.menuItemText}>Logout</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </View>

      <View style={styles.hubGrid}>
        {!accessChecked ? (
          <View style={styles.loadingCard}>
            <ActivityIndicator size="large" color="#f59e0b" />
            <Text style={styles.loadingText}>Vérification du profil...</Text>
          </View>
        ) : null}
        {accessChecked && ['admin', 'manager', 'employee'].includes(accessRole || '') ? (
          <>
            <Pressable style={[styles.card, styles.cardRental]} onPress={() => router.push('/reservations')}>
              <Text style={styles.cardTitle}>Montegordo</Text>
              <Text style={styles.cardMeta}>
                {accessRole === 'manager'
                  ? 'Consultation des réservations.'
                  : accessRole === 'employee'
                    ? 'Consultation réservée employé.'
                    : 'Réservations maison, calendrier et liste.'}
              </Text>
            </Pressable>
            {accessRole === 'admin' ? (
              <Pressable style={[styles.card, styles.cardNotes]} onPress={() => router.push('/notes' as any)}>
                <Text style={styles.cardTitle}>Notes</Text>
                <Text style={styles.cardMeta}>Notes personnelles, rappels et échéances.</Text>
              </Pressable>
            ) : null}
          </>
        ) : null}
        {accessChecked && ['admin', 'member'].includes(accessRole || '') ? (
          <>
            <Pressable style={[styles.card, styles.cardFino]} onPress={() => router.push('/fino' as any)}>
              <Text style={styles.cardTitle}>Fino</Text>
              <Text style={styles.cardMeta}>Duo, lobby et état de partie en cours de migration.</Text>
            </Pressable>
            <Pressable style={styles.card} onPress={() => router.push('/coinche')}>
              <Text style={styles.cardTitle}>Coinche</Text>
              <Text style={styles.cardMeta}>Tables rapides, robots prets.</Text>
            </Pressable>
            <Pressable style={[styles.card, styles.cardAlt]} onPress={handleEnterImpostor}>
              <Text style={styles.cardTitle}>Imposteur</Text>
              <Text style={styles.cardMeta}>Parties bluff, votes, score.</Text>
              {impostorLoading ? <Text style={styles.cardStatus}>Connexion...</Text> : null}
            </Pressable>
          </>
        ) : null}
        {accessChecked && ['admin', 'member', 'eleve'].includes(accessRole || '') ? (
          <Pressable style={[styles.card, styles.cardFrench]} onPress={() => router.push('/tests')}>
            <Text style={styles.cardTitle}>Francais</Text>
            <Text style={styles.cardMeta}>Conjugaison, dictées, orthographe.</Text>
          </Pressable>
        ) : null}
        {impostorError ? <Text style={styles.errorText}>{impostorError}</Text> : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  authSafe: {
    flex: 1,
    width: '100%',
    maxWidth: '100%',
    backgroundColor: '#0b0f1a',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    overflow: 'hidden'
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
    width: '100%',
    maxWidth: 420,
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
    color: '#e2e8f0',
    fontSize: 18,
    lineHeight: 24
  },
  passwordToggle: {
    display: 'none'
  },
  passwordToggleRow: {
    marginTop: 8,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  passwordToggleBox: {
    width: 16,
    height: 16,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#475569',
    backgroundColor: '#0b1220'
  },
  passwordToggleBoxActive: {
    backgroundColor: '#22c55e',
    borderColor: '#22c55e'
  },
  passwordToggleLabel: {
    color: '#cbd5e1'
  },
  authError: {
    marginTop: 12,
    color: '#fca5a5'
  },
  authInfo: {
    marginTop: 12,
    color: '#93c5fd'
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
    width: '100%',
    maxWidth: '100%',
    backgroundColor: '#0b0f1a',
    overflow: 'hidden'
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
    alignItems: 'center',
    zIndex: 50,
    elevation: 50
  },
  menuWrapper: {
    position: 'relative',
    zIndex: 60
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
  menuButton: {
    width: 38,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#24304f',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 3
  },
  menuLine: {
    width: 16,
    height: 2,
    borderRadius: 2,
    backgroundColor: '#e2e8f0'
  },
  menuPanel: {
    position: 'absolute',
    top: 40,
    right: 0,
    width: 140,
    borderRadius: 12,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#24304f',
    overflow: 'hidden',
    zIndex: 20
  },
  menuItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937'
  },
  menuItemText: {
    color: '#f8fafc',
    fontSize: 13
  },
  hubGrid: {
    marginTop: 24,
    paddingHorizontal: 24,
    gap: 16,
    zIndex: 1
  },
  loadingCard: {
    backgroundColor: '#111827',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#1f2937',
    alignItems: 'center',
    gap: 10
  },
  loadingText: {
    color: '#cbd5e1',
    fontWeight: '600'
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
  cardRental: {
    borderColor: '#9a3412'
  },
  cardNotes: {
    borderColor: '#b45309'
  },
  cardFino: {
    borderColor: '#0f766e'
  },
  cardFrench: {
    borderColor: '#065f46'
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
  cardStatus: {
    marginTop: 14,
    color: '#f59e0b',
    fontWeight: '700'
  },
  errorText: {
    color: '#fca5a5'
  }
});
