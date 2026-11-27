-- 0011: interviewer-list upload (e.g. a booking export of everyone aligned with Parul).
--  • People in the file (matched by mobile) move to 1:1 Aligned with the interviewer you choose.
--  • People not in the tracker are added (source = 'interview_file') straight into 1:1 Aligned.
--    A later Naukri upload fills in their details, exactly like people added from a test file.
--  • If the file has a booking date/time, it is saved on the candidate as the 1:1 date (interview_at).
-- Safe to run once on top of 0001–0010. No existing candidate changes.

-- 1. New kinds and columns ---------------------------------------------------------------------------
alter table public.uploads drop constraint if exists uploads_kind_check;
alter table public.uploads add constraint uploads_kind_check check (kind in ('naukri', 'test_results', 'interviewer_list'));

alter table public.candidates drop constraint if exists candidates_source_check;
alter table public.candidates add constraint candidates_source_check check (source in ('naukri', 'test_file', 'interview_file'));

alter table public.candidates add column if not exists interview_at timestamptz;  -- 1:1 date/time from a booking file

-- 2. Anyone added from a file (test or interviewer list) can be completed from Naukri.
create or replace function public.candidates_before_update()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.created_at := old.created_at;
  new.created_by := old.created_by;
  new.upload_id  := old.upload_id;
  if not (old.source <> 'naukri' and new.source = 'naukri') then
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
      raw                   = coalesce((s.n).raw, '{}') || jsonb_build_object(case c.source when 'test_file' then 'Test file row' else 'Interviewer file row' end, c.raw),
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
    where c.id = s.id and c.source <> 'naukri'
    returning 1
  )
  select count(*) into v_count from done;
  return v_count;
end;
$$;


drop index if exists public.candidates_test_file_idx;
create index if not exists candidates_from_file_idx on public.candidates (role, primary_phone) where source <> 'naukri';

-- 3. The phone lookup also returns the interviewer and 1:1 date.
drop function if exists public.find_candidates_by_phone(text[]);
create function public.find_candidates_by_phone(p_phones text[])
returns table (
  id               uuid,
  role             public.candidate_role,
  name             text,
  primary_phone    text,
  stage_id         bigint,
  stage_name       text,
  stage_position   int,
  tag_name         text,
  interviewer_id   bigint,
  interviewer_name text,
  interview_at     timestamptz
)
language sql stable security invoker set search_path = ''
as $$
  select c.id, c.role, c.name, c.primary_phone, c.stage_id, s.name, s.position, t.name, c.interviewer_id, i.name, c.interview_at
  from public.candidates c
  join public.stages s on s.id = c.stage_id
  left join public.shortlist_tags t on t.id = c.shortlist_tag_id
  left join public.interviewers i on i.id = c.interviewer_id
  where c.primary_phone = any (coalesce(p_phones, '{}'));
$$;

-- 4. Add people from an interviewer file straight into the 1:1 stage with that interviewer.
--    p_rows: [{name, name_norm, primary_phone, phone_raw, email, email_norm, interview_at, raw}]
--    Anyone whose mobile is already in that role is skipped (a re-upload never adds twice).
create or replace function public.add_interview_candidates(p_upload_id uuid, p_role public.candidate_role, p_stage_id bigint, p_interviewer_id bigint, p_rows jsonb)
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
  if not exists (select 1 from public.interviewers where id = p_interviewer_id and is_active) then
    raise exception 'That interviewer no longer exists or is inactive. Reload the page.';
  end if;

  with src as (
    select distinct on (r.primary_phone) r.*
    from jsonb_to_recordset(coalesce(p_rows, '[]')) as r(
      name text, name_norm text, primary_phone text, phone_raw text, email text, email_norm text,
      interview_at timestamptz, raw jsonb)
    where r.primary_phone ~ '^[6-9][0-9]{9}$' and coalesce(trim(r.name), '') <> ''
  ), ins as (
    insert into public.candidates (role, upload_id, source, name, name_norm, primary_phone, phone_raw,
                                   email, email_norm, interview_at, raw, screening)
    select p_role, p_upload_id, 'interview_file', trim(s.name), s.name_norm, s.primary_phone, s.phone_raw,
           s.email, s.email_norm, s.interview_at, coalesce(s.raw, '{}'), '{}'
    from src s
    where not exists (select 1 from public.candidates c where c.role = p_role and c.primary_phone = s.primary_phone)
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_ids from ins;

  perform set_config('app.bulk_action_id', v_bulk::text, true);
  update public.candidates set stage_id = p_stage_id, interviewer_id = p_interviewer_id where id = any (v_ids);
  perform set_config('app.bulk_action_id', '', true);

  return jsonb_build_object('added', cardinality(v_ids), 'skipped', v_total - cardinality(v_ids),
                            'ids', to_jsonb(v_ids), 'bulk_action_id', v_bulk);
end;
$$;

-- 5. Save 1:1 dates from a booking file (admins and team members). p_rows: [{id, interview_at}]
create or replace function public.set_interview_times(p_rows jsonb)
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
    select r.id, r.interview_at from jsonb_to_recordset(coalesce(p_rows, '[]')) as r(id uuid, interview_at timestamptz)
  ), done as (
    update public.candidates c set interview_at = s.interview_at
    from src s where c.id = s.id and c.interview_at is distinct from s.interview_at
    returning 1
  )
  select count(*) into v_count from done;
  return v_count;
end;
$$;

revoke execute on function public.find_candidates_by_phone(text[]) from public, anon;
revoke execute on function public.add_interview_candidates(uuid, public.candidate_role, bigint, bigint, jsonb) from public, anon;
revoke execute on function public.set_interview_times(jsonb) from public, anon;
grant execute on function public.find_candidates_by_phone(text[]) to authenticated;
grant execute on function public.add_interview_candidates(uuid, public.candidate_role, bigint, bigint, jsonb) to authenticated;
grant execute on function public.set_interview_times(jsonb) to authenticated;
