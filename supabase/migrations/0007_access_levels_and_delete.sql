-- =============================================================================
-- HTLB Candidate Tracker — access levels and admin delete
-- Run once in Supabase → SQL Editor, AFTER 0006_settings.sql.
--
-- Access levels (set by an admin in Settings → Team users):
--   • Admin        – sees and does everything, manages team users, can delete candidates
--   • Team member  – sees and does everything except managing users and deleting
--   • Interviewer  – linked to one interviewer name (e.g. Parul); sees ONLY candidates
--                    tagged with that interviewer, and can move their stage. No uploads,
--                    no settings, cannot reassign interviewers.
-- The rules are enforced by the database (Row Level Security), not only hidden in the screens.
-- No candidate data is changed by this file.
-- =============================================================================

-- 1. Access level per person ---------------------------------------------------
alter table public.profiles
  add column if not exists access text not null default 'full' check (access in ('full', 'interviewer')),
  add column if not exists interviewer_id bigint references public.interviewers (id) on delete set null;

-- New activity type for deletions (used by delete_candidates below).
alter type public.activity_action add value if not exists 'candidates_deleted';

-- Helpers
create or replace function public.is_full_member()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_active and (is_admin or access = 'full'));
$$;

-- The interviewer an interviewer-only login is limited to (NULL for admins / team members).
create or replace function public.my_interviewer_id()
returns bigint
language sql stable security definer set search_path = ''
as $$
  select interviewer_id from public.profiles
  where id = auth.uid() and is_active and not is_admin and access = 'interviewer';
$$;

-- True when this login may see candidate rows tagged with p_interviewer_id.
create or replace function public.can_see_candidate(p_interviewer_id bigint)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_full_member()
      or (p_interviewer_id is not null and p_interviewer_id = public.my_interviewer_id());
$$;

revoke execute on function public.is_full_member()            from public, anon;
revoke execute on function public.my_interviewer_id()         from public, anon;
revoke execute on function public.can_see_candidate(bigint)   from public, anon;
grant  execute on function public.is_full_member()            to authenticated;
grant  execute on function public.my_interviewer_id()         to authenticated;
grant  execute on function public.can_see_candidate(bigint)   to authenticated;


-- 2. Row Level Security: replace the "whole team" rules ---------------------------

-- Candidates: full members see all; interviewers see and update only their own.
drop policy if exists "team reads candidates"   on public.candidates;
drop policy if exists "team inserts candidates" on public.candidates;
drop policy if exists "team updates candidates" on public.candidates;
-- "(select fn())" makes Postgres check the login once per query instead of once per row (much faster).
create policy "read candidates"   on public.candidates for select to authenticated
  using ((select public.is_full_member()) or (interviewer_id is not null and interviewer_id = (select public.my_interviewer_id())));
create policy "add candidates"    on public.candidates for insert to authenticated with check ((select public.is_full_member()));
create policy "update candidates" on public.candidates for update to authenticated
  using ((select public.is_full_member()) or (interviewer_id is not null and interviewer_id = (select public.my_interviewer_id())))
  with check ((select public.is_full_member()) or interviewer_id = (select public.my_interviewer_id()));  -- interviewers can't hand candidates to someone else

-- Uploads: full members only.
drop policy if exists "team reads uploads"   on public.uploads;
drop policy if exists "team inserts uploads" on public.uploads;
drop policy if exists "team updates uploads" on public.uploads;
create policy "read uploads"   on public.uploads for select to authenticated using ((select public.is_full_member()));
create policy "add uploads"    on public.uploads for insert to authenticated with check (public.is_full_member());
create policy "update uploads" on public.uploads for update to authenticated using (public.is_full_member()) with check (public.is_full_member());

-- Activity Log: full members see all; interviewers see entries about their candidates and their own actions.
drop policy if exists "team reads activity" on public.activity_log;
create policy "read activity" on public.activity_log for select to authenticated using (
  (select public.is_full_member())
  or user_id = (select auth.uid())
  or (candidate_id is not null and exists (
        select 1 from public.candidates c
        where c.id = activity_log.candidate_id and c.interviewer_id = (select public.my_interviewer_id())))
);

-- Settings tables: everyone can read (stage names/colours are needed everywhere); only full members change them.
do $$
declare t text;
begin
  foreach t in array array['stages', 'interviewers', 'role_keywords', 'app_settings'] loop
    execute format('drop policy if exists "team writes %1$s" on public.%1$I', t);
    execute format('create policy "full members add %1$s"    on public.%1$I for insert to authenticated with check (public.is_full_member())', t);
    execute format('create policy "full members change %1$s" on public.%1$I for update to authenticated using (public.is_full_member()) with check (public.is_full_member())', t);
    execute format('create policy "full members delete %1$s" on public.%1$I for delete to authenticated using (public.is_full_member())', t);
  end loop;
end $$;

drop policy if exists "team writes questions"  on public.screening_questions;
drop policy if exists "team updates questions" on public.screening_questions;
create policy "add questions"    on public.screening_questions for insert to authenticated with check (public.is_full_member());
create policy "update questions" on public.screening_questions for update to authenticated using (public.is_full_member()) with check (public.is_full_member());


-- 3. Only admins change access; admins are always full members ----------------------
create or replace function public.profiles_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.id := old.id;
  new.email := old.email;
  new.created_at := old.created_at;
  if not public.is_admin() and auth.uid() is not null then
    new.is_admin := old.is_admin;
    new.is_active := old.is_active;
    new.access := old.access;
    new.interviewer_id := old.interviewer_id;
  end if;
  if new.is_admin then
    new.access := 'full';
  end if;
  if new.access = 'full' then
    new.interviewer_id := null;
  end if;
  if new.access = 'interviewer' and new.interviewer_id is null then
    raise exception 'Choose which interviewer this login belongs to.';
  end if;
  if auth.uid() = old.id and old.is_admin and (not new.is_admin or not new.is_active) then
    raise exception 'You can''t remove your own admin access. Ask another admin.';
  end if;
  if (old.is_admin and old.is_active) and not (new.is_admin and new.is_active)
     and not exists (select 1 from public.profiles where is_admin and is_active and id <> old.id) then
    raise exception 'There must always be at least one active admin.';
  end if;
  return new;
end;
$$;


-- 4. Functions: tighten who may run what --------------------------------------------

-- Moving stages: full members, and interviewers for their own candidates.
-- An interviewer moving into "1:1 Aligned" always keeps themselves as the interviewer.
create or replace function public.move_candidates(p_ids uuid[], p_stage_id bigint, p_interviewer_id bigint default null)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_stage   public.stages;
  v_bulk    uuid := gen_random_uuid();
  v_mine    bigint := public.my_interviewer_id();
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
  if v_mine is not null then
    p_interviewer_id := case when v_stage.requires_interviewer then v_mine else null end;
  end if;
  if v_stage.requires_interviewer and p_interviewer_id is null then
    raise exception 'Choose an interviewer for "%".', v_stage.name;
  end if;
  if p_interviewer_id is not null and not exists (select 1 from public.interviewers where id = p_interviewer_id and is_active) then
    raise exception 'That interviewer no longer exists or is inactive. Reload the page.';
  end if;

  perform set_config('app.bulk_action_id', v_bulk::text, true);
  select count(*) into v_total from public.candidates where id = any (coalesce(p_ids, '{}'));  -- only rows this login can see
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

-- Assigning interviewers: full members only (the admin/team decides who interviews).
create or replace function public.set_interviewer(p_ids uuid[], p_interviewer_id bigint)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_bulk    uuid := gen_random_uuid();
  v_total   int;
  v_changed int;
begin
  if not public.is_full_member() then
    raise exception 'Only admins and team members can assign interviewers';
  end if;
  if p_interviewer_id is not null and not exists (select 1 from public.interviewers where id = p_interviewer_id and is_active) then
    raise exception 'That interviewer no longer exists or is inactive. Reload the page.';
  end if;
  perform set_config('app.bulk_action_id', v_bulk::text, true);
  select count(*) into v_total from public.candidates where id = any (coalesce(p_ids, '{}'));
  with changed as (
    update public.candidates c set interviewer_id = p_interviewer_id
    where c.id = any (coalesce(p_ids, '{}')) and c.interviewer_id is distinct from p_interviewer_id
    returning 1
  )
  select count(*) into v_changed from changed;
  perform set_config('app.bulk_action_id', '', true);
  return jsonb_build_object('bulk_action_id', v_bulk, 'changed', v_changed, 'unchanged', v_total - v_changed,
                            'interviewer', (select name from public.interviewers where id = p_interviewer_id));
end;
$$;

-- Settings functions: full members only.
create or replace function public.reorder_stages(p_ids bigint[])
returns void
language plpgsql security invoker set search_path = ''
as $$
begin
  if not public.is_full_member() then raise exception 'Only admins and team members can change stages'; end if;
  if (select count(*) from public.stages) <> cardinality(p_ids)
     or exists (select 1 from public.stages s where s.id <> all (p_ids)) then
    raise exception 'The stage list has changed since you opened it. Reload the page and try again.';
  end if;
  update public.stages s set position = x.ord
  from unnest(p_ids) with ordinality as x(id, ord)
  where s.id = x.id and s.position is distinct from x.ord;
end;
$$;

create or replace function public.set_default_stage(p_id bigint)
returns void
language plpgsql security invoker set search_path = ''
as $$
begin
  if not public.is_full_member() then raise exception 'Only admins and team members can change stages'; end if;
  if not exists (select 1 from public.stages where id = p_id) then raise exception 'That stage no longer exists.'; end if;
  update public.stages set is_default = false where is_default and id <> p_id;
  update public.stages set is_default = true where id = p_id and not is_default;
end;
$$;

create or replace function public.remove_interviewer(p_id bigint)
returns text
language plpgsql security invoker set search_path = ''
as $$
begin
  if not public.is_full_member() then raise exception 'Only admins and team members can change interviewers'; end if;
  if exists (select 1 from public.candidates where interviewer_id = p_id)
     or exists (select 1 from public.profiles where interviewer_id = p_id) then
    update public.interviewers set is_active = false where id = p_id;
    return 'deactivated';
  end if;
  delete from public.interviewers where id = p_id;
  return 'deleted';
end;
$$;


-- 5. Admin delete --------------------------------------------------------------------
-- Permanently deletes candidates. Their Activity Log lines are kept but unlinked.
-- p_erase_names = true also replaces their name in old log lines (for a data-removal request).
-- One "candidates_deleted" entry records who deleted how many (and the names, unless erased).
create or replace function public.delete_candidates(p_ids uuid[], p_erase_names boolean default false)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_names text[];
  v_roles text[];
  v_count int;
begin
  if not public.is_admin() then
    raise exception 'Only admins can delete candidates.';
  end if;
  select array_agg(name order by name), array_agg(distinct role::text), count(*)
    into v_names, v_roles, v_count
  from public.candidates where id = any (coalesce(p_ids, '{}'));
  if v_count = 0 then
    return jsonb_build_object('deleted', 0);
  end if;

  update public.activity_log
  set candidate_id = null,
      details = case when p_erase_names then details || '{"candidate_name": "(deleted candidate)"}'::jsonb else details end
  where candidate_id = any (p_ids);

  delete from public.candidates where id = any (p_ids);

  insert into public.activity_log (user_id, action, role, details)
  values (auth.uid(), 'candidates_deleted',
          case when cardinality(v_roles) = 1 then v_roles[1]::public.candidate_role end,
          jsonb_build_object('count', v_count, 'names_erased', p_erase_names,
                             'names', case when p_erase_names then '[]'::jsonb else to_jsonb(v_names) end));
  return jsonb_build_object('deleted', v_count);
end;
$$;

revoke execute on function public.delete_candidates(uuid[], boolean) from public, anon;
grant  execute on function public.delete_candidates(uuid[], boolean) to authenticated;


-- 6. Activity feed: describe deletions (counts come from details) ---------------------
-- (activity_feed already returns details for every action; nothing to change.)
