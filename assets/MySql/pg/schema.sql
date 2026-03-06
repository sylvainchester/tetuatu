create extension if not exists "pgcrypto";

create table if not exists reponse_test1 (
  id bigserial primary key,
  infinitif text,
  auxiliaire text,
  participe_passe text,
  present_je text,
  present_tu text,
  present_il text,
  present_nous text,
  present_vous text,
  present_ils text,
  futur_je text,
  futur_tu text,
  futur_il text,
  futur_nous text,
  futur_vous text,
  futur_ils text,
  imparfait_je text,
  imparfait_tu text,
  imparfait_il text,
  imparfait_nous text,
  imparfait_vous text,
  imparfait_ils text,
  passe_simple_je text,
  passe_simple_tu text,
  passe_simple_il text,
  passe_simple_nous text,
  passe_simple_vous text,
  passe_simple_ils text,
  traduction_en text,
  subjonctif_je text,
  subjonctif_tu text,
  subjonctif_il text,
  subjonctif_nous text,
  subjonctif_vous text,
  subjonctif_ils text
);

create table if not exists reponse_test9_fr (
  id bigserial primary key,
  categorie text not null,
  phrase text not null,
  lecon text not null
);

create table if not exists reponse_test10 (
  id bigserial primary key,
  titre text not null,
  langue text not null,
  niveau text not null,
  ref text not null,
  phrase text not null
);

create index if not exists reponse_test10_ref_idx on reponse_test10 (ref);
create index if not exists reponse_test10_langue_niveau_idx on reponse_test10 (langue, niveau);

create table if not exists reponse_test11 (
  id bigserial primary key,
  langue text not null,
  niveau text not null,
  categorie text not null,
  question text not null,
  nombre_mots integer not null,
  commentaire text not null
);

create index if not exists reponse_test11_langue_cat_idx on reponse_test11 (langue, categorie);
