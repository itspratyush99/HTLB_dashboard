-- =============================================================================
-- Candidate Tracker — Phase 5: Dashboard and Analytics
-- Run once in Supabase → SQL Editor, AFTER 0004_moves_and_history.sql.
-- Adds read-only functions; no data is changed.
--
-- Definitions used everywhere (all days are IST calendar days):
--   • A candidate "enters" a stage when uploaded (default stage) or moved into it.
--   • "Entered X in the period" = entered stage X between the From and To dates.
--   • "Converted" = of those, how many have since reached ANY later stage (skipping stages counts).
--   • Time in stage = days between entering a stage and leaving it.
--   • "Stuck" = in a stage (not the last one) for more than the "max days in a stage" setting.
-- =============================================================================

-- Today's date in India.
create or replace function public.ist_today()
returns date
language sql stable set search_path = ''
as $$ select (now() at time zone 'Asia/Kolkata')::date; $$;

-- Every time a candidate entered a stage: the upload (default stage) plus every logged move.
create or replace function public.stage_entries()
returns table (candidate_id uuid, role public.candidate_role, stage_id bigint, entered_at timestamptz, left_at timestamptz)
language sql stable security invoker set search_path = ''
as $$
  with e as (
    select c.id as candidate_id, c.role,
           coalesce((select l.from_stage_id from public.activity_log l
                     where l.candidate_id = c.id and l.action = 'stage_change' order by l.at, l.id limit 1),
                    c.stage_id) as stage_id,  -- the stage it started in (default stage at upload time)
           c.created_at as entered_at
    from public.candidates c
    union all
    select l.candidate_id, l.role, l.to_stage_id, l.at
    from public.activity_log l
    where l.action = 'stage_change' and l.candidate_id is not null and l.to_stage_id is not null
  )
  select candidate_id, role, stage_id, entered_at,
         lead(entered_at) over (partition by candidate_id order by entered_at) as left_at
  from e;
$$;


-- DASHBOARD: per role → total, new today / this week (Mon–Sun, IST), count per stage,
-- candidates per interviewer in stages that ask for one (1:1 Aligned), and the stuck count.
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
                                 where c.role = r.role and c.interviewer_id = i.id and s.requires_interviewer))
                     order by i.name), '[]') from public.interviewers i where i.is_active),
    'stuck', (select count(*) from public.candidates c join public.stages s on s.id = c.stage_id, params p
              where c.role = r.role and s.position < p.last_position
                and p.today - (c.stage_changed_at at time zone 'Asia/Kolkata')::date > p.max_days)
  ))
  from roles r;
$$;


-- ANALYTICS for a role (null = both), a date range and optionally one interviewer.
create or replace function public.analytics(
  p_role           public.candidate_role default null,
  p_from           date default null,
  p_to             date default null,
  p_interviewer_id bigint default null
)
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_to       date := coalesce(p_to, public.ist_today());
  v_from     date := coalesce(p_from, coalesce(p_to, public.ist_today()) - 29);
  v_len      int;
  v_prev_from date;
  v_prev_to   date;
  v_max_days int := coalesce((select (value #>> '{}')::int from public.app_settings where key = 'lag_max_days_in_stage'), 3);
  v_min_conv numeric := coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'lag_min_conversion_pct'), 30);
  v_result   jsonb;
begin
  if v_from > v_to then
    raise exception 'The From date is after the To date.';
  end if;
  v_len := v_to - v_from + 1;
  v_prev_to := v_from - 1;
  v_prev_from := v_prev_to - v_len + 1;

  with
  cand as (  -- candidates in scope
    select c.* from public.candidates c
    where (p_role is null or c.role = p_role)
      and (p_interviewer_id is null or c.interviewer_id = p_interviewer_id)
  ),
  entries as (
    select e.*, s.position, (e.entered_at at time zone 'Asia/Kolkata')::date as entered_day
    from public.stage_entries() e
    join cand on cand.id = e.candidate_id
    join public.stages s on s.id = e.stage_id
  ),
  -- the highest stage position each entry went on to reach afterwards
  reached as (
    select e.*,
           max(e.position) over (partition by e.candidate_id order by e.entered_at
                                 rows between 1 following and unbounded following) as later_max
    from entries e
  ),
  funnel as (
    select s.id, s.name, s.color, s.position, s.requires_interviewer,
      (select count(*) from cand where cand.stage_id = s.id) as current,
      (select count(distinct r.candidate_id) from reached r where r.stage_id = s.id and r.entered_day between v_from and v_to) as entered,
      (select count(distinct r.candidate_id) from reached r where r.stage_id = s.id and r.entered_day between v_from and v_to and r.later_max > s.position) as converted,
      (select count(distinct r.candidate_id) from reached r where r.stage_id = s.id and r.entered_day between v_prev_from and v_prev_to) as prev_entered,
      (select count(distinct r.candidate_id) from reached r where r.stage_id = s.id and r.entered_day between v_prev_from and v_prev_to and r.later_max > s.position) as prev_converted
    from public.stages s
  ),
  stints as (  -- completed stays that started in the period
    select e.stage_id, extract(epoch from (e.left_at - e.entered_at)) / 86400.0 as days
    from entries e
    where e.left_at is not null and e.entered_day between v_from and v_to
  ),
  time_in_stage as (
    select s.id, s.name, s.color, s.position,
      (select round(avg(days)::numeric, 1) from stints where stints.stage_id = s.id) as avg_days,
      (select round((percentile_cont(0.5) within group (order by days))::numeric, 1) from stints where stints.stage_id = s.id) as median_days,
      (select count(*) from stints where stints.stage_id = s.id) as stints,
      (select round(avg(extract(epoch from (now() - cand.stage_changed_at)) / 86400.0)::numeric, 1)
         from cand where cand.stage_id = s.id) as current_avg_days
    from public.stages s
  ),
  days as (select d::date as day from generate_series(v_from, v_to, interval '1 day') d),
  uploads_by_day as (
    select (created_at at time zone 'Asia/Kolkata')::date as day, count(*) as n
    from cand
    where (created_at at time zone 'Asia/Kolkata')::date between v_from and v_to
    group by 1
  ),
  moves_by_day as (
    select day, jsonb_object_agg(stage_id, n) as moves
    from (
      select (l.at at time zone 'Asia/Kolkata')::date as day, l.to_stage_id as stage_id, count(*) as n
      from public.activity_log l join cand on cand.id = l.candidate_id
      where l.action = 'stage_change' and l.to_stage_id is not null
        and l.at >= public.ist_day_start(v_from::text) and l.at < public.ist_day_start(v_to::text) + interval '1 day'
      group by 1, 2
    ) x
    group by day
  ),
  daily as (
    select d.day, coalesce(u.n, 0) as uploaded, coalesce(m.moves, '{}'::jsonb) as moves
    from days d
    left join uploads_by_day u on u.day = d.day
    left join moves_by_day m on m.day = d.day
  ),
  stuck as (
    select c.role, s.id as stage_id, s.name, s.color, s.position, count(*) as count,
           max(public.ist_today() - (c.stage_changed_at at time zone 'Asia/Kolkata')::date) as oldest_days
    from cand c join public.stages s on s.id = c.stage_id
    where s.position < (select max(position) from public.stages)
      and public.ist_today() - (c.stage_changed_at at time zone 'Asia/Kolkata')::date > v_max_days
    group by c.role, s.id
  )
  select jsonb_build_object(
    'period',       jsonb_build_object('from', v_from, 'to', v_to, 'prev_from', v_prev_from, 'prev_to', v_prev_to, 'days', v_len),
    'thresholds',   jsonb_build_object('max_days', v_max_days, 'min_conversion_pct', v_min_conv),
    'today',        public.ist_today(),
    'stuck_before', public.ist_today() - v_max_days - 1,  -- "stage changed on or before" date for the role-tab link
    'funnel',       (select coalesce(jsonb_agg(to_jsonb(f) order by f.position), '[]') from funnel f),
    'time_in_stage',(select coalesce(jsonb_agg(to_jsonb(t) order by t.position), '[]') from time_in_stage t),
    'daily',        (select coalesce(jsonb_agg(to_jsonb(d) order by d.day), '[]') from daily d),
    'stuck',        (select coalesce(jsonb_agg(to_jsonb(s) order by s.role, s.position), '[]') from stuck s)
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.ist_today()                                        from public, anon;
revoke execute on function public.stage_entries()                                    from public, anon;
revoke execute on function public.dashboard_stats()                                  from public, anon;
revoke execute on function public.analytics(public.candidate_role, date, date, bigint) from public, anon;
grant  execute on function public.ist_today()                                        to authenticated;
grant  execute on function public.stage_entries()                                    to authenticated;
grant  execute on function public.dashboard_stats()                                  to authenticated;
grant  execute on function public.analytics(public.candidate_role, date, date, bigint) to authenticated;
