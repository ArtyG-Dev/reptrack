# Claude Code — Follow-up Prompt: Block Search Indexing

RepTrack is live at `https://artyg-dev.github.io/reptrack/`. GitHub Pages sites are public by default and **are** crawled/indexed by search engines and general-purpose bots unless explicitly told not to. Add the following, commit, push, and re-verify the live site after deploy.

## 1. robots.txt

Create `/robots.txt` at the site root (so it serves at `https://artyg-dev.github.io/reptrack/robots.txt`):

```
User-agent: *
Disallow: /
```

## 2. Meta tag on every HTML page

Add to the `<head>` of `index.html` (and any other served HTML page):

```html
<meta name="robots" content="noindex, nofollow, noarchive, nosnippet">
```

## 3. HTTP header (belt-and-braces)

GitHub Pages doesn't let you set arbitrary response headers, so the meta tag above is the primary mechanism. Note this limitation in `DEPLOY.md` rather than silently skipping it — if the site ever moves to a host that supports custom headers, add `X-Robots-Tag: noindex, nofollow` there too.

## 4. Don't link to it from anywhere crawlable

Confirm the repo's public `README.md` doesn't contain the live URL as a clickable link on a page search engines already index (e.g. GitHub's own repo page is itself indexed) — mention it as plain text or in a private note instead, not a hyperlink, since a hyperlink is itself a discovery path independent of robots.txt.

## 5. Acceptance check

- [ ] `robots.txt` returns 200 with the disallow-all rule when fetched directly.
- [ ] Every HTML page's rendered `<head>` contains the noindex meta tag — check this programmatically, not just on `index.html`.
- [ ] Confirm in `DEPLOY.md`: "robots.txt + noindex meta added; GitHub Pages does not support custom response headers, so X-Robots-Tag is not applied at this host."

## Important caveat — read before assuming this is enough

`robots.txt` and `noindex` are **requests, not access control.** Compliant crawlers (Google, Bing) honour them and won't index the site. But:
- The URL still works for **anyone who has the link** — nothing here makes the app private or password-protected.
- Non-compliant bots, scrapers, and anyone who finds the link (shared, leaked, guessed, pulled from GitHub's public repo history if the repo itself is public) can still open it.
- If the **repo** is public (required for free-tier Pages, per the earlier deployment decision), the source code — and the exact URL — are discoverable by anyone browsing GitHub, indexing rules aside.

If you want the app itself to not be reachable by an unauthenticated visitor, that's a separate feature — see the password/access question below, which this indexing fix does **not** solve.
