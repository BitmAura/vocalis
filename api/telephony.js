const { handleInboundCall } = require('../backend/routes/telephony');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  let body = req.body;
  if (!body) {
    body = await new Promise((resolve) => {
      let b = '';
      req.on('data', c => b += c);
      req.on('end', () => resolve(b));
      setTimeout(() => resolve(b), 500);
    });
  }

  let params = {};
  if (typeof body === 'object' && body !== null) {
    params = body;
  } else {
    try {
      const urlParams = new URLSearchParams(String(body || ''));
      urlParams.forEach((v, k) => { params[k] = v; });
    } catch(e) {}
  }

  const twiml = await handleInboundCall(params);
  res.writeHead(200, { 'Content-Type': 'text/xml' });
  return res.end(twiml);
};
