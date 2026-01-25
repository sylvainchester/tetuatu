import { supabase } from '@/lib/supabase';
import { getImpostorApiUrl } from '@/lib/impostor/config';

export function getImpostorApiBase() {
  const apiUrl = getImpostorApiUrl();
  return apiUrl ? apiUrl.replace(/\/$/, '') : '';
}

export async function getImpostorAuthHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    return null;
  }
  return { Authorization: `Bearer ${token}` };
}
