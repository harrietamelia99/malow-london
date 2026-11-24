// Shopify webhook (customers_marketing_consent/update) -> Resend welcome email
// Sends the 10% welcome email once to anyone who subscribes to email marketing,
// whether they signed up in the pop-up or ticked the box at checkout.
import crypto from 'node:crypto';

const {
  SHOPIFY_WEBHOOK_SECRET,
  RESEND_API_KEY,
  RESEND_SEGMENT_ID,
  FROM_EMAIL = 'MALOW London <support@malowlondon.com>',
  DISCOUNT_CODE = 'WELCOME10',
  SHOP_URL = 'https://malowlondon.com',
} = process.env;

function validHmac(rawBody, header) {
  if (!header || !SHOPIFY_WEBHOOK_SECRET) return false;
  const digest = crypto.createHmac('sha256', SHOPIFY_WEBHOOK_SECRET).update(rawBody, 'utf8').digest('base64');
  const a = Buffer.from(digest);
  const b = Buffer.from(header);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function resend(path, method = 'GET', body, extraHeaders = {}) {
  const res = await fetch(`https://api.resend.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json', ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function welcomeHtml(firstName) {
  const hi = firstName ? `Hi ${escapeHtml(firstName)},` : 'Hi there,';
  const display = "'Cormorant SC', 'Cormorant', Georgia, 'Times New Roman', serif";
  const body = "'Avenir Next', Avenir, 'Mulish', Helvetica, Arial, sans-serif";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<title>Welcome to MALOW</title>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+SC:wght@300;400;500&family=Mulish:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  body { margin: 0; padding: 0; background: #FDECEB; }
  a { color: #958989; }
  @media (max-width: 600px) {
    .card { border-radius: 16px !important; }
    .pad { padding-left: 24px !important; padding-right: 24px !important; }
    .h1 { font-size: 28px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#FDECEB;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Here's 10% off your first MALOW order.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FDECEB;padding:32px 12px;">
<tr><td align="center">
<table role="presentation" class="card" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:20px;border:0.5px solid #958989;font-family:${body};color:#958989;">

<tr><td align="center" class="pad" style="padding:40px 40px 0;">
<a href="${SHOP_URL}" style="text-decoration:none;"><img src="${SHOP_URL}/cdn/shop/files/malow-email-logo.png?width=600" width="200" alt="MALOW" style="display:block;width:200px;max-width:60%;height:auto;border:0;"></a>
<p style="margin:10px 0 0;font-family:${display};font-size:13px;letter-spacing:6px;color:#958989;">LONDON</p>
</td></tr>

<tr><td class="pad" style="padding:28px 40px 0;"><div style="height:0.5px;line-height:0.5px;background:#E7DAC7;">&nbsp;</div></td></tr>

<tr><td class="pad" style="padding:28px 40px 0;">
<a href="${SHOP_URL}/collections/shop-all" style="text-decoration:none;"><img src="${SHOP_URL}/cdn/shop/files/malow-email-taylor-gold.jpg?width=960" width="480" alt="MALOW Taylor heels in gold" style="display:block;width:100%;max-width:480px;height:auto;border:0;border-radius:14px;"></a>
</td></tr>

<tr><td align="center" class="pad" style="padding:28px 40px 0;">
<h1 class="h1" style="margin:0;font-family:${body};font-weight:400;font-size:32px;line-height:1.2;letter-spacing:0.5px;color:#958989;">Welcome to MALOW</h1>
<p style="margin:10px 0 0;font-family:${body};font-size:16px;line-height:1.5;color:#958989;">Where beautiful design meets comfort.</p>
</td></tr>

<tr><td class="pad" style="padding:28px 44px 0;font-size:15px;line-height:1.75;color:#958989;">
<p style="margin:0 0 14px;">${hi}</p>
<p style="margin:0 0 14px;">Thank you for joining us. MALOW heels are made for the moments that matter, with ultra soft memory foam footbeds and gentle arch support, so you can feel confident from the first step to the last dance.</p>
<p style="margin:0;">As a thank you, here's 10% off your first order.</p>
</td></tr>

<tr><td align="center" class="pad" style="padding:26px 40px 0;">
<table role="presentation" cellpadding="0" cellspacing="0" style="background:#FFF2EF;border:1px dashed #958989;border-radius:14px;">
<tr><td align="center" style="padding:16px 34px;">
<p style="margin:0 0 4px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#C5B8A6;">Your code</p>
<p style="margin:0;font-family:${body};font-size:24px;letter-spacing:6px;color:#958989;">${escapeHtml(DISCOUNT_CODE)}</p>
</td></tr></table>
</td></tr>

<tr><td align="center" class="pad" style="padding:24px 40px 40px;">
<a href="${SHOP_URL}/collections/shop-all" style="display:inline-block;padding:14px 36px;border-radius:14px;background:#FDECEB;border:0.5px solid #958989;color:#958989;text-decoration:none;font-size:13px;letter-spacing:2px;text-transform:uppercase;">Shop the collection</a>
</td></tr>

</table>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
<tr><td align="center" style="padding:22px 24px 0;font-family:${body};font-size:11px;line-height:1.7;color:#958989;">
Enter your code at checkout. One use per customer.<br>
You're receiving this because you signed up to hear from MALOW London.<br>
<a href="mailto:support@malowlondon.com?subject=Unsubscribe" style="color:#958989;">Unsubscribe</a>
</td></tr></table>

</td></tr></table>
</body></html>`;
}

export async function POST(request) {
  const raw = await request.text();
  if (!validHmac(raw, request.headers.get('x-shopify-hmac-sha256'))) {
    return new Response('Unauthorized', { status: 401 });
  }

  let customer;
  try { customer = JSON.parse(raw); } catch { return new Response('Bad JSON', { status: 400 }); }

  // customers/create|update send `email`; customers_marketing_consent/update sends `email_address`
  const email = (customer.email || customer.email_address || '').trim().toLowerCase();
  const consent = customer.email_marketing_consent?.state
    ?? customer.emailMarketingConsent?.marketingState
    ?? (customer.accepts_marketing === true ? 'subscribed' : undefined);
  const subscribed = String(consent || '').toLowerCase() === 'subscribed';
  const customerId = customer.customer_id ?? customer.id ?? email;
  console.log('customer webhook', { id: customerId, consent: consent ?? null, topic: request.headers.get('x-shopify-topic') });
  if (!email || !subscribed) {
    return Response.json({ skipped: 'not subscribed' });
  }

  // Already a Resend contact? Then they've had their welcome email.
  const existing = await resend(`/contacts/${encodeURIComponent(email)}`);
  if (existing.ok && existing.data?.email) {
    return Response.json({ skipped: 'already welcomed' });
  }

  // Send first (idempotent per customer for 24h), then save the contact,
  // so a failed send gets retried by Shopify rather than marked as done.
  const sent = await resend('/emails', 'POST', {
    from: FROM_EMAIL,
    to: [email],
    subject: 'Welcome to MALOW - here\'s 10% off',
    html: welcomeHtml(customer.first_name),
    headers: {
      'X-Entity-Ref-ID': `welcome-${customerId}`,
      'List-Unsubscribe': '<mailto:support@malowlondon.com?subject=Unsubscribe>',
    },
  }, { 'Idempotency-Key': `welcome-${customerId}` });
  if (!sent.ok) {
    console.error('Resend send error', sent.status, sent.data);
    return new Response('Send error', { status: 500 });
  }

  const added = await resend('/contacts', 'POST', {
    email,
    first_name: customer.first_name || undefined,
    last_name: customer.last_name || undefined,
    unsubscribed: false,
    ...(RESEND_SEGMENT_ID ? { segments: [{ id: RESEND_SEGMENT_ID }] } : {}),
  });
  if (!added.ok) {
    console.error('Resend contact error', added.status, added.data);
    return new Response('Contact error', { status: 500 }); // Shopify will retry
  }

  return Response.json({ sent: true });
}

export function GET() {
  return new Response('MALOW welcome email webhook is running');
}
