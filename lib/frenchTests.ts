import { supabase } from '@/lib/supabase';

export type Test1VerbRow = {
  id: number;
  infinitif: string;
  auxiliaire: string | null;
  participe_passe: string | null;
  present_je: string | null;
  present_tu: string | null;
  present_il: string | null;
  present_nous: string | null;
  present_vous: string | null;
  present_ils: string | null;
  futur_je: string | null;
  futur_tu: string | null;
  futur_il: string | null;
  futur_nous: string | null;
  futur_vous: string | null;
  futur_ils: string | null;
  imparfait_je: string | null;
  imparfait_tu: string | null;
  imparfait_il: string | null;
  imparfait_nous: string | null;
  imparfait_vous: string | null;
  imparfait_ils: string | null;
  passe_simple_je: string | null;
  passe_simple_tu: string | null;
  passe_simple_il: string | null;
  passe_simple_nous: string | null;
  passe_simple_vous: string | null;
  passe_simple_ils: string | null;
  traduction_en: string | null;
  subjonctif_je: string | null;
  subjonctif_tu: string | null;
  subjonctif_il: string | null;
  subjonctif_nous: string | null;
  subjonctif_vous: string | null;
  subjonctif_ils: string | null;
};

export type Test9Row = {
  id: number;
  categorie: string;
  phrase: string;
  lecon: string;
};

export type Test10Row = {
  id: number;
  titre: string;
  langue: string;
  niveau: string;
  ref: string;
  phrase: string;
};

export type Test10Dictation = {
  ref: string;
  titre: string;
  langue: string;
  niveau: string;
  phrases: string[];
};

export type Test11Row = {
  id: number;
  langue: string;
  niveau: string;
  categorie: string;
  question: string;
  nombre_mots: number;
  commentaire: string;
};

function throwIfError(error: { message?: string } | null) {
  if (error) {
    throw new Error(error.message || 'supabase_error');
  }
}

export async function fetchTest1Verbs() {
  const { data, error } = await supabase
    .from('reponse_test1')
    .select('*')
    .order('id', { ascending: true });
  throwIfError(error);
  return (data || []) as Test1VerbRow[];
}

export async function fetchTest9Categories(langue: 'fr' = 'fr') {
  const table = langue === 'fr' ? 'reponse_test9_fr' : 'reponse_test9_fr';
  const { data, error } = await supabase.from(table).select('categorie').order('categorie', { ascending: true });
  throwIfError(error);
  return Array.from(new Set((data || []).map((row: { categorie: string }) => row.categorie)));
}

export async function fetchTest9Exercises(categorie: string, langue: 'fr' = 'fr') {
  const table = langue === 'fr' ? 'reponse_test9_fr' : 'reponse_test9_fr';
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq('categorie', categorie)
    .order('id', { ascending: true });
  throwIfError(error);
  return (data || []) as Test9Row[];
}

export async function fetchTest10Levels(langue: 'FR' | 'EN') {
  const { data, error } = await supabase
    .from('reponse_test10')
    .select('niveau')
    .eq('langue', langue)
    .order('niveau', { ascending: true });
  throwIfError(error);
  return Array.from(new Set((data || []).map((row: { niveau: string }) => row.niveau).filter(Boolean)));
}

export async function fetchTest10Dictations(langue: 'FR' | 'EN', niveau?: string) {
  let query = supabase
    .from('reponse_test10')
    .select('*')
    .eq('langue', langue)
    .order('ref', { ascending: true })
    .order('id', { ascending: true });
  if (niveau) {
    query = query.eq('niveau', niveau);
  }
  const { data, error } = await query;
  throwIfError(error);

  const grouped = new Map<string, Test10Dictation>();
  for (const row of (data || []) as Test10Row[]) {
    const current = grouped.get(row.ref);
    const title = row.titre?.trim() || current?.titre || `Dictee ${row.ref}`;
    if (!current) {
      grouped.set(row.ref, {
        ref: row.ref,
        titre: title,
        langue: row.langue,
        niveau: row.niveau,
        phrases: row.phrase ? [row.phrase] : []
      });
      continue;
    }
    current.titre = title;
    if (row.phrase) current.phrases.push(row.phrase);
  }
  return [...grouped.values()];
}

export async function fetchTest10DictationByRef(ref: string, langue?: 'FR' | 'EN') {
  let query = supabase.from('reponse_test10').select('*').eq('ref', ref).order('id', { ascending: true });
  if (langue) {
    query = query.eq('langue', langue);
  }
  const { data, error } = await query;
  throwIfError(error);
  const rows = (data || []) as Test10Row[];
  if (!rows.length) return null;
  const firstWithTitle = rows.find((row) => row.titre?.trim());
  const first = rows[0];
  return {
    ref,
    titre: firstWithTitle?.titre?.trim() || `Dictee ${ref}`,
    langue: first.langue,
    niveau: first.niveau,
    phrases: rows.map((row) => row.phrase).filter(Boolean)
  } as Test10Dictation;
}

export async function fetchTest11Categories(langue: 'fr' | 'en') {
  const { data, error } = await supabase
    .from('reponse_test11')
    .select('categorie')
    .eq('langue', langue)
    .order('categorie', { ascending: true });
  throwIfError(error);
  return Array.from(new Set((data || []).map((row: { categorie: string }) => row.categorie).filter(Boolean)));
}

export async function fetchTest11Prompts(langue: 'fr' | 'en', categorie: string) {
  const { data, error } = await supabase
    .from('reponse_test11')
    .select('*')
    .eq('langue', langue)
    .eq('categorie', categorie)
    .order('id', { ascending: true });
  throwIfError(error);
  return (data || []) as Test11Row[];
}
