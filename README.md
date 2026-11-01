# docscope-sample

A small, realistic app built with [react-docscope](https://github.com/Busetti/react-docscope):
a project's files stored privately and previewed through **short-lived signed URLs**, the way
you would with S3, GCS or Azure Blob Storage. It runs on Vercel with one serverless function.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FBusetti%2Fdocscope-sample&env=SIGNING_SECRET&envDescription=Any%20long%20random%20string%20used%20to%20sign%20document%20URLs)

What it shows:

- **Every format** — PDF, Word, PowerPoint (with charts), Excel, CSV, Markdown, JSON, XML, logs,
  images and video, all from one `<DocumentPreviewer>`.
- **Signed URLs that expire** — the app's resolver asks the backend for a 60-second URL. With
  _Hand out expired links first_ on, the first URL is already expired: the library receives a 403
  and asks again on its own (`attempt 1 · expired`). The _Resolver calls_ panel shows each call.
- **Inline and dialog** — the main viewer is inline; ⤢ opens a file in a dialog with
  `useDocumentPreview`, and _Compare selected_ opens two documents side by side.
- **Encrypted PDF** — `confidential-memo.pdf` asks for a password (`docscope`) and is marked
  non-downloadable.
- **Local files** — _Add local files_ previews files from your computer in memory; nothing is uploaded.
- **Languages and themes** — English, German, Spanish, French and Hindi (`react-docscope/locales`),
  light, dark or system theme.

## How it fits together

```text
browser                                   Vercel
───────                                   ──────
<DocumentPreviewer resolver={…}>
   │  resolver(doc)  ── GET /api/documents/:id/url ──▶  api/index.ts signs id + expiry (HMAC)
   │                 ◀── { url: /api/files/:id?exp&sig }
   │  fetch(url)     ── GET /api/files/:id?…  ────────▶  verifies signature + expiry,
   │                 ◀── bytes (Range supported) / 403   streams ./documents/<file>
   └─ on 403: resolver(doc, { attempt: 1, reason: 'expired' }) → fresh URL
```

The integration is ~40 lines: [`src/documents.ts`](src/documents.ts) (resolver) and
[`src/App.tsx`](src/App.tsx) (UI). The backend is [`api/index.ts`](api/index.ts), a single
Web-standard `fetch` handler that the Vite dev server also mounts, so `npm run dev` behaves like
production. Documents in [`documents/`](documents) are never served statically.

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # API tests (signatures, expiry, ranges)
npm run build && npm run preview
```

## Deploy to Vercel

1. Click **Deploy with Vercel** above, or import this repository at
   [vercel.com/new](https://vercel.com/new). The framework preset (Vite), build command and
   output directory come from [`vercel.json`](vercel.json).
2. Set the environment variable `SIGNING_SECRET` to a long random string
   (`openssl rand -base64 32`). Without it a public development secret is used.
3. Every push to `main` deploys to production; pull requests get preview deployments.

## Use your own storage

Replace the two backend routes with your storage provider's signed URLs — e.g. S3
`getSignedUrl(GetObjectCommand)` — and keep the resolver as it is. The library never sees your
credentials, only the short-lived URL.

## License

MIT © Gurunath Busetti. Sample documents are synthetic.
