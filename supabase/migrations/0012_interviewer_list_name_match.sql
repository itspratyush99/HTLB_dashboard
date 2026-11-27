-- 0012: the interviewer-list upload can match people by name (first), mobile or email.
-- Read-only lookup; nothing in the database changes. Safe to run once on top of 0001–0011.

-- Finds candidates whose name, "first + last word" of the name, mobile or email is in the lists.
-- Runs with the caller's own rights (admins and team members see everyone).
create or replace function public.find_candidates_for_list(p_names text[], p_name_keys text[], p_phones text[], p_emails text[])
returns table (
  id               uuid,
  role             public.candidate_role,
  name             text,
  name_norm        text,
  name_key         text,
  email_norm       text,
  primary_phone    text,
  stage_id         bigint,
  stage_name       text,
  stage_position   int,
  interviewer_id   bigint,
  interviewer_name text,
  interview_at     timestamptz
)
language sql stable security invoker set search_path = ''
as $$
  with c as (
    select c.*,
           split_part(c.name_norm, ' ', 1) || ' ' || (string_to_array(c.name_norm, ' '))[array_length(string_to_array(c.name_norm, ' '), 1)] as key
    from public.candidates c
  )
  select c.id, c.role, c.name, c.name_norm, c.key, c.email_norm, c.primary_phone, c.stage_id, s.name, s.position,
         c.interviewer_id, i.name, c.interview_at
  from c
  join public.stages s on s.id = c.stage_id
  left join public.interviewers i on i.id = c.interviewer_id
  where c.name_norm = any (coalesce(p_names, '{}'))
     or c.key = any (coalesce(p_name_keys, '{}'))
     or c.primary_phone = any (coalesce(p_phones, '{}'))
     or c.email_norm = any (coalesce(p_emails, '{}'));
$$;

revoke execute on function public.find_candidates_for_list(text[], text[], text[], text[]) from public, anon;
grant execute on function public.find_candidates_for_list(text[], text[], text[], text[]) to authenticated;
