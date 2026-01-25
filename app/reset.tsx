import { useEffect, useState } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';

import { supabase } from '@/lib/supabase';

export default function ResetScreen() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        setError('Lien invalide ou expire.');
      }
      setReady(true);
    });
  }, []);

  async function handleReset() {
    setError('');
    if (!password || password.length < 6) {
      setError('Mot de passe trop court.');
      return;
    }
    if (password !== confirm) {
      setError('Les mots de passe ne correspondent pas.');
      return;
    }
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message || 'Erreur reset.');
      return;
    }
    router.replace('/');
  }

  if (!ready) {
    return (
      <SafeAreaView style={styles.safe}>
        <Text style={styles.title}>Chargement...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.card}>
        <Text style={styles.title}>Nouveau mot de passe</Text>
        <Text style={styles.subtitle}>Choisis un mot de passe solide.</Text>

        <View style={styles.field}>
          <Text style={styles.label}>Mot de passe</Text>
          <TextInput
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            style={styles.input}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Confirmation</Text>
          <TextInput
            secureTextEntry
            value={confirm}
            onChangeText={setConfirm}
            style={styles.input}
          />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable style={styles.button} onPress={handleReset}>
          <Text style={styles.buttonText}>Valider</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#0b0f1a',
    alignItems: 'center',
    justifyContent: 'center'
  },
  card: {
    width: '88%',
    backgroundColor: '#111827',
    padding: 24,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#24304f'
  },
  title: {
    fontSize: 24,
    color: '#f8fafc',
    fontFamily: 'serif'
  },
  subtitle: {
    marginTop: 6,
    color: '#94a3b8'
  },
  field: {
    marginTop: 16
  },
  label: {
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: '#94a3b8'
  },
  input: {
    marginTop: 8,
    backgroundColor: '#0b1220',
    borderWidth: 1,
    borderColor: '#1e293b',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    color: '#e2e8f0'
  },
  error: {
    marginTop: 12,
    color: '#fca5a5'
  },
  button: {
    marginTop: 18,
    backgroundColor: '#f59e0b',
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center'
  },
  buttonText: {
    color: '#1f2937',
    fontWeight: '700'
  }
});
