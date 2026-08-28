const requestHandler = require('../backend/server.js');

module.exports = async (req, res) => {
  try {
    await requestHandler(req, res);
  } catch (err) {
    console.error('[Vercel Serverless Error]:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message, stack: err.stack });
    }
  }
};
