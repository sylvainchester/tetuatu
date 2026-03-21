import { fetchWhitelistByEmail } from '@/lib/accessControl';
import { supabase } from '@/lib/supabase';

export async function requireAdminNotesAccess() {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  const email = session?.user?.email ?? null;
  if (!session || !email) {
    return { allowed: false as const, userId: null };
  }

  const access = await fetchWhitelistByEmail(email);
  if (!access || access.role !== 'admin') {
    return { allowed: false as const, userId: session.user.id };
  }

  return { allowed: true as const, userId: session.user.id };
}
