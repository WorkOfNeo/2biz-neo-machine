import { NextResponse } from "next/server";
import puppeteer from "puppeteer";

const BASE = "https://2-biz.spysystem.dk";
const LOGIN_PAGE = `${BASE}/?controller=Index&action=GetLoginPage`;

type LogLine = { type: "log"; t: string; m: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ensureLoggedIn(page: puppeteer.Page, username: string, password: string, addLog: (m: string) => void) {
  addLog("STEP: Navigating to login page");
  await page.goto(LOGIN_PAGE, { waitUntil: "domcontentloaded" });
  addLog("STEP: Typing username");
  await page.type('input[name="username"]', username, { delay: 10 });
  addLog("STEP: Typing password");
  await page.type('input[name="password"]', password, { delay: 10 });
  addLog("STEP: Submitting login form");
  await Promise.race([
    (async () => {
      await page.click('button[type="submit"]');
      try {
        await page.waitForNavigation({ waitUntil: ["domcontentloaded", "networkidle0"], timeout: 30000 });
      } catch {}
    })(),
    sleep(30000),
  ]);
}

async function scrapeStockPreForLink(page: puppeteer.Page, url: string, addLog: (m: string) => void) {
  addLog(`STEP: Opening ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded" });

  addLog("STEP: Waiting for .basketbox .standardList");
  const start = Date.now();
  let found = false;
  let attempt = 0;
  while (Date.now() - start < 30000) {
    attempt += 1;
    const exists = await page.evaluate(() => {
      const box = document.querySelector(".basketbox");
      if (!box) return false;
      return Boolean(box.querySelector("table.standardList"));
    });
    addLog(`STEP: Poll attempt ${attempt} - stock table present = ${exists}`);
    if (exists) { found = true; break; }
    await sleep(2000);
  }
  if (!found) {
    throw new Error("Stock/Pre table not found after 30s");
  }

  addLog("STEP: Extracting stock/pre table");
  const data = await page.evaluate(() => {
    const box = document.querySelector(".basketbox");
    const table = box?.querySelector("table.standardList");
    const headRow = table?.querySelector("thead tr") || null; // only take first row to avoid duplicates
    const headCells = Array.from(headRow?.querySelectorAll("th") ?? []).map((th) => (th.textContent || "").trim());
    const rows = Array.from(table?.querySelectorAll("tbody tr") ?? []).map((tr) => {
      const cells = Array.from(tr.querySelectorAll("td")).map((td) => {
        const link = td.querySelector("a[href]") as HTMLAnchorElement | null;
        const img = td.querySelector("img") as HTMLImageElement | null;
        const text = (td.textContent || "").trim();
        return {
          text,
          link: link ? { href: link.href, text: (link.textContent || "").trim() } : null,
          image: img ? { src: img.src, alt: img.alt } : null,
        };
      });
      return { cells };
    });
    return { head: headCells, rows, counts: { head: headCells.length, rows: rows.length } };
  });
  addLog(`STEP: Extracted stock/pre counts - head=${data.counts.head}, rows=${data.counts.rows}`);
  return data;
}

export async function POST(request: Request) {
  const username = process.env.SPY_USER;
  const password = process.env.SPY_PASS;
  if (!username || !password) {
    return NextResponse.json({ ok: false, error: "Missing SPY_USER or SPY_PASS" }, { status: 500 });
  }

  const url = new URL(request.url);
  const stream = url.searchParams.get("stream") === "1";
  const body = await request.json().catch(() => ({ links: [], limit: 0 }));
  const inputLinks: string[] = Array.isArray(body.links) ? body.links : [];
  const limit: number = typeof body.limit === "number" ? body.limit : 0;
  const safeLinks = inputLinks
    .map((l) => {
      try { return new URL(l, BASE).href; } catch { return null; }
    })
    .filter((v, i, a) => Boolean(v) && a.indexOf(v) === i) as string[];
  const toProcess = limit && limit > 0 ? safeLinks.slice(0, limit) : safeLinks;

  if (!stream) {
    // Non-streaming response: run and return all
    const logs: LogLine[] = [];
    const add = (m: string) => logs.push({ type: "log", t: new Date().toISOString(), m });
    let browser: puppeteer.Browser | null = null;
    try {
      add("STEP: Launching browser");
      browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-setuid-sandbox"] });
      const page = await browser.newPage();
      await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");
      await ensureLoggedIn(page, username, password, add);

      const items: any[] = [];
      for (let i = 0; i < toProcess.length; i += 1) {
        const href = toProcess[i];
        add(`STEP: Processing ${i + 1}/${toProcess.length} - ${href}`);
        const data = await scrapeStockPreForLink(page, href, add);
        items.push({ url: href, ...data, index: i });
      }
      await browser.close();
      browser = null;
      return NextResponse.json({ ok: true, logs, items });
    } catch (error) {
      if (browser) { try { await browser.close(); } catch {} }
      return NextResponse.json({ ok: false, error: (error as Error).message, logs }, { status: 500 });
    }
  }

  // Streaming NDJSON
  const encoder = new TextEncoder();
  const streamBody = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      const add = (m: string) => send({ type: "log", t: new Date().toISOString(), m });
      let browser: puppeteer.Browser | null = null;
      try {
        add("STEP: Launching browser");
        browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-setuid-sandbox"] });
        const page = await browser.newPage();
        await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");
        await ensureLoggedIn(page, username, password, add);

        for (let i = 0; i < toProcess.length; i += 1) {
          const href = toProcess[i];
          add(`STEP: Processing ${i + 1}/${toProcess.length} - ${href}`);
          try {
            const data = await scrapeStockPreForLink(page, href, add);
            send({ type: "item", index: i, url: href, ...data });
          } catch (err) {
            send({ type: "item", index: i, url: href, ok: false, error: (err as Error).message });
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
