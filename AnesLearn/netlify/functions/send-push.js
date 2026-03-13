// netlify/functions/send-push.js
// Handles both push notification delivery AND kudos email
// Called by Supabase DB Webhook on kudos INSERT

const crypto = globalThis.crypto;

function b64urlEncode(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
function b64urlDecode(str) {
  const pad = str.length % 4;
  const padded = pad ? str + '='.repeat(4 - pad) : str;
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

async function buildVapidJWT(audience, subject, publicKey, privateKeyB64) {
  const header  = b64urlEncode(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const now     = Math.floor(Date.now() / 1000);
  const payload = b64urlEncode(Buffer.from(JSON.stringify({ aud: audience, exp: now + 86400, sub: subject })));
  const pubBytes = b64urlDecode(publicKey);
  const x = b64urlEncode(pubBytes.slice(1, 33));
  const y = b64urlEncode(pubBytes.slice(33, 65));
  const jwk = { kty: 'EC', crv: 'P-256', d: privateKeyB64, x, y };
  const signingKey = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sigInput = `${header}.${payload}`;
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingKey, Buffer.from(sigInput));
  return `${sigInput}.${b64urlEncode(signature)}`;
}

async function supabaseFetch(path) {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      'apikey': process.env.SUPABASE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_KEY}`,
    }
  });
  return res.json();
}

async function getSetting(key) {
  const rows = await supabaseFetch(`settings?key=eq.${encodeURIComponent(key)}&select=value&limit=1`);
  if (!rows?.length) return null;
  try { return JSON.parse(rows[0].value); } catch { return rows[0].value; }
}

async function getResident(id) {
  const rows = await supabaseFetch(`residents?id=eq.${encodeURIComponent(id)}&select=name,email&limit=1`);
  return rows?.[0] || null;
}

async function sendPush(subscription, payloadObj) {
  const PRIV    = process.env.VAPID_PRIVATE_KEY;
  const PUB     = process.env.VAPID_PUBLIC_KEY;
  const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';
  if (!PRIV || !PUB) throw new Error('VAPID keys not configured');

  const endpoint   = subscription.endpoint;
  const origin     = new URL(endpoint).origin;
  const jwt        = await buildVapidJWT(origin, SUBJECT, PUB, PRIV);
  const payloadBuf = Buffer.from(JSON.stringify(payloadObj));

  return fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization':  `vapid t=${jwt},k=${PUB}`,
      'Content-Type':   'application/json',
      'Content-Length': String(payloadBuf.length),
      'TTL':            '86400',
    },
    body: payloadBuf,
  });
}

async function sendEmail({ to, subject, giverName, firstName, badgeEmoji, badgeLabel, message, resendKey }) {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#F4F2EE;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F2EE;padding:32px 16px;"><tr><td>
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;">
  <tr><td style="background:#1B1B1B;border-radius:12px 12px 0 0;padding:20px 28px;">
    <table cellpadding="0" cellspacing="0"><tr>
      <td style="width:34px;height:34px;background:#CFB87C;border-radius:8px;text-align:center;vertical-align:middle;font-size:17px;font-weight:800;color:#1B1B1B;">A</td>
      <td style="padding-left:12px;font-size:17px;font-weight:800;color:#fff;">AnesLearn</td>
    </tr></table>
  </td></tr>
  <tr><td style="background:#CFB87C;padding:10px 28px;">
    <span style="font-size:12px;font-weight:700;color:#1B1B1B;text-transform:uppercase;letter-spacing:.07em;">🏆 You Received a Kudos</span>
  </td></tr>
  <tr><td style="background:#fff;padding:28px 28px 24px;">
    <p style="margin:0 0 20px;font-size:15px;color:#333;line-height:1.65;">
      Hi <strong>${firstName}</strong>,<br><br>
      <strong>${giverName}</strong> just recognized you on AnesLearn.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#F9F7F3;border:1.5px solid #E2CFA0;border-radius:10px;margin-bottom:22px;">
      <tr><td style="padding:18px 20px;">
        <table cellpadding="0" cellspacing="0"><tr>
          <td style="font-size:36px;line-height:1;padding-right:14px;vertical-align:top;">${badgeEmoji}</td>
          <td style="vertical-align:top;">
            <div style="font-size:13px;font-weight:700;color:#A8924A;text-transform:uppercase;letter-spacing:.06em;">${badgeLabel}</div>
            <div style="font-size:11px;color:#aaa;margin-top:2px;">from ${giverName}</div>
          </td>
        </tr></table>
        <div style="margin-top:14px;padding-top:14px;border-top:1px solid #E8E5DF;font-size:14px;color:#333;line-height:1.7;font-style:italic;">&#8220;${message}&#8221;</div>
      </td></tr>
    </table>
    <a href="https://aneslearn.netlify.app" style="display:block;text-align:center;background:#1B1B1B;color:#CFB87C;text-decoration:none;padding:13px;border-radius:9px;font-weight:700;font-size:13px;">View in AnesLearn &rarr;</a>
  </td></tr>
  <tr><td style="background:#F9F7F3;border-radius:0 0 12px 12px;padding:14px 28px;border-top:1px solid #F0EDE8;">
    <p style="margin:0;font-size:11px;color:#bbb;">University of Colorado Anesthesiology Residency &middot; AnesLearn</p>
  </td></tr>
</table></td></tr></table></body></html>`;

  return fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${resendKey}`,
    },
    body: JSON.stringify({
      from:    'AnesLearn <onboarding@resend.dev>',
      to:      [to],
      subject,
      html,
    }),
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  const record = body.record;
  if (!record) return { statusCode: 400, body: 'No record' };

  const { recipient_id, from_id, badge_emoji, badge_label, message } = record;
  if (!recipient_id) return { statusCode: 200, body: 'No recipient_id' };

  const [recipient, giver, resendKey] = await Promise.all([
    getResident(recipient_id),
    from_id ? getResident(from_id) : Promise.resolve(null),
    getSetting('resend_api_key'),
  ]);

  const giverName  = giver?.name  || 'A colleague';
  const firstName  = recipient?.name?.split(' ')[0] || 'there';
  const results    = [];

  // ── Email ────────────────────────────────────────────────────────────────
  if (resendKey && recipient?.email) {
    try {
      const r = await sendEmail({
        to: recipient.email,
        subject: `${badge_emoji} ${giverName} recognized you in AnesLearn!`,
        giverName, firstName,
        badgeEmoji: badge_emoji || '⭐',
        badgeLabel: badge_label || 'Kudos',
        message: message || '',
        resendKey,
      });
      results.push(`email:${r.status}`);
    } catch(e) { results.push(`email:error:${e.message}`); }
  } else {
    results.push('email:skipped');
  }

  // ── Push ─────────────────────────────────────────────────────────────────
  try {
    const subRaw = await getSetting('push_' + recipient_id);
    if (subRaw) {
      const sub = typeof subRaw === 'string' ? JSON.parse(subRaw) : subRaw;
      const r = await sendPush(sub, {
        title: '🏆 You received a Kudos!',
        body:  `${giverName} recognized you: "${(message||'').slice(0, 80)}"`,
        url:   '/kudos',
      });
      results.push(`push:${r.status}`);
    } else {
      results.push('push:no-subscription');
    }
  } catch(e) { results.push(`push:error:${e.message}`); }

  console.log('kudos notify results:', results.join(', '));
  return { statusCode: 200, body: results.join(', ') };
};
