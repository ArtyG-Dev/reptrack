# DEPLOY.md — the legacy copy

How the pre-3D-muscle-map version of RepTrack stays available, both as code and as a
working site, and how to retire it. For the main deployment (GitHub Pages, the workflow,
cache bumps), see `DEPLOYMENT.md`.

## Where the old version lives

| What | Where |
|---|---|
| Code, frozen | the tag `v-pre-musclemap`, and the branch `stable-pre-musclemap` (same commit) |
| Working site | `/reptrack/legacy/` on the Pages site, i.e. `https://artyg-dev.github.io/reptrack/legacy/` |
| How it is built | `node scripts/build-legacy.mjs` builds `legacy/` from the tag; the folder is committed on `main` |

Pages serves one site from the repository root, so the old version is a folder inside it
rather than a second site.

## Why it needs isolating

Both versions run on the same origin. By default they would share **IndexedDB, Cache
Storage, `localStorage` and a service worker**: the new version's data migration could
then change the old one's data, or the old one could write data the new one doesn't
expect. The build script isolates the copy, and every edit it makes asserts that what it
replaces is there exactly once, so it fails loudly rather than building a shared copy:

| Shared by default | In the legacy copy |
|---|---|
| IndexedDB `reptrack` | its own database, `reptrack-legacy` (`legacy/js/db.js`) |
| `localStorage` / `sessionStorage` | the app uses none; the keys the copy adds are prefixed `legacy:` (`legacy:copied`, `legacy:bannerDismissed`) |
| Service worker `/reptrack/sw.js`, scope `/reptrack/` | its own, `/reptrack/legacy/sw.js`, scope `/reptrack/legacy/` (the more specific scope wins for its pages) |
| Cache `reptrack-shell-vN` | `reptrack-legacy-shell-vN`. Each worker deletes **only its own prefix** on activate, so neither clears the other's cache |
| Manifest id `reptrack` | id `reptrack-legacy`, name "RepTrack (legacy)", `start_url`/`scope` inside `/legacy/`, so installing it never replaces the main app |

The main service worker (`sw.js`) never answers for anything under `/legacy/`: not a file,
and not a navigation. Without that, the first visit to `/legacy/` would get the main app's
cached shell. `tests/pwa-static.test.js` and `tests/legacy.test.js` hold all of this in place,
the second in real Chromium. It checks which worker controls each page, that each cache
holds only its own app's files, the one-time copy, and that data logged in either version
doesn't appear in the other.

The legacy copy keeps the `noindex` meta tag, and the root `robots.txt` covers it too.
There is no passcode gate: the app never had one, and at the user's choice none was added
(see `DECISIONS.md`).

## The one-time data copy

On its first launch, `legacy/legacy-boot.js` runs before the app and:

1. checks `indexedDB.databases()` for the main `reptrack` database (it never opens one
   that doesn't exist, because opening creates it);
2. if `reptrack-legacy` doesn't exist yet, reads every store of `reptrack` without a
   version number (so it can never upgrade the main database) and imports it into
   `reptrack-legacy` through the old app's own `importAll()`;
3. maps muscle ids the new version introduced back to the ones the old version knows
   (`upper-back-lats` → `lats` + `upper-back`, `traps` → `upper-back`);
4. records `legacy:copied`, so it never copies again.

After that the two are independent: workouts logged in one **do not** appear in the
other. A small, dismissible banner says so: "Legacy version: data here is separate from
the main app."

**Being precise about "as it was at the time of branching":** the copy happens on the
legacy copy's *first launch*, from whatever the main database holds at that moment. If
the main app has been used since this release, the copy includes that later data as well
(with the muscle ids mapped back). A browser without `indexedDB.databases()` skips the
copy and opens empty, rather than risk creating a stray main database.

**First visit on a device that already has the old main app installed:** until that
device's main service worker updates to this release (the next time the main app is
opened), it may still answer `/legacy/` with its own shell once. Open the main app first,
or reload `/legacy/` once, and from then on the legacy copy's own worker answers.

## Rebuilding

```bash
node scripts/build-legacy.mjs                 # from v-pre-musclemap
```

The tag must exist locally (`git fetch --tags`). Commit the regenerated `legacy/`.

## Retiring the legacy copy

1. Delete the folder and its build script, and commit:
   ```bash
   git rm -r legacy scripts/build-legacy.mjs tests/legacy.test.js
   ```
   Also remove the legacy test from `scripts/run-acceptance.mjs`, and remove the legacy
   test block from `tests/pwa-static.test.js`.
2. Keep the main worker's `/legacy/` bypass for one release, so devices that still have
   the legacy worker installed aren't served the main shell at that path. It can go
   after that.
3. On each device that used it: open `/reptrack/legacy/` once, then in the browser's site
   settings unregister its service worker and clear its storage. Or, from the console on
   that page:
   ```js
   (await navigator.serviceWorker.getRegistration('./'))?.unregister();
   indexedDB.deleteDatabase('reptrack-legacy');
   for (const k of await caches.keys()) if (k.startsWith('reptrack-legacy-')) await caches.delete(k);
   ```
   Uninstall "RepTrack (legacy)" if it was installed. None of this touches the main app's
   data.
4. The tag and the `stable-pre-musclemap` branch can stay: they cost nothing and keep the
   code reachable.
