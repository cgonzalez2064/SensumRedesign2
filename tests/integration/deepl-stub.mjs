// A local stand-in for the DeepL API, so tests never call the real service.
// The Content Manager is pointed at it with DEEPL_API_URL (honored only when
// APP_ENV=development). It answers like DeepL: known phrases get a fixed
// translation, anything else is returned prefixed with the target language,
// XML tags untouched. `stub.mode` simulates DeepL failures.
import { createServer } from 'node:http';

export const STUB_KEY = 'test-deepl-key-0000:fx';

const PHRASES = {
  'EN-US': {
    'Construimos con <em>precisión</em> &amp; calidad': 'We build with <em>precision</em> &amp; quality',
    'Cotiza tu proyecto': 'Get a quote',
  },
  'ES-419': {
    'Get a quote': 'Cotiza tu proyecto',
  },
};

export async function startDeepLStub({ port }) {
  const stub = {
    url: `http://127.0.0.1:${port}`,
    mode: 'ok', // ok | quota | busy | error | delay
    requests: [],
    reply: null, // optional fixed translation text (e.g. hostile markup)
  };
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', async () => {
      const send = (status, data) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      if (req.headers.authorization !== `DeepL-Auth-Key ${STUB_KEY}`) return send(403, { message: 'Wrong key' });
      if (req.method === 'GET' && req.url === '/v2/usage') return send(200, { character_count: 1234, character_limit: 500000 });
      if (req.method !== 'POST' || req.url !== '/v2/translate') return send(404, { message: 'Not found' });
      let json;
      try { json = JSON.parse(body); } catch (e) { return send(400, { message: 'Bad JSON' }); }
      stub.requests.push({ headers: req.headers, body: json });
      if (stub.mode === 'quota') return send(456, { message: 'Quota exceeded' });
      if (stub.mode === 'busy') return send(429, { message: 'Too many requests' });
      if (stub.mode === 'error') return send(500, { message: 'Internal error' });
      if (stub.mode === 'delay') await new Promise((r) => setTimeout(r, 1500));
      const target = json.target_lang;
      const translations = json.text.map((t) => ({
        detected_source_language: json.source_lang,
        text: stub.reply ?? (PHRASES[target] && PHRASES[target][t]) ?? `${target.slice(0, 2)}: ${t}`,
      }));
      send(200, { translations });
    });
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  stub.stop = () => new Promise((r) => server.close(r));
  stub.last = () => stub.requests[stub.requests.length - 1];
  return stub;
}
