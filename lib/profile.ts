import { supabase } from '@/lib/supabase';

function deriveUsername(email?: string | null) {
  if (!email) return '';
  const base = email.split('@')[0] || '';
  return base.trim().slice(0, 20);
}

export async function ensureProfileUsername(
  user: { id: string; email?: string | null },
  desiredUsername?: string
) {
  const fallback = deriveUsername(user.email);
  const desired = desiredUsername?.trim();
  const nextUsername = desired || fallback;

  const { data: profile } = await supabase
    .from('profiles')
    .select('username')
    .eq('id', user.id)
    .single();

  if (profile?.username) {
    return profile.username;
  }

  if (nextUsername) {
    await supabase.from('profiles').insert({ id: user.id, username: nextUsername });
  }

  return nextUsername;
}
