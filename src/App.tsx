import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DocumentPreviewer,
  formatBytes,
  getExtension,
  useDocumentPreview,
  type PreviewConfig,
  type PreviewDocument,
} from 'react-docscope';
import { de, en, es, fr, hi } from 'react-docscope/locales';
import { createSignedUrlResolver, fetchDocuments, type ResolverLogEntry } from './documents';

const LANGUAGES = { en, de, es, fr, hi } as const;
type Language = keyof typeof LANGUAGES;
type Theme = 'system' | 'light' | 'dark';

const LANGUAGE_NAMES: Record<Language, string> = {
  en: 'English',
  de: 'Deutsch',
  es: 'Español',
  fr: 'Français',
  hi: 'हिन्दी',
};

const KIND_COLORS: Record<string, string> = {
  pdf: '#dc2626',
  docx: '#2563eb',
  pptx: '#ea580c',
  xlsx: '#16a34a',
  csv: '#16a34a',
  md: '#7c3aed',
  json: '#ca8a04',
  xml: '#0891b2',
  log: '#64748b',
  txt: '#64748b',
  jpg: '#db2777',
  png: '#db2777',
  mp4: '#9333ea',
};

function useResolvedTheme(theme: Theme) {
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }, [theme]);
}

export function App() {
  const [documents, setDocuments] = useState<PreviewDocument[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | undefined>();
  const [language, setLanguage] = useState<Language>('en');
  const [theme, setTheme] = useState<Theme>('system');
  const [startExpired, setStartExpired] = useState(true);
  const [log, setLog] = useState<ResolverLogEntry[]>([]);
  const [compareLeft, setCompareLeft] = useState('annual-report');
  const [compareRight, setCompareRight] = useState('service-contract');
  const localFiles = useRef(new Map<string, File>());
  useResolvedTheme(theme);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchDocuments(ctrl.signal)
      .then((docs) => {
        setDocuments(docs);
        setActiveId((id) => id ?? docs[0]?.id);
      })
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => ctrl.abort();
  }, []);

  const startExpiredRef = useRef(startExpired);
  startExpiredRef.current = startExpired;
  const resolver = useMemo(
    () =>
      createSignedUrlResolver({
        startExpired: () => startExpiredRef.current,
        log: (entry) => setLog((prev) => [entry, ...prev].slice(0, 12)),
        localFiles: localFiles.current,
      }),
    [],
  );

  const config = useMemo<PreviewConfig>(
    () => ({ theme, labels: LANGUAGES[language], height: '100%' }),
    [theme, language],
  );

  // Inline, the app's own file list is the navigation, so the viewer's sidebar is off.
  const inlineConfig = useMemo<PreviewConfig>(() => ({ ...config, sidebar: false }), [config]);
  const modal = useDocumentPreview({ documents, resolver, config });

  const addLocalFiles = useCallback((files: FileList | null) => {
    if (!files?.length) return;
    const added: PreviewDocument[] = [...files].map((file, i) => {
      const id = `local-${Date.now()}-${i}`;
      localFiles.current.set(id, file);
      return {
        id,
        name: file.name,
        type: file.type || undefined,
        metadata: {
          size: file.size,
          uploadedAt: new Date(file.lastModified).toISOString(),
          uploadedBy: 'You (local, not uploaded)',
        },
      };
    });
    setDocuments((prev) => [...added, ...prev]);
    setActiveId(added[0]!.id);
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <h1>Northwind Projects</h1>
            <p>Project files · a sample app built with react-docscope</p>
          </div>
        </div>
        <div className="controls">
          <label>
            Language
            <select value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
              {Object.entries(LANGUAGE_NAMES).map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Theme
            <select value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={startExpired}
              onChange={(e) => setStartExpired(e.target.checked)}
            />
            Hand out expired links first
          </label>
        </div>
      </header>

      <main className="layout">
        <aside className="files" aria-label="Project files">
          <div className="files-head">
            <h2 className="section-title">Files</h2>
            <label className="button secondary">
              Add local files
              <input
                type="file"
                multiple
                className="visually-hidden"
                onChange={(e) => {
                  addLocalFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
          {loadError && <p role="alert" className="error">{loadError}</p>}
          <ul className="file-list">
            {documents.map((doc) => {
              const ext = getExtension(doc);
              return (
                <li key={doc.id} className={doc.id === activeId ? 'active' : undefined}>
                  <button type="button" className="file-main" onClick={() => setActiveId(doc.id)}>
                    <span
                      className="file-badge"
                      aria-hidden="true"
                      style={{ background: KIND_COLORS[ext] ?? "#475569" }}
                    >
                      {ext.slice(0, 4) || 'file'}
                    </span>
                    <span className="file-text">
                      <span className="file-name">{doc.name}</span>
                      <span className="file-meta">
                        {formatBytes(doc.metadata?.size)} · {doc.metadata?.uploadedBy}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Open ${doc.name} in a dialog`}
                    title="Open in a dialog"
                    onClick={() => modal.open(doc.id)}
                  >
                    ⤢
                  </button>
                </li>
              );
            })}
          </ul>

          <section className="compare" aria-labelledby="compare-title">
            <h2 id="compare-title" className="section-title">
              Compare side by side
            </h2>
            <div className="compare-row">
              <select
                aria-label="Left document"
                value={compareLeft}
                onChange={(e) => setCompareLeft(e.target.value)}
              >
                {documents.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Right document"
                value={compareRight}
                onChange={(e) => setCompareRight(e.target.value)}
              >
                {documents.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="button"
              disabled={compareLeft === compareRight || documents.length < 2}
              onClick={() => modal.compare(compareLeft, compareRight)}
            >
              Compare selected
            </button>
          </section>
        </aside>

        <section className="viewer" aria-label="Document preview">
          {documents.length > 0 && (
            <DocumentPreviewer
              documents={documents}
              activeDocumentId={activeId}
              onDocumentChange={(doc) => setActiveId(doc.id)}
              resolver={resolver}
              config={inlineConfig}
            />
          )}
        </section>

        <section className="log" aria-label="Resolver calls">
          <h2 className="section-title">Resolver calls</h2>
          <p className="hint">
            Each preview asks the backend for a 60-second signed URL. With “Hand out expired links
            first” on, the first link is already expired: the library gets a 403 and asks again on
            its own (<code>attempt 1 · expired</code>).
          </p>
          <ol>
            {log.map((e, i) => (
              <li key={i}>
                <time>{e.time}</time> <strong>{e.document}</strong>{' '}
                <span className="tag">{e.purpose}</span>{' '}
                <span className="tag">
                  attempt {e.attempt} · {e.reason}
                </span>{' '}
                → {e.outcome}
              </li>
            ))}
          </ol>
        </section>
      </main>
      <modal.PreviewPortal />
    </div>
  );
}
