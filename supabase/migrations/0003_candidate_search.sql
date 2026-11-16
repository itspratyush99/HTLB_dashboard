-- =============================================================================
-- Candidate Tracker — Phase 3: candidate table search, filters, sorting and export
-- Run once in Supabase → SQL Editor, AFTER 0002_uploads.sql.
--
-- All functions are "security invoker": they run as the logged-in user,
-- so Row Level Security still decides what can be read.
--
-- Filters are passed as one JSON object (every key optional):
--   q                    text      global search: name, email, phone, company, headline
--   stage_ids            [int]     any of these stages
--   interviewer_ids      [text]    interviewer ids as text, or "none" for no interviewer
--   created_from/_to     date      upload date (IST)
--   applied_from/_to     date      Naukri date of application
--   stage_changed_from/_to date    last stage change (IST)
--   current_locations    [text]    any of (ignores letter case)
--   home_towns           [text]    any of (ignores letter case)
--   preferred_location   text      contains
--   exp_min / exp_max    number    years
--   salary_min / _max    number    lakhs
--   notice_periods, genders, ug_degrees, pg_degrees   [text]  any of
--   company, designation text      contains
--   phone_status         text      "valid" | "invalid"
--   upload_id            uuid      candidates added by one upload
--   screening            object    {"<question>": {"min": n, "max": n, "text": "contains"}}
-- =============================================================================

-- Helper: JSON array → text[] (empty array when missing).
create or replace function public.jsonb_text_array(p jsonb)
returns text[]
language sql immutable set search_path = ''
as $$
  select coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end)), '{}');
$$;

-- Helper: start of an IST calendar day as a timestamp.
create or replace function public.ist_day_start(p_date text)
returns timestamptz
language sql immutable set search_path = ''
as $$
  select (p_date::date)::timestamp at time zone 'Asia/Kolkata';
$$;

-- The core filter: every candidate of one role that matches the filter object.
create or replace function public.filtered_candidates(p_role public.candidate_role, f jsonb)
returns setof public.candidates
language sql stable security invoker set search_path = ''
as $$
  select c.*
  from public.candidates c
  where c.role = p_role
    -- global search
    and (coalesce(f->>'q', '') = '' or c.search_text like '%' || lower(trim(f->>'q')) || '%')
    -- stage / interviewer
    and (cardinality(public.jsonb_text_array(f->'stage_ids')) = 0
         or c.stage_id::text = any (public.jsonb_text_array(f->'stage_ids')))
    and (cardinality(public.jsonb_text_array(f->'interviewer_ids')) = 0
         or c.interviewer_id::text = any (public.jsonb_text_array(f->'interviewer_ids'))
         or (c.interviewer_id is null and 'none' = any (public.jsonb_text_array(f->'interviewer_ids'))))
    -- dates
    and (f->>'created_from' is null or c.created_at >= public.ist_day_start(f->>'created_from'))
    and (f->>'created_to'   is null or c.created_at <  public.ist_day_start(f->>'created_to') + interval '1 day')
    and (f->>'applied_from' is null or c.applied_on >= (f->>'applied_from')::date)
    and (f->>'applied_to'   is null or c.applied_on <= (f->>'applied_to')::date)
    and (f->>'stage_changed_from' is null or c.stage_changed_at >= public.ist_day_start(f->>'stage_changed_from'))
    and (f->>'stage_changed_to'   is null or c.stage_changed_at <  public.ist_day_start(f->>'stage_changed_to') + interval '1 day')
    -- locations
    and (cardinality(public.jsonb_text_array(f->'current_locations')) = 0
         or lower(c.current_location) = any (select lower(x) from unnest(public.jsonb_text_array(f->'current_locations')) x))
    and (cardinality(public.jsonb_text_array(f->'home_towns')) = 0
         or lower(c.home_town) = any (select lower(x) from unnest(public.jsonb_text_array(f->'home_towns')) x))
    and (coalesce(f->>'preferred_location', '') = '' or c.preferred_locations ilike '%' || trim(f->>'preferred_location') || '%')
    -- experience (years) and salary (lakhs)
    and (f->>'exp_min'    is null or c.total_exp_months >= (f->>'exp_min')::numeric * 12)
    and (f->>'exp_max'    is null or c.total_exp_months <= (f->>'exp_max')::numeric * 12)
    and (f->>'salary_min' is null or c.salary_lakhs >= (f->>'salary_min')::numeric)
    and (f->>'salary_max' is null or c.salary_lakhs <= (f->>'salary_max')::numeric)
    -- pick-lists
    and (cardinality(public.jsonb_text_array(f->'notice_periods')) = 0 or c.notice_period = any (public.jsonb_text_array(f->'notice_periods')))
    and (cardinality(public.jsonb_text_array(f->'genders'))        = 0 or c.gender        = any (public.jsonb_text_array(f->'genders')))
    and (cardinality(public.jsonb_text_array(f->'ug_degrees'))     = 0 or c.ug_degree     = any (public.jsonb_text_array(f->'ug_degrees')))
    and (cardinality(public.jsonb_text_array(f->'pg_degrees'))     = 0 or c.pg_degree     = any (public.jsonb_text_array(f->'pg_degrees')))
    -- contains
    and (coalesce(f->>'company', '')     = '' or c.current_company ilike '%' || trim(f->>'company') || '%')
    and (coalesce(f->>'designation', '') = '' or c.designation     ilike '%' || trim(f->>'designation') || '%')
    -- mobile usable for the bulk sender?
    and (coalesce(f->>'phone_status', '') = ''
         or (f->>'phone_status' = 'valid'   and c.primary_phone is not null)
         or (f->>'phone_status' = 'invalid' and c.primary_phone is null))
    and (f->>'upload_id' is null or c.upload_id = (f->>'upload_id')::uuid)
    -- screening answers: every condition given must hold
    and not exists (
      select 1
      from jsonb_each(case when jsonb_typeof(f->'screening') = 'object' then f->'screening' else '{}'::jsonb end) s(question, cond)
      where not coalesce(
        (cond->>'min'  is null or (c.screening->s.question->>'n')::numeric >= (cond->>'min')::numeric)
        and (cond->>'max'  is null or (c.screening->s.question->>'n')::numeric <= (cond->>'max')::numeric)
        and (coalesce(cond->>'text', '') = '' or c.screening->s.question->>'t' ilike '%' || trim(cond->>'text') || '%'),
        false)
    );
$$;

-- One page of the candidate table, sorted, plus counts.
-- Returns {"total": <matching filter>, "role_total": <all in role>, "rows": [...]}.
create or replace function public.search_candidates(
  p_role    public.candidate_role,
  p_filters jsonb default '{}',
  p_sort    text default 'created_at',
  p_desc    boolean default true,
  p_limit   int default 50,
  p_offset  int default 0
)
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_sort   text;
  v_result jsonb;
begin
  -- Only known columns can be sorted on (protects the dynamic ORDER BY).
  v_sort := case p_sort
    when 'name'                then 'f.name_norm'
    when 'email'               then 'f.email_norm'
    when 'primary_phone'       then 'f.primary_phone'
    when 'applied_on'          then 'f.applied_on'
    when 'created_at'          then 'f.created_at'
    when 'stage_changed_at'    then 'f.stage_changed_at'
    when 'stage'               then 's.position'
    when 'interviewer'         then 'lower(i.name)'
    when 'current_location'    then 'lower(f.current_location)'
    when 'preferred_locations' then 'lower(f.preferred_locations)'
    when 'home_town'           then 'lower(f.home_town)'
    when 'total_exp_months'    then 'f.total_exp_months'
    when 'salary_lakhs'        then 'f.salary_lakhs'
    when 'notice_period'       then 'f.notice_period'
    when 'current_company'     then 'lower(f.current_company)'
    when 'designation'         then 'lower(f.designation)'
    when 'gender'              then 'f.gender'
    when 'ug_degree'           then 'f.ug_degree'
    when 'pg_degree'           then 'f.pg_degree'
    when 'resume_headline'     then 'lower(f.resume_headline)'
    when 'dob'                 then 'f.dob'
    else null
  end;
  if v_sort is null and p_sort like 'q:%' then
    -- A screening question: sort by its number, then its text.
    v_sort := format('(f.screening->%L->>''n'')::numeric %s nulls last, lower(f.screening->%L->>''t'')',
                     substr(p_sort, 3), case when p_desc then 'desc' else 'asc' end, substr(p_sort, 3));
  elsif v_sort is null then
    v_sort := 'f.created_at';
  end if;

  execute format($q$
    with f as materialized (select * from public.filtered_candidates($1, $2)),
    page as (
      select f.*, s.name as stage_name, s.color as stage_color, s.position as stage_position,
             i.name as interviewer_name, i.color as interviewer_color,
             row_number() over (order by %1$s %2$s nulls last, f.name_norm, f.id) as sort_pos
      from f
      join public.stages s on s.id = f.stage_id
      left join public.interviewers i on i.id = f.interviewer_id
      order by sort_pos
      limit $3 offset $4
    )
    select jsonb_build_object(
      'total',      (select count(*) from f),
      'role_total', (select count(*) from public.candidates where role = $1),
      'rows',       coalesce((select jsonb_agg(to_jsonb(page) - 'raw' - 'search_text' - 'name_norm' - 'email_norm' - 'sort_pos'
                                               order by page.sort_pos) from page), '[]'::jsonb)
    )
  $q$, v_sort, case when p_desc then 'desc' else 'asc' end)
  using p_role, coalesce(p_filters, '{}'::jsonb), least(greatest(p_limit, 1), 500), greatest(p_offset, 0)
  into v_result;

  return v_result;
end;
$$;

-- All ids matching a filter ("select all filtered results").
create or replace function public.candidate_ids(p_role public.candidate_role, p_filters jsonb default '{}')
returns uuid[]
language sql stable security invoker set search_path = ''
as $$
  select coalesce(array_agg(id), '{}') from public.filtered_candidates(p_role, coalesce(p_filters, '{}'::jsonb));
$$;

-- What the bulk-sender export needs for a set of selected candidates.
create or replace function public.candidates_for_export(p_ids uuid[])
returns table (
  id               uuid,
  role             public.candidate_role,
  name             text,
  primary_phone    text,
  phone_raw        text,
  stage_id         bigint,
  stage_name       text,
  interviewer_name text
)
language sql stable security invoker set search_path = ''
as $$
  select c.id, c.role, c.name, c.primary_phone, c.phone_raw, c.stage_id, s.name, i.name
  from public.candidates c
  join public.stages s on s.id = c.stage_id
  left join public.interviewers i on i.id = c.interviewer_id
  where c.id = any (coalesce(p_ids, '{}'))
  order by s.position, c.name_norm;
$$;

-- Values for the filter pick-lists in one role tab.
create or replace function public.candidate_filter_options(p_role public.candidate_role)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  with c as (select * from public.candidates where role = p_role)
  select jsonb_build_object(
    -- Locations / home towns: one entry per spelling-ignoring-case, shown in its most common spelling.
    'current_locations', coalesce((select jsonb_agg(v order by v) from (
        select mode() within group (order by current_location) v from c where current_location is not null group by lower(current_location)) x), '[]'),
    'home_towns', coalesce((select jsonb_agg(v order by v) from (
        select mode() within group (order by home_town) v from c where home_town is not null group by lower(home_town)) x), '[]'),
    'notice_periods', coalesce((select jsonb_agg(distinct notice_period) from c where notice_period is not null), '[]'),
    'genders',        coalesce((select jsonb_agg(distinct gender)        from c where gender        is not null), '[]'),
    'ug_degrees',     coalesce((select jsonb_agg(distinct ug_degree)     from c where ug_degree     is not null), '[]'),
    'pg_degrees',     coalesce((select jsonb_agg(distinct pg_degree)     from c where pg_degree     is not null), '[]'),
    'questions', coalesce((select jsonb_agg(jsonb_build_object('question', q.question, 'is_numeric', q.is_numeric) order by q.id)
                           from public.screening_questions q where q.role = p_role), '[]')
  );
$$;

-- Logged-in team members only.
revoke execute on function public.filtered_candidates(public.candidate_role, jsonb)   from public, anon;
revoke execute on function public.search_candidates(public.candidate_role, jsonb, text, boolean, int, int) from public, anon;
revoke execute on function public.candidate_ids(public.candidate_role, jsonb)          from public, anon;
revoke execute on function public.candidates_for_export(uuid[])                        from public, anon;
revoke execute on function public.candidate_filter_options(public.candidate_role)      from public, anon;
grant  execute on function public.filtered_candidates(public.candidate_role, jsonb)   to authenticated;
grant  execute on function public.search_candidates(public.candidate_role, jsonb, text, boolean, int, int) to authenticated;
grant  execute on function public.candidate_ids(public.candidate_role, jsonb)          to authenticated;
grant  execute on function public.candidates_for_export(uuid[])                        to authenticated;
grant  execute on function public.candidate_filter_options(public.candidate_role)      to authenticated;
