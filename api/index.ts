/**
 * Demo document backend: one Vercel Function (Web-standard `fetch` handler)
 * that is also mounted into the Vite dev/preview server (see vite.config.ts).
 *
 *   GET /api/documents                      → catalog (JSON)
 *   GET /api/documents/:id/url?purpose=…    → { url, expiresAt }  short-lived signed URL
 *   GET /api/files/:id?exp=…&sig=…          → file bytes (Range supported), 403 once expired
 *
 * Files live in ./documents and are never served statically: the only way in is a
 * signed URL, exactly like a private S3/GCS bucket with pre-signed URLs.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { open, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

export interface ApiOptions {
  /** Directory holding the documents and catalog.json. */
  root: string;
  /** HMAC secret for signed URLs. */
  secret: string;
  /** Signed URL lifetime in seconds (default 60). */
  ttlSeconds?: number;
  now?: () => number;
}

interface CatalogEntry {
  id: string;
  file: string;
  name: string;
  type: string;
  uploadedAt: string;
  uploadedBy: string;
  description?: string;
  /** Hide the download button for this document. */
  downloadable?: boolean;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

const accessDenied = (message: string) =>
  new Response(`<Error><Code>AccessDenied</Code><Message>${message}</Message></Error>`, {
    status: 403,
    headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'no-store' },
  });

export function sign(secret: string, id: string, exp: number, disposition: string): string {
  return createHmac('sha256', secret).update(`${id}\n${exp}\n${disposition}`).digest('base64url');
}

function verify(secret: string, id: string, exp: number, disposition: string, sig: string) {
  const expected = Buffer.from(sign(secret, id, exp, disposition));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

async function loadCatalog(root: string): Promise<CatalogEntry[]> {
  return JSON.parse(await readFile(join(root, 'catalog.json'), 'utf8')) as CatalogEntry[];
}

/** Parses a single "bytes=start-end" range. Returns null when absent or unsatisfiable. */
export function parseRange(header: string | null, size: number): [number, number] | null {
  const m = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start: number;
  let end: number;
  if (m[1] === '') {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  return start <= end && start < size ? [start, end] : null;
}

export async function handleApi(request: Request, options: ApiOptions): Promise<Response> {
  const url = new URL(request.url);
  // Vercel rewrites /api/<path> to /api?path=<path>; the dev server passes the real path.
  const path = (url.searchParams.get('path') ?? url.pathname.replace(/^\/api\/?/, '')).replace(
    /^\/+|\/+$/g,
    '',
  );
  const parts = path.split('/');
  const now = options.now ?? Date.now;
  if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'Method not allowed' }, 405);

  const catalog = await loadCatalog(options.root);
  const find = (id: string | undefined) => catalog.find((d) => d.id === id);

  // GET /api/documents
  if (parts.length === 1 && parts[0] === 'documents') {
    const docs = await Promise.all(
      catalog.map(async (d) => ({
        id: d.id,
        name: d.name,
        type: d.type,
        downloadable: d.downloadable ?? true,
        metadata: {
          size: (await stat(join(options.root, d.file))).size,
          uploadedAt: d.uploadedAt,
          uploadedBy: d.uploadedBy,
          description: d.description,
        },
      })),
    );
    return json(docs);
  }

  // GET /api/documents/:id/url?purpose=preview|download&ttl=<seconds, demo only>
  if (parts.length === 3 && parts[0] === 'documents' && parts[2] === 'url') {
    const doc = find(parts[1]);
    if (!doc) return json({ error: 'Not found' }, 404);
    const purpose = url.searchParams.get('purpose') === 'download' ? 'download' : 'preview';
    if (purpose === 'download' && doc.downloadable === false) return json({ error: 'Forbidden' }, 403);
    const requestedTtl = Number(url.searchParams.get('ttl'));
    // The demo may ask for an already-expired link (ttl < 0) to show automatic re-resolution.
    const ttl = Number.isFinite(requestedTtl) && url.searchParams.has('ttl')
      ? Math.max(-60, Math.min(requestedTtl, 300))
      : (options.ttlSeconds ?? 60);
    const exp = Math.floor(now() / 1000) + ttl;
    const disposition = purpose === 'download' ? 'attachment' : 'inline';
    const sig = sign(options.secret, doc.id, exp, disposition);
    const q = new URLSearchParams({ exp: String(exp), d: disposition, sig });
    return json({ url: `/api/files/${encodeURIComponent(doc.id)}?${q}`, expiresAt: exp * 1000 });
  }

  // GET /api/files/:id?exp&d&sig
  if (parts.length === 2 && parts[0] === 'files') {
    const doc = find(parts[1]);
    const exp = Number(url.searchParams.get('exp'));
    const disposition = url.searchParams.get('d') === 'attachment' ? 'attachment' : 'inline';
    const sig = url.searchParams.get('sig') ?? '';
    if (!doc || !Number.isFinite(exp) || !verify(options.secret, doc.id, exp, disposition, sig)) {
      return accessDenied('Invalid signature');
    }
    if (now() / 1000 > exp) return accessDenied('Request has expired');

    const file = join(options.root, doc.file);
    const { size } = await stat(file);
    const headers: Record<string, string> = {
      'Content-Type': doc.type,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, no-store',
      'Content-Disposition': `${disposition}; filename="${doc.name.replace(/"/g, '')}"`,
    };
    const range = parseRange(request.headers.get('range'), size);
    if (request.headers.get('range') && !range) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }
    const [start, end] = range ?? [0, size - 1];
    const length = end - start + 1;
    headers['Content-Length'] = String(length);
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    if (request.method === 'HEAD') return new Response(null, { status: range ? 206 : 200, headers });
    const handle = await open(file, 'r');
    try {
      const buf = Buffer.alloc(length);
      await handle.read(buf, 0, length, start);
      return new Response(buf, { status: range ? 206 : 200, headers });
    } finally {
      await handle.close();
    }
  }

  return json({ error: 'Not found' }, 404);
}

const DEV_SECRET = 'docscope-sample-dev-secret';

export default {
  fetch(request: Request) {
    return handleApi(request, {
      root: join(process.cwd(), 'documents'),
      secret: process.env.SIGNING_SECRET || DEV_SECRET,
    });
  },
};
