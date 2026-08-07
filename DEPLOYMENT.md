# DEPLOYMENT.md — GitHub Pages

RepTrack is a static site with no build step, so deployment is "copy `reptrack/` to a
web root". GitHub Pages is the shortest path to an HTTPS URL, and HTTPS is what an
Android PWA install needs.

> **Blocked on one decision.** GitHub Pages on the **free** plan only publishes from
> **public** repositories. `ArtyG-Dev/GridAIcon` is private, so deploying means either
> making that repo public or moving RepTrack to its own public repo. Nothing has been
> published and nothing has been made public — say which way you want to go.

---

## Option A — move RepTrack to its own public repo (recommended)

Keeps GridAIcon private and gives RepTrack the repo it was meant to have.

```bash
# from a clone of GridAIcon, on the Reptracker branch
git subtree split --prefix=reptrack -b reptrack-only

# create a new PUBLIC repo artyg-dev/reptrack on github.com, then:
git push git@github.com:ArtyG-Dev/reptrack.git reptrack-only:main
```

Then in the new repo: **Settings → Pages → Source: GitHub Actions**, and commit
`deploy/github-pages.yml` to `.github/workflows/pages.yml` with `PROJECT_DIR: .`.

Published at `https://artyg-dev.github.io/reptrack/`.

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
