-- =============================================================================
-- Candidate Tracker — Phase 2: file upload support
-- Run once in Supabase → SQL Editor, AFTER 0001_init.sql.
-- =============================================================================

-- Extra details kept for each upload (shown on the Upload History detail page).
alter table public.uploads
  add column if not exists file_size_bytes int,
  add column if not exists warning_count   int   not null default 0,
  add column if not exists warnings        jsonb not null default '[]',  -- [{row, name, message}] imported with a note
  add column if not exists unassigned      jsonb not null default '[]',  -- [{row, name, job_title, decision}] decision = ZBM | HOS | skip
  add column if not exists failure_message text;

-- Naukri can list two emails in one cell; the first is `email`, the rest go here.
alter table public.candidates add column if not exists alternate_email text;

-- Rebuild the global-search text so it also covers the alternate email.
drop index if exists public.candidates_search_trgm_idx;
alter table public.candidates drop column if exists search_text;
alter table public.candidates add column search_text text generated always as (
  lower(
    coalesce(name, '') || ' ' || coalesce(email, '') || ' ' || coalesce(alternate_email, '') || ' ' ||
    coalesce(primary_phone, '') || ' ' || coalesce(alternate_phone, '') || ' ' ||
    coalesce(current_company, '') || ' ' || coalesce(resume_headline, '')
  )
) stored;
create index candidates_search_trgm_idx on public.candidates using gin (search_text extensions.gin_trgm_ops);

-- Finds saved candidates whose phone or email matches any of the given values (all roles).
-- The upload preview uses this to spot exact and possible duplicates without downloading every candidate.
-- "security invoker" = runs as the logged-in user, so Row Level Security still applies.
create or replace function public.match_existing_candidates(p_phones text[], p_emails text[])
returns table (
  id            uuid,
  role          public.candidate_role,
  name          text,
  name_norm     text,
  email_norm    text,
  primary_phone text,
  stage_name    text,
  created_at    timestamptz
)
language sql stable security invoker set search_path = ''
as $$
  select c.id, c.role, c.name, c.name_norm, c.email_norm, c.primary_phone, s.name, c.created_at
  from public.candidates c
  join public.stages s on s.id = c.stage_id
  where c.primary_phone = any (coalesce(p_phones, '{}'))
     or c.email_norm    = any (coalesce(p_emails, '{}'));
$$;

revoke execute on function public.match_existing_candidates(text[], text[]) from public, anon;
grant  execute on function public.match_existing_candidates(text[], text[]) to authenticated;
