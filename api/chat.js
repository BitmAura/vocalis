module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  try {
    const { handleChat } = require('../backend/routes/chat');
    let body = req.body;
    if (!body) {
      body = await new Promise((resolve) => {
        let b = '';
        req.on('data', c => b += c);
        req.on('end', () => resolve(b));
        setTimeout(() => resolve(b), 200);
      });
    }
    return await handleChat(req, res, body);
  } catch (err) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ vercelCaughtError: err.message, stack: err.stack }));
  }
};
