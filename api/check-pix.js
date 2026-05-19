// /api/check-pix.js
// Consulta status de uma transação na SkalePay.
// Chamado pelo frontend a cada 4s no polling.

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const API_KEY = process.env.SKALEPAY_API_KEY;
  const API_URL = process.env.SKALEPAY_API_URL || 'https://api.skalepayments.com.br';

  if (!API_KEY) {
    return res.status(500).json({ success: false, error: 'config_error' });
  }

  const txId = req.query.id;
  if (!txId || !/^[a-zA-Z0-9_-]+$/.test(txId)) {
    return res.status(400).json({ success: false, error: 'invalid_id' });
  }

  try {
    const skResp = await fetch(`${API_URL}/transactions/${txId}`, {
      method: 'GET',
      headers: {
        'X-API-Key': API_KEY
      }
    });

    const skData = await skResp.json().catch(() => ({}));

    if (!skResp.ok) {
      console.error('[check-pix] SkalePay error:', skResp.status, skData);
      return res.status(502).json({
        success: false,
        error: 'gateway_error',
        status: 'unknown'
      });
    }

    return res.status(200).json({
      success: true,
      id: skData.id,
      status: skData.status,
      amount: skData.amount || null,
      timestamp: skData.timestamp || null
    });

  } catch (err) {
    console.error('[check-pix] Exception:', err);
    return res.status(500).json({ success: false, error: 'internal_error', status: 'unknown' });
  }
}
