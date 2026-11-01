import type { DocumentResolver, PreviewDocument } from 'react-docscope';

export interface ResolverLogEntry {
  time: string;
  document: string;
  purpose: string;
  attempt: number;
  reason: string;
  outcome: string;
}

/** Loads the document list from the backend. */
export async function fetchDocuments(signal?: AbortSignal): Promise<PreviewDocument[]> {
  const res = await fetch('/api/documents', { signal });
  if (!res.ok) throw new Error(`Could not load documents (${res.status})`);
  return (await res.json()) as PreviewDocument[];
}

/**
 * The integration point with react-docscope: ask *your* backend for a
 * short-lived signed URL. The library calls this again by itself when a URL
 * has expired (HTTP 401/403), with `attempt > 0` and `reason: 'expired'`.
 *
 * `startExpired` is demo-only: the first URL for each document is already
 * expired, so you can watch the automatic re-resolution in the log.
 */
export function createSignedUrlResolver(options: {
  startExpired: () => boolean;
  log: (entry: ResolverLogEntry) => void;
  localFiles: Map<string, File>;
}): DocumentResolver {
  return async (doc, { signal, purpose, attempt, reason }) => {
    const entry = {
      time: new Date().toLocaleTimeString(),
      document: doc.name,
      purpose,
      attempt,
      reason,
    };

    // Files picked from the user's computer are previewed from memory, never uploaded.
    const local = options.localFiles.get(doc.id);
    if (local) {
      options.log({ ...entry, outcome: 'local file (in memory)' });
      return { kind: 'blob', blob: local };
    }

    const params = new URLSearchParams({ purpose });
    if (attempt === 0 && purpose === 'preview' && options.startExpired()) params.set('ttl', '-1');
    const res = await fetch(`/api/documents/${encodeURIComponent(doc.id)}/url?${params}`, {
      signal,
    });
    if (!res.ok) {
      options.log({ ...entry, outcome: `backend error ${res.status}` });
      throw new Error(`Could not sign a URL for ${doc.name} (${res.status})`);
    }
    const { url, expiresAt } = (await res.json()) as { url: string; expiresAt: number };
    const seconds = Math.round((expiresAt - Date.now()) / 1000);
    options.log({
      ...entry,
      outcome: seconds <= 0 ? 'signed URL (already expired)' : `signed URL, valid ${seconds}s`,
    });
    return { kind: 'url', url };
  };
}
