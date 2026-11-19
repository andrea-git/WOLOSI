import { get, put } from '@vercel/blob';

const PREFIX = 'workout-logbook/machines';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'PIN non valido' });
  }

  try {
    const slot = sanitizeSlot(req.query.slot || req.body?.slot);
    if (!slot) return res.status(400).json({ error: 'Slot macchina non valido' });

    const path = `${PREFIX}/${slot}.jpg`;

    if (req.method === 'GET') {
      const result = await get(path, { access: 'private', useCache: false });
      if (!result || result.statusCode !== 200 || !result.stream) {
        return res.status(404).end();
      }

      const buffer = Buffer.from(await new Response(result.stream).arrayBuffer());
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Content-Length', String(buffer.length));
      return res.status(200).send(buffer);
    }

    if (req.method === 'POST') {
      const dataUrl = req.body?.dataUrl;
      if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/jpeg;base64,')) {
        return res.status(400).json({ error: 'Immagine non valida' });
      }

      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      const buffer = Buffer.from(base64, 'base64');

      if (!buffer.length || buffer.length > 2_000_000) {
        return res.status(413).json({ error: 'Immagine troppo grande' });
      }

      await put(path, buffer, {
        access: 'private',
        allowOverwrite: true,
        contentType: 'image/jpeg',
        cacheControlMaxAge: 60,
      });

      return res.status(200).json({ ok: true, imageVersion: Date.now() });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Metodo non consentito' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error?.message || 'Errore immagine' });
  }
}

function isAuthorized(req) {
  const expected = process.env.LOGBOOK_PIN;
  if (!expected) return true;
  const provided = req.headers['x-logbook-pin'];
  return typeof provided === 'string' && provided === expected;
}

function sanitizeSlot(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 160);
}
