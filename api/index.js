const { handleChat } = require('../backend/routes/chat');
const { handleInboundCall } = require('../backend/routes/telephony');
const tenantStore = require('../backend/services/tenant-store');
const bookingEngine = require('../backend/services/booking-engine');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE, PATCH');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const parsedUrl = req.url.split('?')[0];

  try {
    if (parsedUrl === '/v1/chat' || parsedUrl === '/api/chat') {
      return await handleChat(req, res, req.body || '');
    }

    if (parsedUrl === '/v1/telephony/inbound' || parsedUrl === '/api/telephony/inbound') {
      const twiml = await handleInboundCall(req.body || {});
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      return res.end(twiml);
    }

    if (parsedUrl === '/v1/tenants' || parsedUrl === '/api/tenants') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(tenantStore.getAllTenants()));
    }

    if (parsedUrl === '/v1/bookings' || parsedUrl === '/api/bookings') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(bookingEngine.getAllBookings()));
    }

    if (parsedUrl === '/v1/telephony/active-tenant') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ activeTenantId: tenantStore.getActiveTestTenantId() }));
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint not found: ' + parsedUrl }));
  } catch(err) {
    console.error('[API Serverless Error]:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message, stack: err.stack }));
    }
  }
};
