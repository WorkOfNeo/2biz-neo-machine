import { NextResponse } from "next/server";
import puppeteer from "puppeteer";

const BASE = "https://2-biz.spysystem.dk";
const LOGIN_PAGE = `${BASE}/?controller=Index&action=GetLoginPage`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ensureLoggedIn(page: puppeteer.Page, username: string, password: string, log: (m: string) => void) {
  await page.goto(LOGIN_PAGE, { waitUntil: "domcontentloaded" });
  log("STEP: Login page loaded");
  await page.type('input[name="username"]', username, { delay: 10 });
  await page.type('input[name="password"]', password, { delay: 10 });
  await Promise.race([
    (async () => { try { await page.click('button[type="submit"]'); } catch {} })(),
    sleep(3000),
  ]);
  try {
    await page.waitForNavigation({ waitUntil: ["domcontentloaded", "networkidle0"], timeout: 10000 });
  } catch {}
}

export async function POST(request: Request) {
  const { url } = await request.json().catch(() => ({ url: "" }));
  const username = process.env.SPY_USER;
  const password = process.env.SPY_PASS;
  if (!url) return NextResponse.json({ ok: false, error: "Missing url" }, { status: 400 });
  if (!username || !password) return NextResponse.json({ ok: false, error: "Missing SPY_USER or SPY_PASS" }, { status: 500 });

  const encoder = new TextEncoder();
  const streamBody = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      const log = (m: string) => send({ type: "log", t: new Date().toISOString(), m });
      let browser: puppeteer.Browser | null = null;
      try {
        log("STEP: Launching browser");
        browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-setuid-sandbox"] });
        const page = await browser.newPage();
        await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");

        log("STEP: Ensuring login");
        await ensureLoggedIn(page, username, password, log);

        let targetHref = url;
        try { targetHref = new URL(url, BASE).href; } catch {}
        log(`STEP: Navigating to style URL: ${targetHref}`);
        await page.goto(targetHref, { waitUntil: "domcontentloaded" });

        log("STEP: Polling for detail container every 200ms");
        const start = Date.now();
        let found = false;
        let attempts = 0;
        while (Date.now() - start < 15000) {
          attempts += 1;
          const exists = await page.evaluate(() => {
            return Boolean(document.querySelector('.colorBox.full-width-table') || document.querySelector('.single-table-container'));
          });
          log(`STEP: Poll ${attempts} -> container present = ${exists}`);
          if (exists) { found = true; break; }
          await sleep(200);
        }
        if (!found) {
          send({ type: "result", ok: false, error: "Detail container not found" });
          return controller.close();
        }

        log("STEP: Extracting allocations and size matrix");
        const data = await page.evaluate(() => {
          const container = (document.querySelector('.colorBox.full-width-table') || document.querySelector('.single-table-container')) as HTMLElement | null;
          if (!container) return null;
          const colorName = (container.querySelector('.headerRow .color-name') as HTMLElement | null)?.textContent?.trim() || '';
          const sizeHeaders = Array.from(container.querySelectorAll('.headerRow td[data-size_master_id]')).map((td) => ({
            id: (td as HTMLElement).getAttribute('data-size_master_id') || '',
            label: (td as HTMLElement).textContent?.trim() || '',
          }));
          const rows = Array.from(container.querySelectorAll('tr.cBassortLine.cBinputLine')) as HTMLElement[];
          const hasStock = rows.some((r) => (r.getAttribute('data-assortment--loop-type') || '').toLowerCase() === 'stock' || (r.children[1]?.textContent || '').toLowerCase().includes('stock'));
          const hasPre = rows.some((r) => (r.getAttribute('data-assortment--loop-type') || '').toLowerCase() === 'pre' || (r.children[1]?.textContent || '').toLowerCase().includes('pre'));

          type Alloc = { label: string; stockTotal: number; preTotal: number };
          const map: Record<string, Alloc> = {};
          const mapQty: Record<string, Alloc> = {};
          function ensure(label: string) { if (!map[label]) map[label] = { label, stockTotal: 0, preTotal: 0 }; return map[label]; }
          function ensureQty(label: string) { if (!mapQty[label]) mapQty[label] = { label, stockTotal: 0, preTotal: 0 }; return mapQty[label]; }
          function toNum(s: string) { return parseFloat((s || '').replace(/[^0-9.-]/g, '')) || 0; }

          // Build FREE matrices (STOCK/PRE) and PACK composition+qty
          type SizeRow = Record<string, number>;
          const free: { STOCK: SizeRow; PRE: SizeRow } = { STOCK: {}, PRE: {} };
          const packs: { composition: Record<string, SizeRow>; qty: Record<string, { stockQty: number; preQty: number }> } = {
            composition: {},
            qty: {},
          };

          for (const el of rows) {
            const kind = (el.getAttribute('data-assortment--loop-type') || '').toLowerCase();
            const labelRaw = ((el.querySelector('td:nth-child(1)')?.textContent || '').trim()) || 'FREE';
            const label = labelRaw || 'FREE';
            const groupCellText = (el.querySelector('td:nth-child(2)')?.textContent || '').trim().toLowerCase();
            const total = (el.querySelector('td[name="total"]') as HTMLElement | null)?.textContent?.trim() || '';
            // Assortment count must come from the input field in the QTY column, if present
            const qtyInput = el.querySelector('td[name="qty"] input') as HTMLInputElement | null;
            const qtyText = (qtyInput ? qtyInput.value : (el.querySelector('td[name="qty"]') as HTMLElement | null)?.textContent?.trim() || '');
            const totalNum = toNum(total);
            const qtyNum = toNum(qtyText);
            const m = ensure(label);
            const mQty = ensureQty(label);
            const groupNorm = (kind === 'stock' || groupCellText.includes('stock')) ? 'STOCK' : ((kind === 'pre' || groupCellText.includes('pre') || (!hasStock && hasPre)) ? 'PRE' : 'PRE');
            // Always use the QTY input value for assortment totals, per requirement
            if (groupNorm === 'STOCK') m.stockTotal += qtyNum; else m.preTotal += qtyNum;
            if (groupNorm === 'STOCK') mQty.stockTotal += qtyNum; else mQty.preTotal += qtyNum;

            // Per-size values: cells with data-sizeset-size-id
            const perSizeCells = Array.from(el.querySelectorAll('td[data-sizeset-size-id]')) as HTMLElement[];
            // Accumulate into FREE or packs.composition
            if (/^free$/i.test(label)) {
              const rowMap = (groupNorm === 'STOCK' ? free.STOCK : free.PRE) as SizeRow;
              for (const td of perSizeCells) {
                const sizeId = td.getAttribute('data-sizeset-size-id') || '';
                const header = sizeHeaders.find((h) => h.id === sizeId)?.label || sizeId;
                const input = td.querySelector('input') as HTMLInputElement | null;
                const txt = (input ? input.value : td.textContent || '').toString().trim();
                const val = toNum(txt);
                rowMap[header] = (rowMap[header] || 0) + val;
              }
            } else {
              if (!packs.composition[label]) packs.composition[label] = {} as SizeRow;
              const comp = packs.composition[label];
              // For composition, read per-size cells as-is (they define pack makeup)
              for (const td of perSizeCells) {
                const sizeId = td.getAttribute('data-sizeset-size-id') || '';
                const header = sizeHeaders.find((h) => h.id === sizeId)?.label || sizeId;
                const input = td.querySelector('input') as HTMLInputElement | null;
                const txt = (input ? input.value : td.textContent || '').toString().trim();
                const val = toNum(txt);
                // Prefer non-zero composition if multiple rows (stock/pre) list same label
                comp[header] = comp[header] || val;
              }
              if (!packs.qty[label]) packs.qty[label] = { stockQty: 0, preQty: 0 };
              if (groupNorm === 'STOCK') packs.qty[label].stockQty += qtyNum; else packs.qty[label].preQty += qtyNum;
            }
          }

          const allocations = Object.values(map);
          const allocationsQty = Object.values(mapQty);
          const freeTotals = {
            stockTotal: Object.values(free.STOCK || {}).reduce((a, b) => a + (b || 0), 0),
            preTotal: Object.values(free.PRE || {}).reduce((a, b) => a + (b || 0), 0),
          };
          return { colorName, sizes: sizeHeaders.map((s) => s.label), allocations, allocationsQty, free, packs, freeTotals };
        });

        if (!data) {
          send({ type: "result", ok: false, error: "No data parsed" });
        } else {
          send({ type: "result", ok: true, ...data });
        }
      } catch (error) {
        send({ type: "result", ok: false, error: (error as Error).message });
      } finally {
        if (browser) { try { await browser.close(); } catch {} }
        controller.close();
      }
    },
  });

  return new Response(streamBody, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" } });
}
