/**
 * Records the showcase demo: drives the chat UI with Playwright and captures JPEG frames
 * with their wall-clock times, plus the time ranges spent waiting for the LLM.
 * `make-video.ts` turns them into an mp4 with the waits fast-forwarded.
 *
 *   npx tsx examples/showcase/record-demo.ts [outDir]
 */
import { chromium, type Page } from '@playwright/test';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';

const BASE = process.env.LORE_URL ?? 'http://localhost:4747';
const outDir = process.argv[2] ?? join('examples', 'showcase', 'out', 'raw');
const env = Object.fromEntries(
  readFileSync(join('examples', 'showcase', '.env'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);

const frames: { file: string; t: number }[] = [];
const waits: { from: number; to: number }[] = [];
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A chapter card drawn in the page (screencast overlays are not part of the captured frames). */
async function chapter(page: Page, title: string, description: string, ms: number): Promise<void> {
  await page.evaluate(
    (text) => {
      const bg = document.createElement('div');
      bg.id = 'demo-chapter';
      Object.assign(bg.style, {
        position: 'fixed', inset: '0', zIndex: '99999', display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: 'rgba(10,10,18,.55)', backdropFilter: 'blur(6px)',
        opacity: '0', transition: 'opacity .35s ease',
      });
      const card = document.createElement('div');
      Object.assign(card.style, {
        padding: '36px 56px', borderRadius: '18px', background: 'rgba(30,30,48,.92)',
        border: '1px solid rgba(129,140,248,.45)', boxShadow: '0 20px 60px rgba(0,0,0,.5)',
        textAlign: 'center', fontFamily: 'Inter, system-ui, sans-serif', maxWidth: '980px',
      });
      const h = document.createElement('div');
      h.textContent = text.title;
      Object.assign(h.style, { fontSize: '44px', fontWeight: '700', color: '#eef', letterSpacing: '-0.5px' });
      const d = document.createElement('div');
      d.textContent = text.description;
      Object.assign(d.style, { marginTop: '12px', fontSize: '21px', color: '#a5b4fc' });
      card.append(h, d);
      bg.append(card);
      document.body.append(bg);
      requestAnimationFrame(() => { bg.style.opacity = '1'; });
    },
    { title, description },
  );
  await pause(ms);
  await page.evaluate(() => {
    const bg = document.getElementById('demo-chapter');
    if (!bg) return;
    bg.style.opacity = '0';
    setTimeout(() => bg.remove(), 400);
  });
  await pause(500);
}

/** Types like a person, sends, waits for the streamed answer to finish (the wait is fast-forwarded later). */
async function ask(page: Page, question: string): Promise<void> {
  const input = page.locator('#input');
  await input.click();
  await input.pressSequentially(question, { delay: 38 });
  await pause(500);
  const before = await page.locator('.msg:not(.user) .bubble.a').count();
  await page.keyboard.press('Enter');
  // keep the "Found N docs" moment at normal speed
  await page.locator('.search-notice').nth(before).waitFor({ timeout: 60_000 }).catch(() => {});
  await pause(1500);
  const from = Date.now();
  await page.waitForFunction(
    (n) => {
      const bubbles = document.querySelectorAll('.msg:not(.user) .bubble.a');
      if (bubbles.length <= n) return false;
      const last = bubbles[bubbles.length - 1];
      return !last.querySelector('.cursor') && (last.textContent ?? '').trim().length > 40;
    },
    before,
    { timeout: 360_000, polling: 250 },
  );
  waits.push({ from, to: Date.now() });
  await pause(600);
}

async function scrollAnswerIntoView(page: Page): Promise<void> {
  await page.locator('.msg:not(.user) .bubble.a').last().scrollIntoViewIfNeeded();
  await page.mouse.move(700, 450);
  await page.mouse.wheel(0, 400);
  await pause(2500);
}

/** Opens a document from the answer's citation chip (or directly when the answer did not cite it), scrolls and closes it. */
async function openCitation(page: Page, lib: string, slug: string): Promise<void> {
  const chip = page.locator('.msg:not(.user) .bubble.a').last().locator('.cite-chip', { hasText: `${lib}.${slug}` }).first();
  if ((await chip.count()) > 0) {
    await chip.hover();
    await pause(500);
    await chip.click();
  } else {
    await page.evaluate(
      (doc) => (window as unknown as { openDocDrawer: (l: string, s: string) => void }).openDocDrawer(doc.lib, doc.slug),
      { lib, slug },
    );
  }
  await page.locator('#docDrawerBg.open').waitFor();
  await page.locator('#docDrawerBody').filter({ hasNotText: 'Loading…' }).waitFor();
  await pause(1800);
  const box = await page.locator('#docDrawerBody').boundingBox();
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 15 });
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, 260);
    await pause(900);
  }
  await pause(800);
  await page.locator('#docDrawerClose').click();
  await pause(800);
}

async function main(): Promise<void> {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  });
  const page = await context.newPage();
  const res = await page.request.post('/api/auth/login', {
    data: { login: env.LORE_ADMIN_LOGIN ?? 'admin', password: env.LORE_ADMIN_PASSWORD },
  });
  if (res.status() !== 204) throw new Error(`sign-in failed: ${res.status()}`);
  // start from an empty chat list (earlier runs leave their sessions behind)
  const sessions = (await (await page.request.get('/api/sessions')).json()) as { id: string }[];
  for (const s of sessions) await page.request.delete(`/api/sessions/${s.id}`, { headers: { Origin: BASE } });
  await page.goto('/');
  await page.locator('#scopeBtn').waitFor();
  await pause(1000);

  let i = 0;
  await page.screencast.start({
    size: { width: 1920, height: 1080 },
    quality: 92,
    onFrame: ({ data }) => {
      const file = `${String(i++).padStart(6, '0')}.jpg`;
      writeFileSync(join(outDir, file), data);
      frames.push({ file, t: Date.now() });
    },
  });
  await page.screencast.showActions({
    cursor: 'pointer',
    duration: 400,
    style: { title: 'display: none', highlight: 'outline: 2px solid rgba(129,140,248,.7); border-radius: 6px' },
  });
  await page.mouse.move(800, 450);
  await pause(800);

  await chapter(page, 'Lore', 'Living documentation for your services — 7 services, 52 docs pushed from CI', 3500);

  // 2. A question that crosses services, with citations
  await chapter(page, 'Ask across services', 'Answers cite the documents they come from', 2500);
  await ask(page, 'What happens when a customer cancels an order after a courier was assigned?');
  await scrollAnswerIntoView(page);
  const firstGroup = page.locator('.find-group-header').first();
  await firstGroup.hover();
  await pause(400);
  await firstGroup.click();
  await pause(2500);
  await openCitation(page, 'orders-service', 'orders/cancel-order');

  // 3. Architecture docs with diagrams
  await chapter(page, 'Diagrams and flows', 'Mermaid diagrams render right in the answer sources', 2500);
  await ask(page, 'Walk me through the lifecycle of an order and its statuses.');
  await scrollAnswerIntoView(page);
  await openCitation(page, 'orders-service', 'orders/overview');

  // 4. Scope to one service and ask the on-call question
  await chapter(page, 'Scope to a service', 'Narrow the chat to one team\'s docs — here dispatch-service', 2500);
  await page.locator('#newChatBtn').click();
  await pause(800);
  await page.locator('#scopeBtn').click();
  await pause(700);
  await page.locator('#scopeSearchInput').pressSequentially('disp', { delay: 90 });
  await pause(500);
  const item = page.locator('.scope-item', { hasText: 'dispatch-service' }).first();
  await item.hover();
  await pause(400);
  await item.click();
  await pause(900);
  await page.locator('#messages').click({ position: { x: 600, y: 500 } });
  await pause(800);
  await ask(page, 'What should on-call do when no couriers are available?');
  await scrollAnswerIntoView(page);
  await openCitation(page, 'dispatch-service', 'ops/no-couriers-available');

  // 5. Publish the conversation as an insight
  await chapter(page, 'Keep what you learned', 'Publish a chat as an Insight — searchable by everyone', 2500);
  await page.locator('#publishBtn').click();
  await pause(900);
  await page.locator('#pubTitle').pressSequentially('On-call: no couriers available', { delay: 40 });
  await pause(600);
  const from = Date.now();
  await page.locator('#pubConfirm').click();
  await page.locator('.bubble.a', { hasText: 'Published as insight' }).waitFor({ timeout: 360_000 });
  waits.push({ from: from + 1200, to: Date.now() });
  await pause(800);
  await page.locator('.sb-item').first().hover();
  await pause(2500);

  // 6. Agents
  await chapter(page, '…and for your agents', 'The same knowledge over MCP: claude mcp add --transport http lore http://localhost:4748/mcp', 4000);

  await page.screencast.stop();
  await browser.close();
  writeFileSync(join(outDir, 'timeline.json'), JSON.stringify({ frames, waits }, null, 1));
  console.log(`${frames.length} frames, ${waits.length} waits -> ${outDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
