-- =============================================================================
-- HTLB Candidate Tracker — Shortlisted tags (72h / 48h / 24h / Hold) and test-results upload
-- Run once in Supabase → SQL Editor, AFTER 0007_access_levels_and_delete.sql.
-- No candidate data is changed: everyone in Shortlisted starts with "No tag".
--
-- How tags work
--   • Tags exist only in the starting stage (Shortlisted). Moving a candidate to any other
--     stage removes the tag automatically.
--   • Tags change only when someone changes them (no timers).
--   • Order (position) = the reminder cycle: No tag → 72h → 48h → 24h → Hold.
--   • Every tag change is saved in the Activity Log with who/when/from → to.
-- =============================================================================

-- 1. Tag list (editable in Settings → Shortlist tags) -----------------------------
create table if not exists public.shortlist_tags (
  id         bigint generated always as identity primary key,
  name       text not null unique check (length(trim(name)) > 0),
  position   int  not null,
  color      text not null default '#64748b',
  created_at timestamptz not null default now()
);

insert into public.shortlist_tags (name, position, color)
select * from (values ('72h', 1, '#0284c7'), ('48h', 2, '#d97706'), ('24h', 3, '#dc2626'), ('Hold', 4, '#64748b')) v(name, position, color)
where not exists (select 1 from public.shortlist_tags);

alter table public.shortlist_tags enable row level security;
revoke all on public.shortlist_tags from anon;
create policy "team reads shortlist_tags"           on public.shortlist_tags for select to authenticated using (public.is_team_member());
create policy "full members add shortlist_tags"     on public.shortlist_tags for insert to authenticated with check ((select public.is_full_member()));
create policy "full members change shortlist_tags"  on public.shortlist_tags for update to authenticated using ((select public.is_full_member())) with check ((select public.is_full_member()));
create policy "full members delete shortlist_tags"  on public.shortlist_tags for delete to authenticated using ((select public.is_full_member()));
create trigger shortlist_tags_audit after insert or update or delete on public.shortlist_tags for each row execute function public.log_settings_change();

-- 2. Tag on each candidate --------------------------------------------------------------
alter table public.candidates
  add column if not exists shortlist_tag_id bigint references public.shortlist_tags (id) on delete restrict,
  add column if not exists shortlist_tag_changed_at timestamptz;
create index if not exists candidates_tag_idx on public.candidates (role, stage_id, shortlist_tag_id);

alter type public.activity_action add value if not exists 'tag_change';

-- Tags only live in the starting stage: cleared automatically anywhere else; new candidates have no tag.
create or replace function public.candidates_tag_guard()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.shortlist_tag_id := null;
    new.shortlist_tag_changed_at := null;
    return new;
  end if;
  if new.shortlist_tag_id is not null
     and new.stage_id is distinct from (select id from public.stages where is_default limit 1) then
    new.shortlist_tag_id := null;
  end if;
  if new.shortlist_tag_id is distinct from old.shortlist_tag_id then
    new.shortlist_tag_changed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists candidates_tag_guard on public.candidates;
create trigger candidates_tag_guard before insert or update on public.candidates
  for each row execute function public.candidates_tag_guard();

-- 3. Logging: stage moves now also record the tag the candidate had (for "which reminder works best"),
--    and pure tag changes are logged as "tag_change".
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
    'to_tag',           (select name from public.shortlist_tags where id = new.shortlist_tag_id)
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
  end if;
  return new;
end;
$$;

drop trigger if exists candidates_log_changes on public.candidates;
create trigger candidates_log_changes
  after update of stage_id, interviewer_id, shortlist_tag_id on public.candidates
  for each row execute function public.candidates_log_changes();

-- 4. Set (or clear, p_tag_id = null) the tag of many candidates at once ------------------------
--    Only candidates in Shortlisted are changed; the rest are counted as "not in Shortlisted".
create or replace function public.set_shortlist_tag(p_ids uuid[], p_tag_id bigint)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_bulk    uuid := gen_random_uuid();
  v_default bigint := (select id from public.stages where is_default limit 1);
  v_total   int;
  v_in      int;
  v_changed int;
begin
  if not public.is_full_member() then
    raise exception 'Only admins and team members can change tags';
  end if;
  if p_tag_id is not null and not exists (select 1 from public.shortlist_tags where id = p_tag_id) then
    raise exception 'That tag no longer exists. Reload the page.';
  end if;
  select count(*), count(*) filter (where stage_id = v_default) into v_total, v_in
  from public.candidates where id = any (coalesce(p_ids, '{}'));

  perform set_config('app.bulk_action_id', v_bulk::text, true);
  with changed as (
    update public.candidates c set shortlist_tag_id = p_tag_id
    where c.id = any (coalesce(p_ids, '{}')) and c.stage_id = v_default
      and c.shortlist_tag_id is distinct from p_tag_id
    returning 1
  )
  select count(*) into v_changed from changed;
  perform set_config('app.bulk_action_id', '', true);

  return jsonb_build_object('bulk_action_id', v_bulk, 'changed', v_changed, 'unchanged', v_in - v_changed,
                            'not_shortlisted', v_total - v_in,
                            'tag', coalesce((select name from public.shortlist_tags where id = p_tag_id), 'No tag'));
end;
$$;

-- Reorder tags (list of ids, first = position 1).
create or replace function public.reorder_shortlist_tags(p_ids bigint[])
returns void
language plpgsql security invoker set search_path = ''
as $$
begin
  if not public.is_full_member() then raise exception 'Only admins and team members can change tags'; end if;
  update public.shortlist_tags t set position = x.ord
  from unnest(p_ids) with ordinality as x(id, ord)
  where t.id = x.id and t.position is distinct from x.ord;
end;
$$;

-- Counts for the quick tag buttons on the ZBM / HOS tabs.
create or replace function public.shortlist_tag_counts(p_role public.candidate_role)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  with d as (select id, name from public.stages where is_default limit 1),
  c as (select cc.shortlist_tag_id from public.candidates cc, d where cc.role = p_role and cc.stage_id = d.id)
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

-- Analytics: candidates who left Shortlisted in a period, by the tag they had then
-- (shows which reminder message gets people to take the test).
create or replace function public.tag_conversion(p_role public.candidate_role default null, p_from date default null, p_to date default null)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('from_tag', from_tag, 'to_stage', to_stage, 'count', n) order by to_stage, from_tag), '[]'::jsonb)
  from (
    select coalesce(l.details->>'from_tag', 'No tag') as from_tag, l.details->>'to_stage' as to_stage, count(*) as n
    from public.activity_log l
    where l.action = 'stage_change'
      and l.from_stage_id = (select id from public.stages where is_default limit 1)
      and (p_role is null or l.role = p_role)
      and l.at >= public.ist_day_start(coalesce(p_from, public.ist_today() - 29)::text)
      and l.at <  public.ist_day_start(coalesce(p_to, public.ist_today())::text) + interval '1 day'
    group by 1, 2
  ) x;
$$;

-- 5. Test-results uploads are recorded in Upload History too ------------------------------
alter table public.uploads
  add column if not exists kind text not null default 'naukri' check (kind in ('naukri', 'test_results')),
  add column if not exists summary jsonb not null default '{}';

-- Which stage a test-results upload moves candidates into (editable in Settings).
insert into public.app_settings (key, value)
select 'test_cleared_stage_id', to_jsonb(id) from public.stages where position = 2
on conflict (key) do nothing;

-- 6. Search, filters and Dashboard learn about tags (same functions as before, plus tags) ----------

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
    'shortlist_tags', (select coalesce(jsonb_agg(jsonb_build_object(
                         'id', tg.id, 'name', tg.name, 'color', tg.color, 'position', tg.position,
                         'count', (select count(*) from public.candidates c where c.role = r.role and c.shortlist_tag_id = tg.id))
                       order by tg.position), '[]') from public.shortlist_tags tg),
    'shortlist_no_tag', (select count(*) from public.candidates c join public.stages s on s.id = c.stage_id
                         where c.role = r.role and s.is_default and c.shortlist_tag_id is null),
    'stuck', (select count(*) from public.candidates c join public.stages s on s.id = c.stage_id, params p
              where c.role = r.role and s.position < p.last_position
                and p.today - (c.stage_changed_at at time zone 'Asia/Kolkata')::date > p.max_days)
  ))
  from roles r;
$$;

-- Candidate panel shows the tag too.
create or replace function public.get_candidate(p_id uuid)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select to_jsonb(c) - 'search_text' - 'name_norm' - 'email_norm'
         || jsonb_build_object(
              'stage_name', s.name, 'stage_color', s.color,
              'interviewer_name', i.name, 'interviewer_color', i.color,
              'upload_file_name', u.file_name,
              'created_by_name', p.full_name,
              'tag_name', t.name, 'tag_color', t.color)
  from public.candidates c
  join public.stages s on s.id = c.stage_id
  left join public.interviewers i on i.id = c.interviewer_id
  left join public.uploads u on u.id = c.upload_id
  left join public.profiles p on p.id = c.created_by
  left join public.shortlist_tags t on t.id = c.shortlist_tag_id
  where c.id = p_id;
$$;

-- 7. Export helper returns the tag too (used for "Move these exported candidates to the next tag").
drop function if exists public.candidates_for_export(uuid[]);
create function public.candidates_for_export(p_ids uuid[])
returns table (
  id               uuid,
  role             public.candidate_role,
  name             text,
  primary_phone    text,
  phone_raw        text,
  stage_id         bigint,
  stage_name       text,
  interviewer_name text,
  tag_id           bigint,
  tag_name         text
)
language sql stable security invoker set search_path = ''
as $$
  select c.id, c.role, c.name, c.primary_phone, c.phone_raw, c.stage_id, s.name, i.name, c.shortlist_tag_id, t.name
  from public.candidates c
  join public.stages s on s.id = c.stage_id
  left join public.interviewers i on i.id = c.interviewer_id
  left join public.shortlist_tags t on t.id = c.shortlist_tag_id
  where c.id = any (coalesce(p_ids, '{}'))
  order by s.position, c.name_norm;
$$;

revoke execute on function public.candidates_for_export(uuid[])                          from public, anon;
revoke execute on function public.set_shortlist_tag(uuid[], bigint)                      from public, anon;
revoke execute on function public.reorder_shortlist_tags(bigint[])                       from public, anon;
revoke execute on function public.shortlist_tag_counts(public.candidate_role)            from public, anon;
revoke execute on function public.tag_conversion(public.candidate_role, date, date)      from public, anon;
grant  execute on function public.candidates_for_export(uuid[])                          to authenticated;
grant  execute on function public.set_shortlist_tag(uuid[], bigint)                      to authenticated;
grant  execute on function public.reorder_shortlist_tags(bigint[])                       to authenticated;
grant  execute on function public.shortlist_tag_counts(public.candidate_role)            to authenticated;
grant  execute on function public.tag_conversion(public.candidate_role, date, date)      to authenticated;

-- 8. Test-results upload: find candidates (all roles) by mobile number, with their stage and tag.
create or replace function public.find_candidates_by_phone(p_phones text[])
returns table (
  id             uuid,
  role           public.candidate_role,
  name           text,
  primary_phone  text,
  stage_id       bigint,
  stage_name     text,
  stage_position int,
  tag_name       text
)
language sql stable security invoker set search_path = ''
as $$
  select c.id, c.role, c.name, c.primary_phone, c.stage_id, s.name, s.position, t.name
  from public.candidates c
  join public.stages s on s.id = c.stage_id
  left join public.shortlist_tags t on t.id = c.shortlist_tag_id
  where c.primary_phone = any (coalesce(p_phones, '{}'));
$$;
revoke execute on function public.find_candidates_by_phone(text[]) from public, anon;
grant  execute on function public.find_candidates_by_phone(text[]) to authenticated;
