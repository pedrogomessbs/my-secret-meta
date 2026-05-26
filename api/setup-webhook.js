// /api/setup-webhook.js
// Cadastra o webhook GLOBAL na Duckfy via API (POST /api/v1/webhooks).
// Acesse UMA VEZ pelo navegador: https://SEU-DOMINIO/api/setup-webhook
// Depois disso, a Duckfy passa a notificar TRANSACTION_PAID pro nosso webhook.
//
// Também lista/checa webhooks já cadastrados (GET) pra você confirmar.

export default async function handler(req, res) {
  const PUBLIC_KEY = process.env.DUCKFY_PUBLIC_KEY;
  const SECRET_KEY = process.env.DUCKFY_SECRET_KEY;
  const API_URL = process.env.DUCKFY_API_URL || 'https://app.duckoficial.com';
  const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://my-secret-red.vercel.app/api/webhook-duckfy';

  if (!PUBLIC_KEY || !SECRET_KEY) {
    return res.status(500).json({ ok: false, error: 'Duckfy keys missing nas envs' });
  }

  const headers = {
    'Content-Type': 'application/json',
    'x-public-key': PUBLIC_KEY,
    'x-secret-key': SECRET_KEY
  };

  try {
    // Cadastra o webhook global
    const createResp = await fetch(`${API_URL}/api/v1/webhooks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'MySecret Producao',
        callbackUrl: WEBHOOK_URL,
        events: ['TRANSACTION_PAID', 'TRANSACTION_CREATED'],
        allProducts: true,
        productIds: []
      })
    });

    const createData = await createResp.json().catch(() => ({}));

    return res.status(200).json({
      ok: createResp.ok,
      message: createResp.ok
        ? '✅ Webhook cadastrado na Duckfy! As próximas vendas vão notificar.'
        : '⚠️ Resposta da Duckfy abaixo — verifique o erro.',
      webhookUrl: WEBHOOK_URL,
      duckfyStatus: createResp.status,
      duckfyResponse: createData
    });

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
