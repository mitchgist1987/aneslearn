// admin-users: lets an AnesLearn admin manage resident logins from the site itself.
// Runs with the service role, so it must verify the caller is an admin on every request.
// The one exception is action "setup", which only works while NO admin exists yet.
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function tempPassword(len = 10) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}
const okEmail = (e: unknown) => typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
const okPassword = (p: unknown) => typeof p === "string" && p.length >= 8 && p.length <= 72;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const action = body?.action;

  async function allUsers() {
    const out: any[] = [];
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw error;
      out.push(...data.users);
      if (data.users.length < 1000) break;
    }
    return out;
  }

  try {
    // ── First-run bootstrap: only while there is no admin at all ───────────────
    if (action === "setup") {
      const { count } = await admin.from("profiles").select("*", { count: "exact", head: true }).eq("role", "admin");
      if ((count ?? 0) > 0) return json({ error: "Setup already completed" }, 403);
      const email = String(body.email || "").trim().toLowerCase();
      if (!okEmail(email) || !okPassword(body.password)) return json({ error: "Valid email and 8+ char password required" }, 400);
      const { data, error } = await admin.auth.admin.createUser({ email, password: body.password, email_confirm: true });
      if (error) return json({ error: error.message }, 400);
      const { error: pe } = await admin.from("profiles").upsert({ user_id: data.user.id, resident_id: body.resident_id || null, role: "admin" });
      if (pe) return json({ error: pe.message }, 500);
      return json({ ok: true, user_id: data.user.id });
    }

    // ── Everything else: caller must be a signed-in admin ──────────────────────
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: who } = await admin.auth.getUser(token);
    const caller = who?.user;
    if (!caller) return json({ error: "Not signed in" }, 401);
    const { data: prof } = await admin.from("profiles").select("role").eq("user_id", caller.id).maybeSingle();
    if (prof?.role !== "admin") return json({ error: "Admins only" }, 403);

    if (action === "list") {
      const [users, { data: profs }] = await Promise.all([allUsers(), admin.from("profiles").select("user_id,resident_id,role")]);
      const byId = new Map((profs || []).map((p: any) => [p.user_id, p]));
      return json({
        users: users.map((u: any) => ({
          user_id: u.id, email: u.email, last_sign_in_at: u.last_sign_in_at,
          resident_id: byId.get(u.id)?.resident_id ?? null, role: byId.get(u.id)?.role ?? null,
        })),
      });
    }

    if (action === "create") {
      const email = String(body.email || "").trim().toLowerCase();
      const role = body.role === "admin" ? "admin" : "resident";
      if (!okEmail(email)) return json({ error: "Valid email required" }, 400);
      const password = body.password || tempPassword();
      if (!okPassword(password)) return json({ error: "Password must be 8-72 characters" }, 400);
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) return json({ error: error.message }, 400);
      const { error: pe } = await admin.from("profiles").upsert({ user_id: data.user.id, resident_id: body.resident_id || null, role });
      if (pe) { await admin.auth.admin.deleteUser(data.user.id); return json({ error: pe.message }, 400); }
      return json({ ok: true, user_id: data.user.id, email, password });
    }

    if (action === "set_password") {
      if (!body.user_id || !okPassword(body.password)) return json({ error: "user_id and an 8-72 character password required" }, 400);
      const { error } = await admin.auth.admin.updateUserById(body.user_id, { password: body.password });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === "reset_password") { // generate a fresh temporary password and return it once
      if (!body.user_id) return json({ error: "user_id required" }, 400);
      const password = tempPassword();
      const { error } = await admin.auth.admin.updateUserById(body.user_id, { password });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, password });
    }

    if (action === "set_role") {
      if (!body.user_id || !["admin", "resident"].includes(body.role)) return json({ error: "user_id and role required" }, 400);
      if (body.user_id === caller.id && body.role !== "admin") return json({ error: "You cannot remove your own admin access" }, 400);
      const { error } = await admin.from("profiles").update({ role: body.role }).eq("user_id", body.user_id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === "delete") {
      if (!body.user_id) return json({ error: "user_id required" }, 400);
      if (body.user_id === caller.id) return json({ error: "You cannot delete your own login" }, 400);
      const { error } = await admin.auth.admin.deleteUser(body.user_id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    // Create logins for many residents at once; returns temporary passwords exactly once.
    if (action === "bulk_create") {
      const rows: { resident_id: string; email: string }[] = Array.isArray(body.residents) ? body.residents : [];
      if (!rows.length || rows.length > 500) return json({ error: "1-500 residents required" }, 400);
      const existing = await allUsers();
      const emails = new Set(existing.map((u: any) => String(u.email || "").toLowerCase()));
      const { data: linked } = await admin.from("profiles").select("resident_id").not("resident_id", "is", null);
      const linkedIds = new Set((linked || []).map((p: any) => p.resident_id));
      const results: any[] = [];
      for (const r of rows) {
        const email = String(r.email || "").trim().toLowerCase();
        if (!r.resident_id || !okEmail(email)) { results.push({ resident_id: r.resident_id, email, status: "skipped: missing or invalid email" }); continue; }
        if (linkedIds.has(r.resident_id)) { results.push({ resident_id: r.resident_id, email, status: "skipped: already has a login" }); continue; }
        if (emails.has(email)) { results.push({ resident_id: r.resident_id, email, status: "skipped: email already used by another login" }); continue; }
        const password = tempPassword();
        const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
        if (error) { results.push({ resident_id: r.resident_id, email, status: "error: " + error.message }); continue; }
        const { error: pe } = await admin.from("profiles").upsert({ user_id: data.user.id, resident_id: r.resident_id, role: "resident" });
        if (pe) { await admin.auth.admin.deleteUser(data.user.id); results.push({ resident_id: r.resident_id, email, status: "error: " + pe.message }); continue; }
        emails.add(email); linkedIds.add(r.resident_id);
        results.push({ resident_id: r.resident_id, email, password, status: "created" });
      }
      return json({ ok: true, results });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
