create extension if not exists pgcrypto;

create table if not exists public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  subscription jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_push_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at_trigger()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_updated_at_web_push_subscriptions on public.web_push_subscriptions;
create trigger set_updated_at_web_push_subscriptions
before update on public.web_push_subscriptions
for each row execute function public.set_updated_at_trigger();

drop trigger if exists set_updated_at_user_push_tokens on public.user_push_tokens;
create trigger set_updated_at_user_push_tokens
before update on public.user_push_tokens
for each row execute function public.set_updated_at_trigger();

alter table public.web_push_subscriptions enable row level security;
alter table public.user_push_tokens enable row level security;

drop policy if exists web_push_subscriptions_select_own on public.web_push_subscriptions;
create policy web_push_subscriptions_select_own
on public.web_push_subscriptions
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists web_push_subscriptions_insert_own on public.web_push_subscriptions;
create policy web_push_subscriptions_insert_own
on public.web_push_subscriptions
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists web_push_subscriptions_update_own on public.web_push_subscriptions;
create policy web_push_subscriptions_update_own
on public.web_push_subscriptions
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists user_push_tokens_select_own on public.user_push_tokens;
create policy user_push_tokens_select_own
on public.user_push_tokens
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists user_push_tokens_insert_own on public.user_push_tokens;
create policy user_push_tokens_insert_own
on public.user_push_tokens
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists user_push_tokens_update_own on public.user_push_tokens;
create policy user_push_tokens_update_own
on public.user_push_tokens
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
