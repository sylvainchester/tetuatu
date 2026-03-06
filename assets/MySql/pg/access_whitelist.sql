create extension if not exists pgcrypto;

create table if not exists public.access_whitelist (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  role text not null check (role in ('admin', 'eleve')),
  teacher_email text null,
  added_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists access_whitelist_email_idx on public.access_whitelist (email);
create index if not exists access_whitelist_teacher_idx on public.access_whitelist (teacher_email);

create or replace function public.set_updated_at_access_whitelist()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_updated_at_access_whitelist_trigger on public.access_whitelist;
create trigger set_updated_at_access_whitelist_trigger
before update on public.access_whitelist
for each row execute function public.set_updated_at_access_whitelist();

alter table public.access_whitelist enable row level security;

drop policy if exists access_whitelist_read_self_or_owned_students on public.access_whitelist;
create policy access_whitelist_read_self_or_owned_students
on public.access_whitelist
for select
to authenticated
using (
  lower(email) = lower(coalesce(auth.jwt()->>'email', ''))
  or lower(teacher_email) = lower(coalesce(auth.jwt()->>'email', ''))
);

drop policy if exists access_whitelist_admin_insert_students on public.access_whitelist;
create policy access_whitelist_admin_insert_students
on public.access_whitelist
for insert
to authenticated
with check (
  role = 'eleve'
  and lower(teacher_email) = lower(coalesce(auth.jwt()->>'email', ''))
);

drop policy if exists access_whitelist_admin_update_students on public.access_whitelist;
create policy access_whitelist_admin_update_students
on public.access_whitelist
for update
to authenticated
using (
  lower(teacher_email) = lower(coalesce(auth.jwt()->>'email', ''))
)
with check (
  role = 'eleve'
  and lower(teacher_email) = lower(coalesce(auth.jwt()->>'email', ''))
);

-- Seed at least one admin manually:
-- insert into public.access_whitelist(email, role) values ('admin@your-domain.com', 'admin');
