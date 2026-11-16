-- =============================================================================
-- Candidate Tracker — Phase 1 schema
-- Run once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
--
-- Contents
--   1. Extensions and types
--   2. Settings tables: profiles, stages, interviewers, role_keywords, app_settings
--   3. Data tables: uploads, candidates, screening_questions, activity_log
--   4. Helper functions (is_team_member / is_admin)
--   5. Triggers: auto-profile on new login user, stamping "who did it",
--      default stage on insert, automatic activity logging
--   6. Row Level Security (only logged-in, active team members can see anything)
--   7. Seed data: 6 stages, 3 interviewers, role keywords, lag thresholds
-- =============================================================================

-- 1. EXTENSIONS AND TYPES ------------------------------------------------------

create extension if not exists pg_trgm with schema extensions;  -- fast "contains" search

create type public.candidate_role as enum ('ZBM', 'HOS');

create type public.activity_action as enum (
  'stage_change',        -- candidate moved between stages
  'interviewer_change',  -- interviewer assigned / changed / cleared
  'upload',              -- a Naukri file was imported
  'export',              -- a bulk-sender CSV was downloaded
  'settings_change'      -- stages, interviewers, keywords, thresholds or users edited
);


-- 2. SETTINGS TABLES -----------------------------------------------------------

-- One row per team member; created automatically when a login user is added.
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text not null,
  is_admin    boolean not null default false,  -- admins can manage team users
  is_active   boolean not null default true,   -- set false to block someone without deleting history
  created_at  timestamptz not null default now()
);

-- Hiring stages. Editable from Settings, never hard-coded in the app.
create table public.stages (
  id                    bigint generated always as identity primary key,
  name                  text not null unique,
  position              int  not null,                   -- display / funnel order
  color                 text not null default '#64748b', -- badge colour (hex)
  is_default            boolean not null default false,  -- new candidates start here
  requires_interviewer  boolean not null default false,  -- e.g. "1:1 Aligned": ask for an interviewer
  created_at            timestamptz not null default now()
);
-- Only one stage can be the default.
create unique index stages_one_default on public.stages (is_default) where is_default;

create table public.interviewers (
  id          bigint generated always as identity primary key,
  name        text not null unique,
  color       text not null default '#2563eb',
  is_active   boolean not null default true,  -- "removed" interviewers are hidden, not deleted, so history stays intact
  created_at  timestamptz not null default now()
);

-- Keyword rules for detecting the role from Naukri's "Job Title" (case-insensitive).
create table public.role_keywords (
  id          bigint generated always as identity primary key,
  role        public.candidate_role not null,
  keyword     text not null,
  whole_word  boolean not null default false,  -- true: "HOS" matches "HOS - Mumbai" but not "Hospital"
  created_at  timestamptz not null default now(),
  unique (role, keyword)
);

-- Simple key/value settings (lag thresholds etc.).
create table public.app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id)
);


-- 3. DATA TABLES -----------------------------------------------------------------

-- One row per uploaded file (Upload History page).
create table public.uploads (
  id                  uuid primary key default gen_random_uuid(),
  file_name           text not null,
  uploaded_by         uuid references public.profiles (id) default auth.uid(),
  uploaded_at         timestamptz not null default now(),
  status              text not null default 'processing' check (status in ('processing', 'completed', 'failed')),
  total_rows          int not null default 0,
  zbm_rows            int not null default 0,
  hos_rows            int not null default 0,
  new_added           int not null default 0,
  duplicates_skipped  int not null default 0,
  flagged_count       int not null default 0,  -- "possible duplicates"
  flagged_added       int not null default 0,  -- ...that the user chose "Add as new"
  flagged_skipped     int not null default 0,  -- ...that the user chose "Skip"
  unassigned_count    int not null default 0,  -- role could not be detected
  error_count         int not null default 0,
  flagged             jsonb not null default '[]',  -- [{row, name, phone, email, matched_candidate_id, decision}]
  errors              jsonb not null default '[]'   -- [{row, name, message}]
);

create table public.candidates (
  id                     uuid primary key default gen_random_uuid(),
  role                   public.candidate_role not null,
  upload_id              uuid references public.uploads (id),

  -- Naukri fields (cleaned). "NA" in the file is stored as NULL here.
  job_title              text,
  applied_on             date,             -- "Date of application"
  name                   text not null,
  email                  text,
  phone_raw              text,             -- exactly as in the file
  primary_phone          text,             -- first valid 10-digit Indian mobile, digits only
  alternate_phone        text,             -- everything else from the phone cell
  current_location       text,
  preferred_locations    text,
  total_exp_text         text,             -- "3 Year(s) 6 Month(s)"
  total_exp_months       int,              -- 42
  current_company        text,
  designation            text,
  salary_text            text,             -- "Rs 15.90 Lakhs"
  salary_lakhs           numeric(8, 2),    -- 15.90 (always treated as INR lakhs)
  notice_period          text,
  resume_headline        text,
  ug_degree              text,
  ug_specialization      text,
  ug_institute           text,
  pg_degree              text,
  pg_specialization      text,
  pg_institute           text,
  doctorate              jsonb,            -- {degree, specialization, institute} or NULL
  gender                 text,
  home_town              text,
  dob                    date,
  naukri_pipeline_stage  text,             -- stored only; never affects our stage
  naukri_comments        jsonb,            -- Comment 1–5, stored only
  screening              jsonb not null default '{}',  -- {"<question>": {"t": "2", "n": 2}}
  profile_url            text,             -- extracted from the "View profile" hyperlink
  raw                    jsonb not null,   -- the full original row, untouched

  -- Normalised copies used for duplicate checks (trimmed + lowercase).
  name_norm              text not null,
  email_norm             text,

  -- Our tracking fields
  stage_id               bigint not null references public.stages (id) on delete restrict,
  interviewer_id         bigint references public.interviewers (id) on delete restrict,
  stage_changed_at       timestamptz not null default now(),

  created_at             timestamptz not null default now(),
  created_by             uuid references public.profiles (id) default auth.uid(),
  updated_at             timestamptz not null default now(),

  -- One lowercase string for the global search box (name, email, phone, company, headline).
  search_text            text generated always as (
    lower(
      coalesce(name, '') || ' ' || coalesce(email, '') || ' ' || coalesce(primary_phone, '') || ' ' ||
      coalesce(alternate_phone, '') || ' ' || coalesce(current_company, '') || ' ' || coalesce(resume_headline, '')
    )
  ) stored
);

create index candidates_role_idx          on public.candidates (role);
create index candidates_role_stage_idx    on public.candidates (role, stage_id);
create index candidates_primary_phone_idx on public.candidates (primary_phone);
create index candidates_email_norm_idx    on public.candidates (email_norm);
create index candidates_interviewer_idx   on public.candidates (interviewer_id);
create index candidates_upload_idx        on public.candidates (upload_id);
create index candidates_created_at_idx    on public.candidates (created_at);
create index candidates_applied_on_idx    on public.candidates (applied_on);
create index candidates_stage_changed_idx on public.candidates (stage_changed_at);
create index candidates_screening_idx     on public.candidates using gin (screening);
create index candidates_search_trgm_idx   on public.candidates using gin (search_text extensions.gin_trgm_ops);

-- The screening questions seen per role, so each role tab can build its dynamic columns.
create table public.screening_questions (
  id          bigint generated always as identity primary key,
  role        public.candidate_role not null,
  question    text not null,                 -- e.g. "How many years of experience do you have in Sales?"
  is_numeric  boolean not null default false, -- true → range filter, false → text filter
  first_seen  timestamptz not null default now(),
  unique (role, question)
);

-- Full history of everything that happens. Append-only (no edits, no deletes).
create table public.activity_log (
  id                   bigint generated always as identity primary key,
  at                   timestamptz not null default now(),
  user_id              uuid references public.profiles (id) default auth.uid(),
  action               public.activity_action not null,
  role                 public.candidate_role,
  candidate_id         uuid references public.candidates (id),
  from_stage_id        bigint references public.stages (id) on delete set null,
  to_stage_id          bigint references public.stages (id) on delete set null,
  from_interviewer_id  bigint references public.interviewers (id) on delete set null,
  to_interviewer_id    bigint references public.interviewers (id) on delete set null,
  bulk_action_id       uuid,   -- groups all rows of one bulk move / export together
  upload_id            uuid references public.uploads (id),
  details              jsonb not null default '{}'
);

create index activity_at_idx        on public.activity_log (at desc);
create index activity_candidate_idx on public.activity_log (candidate_id, at);
create index activity_user_idx      on public.activity_log (user_id);
create index activity_action_idx    on public.activity_log (action, at desc);
create index activity_bulk_idx      on public.activity_log (bulk_action_id);
create index activity_stage_idx     on public.activity_log (to_stage_id, at);


-- 4. HELPER FUNCTIONS -------------------------------------------------------------

-- True when the current login belongs to an active team member.
create or replace function public.is_team_member()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_active);
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_active and is_admin);
$$;


-- 5. TRIGGERS ------------------------------------------------------------------------

-- 5a. Create a profile whenever a login user is added (Dashboard or admin screen).
--     The very first user becomes admin automatically.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, is_admin)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(coalesce(new.email, 'user'), '@', 1)),
    not exists (select 1 from public.profiles)
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 5b. Always record the real logged-in user (the browser cannot fake "who did it").
create or replace function public.stamp_user()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if auth.uid() is not null then
    if tg_table_name = 'uploads' then new.uploaded_by := auth.uid();
    elsif tg_table_name = 'candidates' then new.created_by := auth.uid();
    elsif tg_table_name = 'activity_log' then new.user_id := auth.uid();
    elsif tg_table_name = 'app_settings' then new.updated_by := auth.uid();
    end if;
  end if;
  return new;
end;
$$;

create trigger uploads_stamp_user      before insert on public.uploads      for each row execute function public.stamp_user();
create trigger candidates_stamp_user   before insert on public.candidates   for each row execute function public.stamp_user();
create trigger activity_stamp_user     before insert on public.activity_log for each row execute function public.stamp_user();
create trigger app_settings_stamp_user before insert or update on public.app_settings for each row execute function public.stamp_user();

-- 5c. Every new candidate starts in the default stage ("Shortlisted") with no interviewer,
--     whatever the app sends.
create or replace function public.candidates_before_insert()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  select id into new.stage_id from public.stages where is_default limit 1;
  if new.stage_id is null then
    raise exception 'No default stage is set. Mark one stage as default in Settings.';
  end if;
  new.interviewer_id   := null;
  new.stage_changed_at := now();
  new.created_at       := now();
  new.updated_at       := now();
  return new;
end;
$$;

create trigger candidates_before_insert
  before insert on public.candidates
  for each row execute function public.candidates_before_insert();

-- 5d. On update: protect history fields and stamp stage_changed_at.
create or replace function public.candidates_before_update()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.created_at := old.created_at;
  new.created_by := old.created_by;
  new.upload_id  := old.upload_id;
  new.raw        := old.raw;
  if new.stage_id is distinct from old.stage_id then
    new.stage_changed_at := now();
  else
    new.stage_changed_at := old.stage_changed_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger candidates_before_update
  before update on public.candidates
  for each row execute function public.candidates_before_update();

-- 5e. Log every stage and interviewer change automatically, whichever screen made it.
--     Bulk actions set `app.bulk_action_id` for their transaction so their rows are grouped.
create or replace function public.candidates_log_changes()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_bulk    uuid := nullif(current_setting('app.bulk_action_id', true), '')::uuid;
  -- Names are copied into `details` so history stays readable if a stage/interviewer is renamed later.
  v_details jsonb := jsonb_build_object(
    'candidate_name',   new.name,
    'from_stage',       (select name from public.stages where id = old.stage_id),
    'to_stage',         (select name from public.stages where id = new.stage_id),
    'from_interviewer', (select name from public.interviewers where id = old.interviewer_id),
    'to_interviewer',   (select name from public.interviewers where id = new.interviewer_id)
  );
begin
  if new.stage_id is distinct from old.stage_id then
    insert into public.activity_log (user_id, action, role, candidate_id, from_stage_id, to_stage_id,
                                     from_interviewer_id, to_interviewer_id, bulk_action_id, details)
    values (auth.uid(), 'stage_change', new.role, new.id, old.stage_id, new.stage_id,
            old.interviewer_id, new.interviewer_id, v_bulk, v_details);
  end if;
  if new.interviewer_id is distinct from old.interviewer_id then
    insert into public.activity_log (user_id, action, role, candidate_id, from_stage_id, to_stage_id,
                                     from_interviewer_id, to_interviewer_id, bulk_action_id, details)
    values (auth.uid(), 'interviewer_change', new.role, new.id, new.stage_id, new.stage_id,
            old.interviewer_id, new.interviewer_id, v_bulk, v_details);
  end if;
  return new;
end;
$$;

create trigger candidates_log_changes
  after update of stage_id, interviewer_id on public.candidates
  for each row execute function public.candidates_log_changes();

-- 5f. Settings are part of the audit trail too.
create or replace function public.log_settings_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.activity_log (user_id, action, details)
  values (
    auth.uid(),
    'settings_change',
    jsonb_build_object(
      'table', tg_table_name,
      'operation', lower(tg_op),
      'old', case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
      'new', case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
    )
  );
  return coalesce(new, old);
end;
$$;

-- 5g. The default stage cannot be deleted. (Stages that still hold candidates are
--     protected by the foreign key: "on delete restrict".)
create or replace function public.stages_before_delete()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if old.is_default then
    raise exception 'The default stage "%" cannot be deleted. Make another stage the default first.', old.name;
  end if;
  return old;
end;
$$;

create trigger stages_before_delete
  before delete on public.stages
  for each row execute function public.stages_before_delete();


-- 6. ROW LEVEL SECURITY -----------------------------------------------------------
-- Nothing is readable without logging in. The public "anon" key gets no access at all.

alter table public.profiles            enable row level security;
alter table public.stages              enable row level security;
alter table public.interviewers        enable row level security;
alter table public.role_keywords       enable row level security;
alter table public.app_settings        enable row level security;
alter table public.uploads             enable row level security;
alter table public.candidates          enable row level security;
alter table public.screening_questions enable row level security;
alter table public.activity_log        enable row level security;

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon;

-- profiles: team can see the team; only admins change roles/access.
create policy "team reads profiles"   on public.profiles for select to authenticated using (public.is_team_member());
create policy "admin updates profiles" on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Settings tables: whole team can read and edit (team-user management is admin-only, above).
create policy "team reads stages"   on public.stages for select to authenticated using (public.is_team_member());
create policy "team writes stages"  on public.stages for all    to authenticated using (public.is_team_member()) with check (public.is_team_member());
create policy "team reads interviewers"  on public.interviewers for select to authenticated using (public.is_team_member());
create policy "team writes interviewers" on public.interviewers for all    to authenticated using (public.is_team_member()) with check (public.is_team_member());
create policy "team reads role_keywords"  on public.role_keywords for select to authenticated using (public.is_team_member());
create policy "team writes role_keywords" on public.role_keywords for all    to authenticated using (public.is_team_member()) with check (public.is_team_member());
create policy "team reads app_settings"  on public.app_settings for select to authenticated using (public.is_team_member());
create policy "team writes app_settings" on public.app_settings for all    to authenticated using (public.is_team_member()) with check (public.is_team_member());

-- Uploads and candidates: read, add, update. No deletes (candidate data is never deleted).
create policy "team reads uploads"   on public.uploads for select to authenticated using (public.is_team_member());
create policy "team inserts uploads" on public.uploads for insert to authenticated with check (public.is_team_member());
create policy "team updates uploads" on public.uploads for update to authenticated using (public.is_team_member()) with check (public.is_team_member());

create policy "team reads candidates"   on public.candidates for select to authenticated using (public.is_team_member());
create policy "team inserts candidates" on public.candidates for insert to authenticated with check (public.is_team_member());
create policy "team updates candidates" on public.candidates for update to authenticated using (public.is_team_member()) with check (public.is_team_member());

create policy "team reads questions"   on public.screening_questions for select to authenticated using (public.is_team_member());
create policy "team writes questions"  on public.screening_questions for insert to authenticated with check (public.is_team_member());
create policy "team updates questions" on public.screening_questions for update to authenticated using (public.is_team_member()) with check (public.is_team_member());

-- Activity log: append-only.
create policy "team reads activity"   on public.activity_log for select to authenticated using (public.is_team_member());
create policy "team inserts activity" on public.activity_log for insert to authenticated with check (public.is_team_member());

-- Belt and braces: even a logged-in user cannot delete history.
revoke delete on public.candidates, public.uploads, public.activity_log from authenticated;
revoke update on public.activity_log from authenticated;


-- 7. SEED DATA ------------------------------------------------------------------------

insert into public.stages (name, position, color, is_default, requires_interviewer) values
  ('Shortlisted',                    1, '#64748b', true,  false),
  ('JD and Assessment Test Cleared', 2, '#0284c7', false, false),
  ('FAQ Invited',                    3, '#7c3aed', false, false),
  ('1:1 Aligned',                    4, '#d97706', false, true),
  ('LOI Sent',                       5, '#059669', false, false),
  ('Webinar Invitation',             6, '#db2777', false, false);

insert into public.interviewers (name, color) values
  ('Pratyush', '#2563eb'),
  ('Parul',    '#c026d3'),
  ('Umer',     '#0d9488');

insert into public.role_keywords (role, keyword, whole_word) values
  ('ZBM', 'Zonal Business Manager', false),
  ('ZBM', 'ZBM',                    true),
  ('HOS', 'Head of State',          false),  -- also matches "Head of States"
  ('HOS', 'HOS',                    true);

insert into public.app_settings (key, value) values
  ('lag_max_days_in_stage',  '3'),
  ('lag_min_conversion_pct', '30');

-- Turn on settings auditing only after seeding, so the seed rows are not logged.
create trigger stages_audit        after insert or update or delete on public.stages        for each row execute function public.log_settings_change();
create trigger interviewers_audit  after insert or update or delete on public.interviewers  for each row execute function public.log_settings_change();
create trigger role_keywords_audit after insert or update or delete on public.role_keywords for each row execute function public.log_settings_change();
create trigger app_settings_audit  after insert or update or delete on public.app_settings  for each row execute function public.log_settings_change();
create trigger profiles_audit      after update on public.profiles                          for each row execute function public.log_settings_change();
