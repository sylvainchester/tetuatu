create table if not exists public.fino_rows (
  id uuid primary key default gen_random_uuid(),
  game integer not null,
  seat text not null check (seat in ('seat1', 'seat2', 'deck', 'bin', 'play')),
  player_name text null,
  cards text not null default '',
  turn_flag text null default '',
  points integer null default 0,
  first_flag text null default '',
  last_card text null default '',
  jack_rule text null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game, seat)
);

create index if not exists fino_rows_game_idx on public.fino_rows (game);

create or replace function public.set_updated_at_fino_rows()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_updated_at_fino_rows_trigger on public.fino_rows;
create trigger set_updated_at_fino_rows_trigger
before update on public.fino_rows
for each row execute function public.set_updated_at_fino_rows();

alter table public.fino_rows enable row level security;

drop policy if exists fino_rows_select_all on public.fino_rows;
create policy fino_rows_select_all
on public.fino_rows
for select
to authenticated
using (true);

drop policy if exists fino_rows_insert_all on public.fino_rows;
create policy fino_rows_insert_all
on public.fino_rows
for insert
to authenticated
with check (true);

drop policy if exists fino_rows_update_all on public.fino_rows;
create policy fino_rows_update_all
on public.fino_rows
for update
to authenticated
using (true)
with check (true);

drop policy if exists fino_rows_delete_all on public.fino_rows;
create policy fino_rows_delete_all
on public.fino_rows
for delete
to authenticated
using (true);
