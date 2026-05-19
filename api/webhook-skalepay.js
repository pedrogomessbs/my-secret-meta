// /api/webhook-skalepay.js
// Recebe o POSTBACK da SkalePay quando status muda.
// Quando status === "paid": dispara Purchase event no Meta CAPI (server-side).
//
// Por que CAPI: iOS 14.5+ e ad blockers bloqueiam 30-40% dos eventos client-side.
// CAPI server-side dobra a captura de conversão.

import crypto from 'crypto';

function hashSha256(value) {
  if (!value) return undefined;
  return crypto.createHash('sha256').update(String(value).trim().toLowerCase()).digest('hex');
}

function normalizePhone(phone) {
  if (!phone) return undefined;
  const digits = String(phone).replace(/\D/g, '');
  // Meta espera com código do país, sem '+'
  return digits.length === 11 ? '55' + digits : digits;
}

async function sendMetaCapiEvent({ pixelId, accessToken, eventName, eventId, customerData, customData, eventSourceUrl }) {
  if (!pixelId || !accessToken) {
    console.log('[webhook] Meta CAPI not configured — skipping');
    return { skipped: true };
  }

  const userData = {
    em: customerData.email ? [hashSha256(customerData.email)] : undefined,
    ph: customerData.phone ? [hashSha256(normalizePhone(customerData.phone))] : undefined,
    fn: customerData.firstName ? [hashSha256(customerData.firstName)] : undefined,
    ln: customerData.lastName ? [hashSha256(customerData.lastName)] : undefined,
    external_id: customerData.cpf ? [hashSha256(customerData.cpf)] : undefined,
    fbp: customerData.fbp || undefined,
    fbc: customerData.fbc || undefined,
    client_user_agent: customerData.userAgent || undefined,
    client_ip_address: customerData.ip || undefined,
    country: ['62725a8b07a223617aedf6ce8aa61f6b8da4f3acfdeaf3a7745f4ad7d4d0a3a4'] // BR sha256
  };

  // Remove campos undefined
  Object.keys(userData).forEach(k => userData[k] === undefined && delete userData[k]);

  const eventData = {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: eventId,
    action_source: 'website',
    event_source_url: eventSourceUrl || 'https://my-secret-red.vercel.app/obrigado/',
    user_data: userData,
    custom_data: customData
  };

  const url = `https://graph.facebook.com/v18.0/${pixelId}/events?access_token=${accessToken}`;

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [eventData] })
    });
    const result = await resp.json();
    if (!resp.ok) {
      console.error('[webhook] Meta CAPI error:', resp.status, result);
      return { ok: false, error: result };
    }
    console.log('[webhook] Meta CAPI Purchase sent:', result);
    return { ok: true, result };
  } catch (err) {
    console.error('[webhook] Meta CAPI exception:', err);
    return { ok: false, error: err.message };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    const payload = req.body || {};
    const txId = payload.id;
    const status = payload.status;
    const amountCents = payload.amount;
    const customer = payload.customer || {};
    const metadata = payload.metadata || {};

    console.log('[webhook] received:', { txId, status, amountCents });

    if (!txId || !status) {
      return res.status(400).json({ error: 'invalid_payload' });
    }

    // Dispara CAPI Purchase apenas quando paid
    if (status === 'paid') {
      const PIXEL_ID = process.env.META_PIXEL_ID || '2780957048709348';
      const ACCESS_TOKEN = process.env.META_CAPI_TOKEN;

      const valueBRL = amountCents ? (amountCents / 100) : 0;
      const nameParts = String(customer.name || '').trim().split(/\s+/);
      const firstName = nameParts[0] || '';
      const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

      await sendMetaCapiEvent({
        pixelId: PIXEL_ID,
        accessToken: ACCESS_TOKEN,
        eventName: 'Purchase',
        eventId: txId, // CRÍTICO: deduplica com pixel client-side
        customerData: {
          email: customer.email,
          phone: customer.phone,
          firstName,
          lastName,
          cpf: customer?.document?.number,
          fbp: metadata.fbp,
          fbc: metadata.fbc,
          userAgent: req.headers['user-agent'],
          ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip']
        },
        customData: {
          currency: 'BRL',
          value: valueBRL,
          content_name: metadata.bump === '1' ? 'My Secret + K-Med' : 'My Secret',
          content_category: 'wellness',
          num_items: metadata.bump === '1' ? 3 : 2,
          transaction_id: txId
        }
      });
    }

    // SkalePay precisa de 200 sempre — senão fica reenviando
    return res.status(200).json({ received: true });

  } catch (err) {
    console.error('[webhook] Exception:', err);
    return res.status(200).json({ received: true, error: err.message }); // 200 sempre
  }
}
