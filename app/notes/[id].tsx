import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
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
import { useLocalSearchParams, router } from 'expo-router';

import { deleteNote, fetchNote, resolveNotePhotoUrls, updateNote, uploadNotePhoto } from '@/lib/notesApi';
import { requireAdminNotesAccess } from '@/lib/notesAccess';

const palette = {
  bg: '#f4f0e6',
  card: '#fffaf1',
  ink: '#1f2937',
  sub: '#6b7280',
  border: '#e5d7bf',
  accent: '#9a3412',
  danger: '#b91c1c',
};

export default function EditNoteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [deadline, setDeadline] = useState('');
  const [hasDeadline, setHasDeadline] = useState(false);
  const [noteUserId, setNoteUserId] = useState<string | null>(null);
  const [existingPhotoPaths, setExistingPhotoPaths] = useState<string[]>([]);
  const [existingPhotoUrls, setExistingPhotoUrls] = useState<string[]>([]);
  const [newPhotos, setNewPhotos] = useState<{ file: File; preview: string }[]>([]);
  const [fullscreenPhoto, setFullscreenPhoto] = useState<string | null>(null);

  useEffect(() => {
    requireAdminNotesAccess().then((result) => {
      if (!result.allowed) {
        router.replace('/');
        return;
      }
      setAllowed(true);
    });
  }, []);

  useEffect(() => {
    if (!allowed || !id) return;
    setLoading(true);
    fetchNote(id)
      .then(async (note) => {
        setTitle(note.title || '');
        setBody(note.body || '');
        setDeadline(note.expires_at || '');
        setHasDeadline(!!note.expires_at);
        setNoteUserId(note.user_id || null);
        const paths = note.photos || [];
        setExistingPhotoPaths(paths);
        setExistingPhotoUrls(await resolveNotePhotoUrls(paths));
      })
      .finally(() => setLoading(false));
  }, [allowed, id]);

  function addPhoto() {
    if (Platform.OS !== 'web' || typeof document === 'undefined') {
      Alert.alert('Non disponible', 'L’ajout photo est disponible dans la version web/PWA.');
      return;
    }
    if (existingPhotoPaths.length + newPhotos.length >= 5) {
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
      setNewPhotos((current) => [...current, { file, preview }].slice(0, 5));
    };
    input.click();
  }

  function removeNewPhoto(index: number) {
    setNewPhotos((current) => {
      const target = current[index];
      if (target?.preview?.startsWith('blob:')) {
        URL.revokeObjectURL(target.preview);
      }
      return current.filter((_, currentIndex) => currentIndex !== index);
    });
  }

  async function onSave() {
    if (!id) return;
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
      let photoPaths = existingPhotoPaths;
      const userId = noteUserId;
      if (!userId) {
        throw new Error('Utilisateur de la note introuvable.');
      }
      if (newPhotos.length > 0) {
        const uploaded = await Promise.all(
          newPhotos.map((photo, index) =>
            uploadNotePhoto({
              file: photo.file,
              noteId: id,
              index: existingPhotoPaths.length + index,
              userId,
            }),
          ),
        );
        photoPaths = [...existingPhotoPaths, ...uploaded];
      }

      await updateNote(id, {
        title: cleanTitle,
        body: cleanBody,
        expires_at: hasDeadline ? deadline : null,
        photos: photoPaths,
      });
      router.replace('/notes');
    } catch (error: any) {
      Alert.alert('Mise à jour impossible', error?.message || 'Impossible de modifier la note.');
    } finally {
      setSaving(false);
    }
  }

  function onDelete() {
    if (!id) return;
    Alert.alert('Supprimer la note ?', 'Cette action est définitive.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: async () => {
          await deleteNote(id);
          router.replace('/notes');
        },
      },
    ]);
  }

  if (!allowed || loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={palette.accent} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.back}>Retour</Text>
        </Pressable>

        <View style={styles.card}>
          <Text style={styles.title}>Modifier la note</Text>

          <View style={styles.field}>
            <Text style={styles.label}>Titre</Text>
            <TextInput value={title} onChangeText={setTitle} style={styles.input} placeholder="Titre" placeholderTextColor="#94a3b8" />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Contenu</Text>
            <TextInput
              value={body}
              onChangeText={setBody}
              multiline
              style={[styles.input, styles.bodyInput]}
              placeholder="Contenu"
              placeholderTextColor="#94a3b8"
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
              <Text style={styles.photoCount}>{existingPhotoUrls.length + newPhotos.length}/5</Text>
            </View>
            <View style={styles.photoGrid}>
              {existingPhotoUrls.map((photo, index) => (
                <Pressable key={`${photo}-${index}`} onPress={() => setFullscreenPhoto(photo)}>
                  <Image source={{ uri: photo }} style={styles.photo} contentFit="cover" />
                </Pressable>
              ))}
              {newPhotos.map((photo, index) => (
                <Pressable key={`${photo.preview}-${index}`} onPress={() => removeNewPhoto(index)} style={styles.photoWrap}>
                  <Image source={{ uri: photo.preview }} style={styles.photo} contentFit="cover" />
                  <View style={styles.photoBadge}>
                    <Text style={styles.photoBadgeText}>×</Text>
                  </View>
                </Pressable>
              ))}
              {existingPhotoUrls.length + newPhotos.length < 5 ? (
                <Pressable style={styles.addPhotoButton} onPress={addPhoto}>
                  <Text style={styles.addPhotoPlus}>+</Text>
                </Pressable>
              ) : null}
            </View>
          </View>

          <View style={styles.actions}>
            <Pressable style={styles.deleteButton} onPress={onDelete}>
              <Text style={styles.deleteText}>Supprimer</Text>
            </Pressable>
            <Pressable style={styles.saveButton} onPress={onSave} disabled={saving}>
              <Text style={styles.saveText}>{saving ? 'Enregistrement...' : 'Enregistrer'}</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>

      <Modal visible={!!fullscreenPhoto} transparent animationType="fade" onRequestClose={() => setFullscreenPhoto(null)}>
        <View style={styles.modalBackdrop}>
          <Pressable style={styles.modalCloseZone} onPress={() => setFullscreenPhoto(null)} />
          {fullscreenPhoto ? <Image source={{ uri: fullscreenPhoto }} style={styles.fullscreenImage} contentFit="contain" /> : null}
          <Pressable style={styles.modalCloseButton} onPress={() => setFullscreenPhoto(null)}>
            <Text style={styles.modalCloseText}>Fermer</Text>
          </Pressable>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: palette.bg,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
    width: 90,
    height: 90,
    borderRadius: 12,
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  modalCloseZone: {
    ...StyleSheet.absoluteFillObject,
  },
  fullscreenImage: {
    width: '100%',
    height: '82%',
  },
  modalCloseButton: {
    marginTop: 16,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  modalCloseText: {
    color: '#fff',
    fontWeight: '800',
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  deleteButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: palette.danger,
  },
  deleteText: {
    color: '#fff',
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
