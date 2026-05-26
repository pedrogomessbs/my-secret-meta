// /api/create-pix.js
// Cria cobrança PIX via Duckfy (Duck Oficial).
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
  const WEBHOOK_URL = process.env.WEBHOOK_URL; // ex: https://my-secret-red.vercel.app/api/webhook-duckfy

  if (!PUBLIC_KEY || !SECRET_KEY) {
    return res.status(500).json({ success: false, error: 'config_error', detail: 'Duckfy keys missing' });
  }

  try {
    const body = req.body || {};
    const {
      nome, email, cpf, telefone,
      bump,        // bool
      total,       // em REAIS (ex: 47.90)
      utm_source, utm_medium, utm_campaign, utm_content, utm_term,
      src, sck,
      fbclid, fbp, fbc
    } = body;

    if (!nome || !email || !cpf || !telefone) {
      return res.status(400).json({ success: false, error: 'missing_fields' });
    }

    const totalNum = Number(total);
    if (!Number.isFinite(totalNum) || totalNum < 5 || totalNum > 600) {
      return res.status(400).json({ success: false, error: 'invalid_amount' });
    }

    const cpfClean = String(cpf).replace(/\D/g, '');
    const phoneClean = String(telefone).replace(/\D/g, '');
    if (cpfClean.length !== 11) {
      return res.status(400).json({ success: false, error: 'invalid_cpf' });
    }
    if (phoneClean.length < 10 || phoneClean.length > 11) {
      return res.status(400).json({ success: false, error: 'invalid_phone' });
    }

    const hasBump = bump === true || bump === 'true' || bump === 1 || bump === '1';

    // Products em REAIS (Duckfy usa reais, não centavos)
    const products = [
      { id: 'mysecret-main', name: 'My Secret 2 em 1 + Brinde', quantity: 1, price: 47.90 }
    ];
    if (hasBump) {
      products.push({ id: 'mysecret-kmed', name: 'Gel K-Med 2 em 1', quantity: 1, price: 19.90 });
    }

    // identifier = nosso ID externo (usado depois na consulta como externalId)
    const identifier = 'MS-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();

    const payload = {
      identifier: identifier,
      amount: totalNum, // REAIS
      client: {
        name: String(nome).trim(),
        email: String(email).trim().toLowerCase(),
        phone: phoneClean,        // só dígitos
        document: cpfClean        // CPF string simples
      },
      products: products,
      metadata: {
        order_ref: identifier,
        bump: hasBump ? '1' : '0',
        flow: 'main',
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

    // Webhook por transação
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

    // Duckfy retorna status "OK" na criação (status da requisição, não do pagamento)
    const okStatus = String(dkData?.status || '').toUpperCase() === 'OK';
    if (!dkResp.ok || !dkData?.transactionId || !okStatus) {
      console.error('[create-pix] Duckfy error:', dkResp.status, dkData);
      return res.status(502).json({
        success: false,
        error: 'gateway_error',
        gatewayStatus: dkResp.status,
        detail: dkData?.message || dkData?.error || 'unknown'
      });
    }

    // Notifica UTMify: pedido criado (waiting_payment) — não bloqueia resposta se falhar
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
        utm_content: utm_content, utm_term: utm_term,
        src: src, sck: sck
      },
      createdAt: new Date()
    });

    return res.status(200).json({
      success: true,
      transactionId: dkData.transactionId,
      identifier: identifier,
      status: dkData.status,
      pix: {
        qrcode: dkData?.pix?.code || null,            // copia-e-cola (Duckfy = pix.code)
        qrcodeImage: dkData?.pix?.base64 || dkData?.pix?.image || null
      },
      amount: Math.round(totalNum * 100), // devolvo em centavos pro frontend (compat com UI atual)
      expiresInDays: 1
    });

  } catch (err) {
    console.error('[create-pix] Exception:', err);
    return res.status(500).json({ success: false, error: 'internal_error' });
  }
}
