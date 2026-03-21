import { supabase } from '@/lib/supabase';
import { getPushApiBase } from '@/lib/pushApi';

export type AccessRole = 'admin' | 'manager' | 'member' | 'eleve';

export type AccessWhitelistRow = {
  id: string;
  email: string;
  role: AccessRole;
  teacher_email: string | null;
  added_by: string | null;
  created_at: string;
  updated_at: string;
  profile_username?: string | null;
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function fetchWhitelistByEmail(email: string) {
  const normalized = normalizeEmail(email);
  const { data, error } = await supabase
    .from('access_whitelist')
    .select('*')
    .eq('email', normalized)
    .limit(1);
  if (error) {
    throw new Error(error.message || 'whitelist_lookup_failed');
  }
  return ((data || [])[0] || null) as AccessWhitelistRow | null;
}

export async function listStudentsForAdmin(adminEmail: string) {
  const apiBase = getPushApiBase();
  if (!apiBase) throw new Error('missing_push_api_base');
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error('not_authenticated');

  const response = await fetch(`${apiBase}/admin/students`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || 'students_lookup_failed');
  }
  return (payload.data || []) as AccessWhitelistRow[];
}

export async function addStudentForAdmin(params: {
  adminUserId: string;
  adminEmail: string;
  studentEmail: string;
}) {
  const adminEmail = normalizeEmail(params.adminEmail);
  const studentEmail = normalizeEmail(params.studentEmail);
  if (!studentEmail) {
    throw new Error('Email eleve requis.');
  }
  if (studentEmail === adminEmail) {
    throw new Error('Un admin ne peut pas etre son propre eleve.');
  }

  const payload = {
    email: studentEmail,
    role: 'eleve' as const,
    teacher_email: adminEmail,
    added_by: params.adminUserId
  };

  const { error } = await supabase.from('access_whitelist').upsert(payload, { onConflict: 'email' });
  if (error) {
    throw new Error(error.message || 'student_upsert_failed');
  }
}
