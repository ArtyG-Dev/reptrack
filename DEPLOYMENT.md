# DEPLOYMENT.md — GitHub Pages

RepTrack is a static site with no build step, so deployment is "copy `reptrack/` to a
web root". GitHub Pages is the shortest path to an HTTPS URL, and HTTPS is what an
Android PWA install needs.

**Chosen route: Option A** — RepTrack moves to its own public repo, `artyg-dev/reptrack`.
GridAIcon stays private. Nothing has been made public yet.

---

## Option A — RepTrack in its own public repo (chosen)

`.github/workflows/pages.yml` is already committed and is inert where it currently sits
(GitHub only runs workflows from the repository root). After the subtree split it lands at
the root and takes effect.

**Step 1 — you:** create an empty **public** repo named `reptrack` under `ArtyG-Dev` on
github.com. No README, no .gitignore, no licence — an empty repo.

**Step 2 — the push** (one command, from a clone of GridAIcon on the `Reptracker` branch):

```bash
git subtree split --prefix=reptrack -b reptrack-only
git push https://github.com/ArtyG-Dev/reptrack.git reptrack-only:main
```

**Step 3 — you:** in the new repo, **Settings → Pages → Source: GitHub Actions**.

The workflow then runs the full test suite and the footprint check on every push, and
publishes to `https://artyg-dev.github.io/reptrack/` only if they pass.

## Option B — publish from GridAIcon

Requires making `ArtyG-Dev/GridAIcon` public, which exposes the GridAIcon source too.
If you want this, say so explicitly — I will not flip a repository's visibility on my own.

1. Copy `reptrack/deploy/github-pages.yml` to `.github/workflows/pages.yml` at the repo root.
2. **Settings → Pages → Source: GitHub Actions**.
3. Push to the `Reptracker` branch. The workflow uploads `reptrack/` as the Pages artifact.

Published at `https://artyg-dev.github.io/GridAIcon/`.

## Option C — no GitHub at all

Any static host works, and several are free without going public:

- **Netlify / Cloudflare Pages** — drag the `reptrack/` folder in, or point them at the
  private repo. Both give HTTPS and both can serve from a private source.
- **Your own box** — `npm run serve` behind any TLS-terminating reverse proxy.

RepTrack makes no assumptions about its host: no server-side anything, no API, relative
paths throughout, so it works at a domain root or in a subdirectory.

---

## Verifying a deployment

Once it is live, on the phone:

1. Open the URL in Chrome → menu → **Install app**.
2. Launch from the home screen; confirm it opens full-screen with no browser chrome.
3. Turn on flight mode and reopen — it must still load.
4. Run the check in `MANUAL_TEST.md`.

And from any machine:

```bash
npx lighthouse https://<your-url>/ --only-categories=pwa,accessibility --view
```

Expect the same scores as the local run recorded in `ACCEPTANCE.md`.

---

## A note on caching

`sw.js` uses a versioned cache (currently `reptrack-shell-v5`) and deletes older caches on activate.
**Bump that version string whenever you change a shipped file**, or returning visitors will
keep the old shell until their cache is evicted.

---

## Search indexing

GitHub Pages sites are public by default and **are** crawled/indexed unless told not to.
RepTrack asks not to be, on both channels available to a static site:

- **`robots.txt`** at the site root (`Disallow: /` for all user agents).
- **`<meta name="robots" content="noindex, nofollow, noarchive, nosnippet">`** in every
  served HTML page's `<head>` — checked programmatically in
  `tests/pwa-static.test.js` so a future page can't ship without it.

robots.txt + noindex meta added; GitHub Pages does not support custom response headers, so
`X-Robots-Tag` is not applied at this host. If the site ever moves to a host that does
support custom headers, add `X-Robots-Tag: noindex, nofollow` there too.

**These are requests, not access control.** Compliant crawlers (Google, Bing) honour them.
They do not make the app private: the URL still works for anyone with the link, and since
the repo is public (required for free-tier Pages), the source and the exact URL are
discoverable by anyone browsing GitHub regardless of indexing rules. The live URL is
mentioned in this repo's own docs only in plain/code-formatted text, never as a markdown
hyperlink, so GitHub's own (indexed) repo page isn't itself a discovery path — but that is
a minor mitigation, not a barrier. If you want the app to be unreachable by an
unauthenticated visitor, that's a separate feature (auth/access control), not something
robots.txt or a meta tag can provide.

## Voice data on a deployed instance

Nothing about deploying RepTrack sends voice data anywhere, because RepTrack never has any
to send. Spelled out, since "the app uses your microphone" invites the question:

- The app calls the **Web Speech API**, which is a live recognition stream rather than a
  recorder. What the browser passes back is a transcript string and a confidence number —
  there is no audio object in that API for the app to store, upload, or fail to delete.
- The source contains no `MediaRecorder`, `getUserMedia`, `AudioContext` or
  `createMediaStreamSource`. `tests/pwa-static.test.js` fails the build if one appears.
- `tests/browser.test.js` → "a full voice log writes zero audio bytes to any app-controlled
  storage" drives a real voice log and then sweeps every IndexedDB database, every Cache
  Storage entry, `localStorage` and `sessionStorage` for binary or audio-shaped data.
- RepTrack makes **no network requests at runtime** at all — enforced by test — so there is
  no endpoint for a transcript, let alone audio, to be posted to.

**The honest limit.** All of the above covers storage and traffic *this origin controls*.
Some browser and OS speech implementations perform recognition server-side, and may buffer
or log audio inside their own infrastructure. That happens below the app, is invisible to
it, and cannot be cleared by it. Do not read the tests above as a statement about the
platform layer — they are a statement about RepTrack. Anyone who needs a guarantee spanning
the platform should use the tap-to-text fallback, which is a complete alternative path to
every voice feature and involves no microphone at all.

---

## Live verification

### 3D theme visuals pass — commit `b5f9fa3`, 2026-11-09

- GitHub Actions "Deploy to GitHub Pages" run #23 (id `42550053860`): conclusion `success`.
- `https://artyg-dev.github.io/reptrack/` → `200`. `manifest.webmanifest`, `sw.js` and every new
  module (`js/theme-engine.js`, `js/gl.js`, `js/backdrop-gl.js`, `js/graphic-view.js`) → `200`
  with the right content types. `sw.js`, `js/backdrop.js` and `js/backdrop-gl.js` are byte-identical
  to the commit.
- In headless Chromium against the live site: the service worker registers with scope `/reptrack/`
  and holds exactly one cache, `reptrack-shell-v3`. The bump means installed PWAs drop `v2` on their
  next launch. Kemet runs on `webgl2` and animates, with no console errors.
- `npm run visuals -- --url <live site>` captured all 24 shots from the live deployment into
  `docs/screenshots/live/`. All four skins report `webgl2` and match the local captures.

Earlier passes could only confirm the Actions run, because this sandbox's proxy refused the Pages
host. This session's environment now allows it, so the live files themselves were fetched back.

### Forge rotation + plates — commit `9f37261`, 2026-11-09

- The live site serves `sw.js`, `js/app.js`, `js/backdrop.js`, `js/backdrop-gl.js`,
  `js/theme-engine.js` and `js/graphic-view.js` byte-identical to the commit. The service
  worker is scoped to `/reptrack/` with the single cache `reptrack-shell-v5`.
- On the live site, the same scripted Forge drag that changed **0.11%** of the frame before
  the fix now changes **4.85%**. Level 6 shows two large plates per side. No console errors.
- `docs/screenshots/live/` re-captured from the deployment, including the Forge plate set.
