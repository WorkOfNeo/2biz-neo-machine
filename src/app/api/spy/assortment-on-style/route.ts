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

async function scrapeStyleList(page: puppeteer.Page, addLog: (m: string) => void, seasonText?: string) {
  const useSearch = typeof seasonText === 'string' && seasonText.trim().length > 0;
  const targetUrl = useSearch ? STYLE_LIST_URL : STYLE_LIST_ALL_URL;
  addLog(`STEP: Opening style list (${useSearch ? 'search' : 'show_all=1'})`);
  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
  addLog(`STEP: On list url=${page.url()}`);

  // If we got bounced back to login, re-login then navigate again
  const atLogin = await page.evaluate(() => !!document.querySelector('input[name="username"], form[action*="SignIn"]'));
  if (atLogin) {
    addLog("STEP: Detected login page when opening list, re-authenticating");
    // require caller to have ensured login; but do a soft warning
  }

  if (useSearch) {
    let selectedSeasonId: string = '';
    addLog(`STEP: Selecting season '${seasonText}' and clicking Search`);
    try {
      const res = await page.evaluate((season) => {
        function findSelect(): HTMLSelectElement | null {
          const byId = document.getElementById('Spy\\Model\\Style\\Index\\ListReportSearch[iSeasonID]') as HTMLSelectElement | null;
          if (byId) return byId;
          const candidates = Array.from(document.querySelectorAll('select')) as HTMLSelectElement[];
          return candidates.find(sel => sel.name.includes('ListReportSearch') && sel.name.includes('[iSeasonID]')) || null;
        }
        function findSearchButton(): HTMLElement | null {
          const byName = document.querySelector('button[name="search"], input[name="search"][type="submit"]') as HTMLButtonElement | HTMLInputElement | null;
          if (byName) return byName as unknown as HTMLElement;
          const lower = (s: string) => (s || '').trim().toLowerCase();
          const btns = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[];
          const byTextBtn = btns.find(b => lower(b.textContent || '') === 'search');
          if (byTextBtn) return byTextBtn as unknown as HTMLElement;
          const inputs = Array.from(document.querySelectorAll('input[type="submit"], input[type="button"]')) as HTMLInputElement[];
          const byValue = inputs.find(i => lower(i.value || '') === 'search');
          if (byValue) return byValue as unknown as HTMLElement;
          const links = Array.from(document.querySelectorAll('a')) as HTMLAnchorElement[];
          const linkByText = links.find(a => lower(a.textContent || '') === 'search');
          return (linkByText as unknown as HTMLElement) || null;
        }
        const select = findSelect();
        const selectFound = Boolean(select);
        let optionFound = false;
        let selectedValue = '';
        if (select) {
          const targetText = String(season || '').trim().toLowerCase();
          const opt = Array.from(select.options).find(o => (o.textContent || '').trim().toLowerCase() === targetText);
          optionFound = Boolean(opt);
          if (opt) {
            selectedValue = opt.value;
            select.value = opt.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
        const btn = findSearchButton();
        const buttonFound = Boolean(btn);
        if (btn) (btn as any).click?.();
        return { selectFound, optionFound, selectedValue, buttonFound };
      }, seasonText);
      addLog(`STEP: Search UI - selectFound=${(res as any).selectFound} optionFound=${(res as any).optionFound} selectedValue='${(res as any).selectedValue}' buttonFound=${(res as any).buttonFound}`);
      selectedSeasonId = String((res as any).selectedValue || '');
      if (selectedSeasonId) {
        const forcedUrl = `${STYLE_LIST_URL}&Spy\\Model\\Style\\Index\\ListReportSearch[bForceSearch]=true&Spy\\Model\\Style\\Index\\ListReportSearch[iSeasonID]=${selectedSeasonId}`;
        addLog(`STEP: Navigating directly to filtered list url (seasonID=${selectedSeasonId})`);
        try { await page.goto(forcedUrl, { waitUntil: 'domcontentloaded' }); } catch {}
        addLog(`STEP: After direct nav, url=${page.url()}`);
      }
    } catch (e) {
      addLog(`STEP: Search click error: ${(e as Error).message}`);
    }
  } else {
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
  }

  // If click causes navigation or reload, wait briefly for it
  try {
    await Promise.race([
      (async () => { try { await page.waitForNavigation({ waitUntil: ["domcontentloaded", "networkidle0"], timeout: 15000 }); } catch {} })(),
      sleep(1500),
    ]);
  } catch {}
  addLog(`STEP: After ${useSearch ? 'Search' : 'Show All'} trigger, url=${page.url()}`);

  // If we were redirected away from the list (e.g., Start/Index)
  // - For Show All flow: force back to list with show_all=1
  // - For Search flow: do NOT force navigate; the table often updates in-place or after an internal redirect
  if (!(page.url().includes("controller=Style%5CIndex") && page.url().includes("action=List"))) {
    if (!useSearch) {
      addLog("STEP: Not on list after Show All, forcing navigation back to list with show_all=1");
      await page.goto(STYLE_LIST_ALL_URL, { waitUntil: "domcontentloaded" });
      addLog(`STEP: Forced list url=${page.url()}`);
    } else {
      addLog("STEP: Not on list after Search; proceeding without forcing navigation (waiting for table)");
    }
  }

  // After Search: retry Search clicks if rows are not visible; avoid show_all fallback for search
  if (useSearch) {
    const quickStart = Date.now();
    let quickHas = false;
    let attempts = 0;
    while (Date.now() - quickStart < 6000) {
      const exists = await page.evaluate(() => {
        function hasRows(root: ParentNode) {
          const table = root.querySelector('table.standardList');
          const body = table?.querySelector('tbody');
          return Boolean(body && body.querySelector('tr'));
        }
        return (
          hasRows(document) ||
          Array.from(document.querySelectorAll('.pagesMiddle, .content, .container, .main')).some((el) => hasRows(el))
        );
      });
      if (exists) { quickHas = true; break; }
      if ((Date.now() - quickStart) > 2000 && attempts < 2) {
        attempts += 1;
        addLog(`STEP: Rows not visible yet; retrying Search click (attempt ${attempts})`);
        try {
          const retry = await page.evaluate(() => {
            function findSearchButton(): HTMLElement | null {
              const byName = document.querySelector('button[name="search"], input[name="search"][type="submit"]') as HTMLButtonElement | HTMLInputElement | null;
              if (byName) return byName as unknown as HTMLElement;
              const lower = (s: string) => (s || '').trim().toLowerCase();
              const btns = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[];
              const byTextBtn = btns.find(b => lower(b.textContent || '') === 'search');
              if (byTextBtn) return byTextBtn as unknown as HTMLElement;
              const inputs = Array.from(document.querySelectorAll('input[type="submit"], input[type="button"]')) as HTMLInputElement[];
              const byValue = inputs.find(i => lower(i.value || '') === 'search');
              if (byValue) return byValue as unknown as HTMLElement;
              const links = Array.from(document.querySelectorAll('a')) as HTMLAnchorElement[];
              const linkByText = links.find(a => lower(a.textContent || '') === 'search');
              return (linkByText as unknown as HTMLElement) || null;
            }
            const btn = findSearchButton();
            const buttonFound = Boolean(btn);
            if (btn) (btn as any).click?.();
            return { buttonFound };
          });
          addLog(`STEP: Retry Search - buttonFound=${(retry as any).buttonFound}`);
        } catch (e) {
          addLog(`STEP: Retry Search click error: ${(e as Error).message}`);
        }
      }
      await sleep(250);
    }
    if (!quickHas) {
      addLog('STEP: Search quick wait exhausted; navigating directly to filtered list via query params');
      try {
        if (selectedSeasonId) {
          const forcedUrl = `${STYLE_LIST_URL}&Spy\\Model\\Style\\Index\\ListReportSearch[bForceSearch]=true&Spy\\Model\\Style\\Index\\ListReportSearch[iSeasonID]=${selectedSeasonId}`;
          await page.goto(forcedUrl, { waitUntil: 'domcontentloaded' });
          addLog(`STEP: On list after direct filtered nav url=${page.url()}`);
        } else {
          await page.goto(STYLE_LIST_URL, { waitUntil: 'domcontentloaded' });
          addLog(`STEP: On list after plain nav url=${page.url()}`);
        }
      } catch (e) {
        addLog(`STEP: Navigation back to list failed: ${(e as Error).message}`);
      }
    }
  } else {
    // Fallback: if no rows within a short time, try reloading the list with show_all=1 explicitly
    const quickStart = Date.now();
    let quickHas = false;
    while (Date.now() - quickStart < 3000) {
      const exists = await page.evaluate(() => {
        const table = document.querySelector('table.standardList');
        const body = table?.querySelector('tbody');
        return Boolean(body && body.querySelector('tr'));
      });
      if (exists) { quickHas = true; break; }
      await sleep(200);
    }
    if (!quickHas) {
      addLog('STEP: Quick Show All failed, reloading STYLE_LIST with show_all=1');
      try { await page.goto(STYLE_LIST_ALL_URL, { waitUntil: 'domcontentloaded' }); } catch {}
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
    function toLargeImage(src: string) {
      if (!src) return src;
      try { return src.replace(/t-1:w-\d+,h-\d+/g, 't-1:w-650,h-650'); } catch { return src; }
    }
    const table = document.querySelector("table.standardList");
    const headCells = Array.from(table?.querySelectorAll("thead th") ?? []) as HTMLTableCellElement[];
    const head = headCells.map((th) => (th.textContent || "").trim());
    const lower = head.map((h) => h.toLowerCase());
    const idxStyleNo = lower.findIndex((t) => t.includes("style no"));
    const idxBrand = lower.findIndex((t) => t.includes("brand"));
    const idxSeason = lower.findIndex((t) => t.includes("season"));
    const idxSupplier = lower.findIndex((t) => t.includes("supplier"));
    const idxStyleName = lower.findIndex((t) => t.includes("style name") || t.includes("stylename") || /^name$/.test(t));
    const trs = Array.from(table?.querySelectorAll("tbody tr") ?? []) as HTMLTableRowElement[];
    return trs.map((tr, i) => {
      const cells = Array.from(tr.querySelectorAll("td"));
      const img = cells[0]?.querySelector('img') as HTMLImageElement | null;
      const rawImg = img?.getAttribute('src') || '';
      const imageUrl = rawImg ? abs(toLargeImage(rawImg)) : '';
      const styleCell = idxStyleNo >= 0 ? cells[idxStyleNo] : cells[1];
      const styleNameCell = idxStyleName >= 0 ? cells[idxStyleName] : null;
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
      const styleName = (styleNameCell?.textContent || "").trim();
      const anchors = Array.from(tr.querySelectorAll('a[href]')) as HTMLAnchorElement[];
      const salesHrefA = anchors.find(a => /mode=show_sales_order/i.test(a.getAttribute('href') || ''));
      const salesTextA = anchors.find(a => /show all sales orders/i.test((a.textContent || '').toLowerCase()));
      const salesOrdersUrl = salesHrefA ? abs(salesHrefA.href) : (id ? abs(`/styles.php?mode=show_sales_order&style_id=${id}`) : (salesTextA ? abs(salesTextA.href) : ''));
      const purchaseHrefA = anchors.find(a => /mode=show_purchase_order/i.test(a.getAttribute('href') || ''));
      const purchaseTextA = anchors.find(a => /show all purchase orders/i.test((a.textContent || '').toLowerCase()));
      const purchaseOrdersUrl = purchaseHrefA ? abs(purchaseHrefA.href) : (id ? abs(`/styles.php?mode=show_purchase_order&style_id=${id}`) : (purchaseTextA ? abs(purchaseTextA.href) : ''));
      return { index: i, id, styleNo, styleName, href, supplier, brand, season, salesOrdersUrl, purchaseOrdersUrl, imageUrl };
    }).filter((r) => r.href && r.styleNo);
  });
  addLog(`STEP: Found ${rows.length} list rows with style links`);
  if (rows.length) {
    const heads = rows.slice(0, 5).map((r) => r.styleNo).join(", ");
    addLog(`STEP: First styles: ${heads}`);
  }
  return rows as Array<{ index: number; id: string; styleNo: string; styleName?: string; href: string; supplier: string; brand: string; season: string; salesOrdersUrl?: string; purchaseOrdersUrl?: string }>;
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

async function scrapeStatAndStockExpandedFree(page: puppeteer.Page, url: string, addLog: (m: string) => void) {
  let target = url;
  try {
    const u = new URL(url);
    u.hash = '#tab=statandstock';
    target = u.href;
  } catch {}
  addLog(`STEP: Opening stat & stock tab ${target}`);
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

  addLog('STEP: Expanding boxes with robust retries');
  try {
    const expansion = await page.evaluate(async () => {
      function sleepMs(ms: number) { return new Promise(res => setTimeout(res, ms)); }
      const boxes = Array.from(document.querySelectorAll('.statAndStockBox')) as HTMLElement[];
      const statuses: Array<{ index: number; hadDown: boolean; hadUp: boolean; details: boolean }> = [];
      for (let i = 0; i < boxes.length; i += 1) {
        const box = boxes[i];
        box.scrollIntoView({ block: 'center' });
        await sleepMs(50);
        let down = box.querySelector('.sprite.spriteArrowDown') as HTMLElement | null;
        const up = box.querySelector('.sprite.spriteArrowUp') as HTMLElement | null;
        if (down) { (down as any).click?.(); await sleepMs(100); }
        let details = Boolean(box.querySelector('.statAndStockDetails'));
        if (!details && !down && up) {
          // Already expanded
          details = Boolean(box.querySelector('.statAndStockDetails'));
        }
        if (!details) {
          // Try clicking header cell to toggle
          const headerCell = box.querySelector('tr td') as HTMLElement | null;
          headerCell?.click?.();
          await sleepMs(120);
          details = Boolean(box.querySelector('.statAndStockDetails'));
        }
        // One more try clicking arrow down if it appeared after first click
        if (!details) {
          down = box.querySelector('.sprite.spriteArrowDown') as HTMLElement | null;
          if (down) { (down as any).click?.(); await sleepMs(100); details = Boolean(box.querySelector('.statAndStockDetails')); }
        }
        statuses.push({ index: i, hadDown: Boolean(down), hadUp: Boolean(up), details });
      }
      return { total: boxes.length, statuses };
    });
    addLog(`STEP: Boxes total=${(expansion as any).total}, details ready=${(expansion as any).statuses.filter((s: any) => s.details).length}`);
  } catch {}

  addLog('STEP: Parsing FREE details; fallback to collapsed matrix when FREE missing');
  const out = await page.evaluate(() => {
    function toNum(s: string) { return parseFloat((s || '').replace(/[^0-9.-]/g, '')) || 0; }
    function getText(el: Element | null | undefined) { return (el && (el as HTMLElement).innerText || '').trim(); }
    function abs(href: string) { try { return new URL(href, location.origin).href; } catch { return href; } }

    const results: Array<{
      colorName: string;
      sizes: string[];
      stock?: { perSize: number[]; total: number };
      soldPerSeason: Array<{ label: string; perSize: number[]; total: number }>;
      purchaseTotals: Array<{ label: string; perSize: number[]; total: number }>;
      purchaseOrders: Array<{ code: string; href: string; eta?: string; perSize: number[]; total: number }>
    }> = [];
    const debugLogs: string[] = [];

    const boxes = Array.from(document.querySelectorAll('.statAndStockBox')) as HTMLElement[];
    for (const box of boxes) {
      const details = box.querySelector('.statAndStockDetails') as HTMLElement | null;
      let parsed = false;
      if (details) {
        const tables = Array.from(details.querySelectorAll('table.tableRadius5.tableBorder')) as HTMLTableElement[];
        // pick the table that has first tbody row first cell === 'FREE'
        let targetTable: HTMLTableElement | null = null;
        let headerRow: HTMLTableRowElement | null = null;
        for (const tbl of tables) {
          const tb = tbl.querySelector('tbody');
          const rows = Array.from(tb?.querySelectorAll('tr') || []) as HTMLTableRowElement[];
          if (!rows.length) continue;
          const maybeHeader = rows[0];
          const firstBody = rows[1];
          const firstLabel = (firstBody?.querySelector('td')?.innerText || '').trim();
          if (/^free$/i.test(firstLabel)) {
            targetTable = tbl;
            headerRow = maybeHeader;
            break;
          }
        }
        if (targetTable && headerRow) {
          // header: color + sizes until 'Total'
          const headerTds = Array.from(headerRow.querySelectorAll('td')) as HTMLTableCellElement[];
          const colorCell = headerTds[0];
          const colorName = (colorCell?.innerText || '').trim().replace(/\s*\n.*/s, '');
          const sizeHeaders: string[] = [];
          for (let i = 1; i < headerTds.length; i += 1) {
            const label = (headerTds[i].innerText || '').trim();
            if (/^total$/i.test(label)) break;
            sizeHeaders.push(label);
          }
          debugLogs.push(`FREE table parsed for color='${colorName}' sizes=[${sizeHeaders.join(', ')}]`);
          const tbodyRows = Array.from(targetTable.querySelectorAll('tbody tr')) as HTMLTableRowElement[];
          let section: 'none' | 'sold' | 'available' | 'purchase' | 'net' | 'other' = 'none';
          const soldPerSeason: Array<{ label: string; perSize: number[]; total: number }> = [];
          const purchaseTotals: Array<{ label: string; perSize: number[]; total: number }> = [];
          const purchaseOrders: Array<{ code: string; href: string; eta?: string; perSize: number[]; total: number; dedicatedStockPerSize?: number[]; dedicatedStockTotal?: number; dedicatedPrePerSize?: number[]; dedicatedPreTotal?: number }> = [];
          let currentPO: { code: string; href: string; eta?: string; perSize: number[]; total: number; dedicatedStockPerSize?: number[]; dedicatedStockTotal?: number; dedicatedPrePerSize?: number[]; dedicatedPreTotal?: number } | null = null;
          let availableDedicatedToPre: { perSize: number[]; total: number } | undefined;
          let stock: { perSize: number[]; total: number } | undefined;
          const readPerSize = (tds: HTMLTableCellElement[], count: number) => tds.slice(1, 1 + count).map(td => toNum(td.innerText || ''));
          for (const tr of tbodyRows) {
            const tds = Array.from(tr.querySelectorAll('td')) as HTMLTableCellElement[];
            if (!tds.length) continue;
            const first = (tds[0].innerText || '').trim();
            if (tr.classList.contains('stylecolor-expanded--header')) {
              const f = first.toLowerCase();
              if (/^sold$/i.test(first)) section = 'sold';
              else if (/^available$/i.test(first)) section = 'available';
              else if (/^purchase/i.test(first)) section = 'purchase';
              else if (f.includes('net need')) section = 'net';
              else section = 'other';
              continue;
            }
            if (section === 'none' || section === 'other') {
              // Capture the first physical warehouse Stock row only once
              if (!stock && /^stock$/i.test(first) && tr.classList.contains('stylecolor-expanded--main')) {
                const perSize = readPerSize(tds, sizeHeaders.length);
                const totalCell = tds[1 + sizeHeaders.length];
                const total = toNum(totalCell?.innerText || '');
                stock = { perSize, total };
              }
            } else if (section === 'sold') {
              if (tr.classList.contains('stylecolor-expanded--main')) {
                if (!/^total sold$/i.test(first)) {
                  const perSize = readPerSize(tds, sizeHeaders.length);
                  const total = toNum(tds[1 + sizeHeaders.length]?.innerText || '');
                  // Include 'Stock' main row under Sold as part of soldPerSeason so client can classify it as Sold Stock
                  soldPerSeason.push({ label: first, perSize, total });
                }
              }
            } else if (section === 'purchase') {
              if (tr.classList.contains('stylecolor-expanded--main')) {
                if (!/^total po/i.test(first)) {
                  const perSize = readPerSize(tds, sizeHeaders.length);
                  const total = toNum(tds[1 + sizeHeaders.length]?.innerText || '');
                  purchaseTotals.push({ label: first, perSize, total });
                  debugLogs.push(`PURCHASE total row '${first}' perSize=[${perSize.join(', ')}] total=${total}`);
                }
              } else if (tr.classList.contains('stylecolor-expanded--sub')) {
                const titleCell = (tds[0]?.innerText || '').trim();
                const link = tr.querySelector('td a[href]') as HTMLAnchorElement | null;
                const perSize = readPerSize(tds, sizeHeaders.length);
                const total = toNum(tds[1 + sizeHeaders.length]?.innerText || '');
                if (link) {
                  const code = (link?.innerText || '').trim();
                  const href = abs(link.href);
                  const etaDiv = tr.querySelector('td .right') as HTMLElement | null;
                  const eta = (etaDiv?.innerText || '').trim() || undefined;
                  currentPO = { code, href, eta, perSize, total };
                  purchaseOrders.push(currentPO);
                  debugLogs.push(`PO row code='${code}' perSize=[${perSize.join(', ')}] total=${total} eta='${eta || ''}'`);
                } else {
                  if (/^stock dedicated$/i.test(titleCell)) {
                    if (currentPO) {
                      currentPO.dedicatedStockPerSize = perSize; currentPO.dedicatedStockTotal = total;
                    }
                  } else if (/^pre dedicated$/i.test(titleCell)) {
                    if (currentPO) {
                      currentPO.dedicatedPrePerSize = perSize; currentPO.dedicatedPreTotal = total;
                    }
                  }
                }
              }
            } else if (section === 'available') {
              if (/^stock dedicated to pre$/i.test(first) && tr.classList.contains('stylecolor-expanded--main')) {
                const perSize = readPerSize(tds, sizeHeaders.length);
                const total = toNum(tds[1 + sizeHeaders.length]?.innerText || '');
                availableDedicatedToPre = { perSize, total };
              }
            } else if (section === 'net') {
              // Ignore Net Need timeline rows for physical stock or sold calculations
            }
          }
          results.push({ colorName, sizes: sizeHeaders, stock, soldPerSeason, purchaseTotals, purchaseOrders, availableDedicatedToPre });
          parsed = true;
        }
      }
      if (!parsed) {
        // Fallback: parse collapsed matrix similar to stock mode
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
          if (tr.classList.contains('tableBackgroundBlack')) continue;
          if (/^total$/i.test(label)) continue;
          const numCells = tds.slice(1).map((td) => toNum(td.innerText || ''));
          const perSize = numCells.slice(0, sizeHeaders.length);
          const total = perSize.reduce((a, b) => a + (b || 0), 0);
          resultRows.push({ label, perSize, total });
        }
        function findRow(part: string) { return resultRows.find(r => r.label.toLowerCase().includes(part)); }
        const stockRow = findRow('stock');
        const purchaseRow = findRow('po (running + shipped)') || findRow('purchase');
        const soldStockRow = findRow('sold stock');
        const soldPreRow = findRow('sold pre');
        const soldPerSeason: Array<{ label: string; perSize: number[]; total: number }> = [];
        if (soldStockRow) soldPerSeason.push({ label: 'Stock', perSize: soldStockRow.perSize, total: soldStockRow.total });
        if (soldPreRow) soldPerSeason.push({ label: 'Pre', perSize: soldPreRow.perSize, total: soldPreRow.total });
        const purchaseTotals: Array<{ label: string; perSize: number[]; total: number }> = [];
        if (purchaseRow) purchaseTotals.push({ label: purchaseRow.label, perSize: purchaseRow.perSize, total: purchaseRow.total });
        const purchaseOrders: Array<{ code: string; href: string; eta?: string; perSize: number[]; total: number }> = [];
        results.push({
          colorName,
          sizes: sizeHeaders,
          stock: stockRow ? { perSize: stockRow.perSize, total: stockRow.total } : undefined,
          soldPerSeason,
          purchaseTotals,
          purchaseOrders,
        });
        debugLogs.push(`FALLBACK parsed color='${colorName}' sizes=[${sizeHeaders.join(', ')}] stockTotal=${stockRow ? stockRow.total : 0}`);
      }
    }
    return { results, debugLogs };
  });
  // Emit debug logs to the stream
  try {
    const dbg = (out as any).debugLogs as string[];
    if (Array.isArray(dbg)) {
      for (const line of dbg) addLog(`DEBUG: ${line}`);
    }
  } catch {}
  return (out as any).results;
}

export async function POST(request: Request) {
  const username = process.env.SPY_USER;
  const password = process.env.SPY_PASS;
  if (!username || !password) {
    return new Response(JSON.stringify({ ok: false, error: "Missing SPY_USER or SPY_PASS" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  const url = new URL(request.url);
  const stream = url.searchParams.get("stream") === "1";
  const body = await request.json().catch(() => ({ limit: 0, skipDetails: false, links: [] as any[] }));
  const limit: number = typeof body.limit === "number" ? body.limit : 0;
  const skipDetails: boolean = Boolean((body as any).skipDetails);
  const inputLinksRaw: any[] = Array.isArray((body as any).links) ? (body as any).links : [];
  type LinkObj = { href: string; styleNo?: string; styleName?: string; supplier?: string; brand?: string; season?: string };
  const normalizeLink = (l: any): LinkObj | null => {
    if (!l) return null;
    if (typeof l === 'string') {
      try { return { href: new URL(l, BASE).href }; } catch { return null; }
    }
    if (typeof l === 'object' && typeof l.href === 'string') {
      try {
        const abs = new URL(l.href, BASE).href;
        const { styleNo = '', styleName = '', supplier = '', brand = '', season = '' } = l || {};
        return { href: abs, styleNo, styleName, supplier, brand, season };
      } catch { return null; }
    }
    return null;
  };
  const inputLinksObjs: LinkObj[] = inputLinksRaw.map(normalizeLink).filter(Boolean) as LinkObj[];
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
      let list: Array<{ index: number; id: string; styleNo: string; href: string; supplier: string; brand: string; season: string; styleName?: string }>;
      if (inputLinksObjs.length > 0) {
        add(`STEP: Using provided links (${inputLinksObjs.length}) instead of scraping list`);
        list = inputLinksObjs.map((obj, idx) => ({
          index: idx,
          id: "",
          styleNo: obj.styleNo || (obj.href.split("id=").pop() || `${idx + 1}`),
          href: obj.href,
          supplier: obj.supplier || "",
          brand: obj.brand || "",
          season: obj.season || "",
          styleName: obj.styleName || "",
        }));
      } else {
        list = await scrapeStyleList(page, add, (body as any).seasonText || '');
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
      } else if (mode === 'statstock_free') {
        add(`STEP: Stat&Stock FREE mode enabled, processing ${toProcess.length} links`);
        for (let i = 0; i < toProcess.length; i += 1) {
          const row = toProcess[i];
          add(`STEP: Stat&Stock ${i + 1}/${toProcess.length} - ${row.styleNo}`);
          try {
            const stat = await scrapeStatAndStockExpandedFree(page, row.href, add);
            items.push({ ok: true, type: 'statstock_free', index: row.index, styleNo: row.styleNo, styleName: (row as any).styleName || '', url: row.href, stat });
          } catch (err) {
            items.push({ ok: false, type: 'statstock_free', index: row.index, styleNo: row.styleNo, url: row.href, error: (err as Error).message });
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
            items.push({ ok: true, index: row.index, styleNo: row.styleNo, styleName: (row as any).styleName || '', id: row.id, url: row.href, brand: row.brand, season: row.season, supplier: row.supplier, ...detail });
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
        let list: Array<{ index: number; id: string; styleNo: string; href: string; supplier: string; brand: string; season: string; styleName?: string }>; 
        if (inputLinksObjs.length > 0) {
          add(`STEP: Using provided links (${inputLinksObjs.length}) instead of scraping list`);
          list = inputLinksObjs.map((obj, idx) => ({
            index: idx,
            id: "",
            styleNo: obj.styleNo || (obj.href.split("id=").pop() || `${idx + 1}`),
            href: obj.href,
            supplier: obj.supplier || "",
            brand: obj.brand || "",
            season: obj.season || "",
            styleName: obj.styleName || "",
          }));
        } else {
          list = await scrapeStyleList(page, add, (body as any).seasonText || '');
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
        } else if (mode === 'statstock_free') {
          add(`STEP: Stat&Stock FREE mode enabled, streaming ${toProcess.length} links`);
          for (let i = 0; i < toProcess.length; i += 1) {
            const row = toProcess[i];
            try {
              const stat = await scrapeStatAndStockExpandedFree(page, row.href, add);
              send({ type: 'statstock_free', ok: true, index: row.index, styleNo: row.styleNo, styleName: (row as any).styleName || '', url: row.href, stat });
            } catch (err) {
              send({ type: 'statstock_free', ok: false, index: row.index, styleNo: row.styleNo, url: row.href, error: (err as Error).message });
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
              send({ type: "item", ok: true, index: row.index, styleNo: row.styleNo, styleName: (row as any).styleName || '', id: row.id, url: row.href, brand: row.brand, season: row.season, supplier: row.supplier, ...detail });
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


