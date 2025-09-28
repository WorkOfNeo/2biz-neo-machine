import puppeteer from "puppeteer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BASE = "https://2-biz.spysystem.dk";
const LOGIN_PAGE = `${BASE}/?controller=Index&action=GetLoginPage`;
const STYLE_LIST_URL = `${BASE}/?controller=Style%5CIndex&action=List`;
const STYLE_LIST_ALL_URL = `${STYLE_LIST_URL}&show_all=1`;

type LogLine = { type: "log"; t: string; m: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ensureLoggedIn(page: puppeteer.Page, username: string, password: string, addLog: (m: string) => void) {
  // If already logged in, the login form won't exist
  addLog("STEP: Ensuring logged in");
  await page.goto(LOGIN_PAGE, { waitUntil: "domcontentloaded" });
  const isLogin = await page.evaluate(() => !!document.querySelector('input[name="username"], form[action*="SignIn"]'));
  if (!isLogin) {
    addLog("STEP: Session already authenticated");
    return;
  }
  addLog("STEP: Typing credentials");
  try { await page.type('input[name="username"]', username, { delay: 10 }); } catch {}
  try { await page.type('input[name="password"]', password, { delay: 10 }); } catch {}
  addLog("STEP: Submitting login form");
  await Promise.race([
    (async () => {
      try { await page.click('button[type="submit"], input[type="submit"]'); } catch {}
      try { await page.waitForNavigation({ waitUntil: ["domcontentloaded", "networkidle0"], timeout: 30000 }); } catch {}
    })(),
    sleep(30000),
  ]);
  // Verify we are not on login anymore
  const stillLogin = await page.evaluate(() => !!document.querySelector('input[name="username"], form[action*="SignIn"]'));
  addLog(`STEP: Login page present after submit = ${stillLogin}`);
}

async function scrapeStyleList(page: puppeteer.Page, addLog: (m: string) => void) {
  addLog("STEP: Opening style list (with show_all=1)");
  await page.goto(STYLE_LIST_ALL_URL, { waitUntil: "domcontentloaded" });
  addLog(`STEP: On list url=${page.url()}`);

  // If we got bounced back to login, re-login then navigate again
  const atLogin = await page.evaluate(() => !!document.querySelector('input[name="username"], form[action*="SignIn"]'));
  if (atLogin) {
    addLog("STEP: Detected login page when opening list, re-authenticating");
    // require caller to have ensured login; but do a soft warning
  }

  addLog("STEP: Triggering Show All");
  // Also try clicking Show All in case the param isn't respected by the server
  try {
    await page.evaluate(() => {
      const byName = document.querySelector('button[name="show_all"], input[name="show_all"]') as HTMLButtonElement | HTMLInputElement | null;
      if (byName) { (byName as HTMLButtonElement).click?.(); (byName as HTMLInputElement).click?.(); return; }
      const byText = Array.from(document.querySelectorAll('button, input[type="button"], a')).find((el) => (el.textContent || '').trim().toLowerCase() === 'show all') as HTMLElement | undefined;
      byText?.click?.();
    });
  } catch (e) {
    addLog(`STEP: Show All click error: ${(e as Error).message}`);
  }

  // If click causes navigation or reload, wait briefly for it
  try {
    await Promise.race([
      (async () => { try { await page.waitForNavigation({ waitUntil: ["domcontentloaded", "networkidle0"], timeout: 15000 }); } catch {} })(),
      sleep(1500),
    ]);
  } catch {}
  addLog(`STEP: After Show All trigger, url=${page.url()}`);

  // If we were redirected away from the list (e.g., Start/Index), force back to list with show_all=1
  if (!(page.url().includes("controller=Style%5CIndex") && page.url().includes("action=List"))) {
    addLog("STEP: Not on list after Show All, forcing navigation back to list with show_all=1");
    await page.goto(STYLE_LIST_ALL_URL, { waitUntil: "domcontentloaded" });
    addLog(`STEP: Forced list url=${page.url()}`);
  }

  // Fallback: if no rows within a short time, try reloading the list with show_all=1 explicitly
  {
    const quickStart = Date.now();
    let quickHas = false;
    while (Date.now() - quickStart < 3000) {
      const exists = await page.evaluate(() => {
        const table = document.querySelector("table.standardList");
        const body = table?.querySelector("tbody");
        return Boolean(body && body.querySelector("tr"));
      });
      if (exists) { quickHas = true; break; }
      await sleep(200);
    }
    if (!quickHas) {
      addLog("STEP: Quick Show All failed, reloading STYLE_LIST with show_all=1");
      try { await page.goto(STYLE_LIST_ALL_URL, { waitUntil: "domcontentloaded" }); } catch {}
    }
  }

  addLog("STEP: Waiting for .standardList tbody to populate (or alternatives)");
  const start = Date.now();
  let found = false;
  let attempt = 0;
  while (Date.now() - start < 45000) {
    attempt += 1;
    const exists = await page.evaluate(() => {
      function hasRows(root: ParentNode) {
        const table = root.querySelector("table.standardList");
        const body = table?.querySelector("tbody");
        return !!(body && body.querySelector("tr"));
      }
      return (
        hasRows(document) ||
        Array.from(document.querySelectorAll('.pagesMiddle, .content, .container, .main')).some((el) => hasRows(el))
      );
    });
    addLog(`STEP: Poll ${attempt} - rows present = ${exists}`);
    if (exists) { found = true; break; }
    await sleep(300);
  }
  if (!found) throw new Error("Style list table not loaded within timeout");

  addLog("STEP: Extracting list rows via header mapping");
  const rows = await page.evaluate(() => {
    function abs(href: string) {
      try { return new URL(href, location.origin).href; } catch { return href; }
    }
    const table = document.querySelector("table.standardList");
    const headCells = Array.from(table?.querySelectorAll("thead th") ?? []) as HTMLTableCellElement[];
    const head = headCells.map((th) => (th.textContent || "").trim());
    const lower = head.map((h) => h.toLowerCase());
    const idxStyleNo = lower.findIndex((t) => t.includes("style no"));
    const idxBrand = lower.findIndex((t) => t.includes("brand"));
    const idxSeason = lower.findIndex((t) => t.includes("season"));
    const idxSupplier = lower.findIndex((t) => t.includes("supplier"));
    const trs = Array.from(table?.querySelectorAll("tbody tr") ?? []) as HTMLTableRowElement[];
    return trs.map((tr, i) => {
      const cells = Array.from(tr.querySelectorAll("td"));
      const styleCell = idxStyleNo >= 0 ? cells[idxStyleNo] : cells[1];
      const brandCell = idxBrand >= 0 ? cells[idxBrand] : null;
      const seasonCell = idxSeason >= 0 ? cells[idxSeason] : null;
      const supplierCell = idxSupplier >= 0 ? cells[idxSupplier] : null;
      const styleLink = styleCell?.querySelector("a[href]") as HTMLAnchorElement | null;
      const styleNo = (styleLink?.textContent || styleCell?.textContent || "").trim();
      const href = styleLink ? abs(styleLink.href) : "";
      const id = tr.getAttribute("data-reference") || "";
      const supplier = (supplierCell?.textContent || "").trim();
      const brand = (brandCell?.textContent || "").trim();
      const season = (seasonCell?.textContent || "").trim();
      return { index: i, id, styleNo, href, supplier, brand, season };
    }).filter((r) => r.href && r.styleNo);
  });
  addLog(`STEP: Found ${rows.length} list rows with style links`);
  if (rows.length) {
    const heads = rows.slice(0, 5).map((r) => r.styleNo).join(", ");
    addLog(`STEP: First styles: ${heads}`);
  }
  return rows as Array<{ index: number; id: string; styleNo: string; href: string; supplier: string; brand: string; season: string }>;
}

async function scrapeStyleDetail(page: puppeteer.Page, url: string, addLog: (m: string) => void) {
  addLog(`STEP: Opening style detail ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded" });

  addLog("STEP: Clicking materials tab (td[data-tab-name=materials])");
  try {
    await page.evaluate(() => {
      const tab = document.querySelector('td[data-tab-name="materials"]') as HTMLElement | null;
      tab?.click?.();
      // also try any element with the attribute, in case it's not a TD
      if (!tab) {
        const any = document.querySelector('[data-tab-name="materials"]') as HTMLElement | null;
        any?.click?.();
      }
    });
  } catch {}
  try { await new Promise((r) => setTimeout(r, 300)); } catch {}
  addLog("STEP: Scoping search within [data-tab-name=materials]");
  addLog("STEP: Waiting for size table on detail page (scoped to [data-tab-name=materials])");
  const detailSelectors = ['#edit_size_box', 'div[name="Style No."]', '.pagesMiddle', '.padding10.container', '.container', '.content'];
  addLog(`STEP: Detail host selectors to try: ${detailSelectors.join(', ')}`);
  const start = Date.now();
  let ready = false;
  let attempt = 0;
  while (Date.now() - start < 45000) {
    attempt += 1;
    const info = await page.evaluate(() => {
      // Strict selectors as requested
      const materialsTab = document.querySelector('.pagesTab[data-tab-name="materials"]') as HTMLElement | null;
      const styleSection = materialsTab?.querySelector('.pagesMiddle[name="Style No."]') as HTMLElement | null;
      const table = styleSection?.querySelector('table.standardList') as HTMLTableElement | null;
      const tbody = table?.querySelector('tbody') as HTMLTableSectionElement | null;
      const rows = tbody ? tbody.querySelectorAll('tr').length : 0;
      const headers = Array.from(table?.querySelectorAll('thead th') || []).map((th) => (th.textContent || '').trim());
      const matsCount = document.querySelectorAll('.pagesTab[data-tab-name="materials"]').length;
      const sectionFound = Boolean(styleSection);
      const tableFound = Boolean(table);
      const globalTables = document.querySelectorAll('table.standardList').length;
      return {
        present: Boolean(rows > 0),
        at: tableFound ? '.pagesTab[data-tab-name="materials"] .pagesMiddle[name="Style No."] table.standardList' : '',
        headers,
        debug: { matsCount, sectionFound, tableFound, globalTables, rows },
      };
    });
    addLog(`STEP: Poll ${attempt} - size table present = ${info && (info as any).present}${info && (info as any).at ? ` (at: ${(info as any).at})` : ''}`);
    if (info && (info as any).debug) {
      const d = (info as any).debug;
      addLog(`STEP: Debug mats=${d.matsCount} section=${d.sectionFound} table=${d.tableFound} globalTables=${d.globalTables} rows=${d.rows}`);
    }
    if (info && (info as any).present) { ready = true; break; }
    await sleep(300);
  }
  if (!ready) throw new Error("Size table not found on style page");

  addLog("STEP: Parsing size matrix and assortments");
  const detail = await page.evaluate(() => {
    // Strict selectors as requested
    const materialsTab = document.querySelector('.pagesTab[data-tab-name="materials"]') as HTMLElement | null;
    const styleSection = materialsTab?.querySelector('.pagesMiddle[name="Style No."]') as HTMLElement | null;
    const table = styleSection?.querySelector('table.standardList') as HTMLTableElement | null;
    const locatedAt = '.pagesTab[data-tab-name="materials"] .pagesMiddle[name="Style No."] table.standardList';
    const headersFound = Array.from(table?.querySelectorAll('thead th') || []).map((th) => (th.textContent || '').trim());
    if (!table) return null;
    const ths = Array.from(table.querySelectorAll("thead th")) as HTMLTableCellElement[];
    // Determine size columns: skip the first label col, stop before Total/Min Qty./edit col
    const sizeHeaders: string[] = [];
    for (let i = 1; i < ths.length; i += 1) {
      const label = (ths[i].textContent || "").trim();
      if (/^Total$/i.test(label) || /^Min Qty\.?$/i.test(label) || label === "") break;
      sizeHeaders.push(label);
    }
    const rows = Array.from(table.querySelectorAll("tbody tr")) as HTMLTableRowElement[];
    const assortments: Array<{ label: string; active: boolean; perSize: Record<string, number>; total: number; minQty: number }> = [];
    const free: Record<string, number> = {};
    const rowsDump: Array<{ index: number; value: string; state: 'enabled' | 'disabled'; perSize: Record<string, number>; total: number; minQty: number }> = [];
    function toNum(s: string) { return parseFloat((s || "").replace(/[^0-9.-]/g, "")) || 0; }
    for (const tr of rows) {
      const tds = Array.from(tr.querySelectorAll("td")) as HTMLTableCellElement[];
      const labelInput = tds[0]?.querySelector('input[type="text"]') as HTMLInputElement | null;
      const labelFallback = (tds[0]?.textContent || "").trim();
      const label = (labelInput?.value || labelFallback || "");
      const activeCb = tds[0]?.querySelector('input[type="checkbox"].style-assortment--disabler, input[type="checkbox"]') as HTMLInputElement | null;
      const active = Boolean(activeCb?.checked);
      const perSize: Record<string, number> = {};
      for (let i = 0; i < sizeHeaders.length; i += 1) {
        const td = tds[i + 1];
        const input = td?.querySelector('input[type="text"]') as HTMLInputElement | null;
        const val = toNum(input ? input.value : (td?.textContent || ""));
        perSize[sizeHeaders[i]] = val;
      }
      const totalTd = tds[1 + sizeHeaders.length];
      const minQtyTd = tds[2 + sizeHeaders.length];
      const total = toNum((totalTd?.textContent || "").trim());
      let minQty = 0;
      const minInput = minQtyTd?.querySelector('input[type="text"]') as HTMLInputElement | null;
      if (minInput) { minQty = toNum(minInput.value); } else { minQty = toNum((minQtyTd?.textContent || "").trim()); }

      if (/^free$/i.test(label)) {
        Object.assign(free, perSize);
      } else if (label) {
        assortments.push({ label, active, perSize, total, minQty });
      }
      rowsDump.push({ index: rowsDump.length, value: label, state: active ? 'disabled' : 'enabled', perSize, total, minQty });
    }
    const headers = headersFound.length ? headersFound : Array.from(ths).map((th) => (th.textContent || '').trim());
    const secondRow = rowsDump[1] || null;
    return { sizes: sizeHeaders, free, assortments, locatedAt, headers, rows: rowsDump, secondRow };
  });
  if (detail && (detail as any).locatedAt) {
    addLog(`STEP: Detail table located at ${(detail as any).locatedAt}`);
    addLog(`STEP: Detail headers: ${((detail as any).headers || []).join(', ')}`);
  }
  return detail;
}

async function scrapeStockMatrix(page: puppeteer.Page, url: string, addLog: (m: string) => void) {
  // Switch to stat and stock tab
  let target = url;
  try {
    const u = new URL(url);
    u.hash = '#tab=statandstock';
    target = u.href;
  } catch {}
  addLog(`STEP: Opening stock tab ${target}`);
  await page.goto(target, { waitUntil: 'domcontentloaded' });

  addLog('STEP: Waiting for .statAndStockBox elements');
  const start = Date.now();
  let found = false;
  let attempt = 0;
  while (Date.now() - start < 30000) {
    attempt += 1;
    const count = await page.evaluate(() => document.querySelectorAll('.statAndStockBox').length);
    addLog(`STEP: Poll ${attempt} - statAndStockBox count = ${count}`);
    if (count > 0) { found = true; break; }
    await sleep(300);
  }
  if (!found) throw new Error('statAndStockBox not found');

  addLog('STEP: Parsing stock matrices');
  const data = await page.evaluate(() => {
    function toNum(s: string) { return parseFloat((s || '').replace(/[^0-9.-]/g, '')) || 0; }
    const boxes = Array.from(document.querySelectorAll('.statAndStockBox')) as HTMLElement[];
    return boxes.map((box) => {
      const headCells = Array.from(box.querySelectorAll('tr.tableBackgroundBlack td')) as HTMLTableCellElement[];
      const colorName = (headCells[0]?.innerText || '').trim().replace(/\s*\n.*/s, '');
      const sizeHeaders = headCells.slice(1).map((td) => (td.innerText || '').trim()).filter(Boolean);
      const rows = Array.from(box.querySelectorAll('tbody tr')) as HTMLTableRowElement[];
      const resultRows: Array<{ label: string; perSize: number[]; total: number }> = [];
      for (const tr of rows) {
        const tds = Array.from(tr.querySelectorAll('td')) as HTMLTableCellElement[];
        if (!tds.length) continue;
        const label = (tds[0]?.innerText || '').trim();
        if (!label) continue;
        // Skip header row already handled and skip site Total rows
        if (tr.classList.contains('tableBackgroundBlack')) continue;
        if (/^total$/i.test(label)) continue;
        const numCells = tds.slice(1).map((td) => toNum(td.innerText || ''));
        const perSize = numCells.slice(0, sizeHeaders.length);
        const total = perSize.reduce((a, b) => a + (b || 0), 0);
        resultRows.push({ label, perSize, total });
      }
      // Pick the rows of interest
      function pick(label: string) { return resultRows.find((r) => r.label.toLowerCase().includes(label)); }
      const delivered = pick('delivered');
      const stock = pick('stock');
      const available = pick('available');
      const po = pick('po (running + shipped)');
      const soldStock = pick('sold stock');
      const soldPre = pick('sold pre');
      return { colorName, sizes: sizeHeaders, delivered, stock, available, po, soldStock, soldPre };
    });
  });
  return data;
}

export async function POST(request: Request) {
  const username = process.env.SPY_USER;
  const password = process.env.SPY_PASS;
  if (!username || !password) {
    return new Response(JSON.stringify({ ok: false, error: "Missing SPY_USER or SPY_PASS" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  const url = new URL(request.url);
  const stream = url.searchParams.get("stream") === "1";
  const body = await request.json().catch(() => ({ limit: 0, skipDetails: false, links: [] as string[] }));
  const limit: number = typeof body.limit === "number" ? body.limit : 0;
  const skipDetails: boolean = Boolean((body as any).skipDetails);
  const inputLinksRaw: string[] = Array.isArray((body as any).links) ? (body as any).links : [];
  const inputLinks: string[] = inputLinksRaw
    .map((l) => { try { return new URL(l, BASE).href; } catch { return null; } })
    .filter((v, i, a) => Boolean(v) && a.indexOf(v) === i) as string[];
  const mode: string = typeof (body as any).mode === 'string' ? (body as any).mode : '';

  if (!stream) {
    // Non-streaming: run and return aggregated results
    const logs: LogLine[] = [];
    const add = (m: string) => logs.push({ type: "log", t: new Date().toISOString(), m });
    let browser: puppeteer.Browser | null = null;
    try {
      add("STEP: Launching browser");
      browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-setuid-sandbox"] });
      const page = await browser.newPage();
      page.setDefaultNavigationTimeout(60000);
      page.setDefaultTimeout(60000);
      await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");
      await ensureLoggedIn(page, username, password, add);
      let list: Array<{ index: number; id: string; styleNo: string; href: string; supplier: string; brand: string; season: string }>; 
      if (inputLinks.length > 0) {
        add(`STEP: Using provided links (${inputLinks.length}) instead of scraping list`);
        // Synthesize minimal list rows from links when provided
        list = inputLinks.map((href, idx) => ({ index: idx, id: "", styleNo: href.split("id=").pop() || `${idx + 1}`, href, supplier: "", brand: "", season: "" }));
      } else {
        list = await scrapeStyleList(page, add);
        add(`STEP: Collected ${list.length} rows from list`);
      }
      const toProcess = limit && limit > 0 ? list.slice(0, limit) : list;
      const items: any[] = [];
      if (mode === 'stock') {
        add(`STEP: Stock mode enabled, processing ${toProcess.length} links`);
        for (let i = 0; i < toProcess.length; i += 1) {
          const row = toProcess[i];
          add(`STEP: Stock ${i + 1}/${toProcess.length} - ${row.styleNo}`);
          try {
            const stock = await scrapeStockMatrix(page, row.href, add);
            items.push({ ok: true, type: 'stock', index: row.index, styleNo: row.styleNo, url: row.href, stock });
          } catch (err) {
            items.push({ ok: false, type: 'stock', index: row.index, styleNo: row.styleNo, url: row.href, error: (err as Error).message });
          }
        }
      } else if (skipDetails) {
        for (let i = 0; i < toProcess.length; i += 1) {
          const row = toProcess[i];
          items.push({ ok: true, type: "row", ...row });
        }
      } else {
        for (let i = 0; i < toProcess.length; i += 1) {
          const row = toProcess[i];
          add(`STEP: Processing ${i + 1}/${toProcess.length} - ${row.styleNo}`);
          try {
            const detail = await scrapeStyleDetail(page, row.href, add);
            items.push({ ok: true, index: row.index, styleNo: row.styleNo, id: row.id, url: row.href, brand: row.brand, season: row.season, supplier: row.supplier, ...detail });
          } catch (err) {
            items.push({ ok: false, index: row.index, styleNo: row.styleNo, id: row.id, url: row.href, error: (err as Error).message });
          }
        }
      }
      await browser.close();
      browser = null;
      return new Response(JSON.stringify({ ok: true, logs, items }), { headers: { "Content-Type": "application/json" } });
    } catch (error) {
      if (browser) { try { await browser.close(); } catch {} }
      return new Response(JSON.stringify({ ok: false, error: (error as Error).message, logs }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }

  const encoder = new TextEncoder();
  const streamBody = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      const add = (m: string) => send({ type: "log", t: new Date().toISOString(), m });
      let browser: puppeteer.Browser | null = null;
      try {
        add("STEP: BEGIN stream");
        add("STEP: Launching browser");
        browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-setuid-sandbox"] });
        const page = await browser.newPage();
        page.setDefaultNavigationTimeout(60000);
        page.setDefaultTimeout(60000);
        await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");
        await ensureLoggedIn(page, username, password, add);
        let list: Array<{ index: number; id: string; styleNo: string; href: string; supplier: string; brand: string; season: string }>; 
        if (inputLinks.length > 0) {
          add(`STEP: Using provided links (${inputLinks.length}) instead of scraping list`);
          list = inputLinks.map((href, idx) => ({ index: idx, id: "", styleNo: href.split("id=").pop() || `${idx + 1}`, href, supplier: "", brand: "", season: "" }));
        } else {
          list = await scrapeStyleList(page, add);
          add(`STEP: Collected ${list.length} rows from list`);
        }
        const toProcess = limit && limit > 0 ? list.slice(0, limit) : list;
        if (mode === 'stock') {
          add(`STEP: Stock mode enabled, streaming ${toProcess.length} links`);
          for (let i = 0; i < toProcess.length; i += 1) {
            const row = toProcess[i];
            try {
              const stock = await scrapeStockMatrix(page, row.href, add);
              send({ type: 'stock', ok: true, index: row.index, styleNo: row.styleNo, url: row.href, stock });
            } catch (err) {
              send({ type: 'stock', ok: false, index: row.index, styleNo: row.styleNo, url: row.href, error: (err as Error).message });
            }
          }
        } else if (skipDetails) {
          add(`STEP: List-only mode enabled, streaming ${toProcess.length} rows`);
          for (let i = 0; i < toProcess.length; i += 1) {
            const row = toProcess[i];
            send({ type: "row", ok: true, index: row.index, ...row });
          }
        } else {
          add(`STEP: Processing up to ${toProcess.length} rows`);
          for (let i = 0; i < toProcess.length; i += 1) {
            const row = toProcess[i];
            add(`STEP: Processing ${i + 1}/${toProcess.length} - ${row.styleNo}`);
            try {
              const detail = await scrapeStyleDetail(page, row.href, add);
              send({ type: "item", ok: true, index: row.index, styleNo: row.styleNo, id: row.id, url: row.href, brand: row.brand, season: row.season, supplier: row.supplier, ...detail });
            } catch (err) {
              send({ type: "item", ok: false, index: row.index, styleNo: row.styleNo, id: row.id, url: row.href, error: (err as Error).message });
            }
          }
        }
        send({ type: "done", ok: true });
      } catch (error) {
        send({ type: "done", ok: false, error: (error as Error).message });
      } finally {
        if (browser) { try { await browser.close(); } catch {} }
        controller.close();
      }
    },
  });

  return new Response(streamBody, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" } });
}


