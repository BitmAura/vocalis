const https = require('https');

function request({ hostname, path, method = 'GET', headers = {}, body = '' }) {
  return new Promise((resolve) => {
    const req = https.request({ hostname, path, method, headers }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', (e) => resolve({ status: 0, body: '', error: e.message }));
    if (body) req.write(body);
    req.end();
  });
}

module.exports = { request };
