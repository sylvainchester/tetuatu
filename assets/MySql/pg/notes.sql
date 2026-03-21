create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  title text not null,
  body text not null,
  created_at timestamptz not null default now(),
  expires_at date,
  photos text[] not null default '{}'
);

alter table public.notes enable row level security;

drop policy if exists notes_select_own on public.notes;
create policy notes_select_own
on public.notes
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists notes_insert_own on public.notes;
create policy notes_insert_own
on public.notes
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists notes_update_own on public.notes;
create policy notes_update_own
on public.notes
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists notes_delete_own on public.notes;
create policy notes_delete_own
on public.notes
for delete
to authenticated
using (user_id = auth.uid());
