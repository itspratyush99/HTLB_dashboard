-- =============================================================================
-- Candidate Tracker — Phase 4: bulk stage moves, interviewers, candidate history, activity feed
-- Run once in Supabase → SQL Editor, AFTER 0003_candidate_search.sql.
-- Adds functions only; no data is changed.
-- =============================================================================

-- 1. Cleaner log: when a move also sets the interviewer (e.g. into 1:1 Aligned), write ONE
--    "stage_change" row that carries both, instead of a stage row plus an interviewer row.
--    A pure interviewer change (stage unchanged) is still logged as "interviewer_change".
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
    'to_interviewer',   (select name from public.interviewers where id = new.interviewer_id)
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
  end if;
  return new;
end;
$$;


-- 2. Move candidates to ANY stage (one or many). All rows of one call share a bulk_action_id.
--    If the stage asks for an interviewer (1:1 Aligned), an active interviewer must be given.
--    Leaving 1:1 Aligned keeps the interviewer tag (it is history, and can be changed any time).
create or replace function public.move_candidates(p_ids uuid[], p_stage_id bigint, p_interviewer_id bigint default null)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_stage   public.stages;
  v_bulk    uuid := gen_random_uuid();
  v_total   int;
  v_changed int;
begin
  if not public.is_team_member() then
    raise exception 'Only team members can move candidates';
  end if;
  select * into v_stage from public.stages where id = p_stage_id;
  if not found then
    raise exception 'That stage no longer exists. Reload the page.';
  end if;
  if v_stage.requires_interviewer and p_interviewer_id is null then
    raise exception 'Choose an interviewer for "%".', v_stage.name;
  end if;
  if p_interviewer_id is not null and not exists (select 1 from public.interviewers where id = p_interviewer_id and is_active) then
    raise exception 'That interviewer no longer exists or is inactive. Reload the page.';
  end if;

  perform set_config('app.bulk_action_id', v_bulk::text, true);  -- read by the logging trigger

  select count(*) into v_total from public.candidates where id = any (coalesce(p_ids, '{}'));
  with changed as (
    update public.candidates c
    set stage_id = p_stage_id,
        interviewer_id = coalesce(p_interviewer_id, c.interviewer_id)
    where c.id = any (coalesce(p_ids, '{}'))
      and (c.stage_id is distinct from p_stage_id
           or (p_interviewer_id is not null and c.interviewer_id is distinct from p_interviewer_id))
    returning 1
  )
  select count(*) into v_changed from changed;

  perform set_config('app.bulk_action_id', '', true);
  return jsonb_build_object('bulk_action_id', v_bulk, 'changed', v_changed, 'unchanged', v_total - v_changed, 'stage', v_stage.name);
end;
$$;


-- 3. Assign, change or clear (p_interviewer_id = null) the interviewer for one or many candidates.
create or replace function public.set_interviewer(p_ids uuid[], p_interviewer_id bigint)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_bulk    uuid := gen_random_uuid();
  v_total   int;
  v_changed int;
begin
  if not public.is_team_member() then
    raise exception 'Only team members can change interviewers';
  end if;
  if p_interviewer_id is not null and not exists (select 1 from public.interviewers where id = p_interviewer_id and is_active) then
    raise exception 'That interviewer no longer exists or is inactive. Reload the page.';
  end if;

  perform set_config('app.bulk_action_id', v_bulk::text, true);
  select count(*) into v_total from public.candidates where id = any (coalesce(p_ids, '{}'));
  with changed as (
    update public.candidates c
    set interviewer_id = p_interviewer_id
    where c.id = any (coalesce(p_ids, '{}')) and c.interviewer_id is distinct from p_interviewer_id
    returning 1
  )
  select count(*) into v_changed from changed;
  perform set_config('app.bulk_action_id', '', true);

  return jsonb_build_object('bulk_action_id', v_bulk, 'changed', v_changed, 'unchanged', v_total - v_changed,
                            'interviewer', (select name from public.interviewers where id = p_interviewer_id));
end;
$$;


-- 4. One candidate with everything the detail panel shows.
create or replace function public.get_candidate(p_id uuid)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select to_jsonb(c) - 'search_text' - 'name_norm' - 'email_norm'
         || jsonb_build_object(
              'stage_name', s.name, 'stage_color', s.color,
              'interviewer_name', i.name, 'interviewer_color', i.color,
              'upload_file_name', u.file_name,
              'created_by_name', p.full_name)
  from public.candidates c
  join public.stages s on s.id = c.stage_id
  left join public.interviewers i on i.id = c.interviewer_id
  left join public.uploads u on u.id = c.upload_id
  left join public.profiles p on p.id = c.created_by
  where c.id = p_id;
$$;


-- 5. A candidate's full history, newest first: added by upload, stage moves, interviewer changes, exports.
create or replace function public.candidate_history(p_id uuid)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  with events as (
    -- added
    select c.created_at as at, 'added' as kind, p.full_name as user_name,
           jsonb_build_object('file_name', u.file_name, 'upload_id', c.upload_id, 'stage', s.name) as details,
           null::uuid as bulk_action_id, 0 as bulk_size
    from public.candidates c
    left join public.uploads u on u.id = c.upload_id
    left join public.profiles p on p.id = c.created_by
    left join public.stages s on s.is_default
    where c.id = p_id
    union all
    -- stage and interviewer changes
    select l.at, l.action::text, p.full_name, l.details, l.bulk_action_id,
           (select count(*) from public.activity_log b where b.bulk_action_id = l.bulk_action_id)::int
    from public.activity_log l
    left join public.profiles p on p.id = l.user_id
    where l.candidate_id = p_id
    union all
    -- bulk-sender exports that included this candidate
    select l.at, 'export', p.full_name,
           jsonb_build_object('file_name', l.details->>'file_name', 'tags', l.details->>'tags', 'exported', l.details->'exported'),
           null, coalesce((l.details->>'exported')::int, 0)
    from public.activity_log l
    left join public.profiles p on p.id = l.user_id
    where l.action = 'export' and l.details->'candidate_ids' ? p_id::text
  )
  select coalesce(jsonb_agg(to_jsonb(events) order by at desc), '[]'::jsonb) from events;
$$;


-- 6. Activity feed for the Activity Log page. Rows of one bulk action are grouped into one entry.
--    Filters (all optional): user_id, action, role, from, to (IST dates YYYY-MM-DD).
create or replace function public.activity_feed(p_filters jsonb default '{}', p_limit int default 50, p_offset int default 0)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  with f as (select coalesce(p_filters, '{}'::jsonb) as v),
  rows as (
    select l.*, coalesce(l.bulk_action_id::text, 'one:' || l.id) as gkey
    from public.activity_log l, f
    where (f.v->>'user_id' is null or l.user_id = (f.v->>'user_id')::uuid)
      and (f.v->>'action'  is null or l.action::text = f.v->>'action')
      and (f.v->>'role'    is null or l.role::text = f.v->>'role')
      and (f.v->>'from'    is null or l.at >= public.ist_day_start(f.v->>'from'))
      and (f.v->>'to'      is null or l.at <  public.ist_day_start(f.v->>'to') + interval '1 day')
  ),
  groups as (
    select gkey, action,
           min(at) as at,
           (array_agg(user_id order by id))[1] as user_id,
           case when count(distinct role) = 1 then min(role::text) end as role,
           count(*)::int as row_count,
           count(distinct candidate_id)::int as candidate_count,
           (array_agg(candidate_id order by id))[1] as first_candidate_id,
           (array_agg(details order by id))[1] as details,
           (array_agg(upload_id order by id))[1] as upload_id,
           (array_agg(bulk_action_id order by id))[1] as bulk_action_id,
           array_remove(array_agg(distinct details->>'from_stage'), null) as from_stages,
           array_remove(array_agg(distinct details->>'to_stage'), null) as to_stages,
           array_remove(array_agg(distinct details->>'from_interviewer'), null) as from_interviewers,
           array_remove(array_agg(distinct details->>'to_interviewer'), null) as to_interviewers,
           (array_agg(details->>'candidate_name' order by details->>'candidate_name'))[1:3] as sample_names
    from rows
    group by gkey, action
    order by min(at) desc, gkey
    limit greatest(least(p_limit, 200), 1) + 1 offset greatest(p_offset, 0)
  )
  select jsonb_build_object(
    'has_more', count(*) > greatest(least(p_limit, 200), 1),
    'rows', coalesce(jsonb_agg(to_jsonb(g) || jsonb_build_object('user_name', p.full_name) order by g.at desc, g.gkey)
                     filter (where g.rn <= greatest(least(p_limit, 200), 1)), '[]'::jsonb)
  )
  from (select groups.*, row_number() over (order by at desc, gkey) as rn from groups) g
  left join public.profiles p on p.id = g.user_id;
$$;


revoke execute on function public.move_candidates(uuid[], bigint, bigint) from public, anon;
revoke execute on function public.set_interviewer(uuid[], bigint)          from public, anon;
revoke execute on function public.get_candidate(uuid)                      from public, anon;
revoke execute on function public.candidate_history(uuid)                  from public, anon;
revoke execute on function public.activity_feed(jsonb, int, int)           from public, anon;
grant  execute on function public.move_candidates(uuid[], bigint, bigint) to authenticated;
grant  execute on function public.set_interviewer(uuid[], bigint)          to authenticated;
grant  execute on function public.get_candidate(uuid)                      to authenticated;
grant  execute on function public.candidate_history(uuid)                  to authenticated;
grant  execute on function public.activity_feed(jsonb, int, int)           to authenticated;
