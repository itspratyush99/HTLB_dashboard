-- 0014: add a candidate by hand (Add candidate button on the All / ZBM / HOS tabs).
-- Only the name is required; anything else known can be filled in. Admins and team members only.
-- Hand-added candidates are marked source = 'manual'. If they later arrive in a Naukri file (same role
-- + mobile), the upload fills in their missing details instead of adding them twice (same as 0010/0011).
-- Safe to run once on top of 0001–0013. No existing data changes.

alter type public.activity_action add value if not exists 'candidate_added';

alter table public.candidates drop constraint if exists candidates_source_check;
alter table public.candidates add constraint candidates_source_check
  check (source in ('naukri', 'test_file', 'interview_file', 'manual'));

-- p_data: any of name, name_norm, email, email_norm, alternate_email, primary_phone, phone_raw, alternate_phone,
--         current_location, preferred_locations, home_town, current_company, designation, total_exp_text,
--         total_exp_months, salary_text, salary_lakhs, notice_period, gender, ug_degree, pg_degree,
--         resume_headline, naukri_comments, profile_url, applied_on
create or replace function public.add_manual_candidate(
  p_role           public.candidate_role,
  p_data           jsonb,
  p_stage_id       bigint default null,
  p_interviewer_id bigint default null,
  p_interview_at   timestamptz default null
)
returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  n       public.candidates;
  v_id    uuid;
  v_stage public.stages;
begin
  if not public.is_full_member() then
    raise exception 'Only admins and team members can add candidates';
  end if;
  n := jsonb_populate_record(null::public.candidates, coalesce(p_data, '{}'));
  if coalesce(trim(n.name), '') = '' then
    raise exception 'Name is required';
  end if;
  if n.primary_phone is not null and n.primary_phone !~ '^[6-9][0-9]{9}$' then
    raise exception 'Mobile must be a 10-digit Indian number';
  end if;
  if p_stage_id is not null then
    select * into v_stage from public.stages where id = p_stage_id;
    if not found then raise exception 'That stage no longer exists. Reload the page.'; end if;
    if v_stage.requires_interviewer and p_interviewer_id is null then
      raise exception '% needs an interviewer', v_stage.name;
    end if;
  end if;

  insert into public.candidates (
    role, source, name, name_norm, email, email_norm, alternate_email, primary_phone, phone_raw, alternate_phone,
    current_location, preferred_locations, home_town, current_company, designation, total_exp_text, total_exp_months,
    salary_text, salary_lakhs, notice_period, gender, ug_degree, pg_degree, resume_headline, naukri_comments,
    profile_url, applied_on, interview_at, raw, screening)
  values (
    p_role, 'manual', trim(n.name), coalesce(n.name_norm, lower(trim(n.name))), n.email, n.email_norm, n.alternate_email,
    n.primary_phone, n.phone_raw, n.alternate_phone, n.current_location, n.preferred_locations, n.home_town,
    n.current_company, n.designation, n.total_exp_text, n.total_exp_months, n.salary_text, n.salary_lakhs,
    n.notice_period, n.gender, n.ug_degree, n.pg_degree, n.resume_headline, n.naukri_comments, n.profile_url,
    n.applied_on, p_interview_at, jsonb_build_object('Added by hand', true), '{}')
  returning id into v_id;

  insert into public.activity_log (user_id, action, role, candidate_id, details)
  values (auth.uid(), 'candidate_added', p_role, v_id,
          jsonb_build_object('name', trim(n.name), 'stage', coalesce(v_stage.name, (select name from public.stages where is_default))));

  -- Straight into another stage (logged as a normal stage move).
  if p_stage_id is not null and p_stage_id <> (select stage_id from public.candidates where id = v_id) then
    update public.candidates
    set stage_id = p_stage_id, interviewer_id = case when v_stage.requires_interviewer then p_interviewer_id end
    where id = v_id;
  end if;
  return v_id;
end;
$$;

-- A later Naukri upload completes hand-added candidates too (same function as 0011, with the right label).
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
      raw                   = coalesce((s.n).raw, '{}') || jsonb_build_object(case c.source when 'test_file' then 'Test file row' when 'manual' then 'Added by hand' else 'Interviewer file row' end, c.raw),
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

revoke execute on function public.add_manual_candidate(public.candidate_role, jsonb, bigint, bigint, timestamptz) from public, anon;
grant execute on function public.add_manual_candidate(public.candidate_role, jsonb, bigint, bigint, timestamptz) to authenticated;
