alter table public.exercise_attempts
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists prof_read_at timestamptz null;

create index if not exists exercise_attempts_prof_read_idx
  on public.exercise_attempts (prof_read_at);

update public.exercise_attempts
set updated_at = coalesce(updated_at, created_at, now())
where updated_at is null;
