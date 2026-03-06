import { supabase } from '@/lib/supabase';

export type AccessRole = 'admin' | 'eleve';

export type AccessWhitelistRow = {
  id: string;
  email: string;
  role: AccessRole;
  teacher_email: string | null;
  added_by: string | null;
  created_at: string;
  updated_at: string;
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
  const normalized = normalizeEmail(adminEmail);
  const { data, error } = await supabase
    .from('access_whitelist')
    .select('*')
    .eq('role', 'eleve')
    .eq('teacher_email', normalized)
    .order('created_at', { ascending: false });
  if (error) {
    throw new Error(error.message || 'students_lookup_failed');
  }
  return (data || []) as AccessWhitelistRow[];
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
