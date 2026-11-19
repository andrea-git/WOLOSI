import { get, put } from '@vercel/blob';

const BLOB_PATH = 'workout-logbook/logbook.json';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'PIN non valido' });
  }

  try {
    if (req.method === 'GET') {
      const data = await readRemoteStore();
      if (!data) return res.status(404).json({ exists: false });
      return res.status(200).json({ exists: true, data });
    }

    if (req.method === 'PUT') {
      const incoming = normalizeRequestBody(req.body);
      validateStore(incoming);

      const current = await readRemoteStore();
      const merged = mergeStores(current, incoming);

      await put(BLOB_PATH, JSON.stringify(merged, null, 2), {
        access: 'private',
        allowOverwrite: true,
        contentType: 'application/json',
        cacheControlMaxAge: 60,
      });

      return res.status(200).json({ ok: true, data: merged });
    }

    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Metodo non consentito' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error?.message || 'Errore storage' });
  }
}

function isAuthorized(req) {
  const expected = process.env.LOGBOOK_PIN;
  if (!expected) return true;
  const provided = req.headers['x-logbook-pin'];
  return typeof provided === 'string' && provided === expected;
}

async function readRemoteStore() {
  const result = await get(BLOB_PATH, {
    access: 'private',
    useCache: false,
  });

  if (!result || result.statusCode !== 200 || !result.stream) return null;
  const text = await new Response(result.stream).text();
  if (!text.trim()) return null;
  const parsed = JSON.parse(text);
  validateStore(parsed);
  return parsed;
}

function normalizeRequestBody(body) {
  if (typeof body === 'string') return JSON.parse(body);
  return body;
}

function validateStore(store) {
  if (!store || store.version !== 1 || !Array.isArray(store.sessions)) {
    throw new Error('Formato logbook non valido');
  }
}

function mergeStores(current, incoming) {
  if (!current) return incoming;

  const byId = new Map();
  for (const session of current.sessions || []) {
    if (session?.id) byId.set(session.id, session);
  }

  for (const session of incoming.sessions || []) {
    if (!session?.id) continue;
    const existing = byId.get(session.id);
    const incomingUpdated = Number(session.updatedAt || 0);
    const existingUpdated = Number(existing?.updatedAt || 0);
    if (!existing || incomingUpdated >= existingUpdated) byId.set(session.id, session);
  }

  return {
    version: 1,
    sessions: [...byId.values()].sort((a, b) => {
      const dateCmp = String(a.date || '').localeCompare(String(b.date || ''));
      if (dateCmp !== 0) return dateCmp;
      return String(a.dayId || '').localeCompare(String(b.dayId || ''));
    }),
    exerciseOverrides: mergeExerciseOverrides(
      current.exerciseOverrides || {},
      incoming.exerciseOverrides || {}
    ),
  };
}


function mergeExerciseOverrides(current, incoming) {
  const merged = { ...current };

  for (const [slotKey, incomingSlot] of Object.entries(incoming || {})) {
    if (!incomingSlot || typeof incomingSlot !== 'object') continue;
    merged[slotKey] = {
      ...(current?.[slotKey] || {}),
      ...incomingSlot,
    };
  }

  return merged;
}
