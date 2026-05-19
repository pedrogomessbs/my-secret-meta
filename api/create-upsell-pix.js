// /api/create-upsell-pix.js
// Cria cobrança PIX do Gel Hot via SkalePay (upsell R$ 29,90 ou downsell R$ 19,90).
// Segue o mesmo padrão da /api/create-pix.js
// Roda no servidor — a SKALEPAY_API_KEY NUNCA vai pro frontend.

export default async function handler(req, res) {
  // CORS básico
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const API_KEY = process.env.SKALEPAY_API_KEY;
  const API_URL = process.env.SKALEPAY_API_URL || 'https://api.skalepayments.com.br';

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
      flow,          // 'upsell' | 'downsell'
      total,         // 29.90 | 19.90 (em reais)
      mainTxId,      // ID da transação principal (referência opcional pra atribuição)
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content,
      utm_term,
      fbclid,
      fbp,
      fbc
    } = body;

    // Validação dos dados do customer (vem do localStorage da página principal)
    if (!nome || !email || !cpf || !telefone) {
      return res.status(400).json({ success: false, error: 'missing_fields' });
    }

    // Validação do flow
    const flowSafe = flow === 'downsell' ? 'downsell' : 'upsell';
    const expectedAmount = flowSafe === 'downsell' ? 19.90 : 29.90;

    // Server confia no flow, não no total enviado pelo client
    // (cliente pode tentar mandar total tamperado — sobrescrevemos)
    const totalNum = expectedAmount;

    // Limpa CPF e telefone
    const cpfClean = String(cpf).replace(/\D/g, '');
    const phoneClean = String(telefone).replace(/\D/g, '');
    if (cpfClean.length !== 11) {
      return res.status(400).json({ success: false, error: 'invalid_cpf' });
    }
    if (phoneClean.length < 10 || phoneClean.length > 11) {
      return res.status(400).json({ success: false, error: 'invalid_phone' });
    }

    // Item do Gel Hot
    const items = [
      {
        title: flowSafe === 'downsell' ? 'Gel Hot (oferta final)' : 'Gel Hot',
        unitPrice: Math.round(totalNum * 100), // em centavos
        quantity: 1,
        tangible: true,
        externalRef: flowSafe === 'downsell' ? 'mysecret-gelhot-downsell' : 'mysecret-gelhot-upsell'
      }
    ];

    const amountCents = Math.round(totalNum * 100);

    // Phone format
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
        flow: flowSafe,                  // 'upsell' | 'downsell' — webhook lê isso pra diferenciar
        main_tx_id: mainTxId || '',      // referência pra atribuição (pode ficar vazio)
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
      console.error('[create-upsell-pix] SkalePay error:', skResp.status, skData);
      return res.status(502).json({
        success: false,
        error: 'gateway_error',
        gatewayStatus: skResp.status,
        detail: skData?.message || skData?.error || 'unknown'
      });
    }

    return res.status(200).json({
      success: true,
      transactionId: skData.id,
      status: skData.status,
      pix: {
        qrcode: skData?.pix?.qrcode || null,
        qrcodeImage: skData?.pix?.qrcodeImage || null
      },
      amount: amountCents,
      flow: flowSafe,
      expiresInDays: 1
    });

  } catch (err) {
    console.error('[create-upsell-pix] Exception:', err);
    return res.status(500).json({ success: false, error: 'internal_error' });
  }
}
