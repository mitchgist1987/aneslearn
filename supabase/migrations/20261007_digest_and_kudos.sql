-- Two-week digest (per class year, with ACCRAC + readings) and anonymous kudos.
-- STATUS: applied to production 2026-10-07 EXCEPT the two DROP statements below
-- (trigger "Kudos" and the 6-arg send_kudos_email), which were blocked and are pending the owner's OK.
-- Sender comes from settings.email_from (cuaneslearn.com is verified in Resend).

create or replace function public._digest_esc(t text) returns text
language sql immutable as $$
  select replace(replace(replace(coalesce(t,''),'&','&amp;'),'<','&lt;'),'>','&gt;')
$$;

-- Weekly send, looks 14 days ahead, one personalised email per resident.
-- Test:  select send_weekly_digest('you@example.com','CA-2');   -- sends only to that address
create or replace function public.send_weekly_digest(p_test_to text default null, p_as_year text default null)
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_key text; v_from text; v_url text;
  v_today date := (now() at time zone 'America/Denver')::date;
  v_end   date := (now() at time zone 'America/Denver')::date + 14;
  r record; m record;
  v_rows text; v_n int; v_sent int := 0;
  v_pod text; v_read text; v_seen text[]; v_ln text;
  v_html text; v_subject text;
  v_batch jsonb := '[]'::jsonb;
begin
  select replace(value,'"','') into v_key  from settings where key = 'resend_api_key';
  select replace(value,'"','') into v_from from settings where key = 'email_from';
  select replace(value,'"','') into v_url  from settings where key = 'app_url';

  if v_key is null or v_key = '' or v_from is null or v_from = '' or v_from ilike '%resend.dev%' then
    raise notice 'Digest not sent: resend_api_key / email_from not configured';
    return 0;
  end if;

  for r in
    select id, name, email, year, coalesce(enrolled,'[]'::jsonb) as enrolled
    from residents
    where p_test_to is null and coalesce(email,'') <> ''
    union all
    select 'test', 'Test', p_test_to, coalesce(p_as_year,'CA-1'), '[]'::jsonb
    where p_test_to is not null
  loop
    v_rows := ''; v_n := 0;

    for m in
      select * from (
        select c.id as cid, c.data->>'title' as ctitle, c.data->>'icon' as icon, c.data->>'time' as ctime,
               mo.value as mod,
               case when mo.value->>'date' ~ '^\d{1,2}/\d{1,2}/\d{4}$'
                    then to_date(mo.value->>'date','FMMM/FMDD/YYYY') end as d
        from courses c, jsonb_array_elements(c.data->'modules') mo
        where coalesce(c.data->>'archived','false') <> 'true'
          and ( (c.data->'audience') @> to_jsonb(r.year::text)
                or c.id::text in (select jsonb_array_elements_text(r.enrolled)) )
          and ( coalesce(mo.value->>'level','') = ''
                or mo.value->>'level' = replace(r.year,'-','') )
      ) x
      where d between v_today and v_end
      order by d, cid
    loop
      v_n := v_n + 1;
      v_pod := ''; v_read := ''; v_seen := '{}';

      for v_ln in
        select trim(l) from unnest(string_to_array(coalesce(m.mod->>'reading',''), E'\n')) l
      loop
        continue when v_ln = '' or left(v_ln,1) = '[' or v_ln = any(v_seen);
        v_seen := v_seen || v_ln;
        if v_ln ilike 'ACCRAC:%' then
          v_pod := v_pod || '<div style="font-size:12px;color:#7A5C00;margin-top:4px;">🎧 ' || _digest_esc(v_ln) || '</div>';
        else
          v_read := v_read || '<div style="font-size:12px;color:#666;margin-top:4px;">📖 ' || _digest_esc(v_ln) || '</div>';
        end if;
      end loop;

      v_rows := v_rows ||
        '<tr><td style="padding:14px 12px;border-bottom:1px solid #F0EDE8;vertical-align:top;width:70px;text-align:center;">'
        || '<div style="font-size:11px;font-weight:700;color:#A8924A;text-transform:uppercase;">' || to_char(m.d,'Mon') || '</div>'
        || '<div style="font-size:24px;font-weight:800;color:#1B1B1B;line-height:1.1;">' || to_char(m.d,'FMDD') || '</div>'
        || '<div style="font-size:11px;color:#aaa;">' || to_char(m.d,'Dy') || '</div></td>'
        || '<td style="padding:14px 12px;border-bottom:1px solid #F0EDE8;vertical-align:top;">'
        || '<div style="font-size:14px;font-weight:700;color:#1B1B1B;">' || _digest_esc(m.mod->>'title') || '</div>'
        || '<div style="font-size:12px;color:#888;margin-top:2px;">' || coalesce(m.icon,'') || ' ' || _digest_esc(m.ctitle)
        || coalesce(' · ' || nullif(m.ctime,''),'')
        || ' · ' || coalesce(nullif(_digest_esc(m.mod->>'faculty'),''),'Speaker TBD') || '</div>'
        || v_pod || v_read || '</td></tr>';
    end loop;

    continue when v_n = 0;   -- nothing for this class in the next two weeks: don't email

    v_subject := '📅 AnesLearn: ' || v_n || ' session' || case when v_n > 1 then 's' else '' end
                 || ' in the next two weeks';

    v_html := '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>'
      || '<body style="margin:0;padding:0;background:#F4F2EE;font-family:Arial,sans-serif;">'
      || '<div style="max-width:600px;margin:32px auto;padding:0 16px;">'
      || '<div style="background:#1B1B1B;border-radius:14px 14px 0 0;padding:26px 30px;">'
      || '<div style="color:#CFB87C;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;">Two-Week Look Ahead</div>'
      || '<div style="color:#fff;font-size:21px;font-weight:800;margin:4px 0;">Hi ' || _digest_esc(split_part(r.name,' ',1)) || ' — here''s what''s coming up</div>'
      || '<div style="color:rgba(255,255,255,.55);font-size:13px;">' || to_char(v_today,'Mon FMDD') || ' – ' || to_char(v_end,'Mon FMDD, YYYY') || '</div></div>'
      || '<div style="background:#fff;border-radius:0 0 14px 14px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">'
      || '<table style="width:100%;border-collapse:collapse;"><tbody>' || v_rows || '</tbody></table>'
      || '<div style="padding:22px 28px;background:#FAF3DF;border-top:1px solid #E8D9A0;">'
      || '<a href="' || coalesce(v_url,'') || '" style="display:inline-block;background:#1B1B1B;color:#CFB87C;text-decoration:none;padding:11px 24px;border-radius:8px;font-weight:700;font-size:13px;">Open AnesLearn →</a></div></div>'
      || '<div style="text-align:center;padding:18px;font-size:11px;color:#aaa;">CU Anesthesiology Residency · AnesLearn</div>'
      || '</div></body></html>';

    v_batch := v_batch || jsonb_build_array(jsonb_build_object(
      'from', v_from, 'to', jsonb_build_array(r.email), 'subject', v_subject, 'html', v_html));
    v_sent := v_sent + 1;

    if jsonb_array_length(v_batch) >= 100 then
      perform net.http_post(url := 'https://api.resend.com/emails/batch',
        headers := jsonb_build_object('Authorization','Bearer '||v_key,'Content-Type','application/json'),
        body := v_batch);
      v_batch := '[]'::jsonb;
    end if;
  end loop;

  if jsonb_array_length(v_batch) > 0 then
    perform net.http_post(url := 'https://api.resend.com/emails/batch',
      headers := jsonb_build_object('Authorization','Bearer '||v_key,'Content-Type','application/json'),
      body := v_batch);
  end if;

  return v_sent;
end;
$fn$;

revoke execute on function public.send_weekly_digest(text,text) from public, anon, authenticated;

-- Kudos: anonymous. One email trigger, push without the giver's name, no placeholder webhook.
drop trigger if exists "Kudos" on public.kudos;
drop function if exists public.send_kudos_email(text,text,text,text,text,text);

create or replace function public.send_kudos_email() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare v_key text; v_from text; v_url text; v_email text; v_name text;
begin
  select replace(value,'"','') into v_key  from settings where key = 'resend_api_key';
  select replace(value,'"','') into v_from from settings where key = 'email_from';
  select replace(value,'"','') into v_url  from settings where key = 'app_url';
  select email, name into v_email, v_name from residents where id = NEW.recipient_id;
  if coalesce(v_email,'') = '' or coalesce(v_key,'') = '' or coalesce(v_from,'') = '' or v_from ilike '%resend.dev%' then
    return NEW;
  end if;
  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization','Bearer '||v_key,'Content-Type','application/json'),
    body := jsonb_build_object(
      'from', v_from,
      'to', jsonb_build_array(v_email),
      'subject', coalesce(NEW.badge_emoji,'⭐') || ' You got a Kudos — ' || coalesce(NEW.badge_label,'Kudos') || '!',
      'html',
        '<div style="max-width:520px;margin:32px auto;font-family:Arial,sans-serif;">'
        || '<div style="background:#1B1B1B;border-radius:14px 14px 0 0;padding:26px;text-align:center;">'
        || '<div style="font-size:36px;">' || coalesce(NEW.badge_emoji,'⭐') || '</div>'
        || '<div style="color:#fff;font-size:21px;font-weight:800;">You received a kudos!</div></div>'
        || '<div style="background:#fff;padding:28px;border-radius:0 0 14px 14px;border:1px solid #eee;">'
        || '<p style="font-size:15px;color:#333;">Hey <strong>' || _digest_esc(split_part(v_name,' ',1)) || '</strong>, a colleague recognized you with <strong>' || _digest_esc(NEW.badge_label) || '</strong>.</p>'
        || '<div style="background:#FAF3DF;border:1px solid #E8D9A0;border-radius:10px;padding:18px;font-style:italic;color:#333;">&ldquo;' || _digest_esc(NEW.message) || '&rdquo;</div>'
        || '<p style="font-size:12px;color:#aaa;">Kudos are anonymous.</p>'
        || '<a href="' || coalesce(v_url,'') || '" style="display:inline-block;background:#1B1B1B;color:#CFB87C;text-decoration:none;padding:11px 24px;border-radius:8px;font-weight:700;font-size:13px;">View in AnesLearn →</a>'
        || '</div></div>'));
  return NEW;
end; $fn$;

-- Push only (email is handled by on_kudos_insert_email); giver stays anonymous.
create or replace function public.notify_kudos_recipient() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  perform send_push_to_resident(
    NEW.recipient_id,
    '🏆 You received a Kudos!',
    'A colleague recognized you: "' || left(coalesce(NEW.message,''), 80) || '"',
    '/kudos');
  return NEW;
end; $fn$;
