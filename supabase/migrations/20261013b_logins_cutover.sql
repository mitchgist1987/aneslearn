-- Stage B (CUTOVER): turn on row-level security with real rules.
-- Apply ONLY after (1) 20261013a is applied, (2) the admin-users edge function is deployed,
-- (3) the new frontend (real logins) is live, and (4) the admin has created logins for residents.
-- Applying this with the OLD frontend still live will lock that frontend out.

-- 0. Obsolete PIN data (replaced by real logins). Plaintext resident PINs and the admin PIN hash go away.
delete from public.settings where key like 'pin\_%' or key = 'admin_pin_hash';

-- 1. Helper predicates (private schema: not callable via the REST API)
create or replace function private.public_setting(k text) returns boolean
language sql immutable set search_path = '' as $$
  select k in ('icsUrl','podcast_library','admin_resources','rotation_resources','professional_resources','green_book','quick_links');
$$;
create or replace function private.own_setting(k text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(starts_with(k, 'note_' || s.r || '_') or k = 'push_' || s.r, false)
  from (select private.my_resident() as r) s;
$$;
create or replace function private.admin_emails() returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(u.email), '{}') from auth.users u join public.profiles p on p.user_id = u.id
  where p.role = 'admin' and u.email is not null;
$$;
revoke all on function private.public_setting(text), private.own_setting(text), private.admin_emails() from public, anon;
grant execute on function private.public_setting(text), private.own_setting(text) to authenticated;

-- 2. Enable RLS and clear the old "allow all" policies
do $$
declare t text; p record;
begin
  foreach t in array array['courses','evaluations','events','kudos','progress','quizzes','residents','settings','suggestions'] loop
    execute format('alter table public.%I enable row level security', t);
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
  end loop;
end $$;

-- Signed-out visitors get nothing from the database.
revoke all on all tables in schema public from anon;

-- 3. Shared content: everyone signed in reads; only admins write
do $$
declare t text;
begin
  foreach t in array array['courses','events','quizzes','residents'] loop
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select private.is_admin()))', t || '_admin_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()))', t || '_admin_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select private.is_admin()))', t || '_admin_delete', t);
  end loop;
end $$;

-- 4. Progress: each resident sees and changes only their own rows (admins see all)
create policy progress_own on public.progress for all to authenticated
  using (resident_id = (select private.my_resident()) or (select private.is_admin()))
  with check (resident_id = (select private.my_resident()) or (select private.is_admin()));

-- 5. Kudos: everyone reads the wall, but the giver column is unreadable by any client, so kudos are truly anonymous
revoke all on public.kudos from anon, authenticated;
grant select (id, recipient_id, recipient_name, badge_id, badge_emoji, badge_label, message, ts, created_at) on public.kudos to authenticated;
grant insert, delete on public.kudos to authenticated;
create policy kudos_read on public.kudos for select to authenticated using (true);
create policy kudos_give on public.kudos for insert to authenticated with check (from_id = (select private.my_resident()) and length(message) <= 280);
create policy kudos_admin_delete on public.kudos for delete to authenticated using ((select private.is_admin()));

-- 6. Evaluations and suggestions: any signed-in user can submit (no identity is stored); only admins read or moderate
create policy evaluations_submit on public.evaluations for insert to authenticated with check (length(feedback) between 1 and 5000);
create policy evaluations_admin_read on public.evaluations for select to authenticated using ((select private.is_admin()));
create policy evaluations_admin_update on public.evaluations for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy evaluations_admin_delete on public.evaluations for delete to authenticated using ((select private.is_admin()));
create policy suggestions_submit on public.suggestions for insert to authenticated with check (length(feedback) between 1 and 5000);
create policy suggestions_admin_read on public.suggestions for select to authenticated using ((select private.is_admin()));
create policy suggestions_admin_update on public.suggestions for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy suggestions_admin_delete on public.suggestions for delete to authenticated using ((select private.is_admin()));

-- 7. Settings: shared content readable by all signed-in users; own notes/push subscription by their owner; everything else (API keys etc.) admin-only
create policy settings_read on public.settings for select to authenticated
  using ((select private.is_admin()) or private.public_setting(key) or private.own_setting(key));
create policy settings_insert on public.settings for insert to authenticated
  with check ((select private.is_admin()) or private.own_setting(key));
create policy settings_update on public.settings for update to authenticated
  using ((select private.is_admin()) or private.own_setting(key))
  with check ((select private.is_admin()) or private.own_setting(key));
create policy settings_delete on public.settings for delete to authenticated
  using ((select private.is_admin()) or private.own_setting(key));

-- 8. Server-side notification emails (these used to be sent from the browser using an exposed API key)
create or replace function private.notify_admin_feedback() returns trigger
language plpgsql security definer set search_path = public, extensions, net, pg_temp as $fn$
declare v_key text; v_from text; v_to text[]; v_subject text; v_title text; v_meta text; v_text text;
begin
  select replace(value,'"','') into v_key  from settings where key = 'resend_api_key';
  select replace(value,'"','') into v_from from settings where key = 'email_from';
  v_to := private.admin_emails();
  if coalesce(v_key,'') = '' or coalesce(v_from,'') = '' or v_from ilike '%resend.dev%' or coalesce(array_length(v_to,1),0) = 0 then
    return NEW;
  end if;
  if TG_TABLE_NAME = 'evaluations' then
    v_subject := 'New Eval: ' || coalesce(NEW.module_title,'');
    v_title := 'New Lecture Evaluation';
    v_meta := '<p><strong>Lecture:</strong> ' || _digest_esc(NEW.module_title) || '</p>';
  else
    v_subject := 'New Suggestion [' || coalesce(NEW.category,'General') || ']';
    v_title := 'New Suggestion Box Submission';
    v_meta := '<p><strong>Category:</strong> ' || _digest_esc(NEW.category) || '</p>';
  end if;
  v_text := replace(_digest_esc(NEW.feedback), E'\n', '<br>');
  begin
    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object('Authorization','Bearer '||v_key,'Content-Type','application/json'),
      body := jsonb_build_object('from', v_from, 'to', to_jsonb(v_to), 'subject', v_subject,
        'html', '<div style="font-family:sans-serif;max-width:560px;margin:0 auto;"><h2 style="color:#1B1B1B;">' || v_title || '</h2>'
          || v_meta || '<div style="background:#F4F2EE;border-radius:8px;padding:16px;margin:16px 0;"><p style="margin:0;font-size:15px;line-height:1.6;">'
          || v_text || '</p></div><p style="font-size:12px;color:#aaa;">Submitted anonymously via AnesLearn.</p></div>'));
  exception when others then null;  -- a failed notification must never block the submission
  end;
  return NEW;
end; $fn$;
revoke all on function private.notify_admin_feedback() from public, anon, authenticated;

drop trigger if exists trg_notify_admin_eval on public.evaluations;
create trigger trg_notify_admin_eval after insert on public.evaluations for each row execute function private.notify_admin_feedback();
drop trigger if exists trg_notify_admin_suggestion on public.suggestions;
create trigger trg_notify_admin_suggestion after insert on public.suggestions for each row execute function private.notify_admin_feedback();
