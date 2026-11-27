-- 0013: the "All" tab (ZBM + HOS together).
-- The candidate-list functions accept p_role = null to mean both roles. Same functions as before
-- otherwise (copied from 0003 / 0008 / 0009), plus sorting by role. No data changes.
-- Safe to run once on top of 0001–0012.

create or replace function public.filtered_candidates(p_role public.candidate_role, f jsonb)
returns setof public.candidates
language sql stable security invoker set search_path = ''
as $$
  select c.*
  from public.candidates c
  where (p_role is null or c.role = p_role)  -- null = All (ZBM + HOS)
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
    -- Shortlisted tags (72h / 48h / 24h / Hold, or "none" = no tag). Tags only exist in the starting stage,
    -- so a tag filter always means "in Shortlisted with this tag".
    and (cardinality(public.jsonb_text_array(f->'tag_ids')) = 0
         or (c.stage_id = (select s0.id from public.stages s0 where s0.is_default limit 1)
             and (c.shortlist_tag_id::text = any (public.jsonb_text_array(f->'tag_ids'))
                  or (c.shortlist_tag_id is null and 'none' = any (public.jsonb_text_array(f->'tag_ids'))))))
    -- Rescheduled 1:1s ("yes" = only rescheduled, "no" = only not rescheduled)
    and (coalesce(f->>'rescheduled', '') = ''
         or (f->>'rescheduled' = 'yes' and c.rescheduled)
         or (f->>'rescheduled' = 'no'  and not c.rescheduled))
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
    when 'tag'                 then 'tg.position'
    when 'role'                then 'f.role'
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
             tg.name as tag_name, tg.color as tag_color,
             row_number() over (order by %1$s %2$s nulls last, f.name_norm, f.id) as sort_pos
      from f
      join public.stages s on s.id = f.stage_id
      left join public.interviewers i on i.id = f.interviewer_id
      left join public.shortlist_tags tg on tg.id = f.shortlist_tag_id
      order by sort_pos
      limit $3 offset $4
    )
    select jsonb_build_object(
      'total',      (select count(*) from f),
      'role_total', (select count(*) from public.candidates where $1::public.candidate_role is null or role = $1),
      'rows',       coalesce((select jsonb_agg(to_jsonb(page) - 'raw' - 'search_text' - 'name_norm' - 'email_norm' - 'sort_pos'
                                               order by page.sort_pos) from page), '[]'::jsonb)
    )
  $q$, v_sort, case when p_desc then 'desc' else 'asc' end)
  using p_role, coalesce(p_filters, '{}'::jsonb), least(greatest(p_limit, 1), 500), greatest(p_offset, 0)
  into v_result;

  return v_result;
end;
$$;

create or replace function public.candidate_filter_options(p_role public.candidate_role)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  with c as (select * from public.candidates where p_role is null or role = p_role)
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
                           from (select distinct on (question) * from public.screening_questions
                                 where p_role is null or role = p_role order by question, id) q), '[]')
  );
$$;

create or replace function public.shortlist_tag_counts(p_role public.candidate_role)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  with d as (select id, name from public.stages where is_default limit 1),
  c as (select cc.shortlist_tag_id from public.candidates cc, d where (p_role is null or cc.role = p_role) and cc.stage_id = d.id)
  select jsonb_build_object(
    'stage_id',   (select id from d),
    'stage_name', (select name from d),
    'total',      (select count(*) from c),
    'none',       (select count(*) from c where shortlist_tag_id is null),
    'tags', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color, 'position', t.position,
                                                          'count', (select count(*) from c where c.shortlist_tag_id = t.id))
                                       order by t.position)
                      from public.shortlist_tags t), '[]'::jsonb)
  );
$$;

create or replace function public.rescheduled_counts(p_role public.candidate_role)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'stage_id', s.id, 'stage_name', s.name, 'stage_color', s.color,
           'total', (select count(*) from public.candidates c where (p_role is null or c.role = p_role) and c.stage_id = s.id),
           'rescheduled', (select count(*) from public.candidates c where (p_role is null or c.role = p_role) and c.stage_id = s.id and c.rescheduled))
         order by s.position), '[]')
  from public.stages s where s.requires_interviewer;
$$;

