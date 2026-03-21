import { supabase } from '@/lib/supabase';

export type Note = {
  id: string;
  user_id: string;
  title: string;
  body: string;
  created_at: string;
  expires_at: string | null;
  photos: string[] | null;
};

export type NoteCreate = {
  user_id: string;
  title: string;
  body: string;
  expires_at?: string | null;
  photos?: string[] | null;
};

export async function fetchNotes() {
  const { data, error } = await supabase
    .from('notes')
    .select('id,user_id,title,body,created_at,expires_at,photos')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as Note[];
}

export async function fetchNote(id: string) {
  const { data, error } = await supabase
    .from('notes')
    .select('id,user_id,title,body,created_at,expires_at,photos')
    .eq('id', id)
    .single();

  if (error) throw error;
  return data as Note;
}

export async function createNote(payload: NoteCreate) {
  const { data, error } = await supabase
    .from('notes')
    .insert({ ...payload, photos: payload.photos ?? [] })
    .select('id,user_id,title,body,created_at,expires_at,photos')
    .single();

  if (error) throw error;
  return data as Note;
}

export async function updateNote(id: string, patch: Partial<Omit<NoteCreate, 'user_id'>>) {
  const { data, error } = await supabase
    .from('notes')
    .update(patch)
    .eq('id', id)
    .select('id,user_id,title,body,created_at,expires_at,photos')
    .single();

  if (error) throw error;
  return data as Note;
}

export async function deleteNote(id: string) {
  const { error } = await supabase.from('notes').delete().eq('id', id);
  if (error) throw error;
}

export async function uploadNotePhoto(params: {
  file: File;
  noteId: string;
  index: number;
  userId: string;
}) {
  const { file, noteId, index, userId } = params;
  const extension = file.name.toLowerCase().endsWith('.png') ? 'png' : 'jpg';
  const path = `${userId}/${noteId}/${Date.now()}-${index}.${extension}`;

  const { error } = await supabase.storage.from('notes').upload(path, file, {
    contentType: extension === 'png' ? 'image/png' : 'image/jpeg',
    upsert: true,
  });

  if (error) throw error;
  return path;
}

export async function resolveNotePhotoUrls(paths: string[]) {
  const results = await Promise.all(
    paths.map(async (photo) => {
      if (photo.startsWith('http')) return photo;
      const { data, error } = await supabase.storage.from('notes').createSignedUrl(photo, 60 * 60);
      if (error) return '';
      return data?.signedUrl ?? '';
    }),
  );

  return results.filter(Boolean);
}
