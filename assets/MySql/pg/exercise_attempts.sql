create table if not exists public.exercise_attempts (
  id uuid primary key default gen_random_uuid(),
  student_user_id uuid not null,
  student_email text not null,
  teacher_user_id uuid,
  teacher_email text,
  test_id text not null,
  title text not null,
  summary text not null default '',
  score numeric,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists exercise_attempts_teacher_created_idx
  on public.exercise_attempts (teacher_user_id, created_at desc);

create index if not exists exercise_attempts_student_created_idx
  on public.exercise_attempts (student_user_id, created_at desc);

alter table public.exercise_attempts enable row level security;

drop policy if exists exercise_attempts_insert_own on public.exercise_attempts;
create policy exercise_attempts_insert_own
  on public.exercise_attempts
  for insert
  to authenticated
  with check (student_user_id = auth.uid());

drop policy if exists exercise_attempts_select_own on public.exercise_attempts;
create policy exercise_attempts_select_own
  on public.exercise_attempts
  for select
  to authenticated
  using (student_user_id = auth.uid() or teacher_user_id = auth.uid());
