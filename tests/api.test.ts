import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { handleApi, parseRange, sign } from '../api/index';

const root = resolve('documents');
let clock = Date.UTC(2026, 10, 1, 12, 0, 0);
const opts = { root, secret: 'test-secret', now: () => clock };
const get = (path: string, headers: Record<string, string> = {}) =>
  handleApi(new Request(`http://localhost${path}`, { headers }), opts);

async function signedUrl(id: string, query = '') {
  const res = await get(`/api/documents/${id}/url${query}`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { url: string }).url;
}

describe('document API', () => {
  it('lists the catalog with sizes', async () => {
    const docs = (await (await get('/api/documents')).json()) as Array<{
      id: string;
      metadata: { size: number };
    }>;
    expect(docs.length).toBeGreaterThan(10);
    expect(docs.every((d) => d.metadata.size > 0)).toBe(true);
  });

  it('serves a file through a signed URL and rejects it once expired', async () => {
    const url = await signedUrl('annual-report');
    const ok = await get(url);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('application/pdf');
    expect(new TextDecoder().decode((await ok.arrayBuffer()).slice(0, 5))).toBe('%PDF-');
    clock += 61_000;
    const expired = await get(url);
    expect(expired.status).toBe(403);
    expect(await expired.text()).toContain('expired');
  });

  it('rejects tampered signatures and other documents', async () => {
    const url = await signedUrl('budget');
    expect((await get(url.replace(/sig=[^&]+/, 'sig=abc'))).status).toBe(403);
    expect((await get(url.replace('/files/budget', '/files/customers'))).status).toBe(403);
    // an inline (preview) signature cannot be reused as a download
    expect((await get(url.replace('d=inline', 'd=attachment'))).status).toBe(403);
  });

  it('honours the demo "already expired" ttl', async () => {
    const url = await signedUrl('budget', '?ttl=-1');
    expect((await get(url)).status).toBe(403);
  });

  it('supports range requests', async () => {
    const url = await signedUrl('annual-report');
    const res = await get(url, { Range: 'bytes=0-9' });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toMatch(/^bytes 0-9\/\d+$/);
    expect((await res.arrayBuffer()).byteLength).toBe(10);
    expect((await get(url, { Range: 'bytes=999999-' })).status).toBe(416);
  });

  it('refuses downloads of non-downloadable documents and unknown routes', async () => {
    expect((await get('/api/documents/confidential-memo/url?purpose=download')).status).toBe(403);
    expect((await get('/api/documents/nope/url')).status).toBe(404);
    expect((await get('/api/whatever')).status).toBe(404);
  });

  it('accepts the path from the Vercel rewrite', async () => {
    const res = await get('/api?path=documents');
    expect(res.status).toBe(200);
  });

  it('signs deterministically', () => {
    expect(sign('s', 'a', 1, 'inline')).toBe(sign('s', 'a', 1, 'inline'));
    expect(sign('s', 'a', 1, 'inline')).not.toBe(sign('s', 'a', 2, 'inline'));
  });
});

describe('parseRange', () => {
  it.each([
    [null, null],
    ['bytes=0-99', [0, 99]],
    ['bytes=100-', [100, 999]],
    ['bytes=-100', [900, 999]],
    ['bytes=0-5000', [0, 999]],
    ['bytes=5000-', null],
    ['items=0-1', null],
  ])('%s', (header, expected) => {
    expect(parseRange(header, 1000)).toEqual(expected);
  });
});
