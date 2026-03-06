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

function clean(value: string | null | undefined) {
  return (value || '').trim();
}

function buildTest10FromRows(ref: string, rows: Test10Row[], wantedLangue?: 'FR' | 'EN', wantedNiveau?: string) {
  const header =
    rows.find((row) => {
      const rowLangue = clean(row.langue).toUpperCase();
      const rowNiveau = clean(row.niveau);
      if (wantedLangue && rowLangue !== wantedLangue) return false;
      if (wantedNiveau && rowNiveau !== wantedNiveau) return false;
      return rowLangue.length > 0;
    }) ||
    rows.find((row) => clean(row.langue).length > 0) ||
    rows[0];

  const baseLangue = clean(header.langue).toUpperCase();
  const baseNiveau = clean(header.niveau);

  const scopedRows = rows.filter((row) => {
    const rowLangue = clean(row.langue).toUpperCase();
    const rowNiveau = clean(row.niveau);
    const keepLangue = rowLangue.length === 0 || rowLangue === baseLangue;
    const keepNiveau = rowNiveau.length === 0 || rowNiveau === baseNiveau;
    return keepLangue && keepNiveau;
  });

  const title =
    clean(header.titre) ||
    clean(scopedRows.find((row) => clean(row.titre).length > 0)?.titre) ||
    `Dictee ${ref}`;

  const phrases = scopedRows.map((row) => clean(row.phrase)).filter(Boolean);

  return {
    ref,
    titre: title,
    langue: baseLangue || clean(wantedLangue),
    niveau: baseNiveau || clean(wantedNiveau),
    phrases
  } as Test10Dictation;
}

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
  const { data, error } = await supabase
    .from('reponse_test10')
    .select('*')
    .order('ref', { ascending: true })
    .order('id', { ascending: true });
  throwIfError(error);

  const grouped = new Map<string, Test10Row[]>();
  for (const row of (data || []) as Test10Row[]) {
    if (!grouped.has(row.ref)) grouped.set(row.ref, []);
    grouped.get(row.ref)!.push(row);
  }

  const dictations: Test10Dictation[] = [];
  for (const [ref, rows] of grouped) {
    const hasHeaderForFilter = rows.some((row) => {
      const rowLangue = clean(row.langue).toUpperCase();
      const rowNiveau = clean(row.niveau);
      if (rowLangue !== langue) return false;
      if (niveau && rowNiveau !== niveau) return false;
      return true;
    });
    if (!hasHeaderForFilter) continue;
    dictations.push(buildTest10FromRows(ref, rows, langue, niveau));
  }
  return dictations;
}

export async function fetchTest10DictationByRef(ref: string, langue?: 'FR' | 'EN', niveau?: string) {
  const { data, error } = await supabase.from('reponse_test10').select('*').eq('ref', ref).order('id', { ascending: true });
  throwIfError(error);
  const rows = (data || []) as Test10Row[];
  if (!rows.length) return null;
  return buildTest10FromRows(ref, rows, langue, niveau);
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
