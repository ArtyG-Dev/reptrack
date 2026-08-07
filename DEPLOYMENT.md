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

`sw.js` uses a versioned cache (`reptrack-shell-v1`) and deletes older caches on activate.
**Bump that version string whenever you change a shipped file**, or returning visitors will
keep the old shell until their cache is evicted.
