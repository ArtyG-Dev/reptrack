/* Locates a Chromium build for the browser-driven tests. Prefers CHROMIUM_PATH,
 * then any Playwright browser installed system-wide, then Playwright's own
 * bundled download. Returns null when none is usable so tests can skip cleanly.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function findChromium() {
  if (process.env.CHROMIUM_PATH && existsSync(process.env.CHROMIUM_PATH)) return process.env.CHROMIUM_PATH;

  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (existsSync(root)) {
    const dirs = readdirSync(root).filter((d) => d.startsWith('chromium')).sort().reverse();
    for (const dir of dirs) {
      for (const candidate of ['chrome-linux/chrome', 'chrome-linux/headless_shell']) {
        const full = join(root, dir, candidate);
        if (existsSync(full)) return full;
      }
    }
  }
  return null;
}

export async function launch(playwrightChromium, options = {}) {
  const executablePath = findChromium();
  return playwrightChromium.launch({
    ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    ...options
  });
}
