-- 0010: people who took the test but are not in the tracker can be added from the test-results file.
--  • They are added with what the test file has (name, mobile, city, CTC, designation) and marked
--    source = 'test_file'. They go straight to the test-cleared stage, like everyone else in the file.
--  • When the same person later arrives in a Naukri file (same role + same mobile), the Naukri upload
--    fills in their missing details instead of creating a second copy. Their stage is not changed.
-- Safe to run once on top of 0001–0009. No existing candidate changes.

-- 1. Where a candidate came from -------------------------------------------------------------------
alter table public.candidates
  add column if not exists source text not null default 'naukri';
do $$ begin
  alter table public.candidates add constraint candidates_source_check check (source in ('naukri', 'test_file'));
exception when duplicate_object then null; end $$;

create index if not exists candidates_test_file_idx on public.candidates (role, primary_phone) where source = 'test_file';

-- 2. Updates keep history fields fixed, except: a test-file candidate completed from Naukri keeps
--    the Naukri row too (raw = Naukri row + the original test-file row).
create or replace function public.candidates_before_update()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.created_at := old.created_at;
  new.created_by := old.created_by;
  new.upload_id  := old.upload_id;
  if not (old.source = 'test_file' and new.source = 'naukri') then
    new.raw    := old.raw;
    new.source := old.source;
  end if;
  if new.stage_id is distinct from old.stage_id then
    new.stage_changed_at := now();
  else
    new.stage_changed_at := old.stage_changed_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- 3. Add people from a test file (admins and team members only) ------------------------------------
--    p_rows: [{name, name_norm, primary_phone, phone_raw, current_location, designation, salary_text, salary_lakhs, raw}]
--    Anyone whose mobile is already in that role is skipped (so a re-upload never adds twice).
--    New people start in the starting stage and are then moved to p_stage_id in one bulk action,
--    so their history reads "Added … → Moved Shortlisted → JD and Assessment Test Cleared".
create or replace function public.add_test_candidates(p_upload_id uuid, p_role public.candidate_role, p_stage_id bigint, p_rows jsonb)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_bulk  uuid := gen_random_uuid();
  v_ids   uuid[];
  v_total int := jsonb_array_length(coalesce(p_rows, '[]'));
begin
  if not public.is_full_member() then
    raise exception 'Only admins and team members can add candidates';
  end if;
  if not exists (select 1 from public.stages where id = p_stage_id) then
    raise exception 'That stage no longer exists. Reload the page.';
  end if;

  with src as (
    select distinct on (r.primary_phone) r.*
    from jsonb_to_recordset(coalesce(p_rows, '[]')) as r(
      name text, name_norm text, primary_phone text, phone_raw text, current_location text,
      designation text, salary_text text, salary_lakhs numeric, raw jsonb)
    where r.primary_phone ~ '^[6-9][0-9]{9}$' and coalesce(trim(r.name), '') <> ''
  ), ins as (
    insert into public.candidates (role, upload_id, source, name, name_norm, primary_phone, phone_raw,
                                   current_location, designation, salary_text, salary_lakhs, raw, screening)
    select p_role, p_upload_id, 'test_file', trim(s.name), s.name_norm, s.primary_phone, s.phone_raw,
           s.current_location, s.designation, s.salary_text, s.salary_lakhs, coalesce(s.raw, '{}'), '{}'
    from src s
    where not exists (select 1 from public.candidates c where c.role = p_role and c.primary_phone = s.primary_phone)
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_ids from ins;

  perform set_config('app.bulk_action_id', v_bulk::text, true);
  update public.candidates set stage_id = p_stage_id where id = any (v_ids) and stage_id <> p_stage_id;
  perform set_config('app.bulk_action_id', '', true);

  return jsonb_build_object('added', cardinality(v_ids), 'skipped', v_total - cardinality(v_ids),
                            'ids', to_jsonb(v_ids), 'bulk_action_id', v_bulk);
end;
$$;

-- 4. Complete test-file candidates with their Naukri details (admins and team members only) -------
--    p_rows: [{id, ...the same fields a Naukri upload inserts}]. Stage, interviewer and tags stay.
create or replace function public.complete_test_candidates(p_rows jsonb)
returns int
language plpgsql security invoker set search_path = ''
as $$
declare
  v_count int;
begin
  if not public.is_full_member() then
    raise exception 'Only admins and team members can upload';
  end if;
  with src as (
    select (r->>'id')::uuid as id, jsonb_populate_record(null::public.candidates, r - 'id' - 'stage_id' - 'role') as n
    from jsonb_array_elements(coalesce(p_rows, '[]')) r
  ), done as (
    update public.candidates c set
      source                = 'naukri',
      raw                   = coalesce((s.n).raw, '{}') || jsonb_build_object('Test file row', c.raw),
      name                  = coalesce((s.n).name, c.name),
      name_norm             = coalesce((s.n).name_norm, c.name_norm),
      email                 = coalesce((s.n).email, c.email),
      email_norm            = coalesce((s.n).email_norm, c.email_norm),
      alternate_email       = coalesce((s.n).alternate_email, c.alternate_email),
      phone_raw             = coalesce((s.n).phone_raw, c.phone_raw),
      alternate_phone       = coalesce((s.n).alternate_phone, c.alternate_phone),
      job_title             = coalesce((s.n).job_title, c.job_title),
      applied_on            = coalesce((s.n).applied_on, c.applied_on),
      current_location      = coalesce((s.n).current_location, c.current_location),
      preferred_locations   = coalesce((s.n).preferred_locations, c.preferred_locations),
      total_exp_text        = coalesce((s.n).total_exp_text, c.total_exp_text),
      total_exp_months      = coalesce((s.n).total_exp_months, c.total_exp_months),
      current_company       = coalesce((s.n).current_company, c.current_company),
      designation           = coalesce((s.n).designation, c.designation),
      salary_text           = coalesce((s.n).salary_text, c.salary_text),
      salary_lakhs          = coalesce((s.n).salary_lakhs, c.salary_lakhs),
      notice_period         = coalesce((s.n).notice_period, c.notice_period),
      resume_headline       = coalesce((s.n).resume_headline, c.resume_headline),
      ug_degree             = coalesce((s.n).ug_degree, c.ug_degree),
      ug_specialization     = coalesce((s.n).ug_specialization, c.ug_specialization),
      ug_institute          = coalesce((s.n).ug_institute, c.ug_institute),
      pg_degree             = coalesce((s.n).pg_degree, c.pg_degree),
      pg_specialization     = coalesce((s.n).pg_specialization, c.pg_specialization),
      pg_institute          = coalesce((s.n).pg_institute, c.pg_institute),
      doctorate             = coalesce((s.n).doctorate, c.doctorate),
      gender                = coalesce((s.n).gender, c.gender),
      home_town             = coalesce((s.n).home_town, c.home_town),
      dob                   = coalesce((s.n).dob, c.dob),
      naukri_pipeline_stage = coalesce((s.n).naukri_pipeline_stage, c.naukri_pipeline_stage),
      naukri_comments       = coalesce((s.n).naukri_comments, c.naukri_comments),
      screening             = case when coalesce((s.n).screening, '{}') = '{}' then c.screening else (s.n).screening end,
      profile_url           = coalesce((s.n).profile_url, c.profile_url)
    from src s
    where c.id = s.id and c.source = 'test_file'
    returning 1
  )
  select count(*) into v_count from done;
  return v_count;
end;
$$;

-- 5. The Naukri duplicate check also says where a match came from.
drop function if exists public.match_existing_candidates(text[], text[]);
create function public.match_existing_candidates(p_phones text[], p_emails text[])
returns table (
  id            uuid,
  role          public.candidate_role,
  name          text,
  name_norm     text,
  email_norm    text,
  primary_phone text,
  stage_name    text,
  created_at    timestamptz,
  origin        text   -- 'naukri' or 'test_file'
)
language sql stable security invoker set search_path = ''
as $$
  select c.id, c.role, c.name, c.name_norm, c.email_norm, c.primary_phone, s.name, c.created_at, c.source
  from public.candidates c
  join public.stages s on s.id = c.stage_id
  where c.primary_phone = any (coalesce(p_phones, '{}'))
     or c.email_norm    = any (coalesce(p_emails, '{}'));
$$;

-- 6. Same-name check for people not found by mobile (probably the same person with another number).
create or replace function public.find_candidates_by_name(p_role public.candidate_role, p_names text[])
returns table (id uuid, name text, name_norm text, primary_phone text, stage_name text)
language sql stable security invoker set search_path = ''
as $$
  select c.id, c.name, c.name_norm, c.primary_phone, s.name
  from public.candidates c join public.stages s on s.id = c.stage_id
  where c.role = p_role and c.name_norm = any (coalesce(p_names, '{}'));
$$;

revoke execute on function public.add_test_candidates(uuid, public.candidate_role, bigint, jsonb) from public, anon;
revoke execute on function public.complete_test_candidates(jsonb) from public, anon;
revoke execute on function public.match_existing_candidates(text[], text[]) from public, anon;
revoke execute on function public.find_candidates_by_name(public.candidate_role, text[]) from public, anon;
grant execute on function public.add_test_candidates(uuid, public.candidate_role, bigint, jsonb) to authenticated;
grant execute on function public.complete_test_candidates(jsonb) to authenticated;
grant execute on function public.match_existing_candidates(text[], text[]) to authenticated;
grant execute on function public.find_candidates_by_name(public.candidate_role, text[]) to authenticated;
