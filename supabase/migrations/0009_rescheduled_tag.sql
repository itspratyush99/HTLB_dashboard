-- 0009: "Rescheduled" tag for 1:1 interviews.
-- Anyone on the team (admins, team members AND interviewer logins, for their own candidates) can mark
-- candidates in a stage that asks for an interviewer (1:1 Aligned) as Rescheduled, and remove it again.
-- The tag is removed automatically when the candidate leaves that stage. Every change is in the Activity Log.
-- Safe to run once on top of 0001–0008. No candidate data is changed.

-- 1. New columns -------------------------------------------------------------------------------
alter table public.candidates
  add column if not exists rescheduled    boolean not null default false,
  add column if not exists rescheduled_at timestamptz;

create index if not exists candidates_rescheduled_idx on public.candidates (role, stage_id) where rescheduled;

alter type public.activity_action add value if not exists 'reschedule';

-- 2. Rescheduled only exists in a stage that asks for an interviewer; new candidates never have it.
create or replace function public.candidates_reschedule_guard()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.rescheduled := false;
    new.rescheduled_at := null;
    return new;
  end if;
  if new.rescheduled and not coalesce((select requires_interviewer from public.stages where id = new.stage_id), false) then
    new.rescheduled := false;
  end if;
  if new.rescheduled is distinct from old.rescheduled then
    new.rescheduled_at := case when new.rescheduled then now() end;
  end if;
  return new;
end;
$$;

drop trigger if exists candidates_reschedule_guard on public.candidates;
create trigger candidates_reschedule_guard before insert or update on public.candidates
  for each row execute function public.candidates_reschedule_guard();

-- 3. Logging: marking / unmarking Rescheduled is logged as "reschedule".
create or replace function public.candidates_log_changes()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_bulk    uuid := nullif(current_setting('app.bulk_action_id', true), '')::uuid;
  v_details jsonb := jsonb_build_object(
    'candidate_name',   new.name,
    'from_stage',       (select name from public.stages where id = old.stage_id),
    'to_stage',         (select name from public.stages where id = new.stage_id),
    'from_interviewer', (select name from public.interviewers where id = old.interviewer_id),
    'to_interviewer',   (select name from public.interviewers where id = new.interviewer_id),
    'from_tag',         (select name from public.shortlist_tags where id = old.shortlist_tag_id),
    'to_tag',           (select name from public.shortlist_tags where id = new.shortlist_tag_id),
    'rescheduled',      new.rescheduled,
    'was_rescheduled',  old.rescheduled
  );
begin
  if new.stage_id is distinct from old.stage_id then
    insert into public.activity_log (user_id, action, role, candidate_id, from_stage_id, to_stage_id,
                                     from_interviewer_id, to_interviewer_id, bulk_action_id, details)
    values (auth.uid(), 'stage_change', new.role, new.id, old.stage_id, new.stage_id,
            old.interviewer_id, new.interviewer_id, v_bulk, v_details);
  elsif new.interviewer_id is distinct from old.interviewer_id then
    insert into public.activity_log (user_id, action, role, candidate_id, from_stage_id, to_stage_id,
                                     from_interviewer_id, to_interviewer_id, bulk_action_id, details)
    values (auth.uid(), 'interviewer_change', new.role, new.id, new.stage_id, new.stage_id,
            old.interviewer_id, new.interviewer_id, v_bulk, v_details);
  elsif new.shortlist_tag_id is distinct from old.shortlist_tag_id then
    insert into public.activity_log (user_id, action, role, candidate_id, from_stage_id, to_stage_id, bulk_action_id, details)
    values (auth.uid(), 'tag_change', new.role, new.id, new.stage_id, new.stage_id, v_bulk, v_details);
  elsif new.rescheduled is distinct from old.rescheduled then
    insert into public.activity_log (user_id, action, role, candidate_id, from_stage_id, to_stage_id,
                                     from_interviewer_id, to_interviewer_id, bulk_action_id, details)
    values (auth.uid(), 'reschedule', new.role, new.id, new.stage_id, new.stage_id,
            new.interviewer_id, new.interviewer_id, v_bulk, v_details);
  end if;
  return new;
end;
$$;

drop trigger if exists candidates_log_changes on public.candidates;
create trigger candidates_log_changes
  after update of stage_id, interviewer_id, shortlist_tag_id, rescheduled on public.candidates
  for each row execute function public.candidates_log_changes();

-- 5. Filter and Dashboard learn about Rescheduled (same functions as in 0008, plus Rescheduled).
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

create or replace function public.dashboard_stats()
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  with params as (
    select public.ist_today() as today,
           date_trunc('week', public.ist_today())::date as week_start,  -- Monday
           coalesce((select (value #>> '{}')::int from public.app_settings where key = 'lag_max_days_in_stage'), 3) as max_days,
           (select max(position) from public.stages) as last_position
  ),
  roles as (select unnest(enum_range(null::public.candidate_role)) as role)
  select jsonb_object_agg(r.role, jsonb_build_object(
    'total',     (select count(*) from public.candidates c where c.role = r.role),
    'new_today', (select count(*) from public.candidates c, params p
                  where c.role = r.role and (c.created_at at time zone 'Asia/Kolkata')::date = p.today),
    'new_week',  (select count(*) from public.candidates c, params p
                  where c.role = r.role and (c.created_at at time zone 'Asia/Kolkata')::date >= p.week_start),
    'stages', (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', s.id, 'name', s.name, 'color', s.color, 'position', s.position, 'requires_interviewer', s.requires_interviewer,
                 'count', (select count(*) from public.candidates c where c.role = r.role and c.stage_id = s.id))
               order by s.position), '[]') from public.stages s),
    'interviewers', (select coalesce(jsonb_agg(jsonb_build_object(
                       'id', i.id, 'name', i.name, 'color', i.color,
                       'count', (select count(*) from public.candidates c join public.stages s on s.id = c.stage_id
                                 where c.role = r.role and c.interviewer_id = i.id and s.requires_interviewer),
                       'rescheduled', (select count(*) from public.candidates c
                                       where c.role = r.role and c.interviewer_id = i.id and c.rescheduled))
                     order by i.name), '[]') from public.interviewers i where i.is_active),
    'shortlist_tags', (select coalesce(jsonb_agg(jsonb_build_object(
                         'id', tg.id, 'name', tg.name, 'color', tg.color, 'position', tg.position,
                         'count', (select count(*) from public.candidates c where c.role = r.role and c.shortlist_tag_id = tg.id))
                       order by tg.position), '[]') from public.shortlist_tags tg),
    'shortlist_no_tag', (select count(*) from public.candidates c join public.stages s on s.id = c.stage_id
                         where c.role = r.role and s.is_default and c.shortlist_tag_id is null),
    'rescheduled', (select count(*) from public.candidates c where c.role = r.role and c.rescheduled),
    'stuck', (select count(*) from public.candidates c join public.stages s on s.id = c.stage_id, params p
              where c.role = r.role and s.position < p.last_position
                and p.today - (c.stage_changed_at at time zone 'Asia/Kolkata')::date > p.max_days)
  ))
  from roles r;
$$;

-- 6. Mark (p_value = true) or unmark many candidates at once.
--    Runs with the caller's own rights, so interviewer logins can only change their own candidates
--    (the security rules from 0007 hide everyone else). Only candidates in a 1:1 stage are changed.
create or replace function public.set_rescheduled(p_ids uuid[], p_value boolean)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_bulk    uuid := gen_random_uuid();
  v_total   int;
  v_in      int;
  v_changed int;
begin
  if not public.is_full_member() and public.my_interviewer_id() is null then
    raise exception 'Your login cannot change candidates';
  end if;
  select count(*), count(*) filter (where s.requires_interviewer) into v_total, v_in
  from public.candidates c join public.stages s on s.id = c.stage_id
  where c.id = any (coalesce(p_ids, '{}'));

  perform set_config('app.bulk_action_id', v_bulk::text, true);
  with changed as (
    update public.candidates c set rescheduled = coalesce(p_value, false)
    from public.stages s
    where s.id = c.stage_id and s.requires_interviewer
      and c.id = any (coalesce(p_ids, '{}'))
      and c.rescheduled is distinct from coalesce(p_value, false)
    returning 1
  )
  select count(*) into v_changed from changed;
  perform set_config('app.bulk_action_id', '', true);

  return jsonb_build_object('bulk_action_id', v_bulk, 'changed', v_changed,
                            'unchanged', v_in - v_changed, 'not_in_stage', v_total - v_in);
end;
$$;

-- 7. Counts for the quick buttons above the table (only candidates the caller may see).
create or replace function public.rescheduled_counts(p_role public.candidate_role)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'stage_id', s.id, 'stage_name', s.name, 'stage_color', s.color,
           'total', (select count(*) from public.candidates c where c.role = p_role and c.stage_id = s.id),
           'rescheduled', (select count(*) from public.candidates c where c.role = p_role and c.stage_id = s.id and c.rescheduled))
         order by s.position), '[]')
  from public.stages s where s.requires_interviewer;
$$;

revoke execute on function public.set_rescheduled(uuid[], boolean) from public, anon;
revoke execute on function public.rescheduled_counts(public.candidate_role) from public, anon;
grant execute on function public.set_rescheduled(uuid[], boolean) to authenticated;
grant execute on function public.rescheduled_counts(public.candidate_role) to authenticated;
