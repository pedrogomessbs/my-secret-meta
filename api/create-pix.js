// /api/create-pix.js
// Cria cobrança PIX via SkalePay.
// Roda no servidor — a SKALEPAY_API_KEY NUNCA vai pro frontend.

export default async function handler(req, res) {
  // CORS básico (mesmo origem, mas garante POST)
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  // Validação das env vars
  const API_KEY = process.env.SKALEPAY_API_KEY;
  const API_URL = process.env.SKALEPAY_API_URL || 'https://api.skalepayments.com.br';
  const WEBHOOK_URL = process.env.WEBHOOK_URL; // ex: https://my-secret-red.vercel.app/api/webhook-skalepay

  if (!API_KEY) {
    return res.status(500).json({ success: false, error: 'config_error', detail: 'SKALEPAY_API_KEY missing' });
  }

  try {
    const body = req.body || {};
    const {
      nome,
      email,
      cpf,
      telefone,
      bump,        // bool
      total,       // string ou number — em REAIS (ex: 47.90)
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content,
      utm_term,
      fbclid,
      fbp,
      fbc
    } = body;

    // Validações server-side (frontend pode ser tampered)
    if (!nome || !email || !cpf || !telefone) {
      return res.status(400).json({ success: false, error: 'missing_fields' });
    }

    const totalNum = Number(total);
    if (!Number.isFinite(totalNum) || totalNum < 5 || totalNum > 600) {
      return res.status(400).json({ success: false, error: 'invalid_amount' });
    }

    // Limpa CPF e telefone (só dígitos)
    const cpfClean = String(cpf).replace(/\D/g, '');
    const phoneClean = String(telefone).replace(/\D/g, '');
    if (cpfClean.length !== 11) {
      return res.status(400).json({ success: false, error: 'invalid_cpf' });
    }
    if (phoneClean.length < 10 || phoneClean.length > 11) {
      return res.status(400).json({ success: false, error: 'invalid_phone' });
    }

    // Monta items (SkalePay NÃO aceita unitPrice: 0, então o brinde fica só na UI)
    const items = [
      {
        title: 'My Secret 2 em 1 + Brinde',
        unitPrice: 4790, // R$ 47,90 em centavos — fixo
        quantity: 1,
        tangible: true,
        externalRef: 'mysecret-main'
      }
    ];

    const hasBump = bump === true || bump === 'true' || bump === 1 || bump === '1';
    if (hasBump) {
      items.push({
        title: 'Gel K-Med 2 em 1',
        unitPrice: 1990, // R$ 19,90 em centavos
        quantity: 1,
        tangible: true,
        externalRef: 'mysecret-kmed'
      });
    }

    // Valor total em centavos
    const amountCents = Math.round(totalNum * 100);

    // Phone format esperado pela SkalePay — eles aceitam com formatação (vide doc)
    // Vou enviar com máscara pra ficar igual à doc deles
    const phoneFormatted = phoneClean.length === 11
      ? `(${phoneClean.slice(0, 2)}) ${phoneClean.slice(2, 7)}-${phoneClean.slice(7)}`
      : `(${phoneClean.slice(0, 2)}) ${phoneClean.slice(2, 6)}-${phoneClean.slice(6)}`;

    const payload = {
      amount: amountCents,
      paymentMethod: 'pix',
      pix: { expiresInDays: 1 },
      customer: {
        name: String(nome).trim(),
        email: String(email).trim().toLowerCase(),
        phone: phoneFormatted,
        document: {
          number: cpfClean,
          type: 'cpf'
        }
      },
      items,
      metadata: {
        bump: hasBump ? '1' : '0',
        utm_source: utm_source || '',
        utm_medium: utm_medium || '',
        utm_campaign: utm_campaign || '',
        utm_content: utm_content || '',
        utm_term: utm_term || '',
        fbclid: fbclid || '',
        fbp: fbp || '',
        fbc: fbc || ''
      }
    };

    // ============================================================
    // POSTBACK URL — DESATIVADO (Caminho A: webhook config no painel SkalePay → UTMify)
    // Pra reativar nosso webhook (CAPI server-side), descomenta as 3 linhas abaixo
    // E também remove/ajusta o webhook UTMify no painel SkalePay.
    // ============================================================
    // if (WEBHOOK_URL) {
    //   payload.postbackUrl = WEBHOOK_URL;
    // }

    // Chama SkalePay
    const skResp = await fetch(`${API_URL}/transactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
      },
      body: JSON.stringify(payload)
    });

    const skData = await skResp.json().catch(() => ({}));

    if (!skResp.ok || !skData?.success) {
      console.error('[create-pix] SkalePay error:', skResp.status, skData);
      return res.status(502).json({
        success: false,
        error: 'gateway_error',
        gatewayStatus: skResp.status,
        detail: skData?.message || skData?.error || 'unknown'
      });
    }

    // Resposta normalizada pro frontend (não vaza tudo)
    return res.status(200).json({
      success: true,
      transactionId: skData.id,
      status: skData.status,
      pix: {
        qrcode: skData?.pix?.qrcode || null,
        qrcodeImage: skData?.pix?.qrcodeImage || null
      },
      amount: amountCents,
      expiresInDays: 1
    });

  } catch (err) {
    console.error('[create-pix] Exception:', err);
    return res.status(500).json({ success: false, error: 'internal_error' });
  }
}
