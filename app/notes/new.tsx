import { useEffect, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';

import { createNote, updateNote, uploadNotePhoto } from '@/lib/notesApi';
import { requireAdminNotesAccess } from '@/lib/notesAccess';

function toDateISO(date: Date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yy = date.getFullYear();
  return `${yy}-${mm}-${dd}`;
}

const palette = {
  bg: '#f4f0e6',
  card: '#fffaf1',
  ink: '#1f2937',
  sub: '#6b7280',
  border: '#e5d7bf',
  accent: '#9a3412',
  danger: '#b91c1c',
};

export default function NewNoteScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [hasDeadline, setHasDeadline] = useState(false);
  const [deadline, setDeadline] = useState(toDateISO(new Date()));
  const [saving, setSaving] = useState(false);
  const [photos, setPhotos] = useState<{ file: File; preview: string }[]>([]);

  useEffect(() => {
    requireAdminNotesAccess().then((result) => {
      if (!result.allowed || !result.userId) {
        router.replace('/');
        return;
      }
      setUserId(result.userId);
    });
  }, []);

  function addPhoto() {
    if (Platform.OS !== 'web' || typeof document === 'undefined') {
      Alert.alert('Non disponible', 'L’ajout photo est disponible dans la version web/PWA.');
      return;
    }
    if (photos.length >= 5) {
      Alert.alert('Limite atteinte', 'Tu peux ajouter jusqu’à cinq photos.');
      return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.setAttribute('capture', 'environment');
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const preview = URL.createObjectURL(file);
      setPhotos((current) => [...current, { file, preview }].slice(0, 5));
    };
    input.click();
  }

  function removePhoto(index: number) {
    setPhotos((current) => {
      const target = current[index];
      if (target?.preview?.startsWith('blob:')) {
        URL.revokeObjectURL(target.preview);
      }
      return current.filter((_, currentIndex) => currentIndex !== index);
    });
  }

  async function onSave() {
    if (!userId) return;
    const cleanTitle = title.trim();
    const cleanBody = body.trim();
    if (!cleanTitle) {
      Alert.alert('Titre manquant', 'Ajoute un titre à la note.');
      return;
    }
    if (!cleanBody) {
      Alert.alert('Texte manquant', 'Ajoute le contenu de la note.');
      return;
    }

    try {
      setSaving(true);
      const note = await createNote({
        user_id: userId,
        title: cleanTitle,
        body: cleanBody,
        expires_at: hasDeadline ? deadline : null,
        photos: [],
      });
      if (photos.length > 0) {
        const uploaded = await Promise.all(
          photos.map((photo, index) =>
            uploadNotePhoto({
              file: photo.file,
              noteId: note.id,
              index,
              userId,
            }),
          ),
        );
        await updateNote(note.id, { photos: uploaded });
      }
      router.replace('/notes');
    } catch (error: any) {
      Alert.alert('Enregistrement impossible', error?.message || 'Impossible de créer la note.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.back}>Retour</Text>
        </Pressable>

        <View style={styles.card}>
          <Text style={styles.title}>Nouvelle note</Text>

          <View style={styles.field}>
            <Text style={styles.label}>Titre</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Titre court"
              placeholderTextColor="#94a3b8"
              style={styles.input}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Contenu</Text>
            <TextInput
              value={body}
              onChangeText={setBody}
              placeholder="Écris ici"
              placeholderTextColor="#94a3b8"
              multiline
              style={[styles.input, styles.bodyInput]}
            />
          </View>

          <View style={styles.switchRow}>
            <Text style={styles.label}>Échéance</Text>
            <Switch value={hasDeadline} onValueChange={setHasDeadline} />
          </View>

          {hasDeadline ? (
            <View style={styles.field}>
              <Text style={styles.label}>Date</Text>
              <TextInput value={deadline} onChangeText={setDeadline} style={styles.input} placeholder="YYYY-MM-DD" />
            </View>
          ) : null}

          <View style={styles.field}>
            <View style={styles.photoHeader}>
              <Text style={styles.label}>Photos</Text>
              <Text style={styles.photoCount}>{photos.length}/5</Text>
            </View>
            <View style={styles.photoGrid}>
              {photos.map((photo, index) => (
                <Pressable key={`${photo.preview}-${index}`} onPress={() => removePhoto(index)} style={styles.photoWrap}>
                  <Image source={{ uri: photo.preview }} style={styles.photo} contentFit="cover" />
                  <View style={styles.photoBadge}>
                    <Text style={styles.photoBadgeText}>×</Text>
                  </View>
                </Pressable>
              ))}
              {photos.length < 5 ? (
                <Pressable style={styles.addPhotoButton} onPress={addPhoto}>
                  <Text style={styles.addPhotoPlus}>+</Text>
                </Pressable>
              ) : null}
            </View>
          </View>

          <View style={styles.actions}>
            <Pressable style={styles.cancelButton} onPress={() => router.back()}>
              <Text style={styles.cancelText}>Annuler</Text>
            </Pressable>
            <Pressable style={styles.saveButton} onPress={onSave} disabled={saving}>
              <Text style={styles.saveText}>{saving ? 'Enregistrement...' : 'Enregistrer'}</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: palette.bg,
  },
  container: {
    padding: 16,
    gap: 14,
  },
  back: {
    color: palette.ink,
  },
  card: {
    backgroundColor: palette.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 16,
    gap: 14,
  },
  title: {
    fontSize: 24,
    fontWeight: '900',
    color: palette.ink,
  },
  field: {
    gap: 6,
  },
  label: {
    color: palette.sub,
    fontWeight: '700',
  },
  input: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#fff',
    color: palette.ink,
  },
  bodyInput: {
    height: 180,
    textAlignVertical: 'top',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  photoHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  photoCount: {
    color: palette.sub,
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  photoWrap: {
    width: 90,
    height: 90,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  photo: {
    width: '100%',
    height: '100%',
    backgroundColor: '#e5e7eb',
  },
  photoBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoBadgeText: {
    color: '#fff',
    fontSize: 16,
    lineHeight: 16,
    fontWeight: '800',
  },
  addPhotoButton: {
    width: 90,
    height: 90,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPhotoPlus: {
    fontSize: 30,
    color: palette.accent,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#e7ded0',
  },
  cancelText: {
    color: palette.ink,
    fontWeight: '800',
  },
  saveButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: palette.accent,
  },
  saveText: {
    color: '#fff',
    fontWeight: '800',
  },
});
