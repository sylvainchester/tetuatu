import { supabase } from '@/lib/supabase';

function deriveUsername(email?: string | null) {
  if (!email) return '';
  const base = email.split('@')[0] || '';
  return base.trim().slice(0, 20);
}

export async function ensureProfileUsername(
  user: { id: string; email?: string | null; user_metadata?: { username?: string } },
  desiredUsername?: string
) {
  const fallback = deriveUsername(user.email);
  const desired = desiredUsername?.trim();
  const metadataUsername = user.user_metadata?.username?.trim();
  const preferredUsername = desired || metadataUsername || '';
  const nextUsername = desired || metadataUsername || fallback;

  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('username')
    .eq('id', user.id)
    .limit(1);

  if (profileError) {
    throw new Error(profileError.message || 'profile_lookup_failed');
  }
  const profile = profiles?.[0];

  if (profile?.username) {
    const current = profile.username.trim();
    // Migrate old fallback usernames (email local-part) to the actual chosen pseudo.
    if (preferredUsername && current === fallback && current !== preferredUsername) {
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ username: preferredUsername })
        .eq('id', user.id);
      if (updateError) {
        const code = (updateError as any)?.code;
        if (code === '23505' || code === '409') {
          throw new Error('Ce pseudo est deja utilise. Choisis-en un autre.');
        }
        throw new Error(updateError.message || 'profile_update_failed');
      }
      return preferredUsername;
    }
    return current;
  }

  if (nextUsername) {
    const writeQuery = profile
      ? supabase.from('profiles').update({ username: nextUsername }).eq('id', user.id)
      : supabase.from('profiles').insert({ id: user.id, username: nextUsername });
    const { error: writeError } = await writeQuery;
    if (writeError) {
      const code = (writeError as any)?.code;
      if (code === '23505' || code === '409') {
        throw new Error('Ce pseudo est deja utilise. Choisis-en un autre.');
      }
      throw new Error(writeError.message || 'profile_write_failed');
    }
  }

  return nextUsername;
}
