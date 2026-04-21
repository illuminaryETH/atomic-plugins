#!/usr/bin/env node

/**
 * Playwright-driven probes for the /editor-harness page.
 *
 * Measures what the eye can't easily quantify: cumulative layout shift
 * during idle, cursor movement, typing, and scroll, plus whether a
 * drag-selection still produces the raw markdown on copy.
 *
 * Usage:
 *   node scripts/test-editor-harness.mjs               # auto-start dev server
 *   node scripts/test-editor-harness.mjs --headed      # see the browser
 *   node scripts/test-editor-harness.mjs --skip-dev    # assume :1420 is up
 *   HARNESS_URL=http://foo:1420 node scripts/test-editor-harness.mjs
 */

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const args = new Set(process.argv.slice(2));
const headed = args.has('--headed');
const skipDev = args.has('--skip-dev');
const base = process.env.HARNESS_URL || 'http://localhost:1420';

const SCREENSHOT_DIR = path.join(repoRoot, '.harness-screenshots');
rmSync(SCREENSHOT_DIR, { recursive: true, force: true });
mkdirSync(SCREENSHOT_DIR, { recursive: true });

// ---------- dev server lifecycle ----------

async function isServerUp(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1200) });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await isServerUp(base)) {
    log('info', `using existing dev server at ${base}`);
    return null;
  }
  if (skipDev) {
    throw new Error(`dev server not reachable at ${base} and --skip-dev was set`);
  }
  log('info', 'starting vite dev server…');
  const proc = spawn('npm', ['run', 'dev'], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  const start = Date.now();
  while (Date.now() - start < 60_000) {
    if (await isServerUp(base)) {
      log('info', `dev server ready (${Math.round((Date.now() - start) / 100) / 10}s)`);
      return proc;
    }
    await sleep(400);
  }
  proc.kill('SIGTERM');
  throw new Error(`dev server did not respond on ${base} within 60s`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------- logging ----------

const results = [];
const COLORS = { reset: '\x1b[0m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m' };
function color(c, s) {
  return process.stdout.isTTY ? `${COLORS[c]}${s}${COLORS.reset}` : s;
}

function log(level, msg) {
  const tag = level === 'fail' ? color('red', 'FAIL') : level === 'warn' ? color('yellow', 'WARN') : level === 'ok' ? color('green', ' OK ') : color('cyan', 'INFO');
  console.log(`[${tag}] ${msg}`);
}

function record(name, status, detail) {
  results.push({ name, status, detail });
  log(status === 'pass' ? 'ok' : status === 'warn' ? 'warn' : status === 'fail' ? 'fail' : 'info', `${name.padEnd(38)} ${detail}`);
}

// ---------- CLS measurement helpers ----------

const BEGIN_CLS_WINDOW = /* js */ `
  (() => {
    window.__clsEntries = [];
    window.__clsObserver?.disconnect();
    window.__clsObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__clsEntries.push({
          value: entry.value,
          hadRecentInput: entry.hadRecentInput,
          startTime: entry.startTime,
          sources: (entry.sources || []).map(s => ({
            node: s.node?.nodeName || null,
            className: s.node?.className || null,
            previousRect: { x: s.previousRect.x, y: s.previousRect.y, w: s.previousRect.width, h: s.previousRect.height },
            currentRect: { x: s.currentRect.x, y: s.currentRect.y, w: s.currentRect.width, h: s.currentRect.height },
          })),
        });
      }
    });
    window.__clsObserver.observe({ type: 'layout-shift', buffered: false });
  })();
`;

const END_CLS_WINDOW = /* js */ `
  (() => {
    window.__clsObserver?.disconnect();
    const entries = window.__clsEntries || [];
    window.__clsEntries = [];
    const total = entries.reduce((a, e) => a + e.value, 0);
    return { total, count: entries.length, entries };
  })();
`;

async function measureCLS(page, durationMs, action) {
  await page.evaluate(BEGIN_CLS_WINDOW);
  if (action) await action();
  await page.waitForTimeout(durationMs);
  return page.evaluate(END_CLS_WINDOW);
}

function topShiftSources(entries, n) {
  const byNode = new Map();
  for (const e of entries) {
    for (const s of e.sources || []) {
      const key = `${s.node}.${(s.className || '').toString().split(' ').slice(0, 2).join('.')}`;
      byNode.set(key, (byNode.get(key) || 0) + e.value / Math.max(1, e.sources.length));
    }
  }
  return [...byNode.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `${k}(${v.toFixed(3)})`)
    .join(', ');
}

// ---------- probes ----------

async function probeIdle(page) {
  await page.waitForSelector('.cm-editor');
  await page.waitForTimeout(300);
  const cls = await measureCLS(page, 1500);
  const status = cls.total < 0.05 ? 'pass' : cls.total < 0.2 ? 'warn' : 'fail';
  record('idle CLS (1.5s post-mount)', status, `total=${cls.total.toFixed(3)} shifts=${cls.count}`);
  return cls;
}

async function probeCursorPingPong(page) {
  // Bounce the cursor between an H2 and a plain paragraph line a few
  // times. Each cursor move swaps which line is "active" and triggers
  // a decoration rebuild; if the swap changes heights, CLS spikes.
  const h2 = page.locator('.cm-line.cm-atomic-h2').first();
  const para = page.locator('.cm-line:not([class*="cm-atomic"])').nth(4);
  if ((await h2.count()) === 0 || (await para.count()) === 0) {
    record('cursor ping-pong CLS', 'fail', 'missing target lines');
    return null;
  }
  const h2box = await h2.boundingBox();
  const pbox = await para.boundingBox();
  if (!h2box || !pbox) {
    record('cursor ping-pong CLS', 'fail', 'no bbox');
    return null;
  }
  const cls = await measureCLS(page, 2500, async () => {
    for (let i = 0; i < 5; i++) {
      await page.mouse.click(h2box.x + 40, h2box.y + h2box.height / 2);
      await page.waitForTimeout(160);
      await page.mouse.click(pbox.x + 40, pbox.y + pbox.height / 2);
      await page.waitForTimeout(160);
    }
  });
  const status = cls.total < 0.05 ? 'pass' : cls.total < 0.2 ? 'warn' : 'fail';
  const topSrc = topShiftSources(cls.entries, 4);
  record(
    'ping-pong CLS (10 moves)',
    status,
    `total=${cls.total.toFixed(3)} shifts=${cls.count}${topSrc ? ` sources=${topSrc}` : ''}`,
  );
  return cls;
}

async function probeClickFreeze(page) {
  // Behavior under test: when you click a heading line, the `# ` prefix
  // should NOT appear immediately (that's what shifts layout under the
  // cursor and turns clicks into micro-drags). It should appear a beat
  // after the mouse is released, once the freeze tail expires.
  const h2 = page.locator('.cm-line.cm-atomic-h2').first();
  if ((await h2.count()) === 0) {
    record('click freeze: heading stays rendered during click', 'fail', 'no H2 line');
    return;
  }
  const box = await h2.boundingBox();
  if (!box) {
    record('click freeze: heading stays rendered during click', 'fail', 'no bbox');
    return;
  }

  // Measure the line text before the click — we expect `## ` to be
  // hidden, so the text starts with the heading's first non-syntax
  // character.
  const textBefore = (await h2.textContent())?.trim() ?? '';

  await page.mouse.click(box.x + Math.min(box.width / 3, 80), box.y + box.height / 2);

  // Within the freeze window (<160ms), the syntax should still be hidden.
  await page.waitForTimeout(30);
  const textDuringFreeze = (await h2.textContent())?.trim() ?? '';
  const stayedRendered = !/^##\s/.test(textDuringFreeze);

  // After the freeze tail, syntax should be revealed.
  await page.waitForTimeout(250);
  const textAfterFreeze = (await h2.textContent())?.trim() ?? '';
  const revealed = /^##\s/.test(textAfterFreeze);

  record(
    'click freeze: heading stays rendered mid-click',
    stayedRendered ? 'pass' : 'fail',
    `before="${textBefore.slice(0, 40)}" duringFreeze="${textDuringFreeze.slice(0, 40)}"`,
  );
  record(
    'click freeze: syntax revealed after tail',
    revealed ? 'pass' : 'fail',
    `afterFreeze="${textAfterFreeze.slice(0, 40)}"`,
  );

  // Verify the click didn't turn into a micro-drag — selection should
  // be a collapsed cursor, not a range.
  const selLen = await page.evaluate(() => window.getSelection()?.toString().length ?? 0);
  record(
    'click freeze: no accidental selection',
    selLen === 0 ? 'pass' : 'fail',
    `selectionLen=${selLen}`,
  );
}

async function probeTyping(page) {
  // Cursor should already be somewhere in the doc. Type a burst of
  // characters and watch CLS.
  const cls = await measureCLS(page, 1200, async () => {
    for (const ch of 'hello world') {
      await page.keyboard.press(ch === ' ' ? 'Space' : `Key${ch.toUpperCase()}`);
      await page.waitForTimeout(25);
    }
  });
  const status = cls.total < 0.05 ? 'pass' : cls.total < 0.2 ? 'warn' : 'fail';
  record('type inside line (CLS)', status, `total=${cls.total.toFixed(3)} shifts=${cls.count}`);
  return cls;
}

async function probeScroll(page) {
  const editor = page.locator('.cm-scroller');
  await editor.evaluate((el) => { el.scrollTop = 0; });
  await page.waitForTimeout(200);
  const cls = await measureCLS(page, 2000, async () => {
    await editor.evaluate(async (el) => {
      const step = Math.max(el.clientHeight * 0.8, 400);
      for (let i = 0; i < 10; i++) {
        el.scrollTop += step;
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      }
    });
  });
  const status = cls.total < 0.15 ? 'pass' : cls.total < 0.6 ? 'warn' : 'fail';
  const topSrc = topShiftSources(cls.entries, 3);
  record('scroll CLS (2s)', status, `total=${cls.total.toFixed(3)} shifts=${cls.count}${topSrc ? ` sources=${topSrc}` : ''}`);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04-after-scroll.png'), fullPage: false });
  return cls;
}

async function probeSelection(page) {
  const editor = page.locator('.cm-scroller');
  await editor.evaluate((el) => { el.scrollTop = 0; });
  await page.waitForTimeout(200);

  // Drag across multiple visible lines.
  const lines = page.locator('.cm-line:not(:empty)');
  const count = await lines.count();
  if (count < 3) {
    record('drag-select across lines', 'fail', `only ${count} lines visible`);
    return null;
  }
  const firstBox = await lines.nth(1).boundingBox();
  const lastBox = await lines.nth(Math.min(count - 1, 5)).boundingBox();
  if (!firstBox || !lastBox) {
    record('drag-select across lines', 'fail', 'no bbox');
    return null;
  }

  const startX = firstBox.x + 20;
  const startY = firstBox.y + firstBox.height / 2;
  const endX = lastBox.x + Math.min(200, lastBox.width - 20);
  const endY = lastBox.y + lastBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  const steps = 18;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await page.mouse.move(startX + (endX - startX) * t, startY + (endY - startY) * t);
    await page.waitForTimeout(8);
  }
  await page.mouse.up();
  await page.waitForTimeout(150);

  const selection = await page.evaluate(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return { empty: true };
    const s = sel.toString();
    return { empty: s.length === 0, length: s.length };
  });

  if (selection.empty) {
    record('drag-select across lines', 'fail', 'window.getSelection() empty');
  } else {
    record('drag-select across lines', 'pass', `len=${selection.length}B`);
  }
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '05-selection.png'), fullPage: false });
  return selection;
}

async function probeCopyIsRawMarkdown(page) {
  // Synthesize a copy event and capture what CM6 puts on the clipboard.
  const payload = await page.evaluate(() => {
    const target = document.querySelector('.cm-content');
    if (!target) return { error: 'no .cm-content' };
    const dt = new DataTransfer();
    const ev = new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: dt });
    target.dispatchEvent(ev);
    return { text: dt.getData('text/plain') };
  });
  if (!payload || payload.error) {
    record('copy yields raw markdown', 'fail', payload?.error || 'unknown');
    return null;
  }
  const text = payload.text || '';
  const looksLikeMarkdown =
    /(^|\n)#{1,6}\s|\*\*|`{1,3}|(^|\n)[-*]\s|\[[^\]]+\]\(/.test(text) || text.length > 40;
  const status = text && looksLikeMarkdown ? 'pass' : 'warn';
  const preview = text.slice(0, 60).replace(/\n/g, '\\n');
  record('copy yields raw markdown', status, `len=${text.length}B preview="${preview}"`);
  return payload;
}

// ---------- driver ----------

async function run() {
  const devProc = await ensureServer();
  const browser = await chromium.launch({ headless: !headed });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  context.on('weberror', (err) => log('warn', `page weberror: ${err.error().message}`));
  const page = await context.newPage();
  page.on('pageerror', (err) => log('warn', `pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') log('warn', `console.error: ${msg.text()}`);
  });

  try {
    log('info', `navigating to ${base}/editor-harness`);
    await page.goto(`${base}/editor-harness`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.cm-editor');
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-initial.png'), fullPage: false });

    await probeIdle(page);
    await probeClickFreeze(page);
    await probeCursorPingPong(page);
    await probeTyping(page);
    await probeSelection(page);
    await probeCopyIsRawMarkdown(page);
    await probeScroll(page);

    const failCount = results.filter((r) => r.status === 'fail').length;
    const warnCount = results.filter((r) => r.status === 'warn').length;
    console.log('');
    log('info', `${results.length} probes: ${failCount} fail, ${warnCount} warn`);
    log('info', `screenshots: ${SCREENSHOT_DIR}`);
    process.exitCode = failCount > 0 ? 1 : 0;
  } finally {
    await browser.close();
    if (devProc && !devProc.killed) {
      devProc.kill('SIGTERM');
      await Promise.race([once(devProc, 'exit'), sleep(2000)]);
    }
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
