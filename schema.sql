-- ============================================================
-- Copiloto Pré-Op — schema do banco (Supabase / PostgreSQL)
-- Rode este script no Supabase: SQL Editor > New query > Run.
-- Princípio: armazenamento PSEUDONIMIZADO. Nada de nome/CPF aqui.
-- O vínculo código <-> paciente vive no seu prontuário oficial (Feegow).
-- ============================================================

create table if not exists public.casos (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  codigo      text not null,                 -- apelido/código do caso (ex.: "MJ-67"), NUNCA o nome
  idade       int,
  sexo        text,
  dados       jsonb not null default '{}',   -- dados clínicos pseudonimizados (comorbidades, exames, cálculos)
  laudo       text,                          -- avaliação gerada
  created_at  timestamptz not null default now()
);

-- Índice para listar o histórico do próprio usuário rapidamente
create index if not exists casos_user_created_idx on public.casos (user_id, created_at desc);

-- ============================================================
-- Row Level Security: cada usuário só acessa os PRÓPRIOS casos.
-- ============================================================
alter table public.casos enable row level security;

drop policy if exists "casos_select_own" on public.casos;
create policy "casos_select_own" on public.casos
  for select using (auth.uid() = user_id);

drop policy if exists "casos_insert_own" on public.casos;
create policy "casos_insert_own" on public.casos
  for insert with check (auth.uid() = user_id);

drop policy if exists "casos_update_own" on public.casos;
create policy "casos_update_own" on public.casos
  for update using (auth.uid() = user_id);

drop policy if exists "casos_delete_own" on public.casos;
create policy "casos_delete_own" on public.casos
  for delete using (auth.uid() = user_id);
