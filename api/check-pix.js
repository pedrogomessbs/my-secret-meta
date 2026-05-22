// /api/check-pix.js
// Consulta status de uma transação na Duckfy.
// Chamado pelo frontend a cada 4s no polling.

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const PUBLIC_KEY = process.env.DUCKFY_PUBLIC_KEY;
  const SECRET_KEY = process.env.DUCKFY_SECRET_KEY;
  const API_URL = process.env.DUCKFY_API_URL || 'https://app.duckoficial.com';

  if (!PUBLIC_KEY || !SECRET_KEY) {
    return res.status(500).json({ success: false, error: 'config_error', status: 'unknown' });
  }

  const txId = req.query.id;
  if (!txId || !/^[a-zA-Z0-9_-]+$/.test(txId)) {
    return res.status(400).json({ success: false, error: 'invalid_id', status: 'unknown' });
  }

  try {
    const dkResp = await fetch(`${API_URL}/api/v1/transactions?id=${encodeURIComponent(txId)}`, {
      method: 'GET',
      headers: {
        'x-public-key': PUBLIC_KEY,
        'x-secret-key': SECRET_KEY,
        'Content-Type': 'application/json'
      }
    });

    const dkData = await dkResp.json().catch(() => ({}));

    if (!dkResp.ok) {
      console.error('[check-pix] Duckfy error:', dkResp.status, dkData);
      return res.status(502).json({ success: false, error: 'gateway_error', status: 'unknown' });
    }

    // A consulta pode vir como objeto único ou array — normaliza
    const tx = Array.isArray(dkData) ? dkData[0]
             : (dkData?.data ? dkData.data : dkData);

    const rawStatus = String(tx?.status || tx?.transactionStatus || '').toLowerCase();

    // Detecção DEFENSIVA: cobre paid, PAID, TRANSACTION_PAID, completed, approved
    let normalizedStatus = 'pending';
    if (/paid|completed|approved|success/.test(rawStatus)) {
      normalizedStatus = 'paid';
    } else if (/refused|cancel|fail|expired|refund|chargeback/.test(rawStatus)) {
      normalizedStatus = 'refused';
    }

    return res.status(200).json({
      success: true,
      id: tx?.transactionId || tx?.id || txId,
      status: normalizedStatus,      // frontend espera 'paid' / 'refused' / 'pending'
      rawStatus: rawStatus,          // status original do gateway (debug)
      amount: tx?.amount || null,
      timestamp: tx?.createdAt || tx?.timestamp || null
    });

  } catch (err) {
    console.error('[check-pix] Exception:', err);
    return res.status(500).json({ success: false, error: 'internal_error', status: 'unknown' });
  }
}
