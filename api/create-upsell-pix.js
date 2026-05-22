// /api/create-upsell-pix.js
// Cria cobrança PIX do Gel Hot via Duckfy (upsell R$ 29,90 ou downsell R$ 19,90).
// Roda no servidor — as chaves NUNCA vão pro frontend.

import { notifyUtmify } from './_utmify.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const PUBLIC_KEY = process.env.DUCKFY_PUBLIC_KEY;
  const SECRET_KEY = process.env.DUCKFY_SECRET_KEY;
  const API_URL = process.env.DUCKFY_API_URL || 'https://app.duckoficial.com';
  const WEBHOOK_URL = process.env.WEBHOOK_URL;

  if (!PUBLIC_KEY || !SECRET_KEY) {
    return res.status(500).json({ success: false, error: 'config_error', detail: 'Duckfy keys missing' });
  }

  try {
    const body = req.body || {};
    const {
      nome, email, cpf, telefone,
      flow,          // 'upsell' | 'downsell'
      mainTxId,      // ID da transação principal (referência)
      utm_source, utm_medium, utm_campaign, utm_content, utm_term,
      src, sck,
      fbclid, fbp, fbc
    } = body;

    if (!nome || !email || !cpf || !telefone) {
      return res.status(400).json({ success: false, error: 'missing_fields' });
    }

    // Server força o preço pelo flow (anti-tampering)
    const flowSafe = flow === 'downsell' ? 'downsell' : 'upsell';
    const totalNum = flowSafe === 'downsell' ? 1.00 : 1.00;

    const cpfClean = String(cpf).replace(/\D/g, '');
    const phoneClean = String(telefone).replace(/\D/g, '');
    if (cpfClean.length !== 11) {
      return res.status(400).json({ success: false, error: 'invalid_cpf' });
    }
    if (phoneClean.length < 10 || phoneClean.length > 11) {
      return res.status(400).json({ success: false, error: 'invalid_phone' });
    }

    const products = [
      {
        id: flowSafe === 'downsell' ? 'mysecret-gelhot-downsell' : 'mysecret-gelhot-upsell',
        name: flowSafe === 'downsell' ? 'Gel Hot (oferta final)' : 'Gel Hot',
        quantity: 1,
        price: totalNum
      }
    ];

    const identifier = 'MS-' + flowSafe.toUpperCase() + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();

    const payload = {
      identifier: identifier,
      amount: totalNum, // REAIS
      client: {
        name: String(nome).trim(),
        email: String(email).trim().toLowerCase(),
        phone: phoneClean,
        document: cpfClean
      },
      products: products,
      metadata: {
        order_ref: identifier,
        flow: flowSafe,
        main_tx_id: mainTxId || '',
        utm_source: utm_source || '',
        utm_medium: utm_medium || '',
        utm_campaign: utm_campaign || '',
        utm_content: utm_content || '',
        utm_term: utm_term || '',
        src: src || '',
        sck: sck || '',
        fbclid: fbclid || '',
        fbp: fbp || '',
        fbc: fbc || ''
      }
    };

    if (WEBHOOK_URL) {
      payload.callbackUrl = WEBHOOK_URL;
    }

    const dkResp = await fetch(`${API_URL}/api/v1/gateway/pix/receive`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-public-key': PUBLIC_KEY,
        'x-secret-key': SECRET_KEY
      },
      body: JSON.stringify(payload)
    });

    const dkData = await dkResp.json().catch(() => ({}));

    const okStatus = String(dkData?.status || '').toUpperCase() === 'OK';
    if (!dkResp.ok || !dkData?.transactionId || !okStatus) {
      console.error('[create-upsell-pix] Duckfy error:', dkResp.status, dkData);
      return res.status(502).json({
        success: false,
        error: 'gateway_error',
        gatewayStatus: dkResp.status,
        detail: dkData?.message || dkData?.error || 'unknown'
      });
    }

    // Notifica UTMify: pedido criado (waiting_payment)
    await notifyUtmify({
      orderId: identifier,
      status: 'waiting_payment',
      amountReais: totalNum,
      customer: {
        name: String(nome).trim(),
        email: String(email).trim().toLowerCase(),
        phone: phoneClean,
        document: cpfClean
      },
      products: products.map(function(p){ return { id: p.id, name: p.name, quantity: p.quantity, priceReais: p.price }; }),
      tracking: {
        utm_source: utm_source, utm_medium: utm_medium, utm_campaign: utm_campaign,
        utm_content: utm_content, utm_term: utm_term, src: src, sck: sck
      },
      createdAt: new Date()
    });

    return res.status(200).json({
      success: true,
      transactionId: dkData.transactionId,
      identifier: identifier,
      status: dkData.status,
      pix: {
        qrcode: dkData?.pix?.code || null,
        qrcodeImage: dkData?.pix?.base64 || dkData?.pix?.image || null
      },
      amount: Math.round(totalNum * 100), // centavos pro frontend
      flow: flowSafe,
      expiresInDays: 1
    });

  } catch (err) {
    console.error('[create-upsell-pix] Exception:', err);
    return res.status(500).json({ success: false, error: 'internal_error' });
  }
}
