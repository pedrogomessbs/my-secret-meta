// /api/webhook-duckfy.js
// Recebe o callback da Duckfy quando status muda.
// Quando evento === "TRANSACTION_PAID": dispara Purchase no Meta CAPI (server-side).
//
// Diferencia main / upsell / downsell via metadata.flow.

import crypto from 'crypto';
import { notifyUtmify } from './_utmify.js';

function hashSha256(value) {
  if (!value) return undefined;
  return crypto.createHash('sha256').update(String(value).trim().toLowerCase()).digest('hex');
}

function normalizePhone(phone) {
  if (!phone) return undefined;
  const digits = String(phone).replace(/\D/g, '');
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

    // Estrutura REAL do webhook Duckfy (confirmada na doc):
    // { event, token, transaction: { id, status, amount, externalRef, customer, pix, trackProps }, timestamp }
    const event = payload.event || payload.type || '';
    const tx = payload.transaction || payload.data || payload;

    const txId = tx.id || tx.transactionId;
    const externalRef = tx.externalRef || tx.identifier || ''; // = nosso identifier MS-xxx
    const rawStatus = String(tx.status || '').toLowerCase(); // "COMPLETED" quando pago
    const amountReais = Number(tx.amount) || 0; // Duckfy = reais
    const client = tx.customer || tx.client || {}; // Duckfy usa "customer"
    const trackProps = tx.trackProps || tx.metadata || {}; // Duckfy usa "trackProps"

    // O flow (main/upsell/downsell) é detectado pelo prefixo do externalRef
    // (MS-UPSELL-xxx, MS-DOWNSELL-xxx, MS-xxx). trackProps não carrega nosso metadata custom.
    let detectedFlow = 'main';
    if (/^MS-UPSELL-/i.test(externalRef)) detectedFlow = 'upsell';
    else if (/^MS-DOWNSELL-/i.test(externalRef)) detectedFlow = 'downsell';

    // metadata normalizado (compat com resto do código)
    const metadata = {
      flow: detectedFlow,
      order_ref: externalRef, // casa com o orderId do waiting_payment
      bump: trackProps.bump || '0',
      utm_source: trackProps.utm_source || trackProps.src || '',
      utm_medium: trackProps.utm_medium || '',
      utm_campaign: trackProps.utm_campaign || trackProps.campaignId || '',
      utm_content: trackProps.utm_content || '',
      utm_term: trackProps.utm_term || '',
      src: trackProps.src || trackProps.source || '',
      sck: trackProps.sck || '',
      fbp: trackProps.fbp || '',
      fbc: trackProps.fbc || ''
    };

    console.log('[webhook] received:', { event, txId, externalRef, rawStatus, amountReais, flow: detectedFlow });

    if (!txId) {
      return res.status(200).json({ received: true, note: 'no_tx_id' });
    }

    // Dispara Purchase quando pago — detecta por evento OU por status (defensivo)
    // Duckfy: event "TRANSACTION_PAID" + status "COMPLETED"
    const isPaid = /TRANSACTION_PAID|paid|completed|approved/i.test(event)
                || /paid|completed|approved|success/i.test(rawStatus);

    if (isPaid) {
      const PIXEL_ID = process.env.META_PIXEL_ID || '2780957048709348';
      const ACCESS_TOKEN = process.env.META_CAPI_TOKEN;

      const valueBRL = amountReais;
      const nameParts = String(client.name || '').trim().split(/\s+/);
      const firstName = nameParts[0] || '';
      const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

      // flow já detectado acima via externalRef
      const flow = metadata.flow;
      let contentName, contentIds, numItems;

      if (flow === 'upsell') {
        contentName = 'Gel Hot (upsell)';
        contentIds = ['mysecret-gelhot-upsell'];
        numItems = 1;
      } else if (flow === 'downsell') {
        contentName = 'Gel Hot (downsell)';
        contentIds = ['mysecret-gelhot-downsell'];
        numItems = 1;
      } else {
        contentName = metadata.bump === '1' ? 'My Secret + K-Med' : 'My Secret';
        contentIds = metadata.bump === '1' ? ['mysecret-main', 'mysecret-kmed'] : ['mysecret-main'];
        numItems = metadata.bump === '1' ? 3 : 2;
      }

      // client.document na Duckfy é string simples
      const cpf = client.document || client?.document?.number;

      await sendMetaCapiEvent({
        pixelId: PIXEL_ID,
        accessToken: ACCESS_TOKEN,
        eventName: 'Purchase',
        eventId: txId, // deduplica com pixel client-side
        customerData: {
          email: client.email,
          phone: client.phone,
          firstName,
          lastName,
          cpf: cpf,
          fbp: metadata.fbp,
          fbc: metadata.fbc,
          userAgent: req.headers['user-agent'],
          ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip']
        },
        customData: {
          currency: 'BRL',
          value: valueBRL,
          content_name: contentName,
          content_ids: contentIds,
          content_category: 'wellness',
          num_items: numItems,
          transaction_id: txId,
          flow: flow
        }
      });

      // Notifica UTMify: pedido PAGO (mesmo orderId do waiting_payment via order_ref)
      const utmifyProducts = (flow === 'upsell' || flow === 'downsell')
        ? [{ id: contentIds[0], name: contentName, quantity: 1, priceReais: valueBRL }]
        : (metadata.bump === '1'
            ? [
                { id: 'mysecret-main', name: 'My Secret 2 em 1 + Brinde', quantity: 1, priceReais: 47.90 },
                { id: 'mysecret-kmed', name: 'Gel K-Med 2 em 1', quantity: 1, priceReais: 19.90 }
              ]
            : [{ id: 'mysecret-main', name: 'My Secret 2 em 1 + Brinde', quantity: 1, priceReais: 47.90 }]);

      await notifyUtmify({
        orderId: metadata.order_ref || txId, // casa com o waiting_payment
        status: 'paid',
        amountReais: valueBRL,
        customer: {
          name: client.name || '',
          email: client.email || '',
          phone: client.phone || '',
          document: cpf || ''
        },
        products: utmifyProducts,
        tracking: {
          utm_source: metadata.utm_source, utm_medium: metadata.utm_medium,
          utm_campaign: metadata.utm_campaign, utm_content: metadata.utm_content,
          utm_term: metadata.utm_term, src: metadata.src, sck: metadata.sck
        },
        createdAt: new Date(),
        approvedAt: new Date()
      });
    }

    // Duckfy precisa de 2XX sempre — senão reenvia
    return res.status(200).json({ received: true });

  } catch (err) {
    console.error('[webhook] Exception:', err);
    return res.status(200).json({ received: true, error: err.message });
  }
}
