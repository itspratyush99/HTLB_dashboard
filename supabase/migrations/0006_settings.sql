-- =============================================================================
-- HTLB Candidate Tracker — Phase 6: editable Settings
-- Run once in Supabase → SQL Editor, AFTER 0005_dashboard_analytics.sql.
-- Adds functions and safety rules; no candidate data is changed.
-- =============================================================================

-- 1. Put stages in a new order (the list of ids, first = position 1).
create or replace function public.reorder_stages(p_ids bigint[])
returns void
language plpgsql security invoker set search_path = ''
as $$
begin
  if not public.is_team_member() then raise exception 'Only team members can change stages'; end if;
  if (select count(*) from public.stages) <> cardinality(p_ids)
     or exists (select 1 from public.stages s where s.id <> all (p_ids)) then
    raise exception 'The stage list has changed since you opened it. Reload the page and try again.';
  end if;
  update public.stages s set position = x.ord
  from unnest(p_ids) with ordinality as x(id, ord)
  where s.id = x.id and s.position is distinct from x.ord;
end;
$$;

-- 2. Choose the stage new candidates start in.
create or replace function public.set_default_stage(p_id bigint)
returns void
language plpgsql security invoker set search_path = ''
as $$
begin
  if not public.is_team_member() then raise exception 'Only team members can change stages'; end if;
  if not exists (select 1 from public.stages where id = p_id) then raise exception 'That stage no longer exists.'; end if;
  update public.stages set is_default = false where is_default and id <> p_id;  -- two steps: only one default at a time
  update public.stages set is_default = true where id = p_id and not is_default;
end;
$$;

-- 3. Remove an interviewer. If any candidate still has them, they are switched off instead
--    (hidden from new assignments, history and existing tags kept). Returns 'deleted' or 'deactivated'.
create or replace function public.remove_interviewer(p_id bigint)
returns text
language plpgsql security invoker set search_path = ''
as $$
begin
  if not public.is_team_member() then raise exception 'Only team members can change interviewers'; end if;
  if exists (select 1 from public.candidates where interviewer_id = p_id) then
    update public.interviewers set is_active = false where id = p_id;
    return 'deactivated';
  end if;
  delete from public.interviewers where id = p_id;
  return 'deleted';
end;
$$;

-- 4. Team users: anyone may change their own display name; only admins change access.
--    Nobody can remove their own admin access or switch themselves off, and there is always one active admin.
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

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles for each row execute function public.profiles_guard();

drop policy if exists "user updates own name" on public.profiles;
create policy "user updates own name" on public.profiles for update to authenticated
  using (id = auth.uid() and public.is_team_member()) with check (id = auth.uid());

-- 5. Sensible limits for the two bottleneck thresholds.
create or replace function public.app_settings_check()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.key = 'lag_max_days_in_stage' and ((new.value #>> '{}')::numeric < 1 or (new.value #>> '{}')::numeric > 90) then
    raise exception 'Max days in a stage must be between 1 and 90.';
  end if;
  if new.key = 'lag_min_conversion_pct' and ((new.value #>> '{}')::numeric < 1 or (new.value #>> '{}')::numeric > 100) then
    raise exception 'Minimum conversion must be between 1 and 100%%.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists app_settings_check on public.app_settings;
create trigger app_settings_check before insert or update on public.app_settings for each row execute function public.app_settings_check();

-- 6. Stage and interviewer names must not be blank; keywords are trimmed.
alter table public.stages       drop constraint if exists stages_name_not_blank;
alter table public.stages       add  constraint stages_name_not_blank check (length(trim(name)) > 0);
alter table public.interviewers drop constraint if exists interviewers_name_not_blank;
alter table public.interviewers add  constraint interviewers_name_not_blank check (length(trim(name)) > 0);
alter table public.role_keywords drop constraint if exists role_keywords_not_blank;
alter table public.role_keywords add  constraint role_keywords_not_blank check (length(trim(keyword)) > 0);

revoke execute on function public.reorder_stages(bigint[])    from public, anon;
revoke execute on function public.set_default_stage(bigint)   from public, anon;
revoke execute on function public.remove_interviewer(bigint)  from public, anon;
grant  execute on function public.reorder_stages(bigint[])    to authenticated;
grant  execute on function public.set_default_stage(bigint)   to authenticated;
grant  execute on function public.remove_interviewer(bigint)  to authenticated;
