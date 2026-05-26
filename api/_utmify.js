// /api/_utmify.js
// Helper compartilhado: envia pedidos pra UTMify (Orders API).
// Usado em: create-pix, create-upsell-pix (waiting_payment) e webhook-duckfy (paid).
//
// Lifecycle: waiting_payment (PIX gerado) → paid (aprovado).
// Mesmo orderId (nosso identifier MS-xxx) nos dois momentos pra UTMify casar.

const UTMIFY_URL = process.env.UTMIFY_API_URL || 'https://api.utmify.com.br/api-credentials/orders';

// Formata data no padrão UTMify: "YYYY-MM-DD HH:MM:SS" em UTC
function utmifyDate(d) {
  const dt = d || new Date();
  return dt.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Notifica a UTMify sobre um pedido.
 * @param {object} opts
 *   orderId      - nosso identifier (MS-xxx) — MESMO nos 2 momentos
 *   status       - 'waiting_payment' | 'paid'
 *   amountReais  - valor em REAIS (ex: 47.90)
 *   customer     - { name, email, phone, document }
 *   products     - [{ id, name, quantity, priceReais }]
 *   tracking     - { utm_source, utm_medium, utm_campaign, utm_content, utm_term, src, sck }
 *   createdAt    - Date opcional (quando o PIX foi criado)
 *   approvedAt   - Date opcional (quando pago)
 */
export async function notifyUtmify(opts) {
  const TOKEN = process.env.UTMIFY_API_TOKEN;
  if (!TOKEN) {
    console.log('[utmify] UTMIFY_API_TOKEN não configurado — skip');
    return { skipped: true };
  }

  const {
    orderId, status, amountReais, customer = {}, products = [],
    tracking = {}, createdAt, approvedAt
  } = opts;

  const totalCents = Math.round(Number(amountReais || 0) * 100);

  const payload = {
    orderId: orderId,
    platform: 'MySecret',
    paymentMethod: 'pix',
    status: status, // 'waiting_payment' | 'paid'
    createdAt: utmifyDate(createdAt),
    approvedDate: status === 'paid' ? utmifyDate(approvedAt) : null,
    refundedAt: null,
    customer: {
      name: customer.name || '',
      email: customer.email || '',
      phone: customer.phone || '',
      document: customer.document || ''
    },
    products: (products.length ? products : [{ id: 'mysecret', name: 'My Secret', quantity: 1, priceReais: amountReais }])
      .map(function(p){
        return {
          id: p.id || 'item',
          name: p.name || 'Item',
          planId: null,
          planName: null,
          quantity: p.quantity || 1,
          priceInCents: Math.round(Number(p.priceReais || 0) * 100)
        };
      }),
    trackingParameters: {
      utm_source: tracking.utm_source || null,
      utm_medium: tracking.utm_medium || null,
      utm_campaign: tracking.utm_campaign || null,
      utm_content: tracking.utm_content || null,
      utm_term: tracking.utm_term || null,
      src: tracking.src || null,
      sck: tracking.sck || null
    },
    commission: {
      totalPriceInCents: totalCents,
      gatewayFeeInCents: 0,
      userCommissionInCents: totalCents,
      currency: 'BRL'
    },
    isTest: false
  };

  try {
    const resp = await fetch(UTMIFY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-token': TOKEN
      },
      body: JSON.stringify(payload)
    });
    const result = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.error('[utmify] erro:', resp.status, result);
      return { ok: false, status: resp.status, result };
    }
    console.log('[utmify] pedido enviado:', orderId, status);
    return { ok: true, result };
  } catch (err) {
    console.error('[utmify] exception:', err);
    return { ok: false, error: err.message };
  }
}
