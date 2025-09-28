import { NextResponse } from "next/server";
import puppeteer from "puppeteer";

const LOGIN_PAGE = "https://2-biz.spysystem.dk/?controller=Index&action=GetLoginPage";
const LOGIN_POST = "https://2-biz.spysystem.dk/?controller=Index&action=SignIn";
const RUNNING_URL = "https://2-biz.spysystem.dk/app/purchase/running";

type LogEntry = { t: string; m: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runScrape(addLog: (m: string) => void) {
  const username = process.env.SPY_USER;
  const password = process.env.SPY_PASS;
  if (!username || !password) {
    throw new Error("Missing SPY_USER or SPY_PASS");
  }

  addLog("STEP: Launching browser");
  let browser: puppeteer.Browser | null = null;
  try {
    browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    );

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
        try { await page.waitForNavigation({ waitUntil: ["domcontentloaded", "networkidle0"], timeout: 30000 }); } catch {}
      })(),
      sleep(30000),
    ]);

    addLog("STEP: Navigating to running purchases page");
    await page.goto(RUNNING_URL, { waitUntil: "domcontentloaded" });

    addLog("STEP: Waiting for table in .app-outlet");
    const start = Date.now();
    let tableFound = false;
    let attempt = 0;
    while (Date.now() - start < 30000) {
      attempt += 1;
      const exists = await page.evaluate(() => {
        const root = document.querySelector(".app-outlet");
        if (!root) return false;
        const table = root.querySelector("table");
        return Boolean(table);
      });
      addLog(`STEP: Poll attempt ${attempt} - table present = ${exists}`);
      if (exists) { tableFound = true; break; }
      await sleep(2000);
    }

    if (!tableFound) {
      addLog("STEP: Table not found within timeout");
      throw new Error("Table not found after 30s");
    }

    addLog("STEP: Extracting table data");
    const result = await page.evaluate(() => {
      const outlet = document.querySelector(".app-outlet");
      const table = outlet?.querySelector("table");
      const rows = Array.from(table?.querySelectorAll("tbody tr") ?? []);
      const headCells = Array.from(table?.querySelectorAll("thead th") ?? []).map((th) => th.textContent?.trim() ?? "");
      const data = rows.map((tr) => {
        const cells = Array.from(tr.querySelectorAll("td")).map((td) => {
          const link = td.querySelector("a[href]") as HTMLAnchorElement | null;
          const img = td.querySelector("img") as HTMLImageElement | null;
          const text = td.textContent?.trim() ?? "";
          return { text, link: link ? { href: link.href, text: link.textContent?.trim() ?? "" } : null, image: img ? { src: img.src, alt: img.alt } : null };
        });
        return { cells };
      });
      return { head: headCells, rows: data, counts: { head: headCells.length, rows: data.length } };
    });

    addLog(`STEP: Extracted counts - head=${result.counts.head}, rows=${result.counts.rows}`);
    addLog("STEP: Done");
    await browser.close();
    browser = null;
    return { ok: true, ...result } as const;
  } finally {
    if (browser) { try { await browser.close(); } catch {} }
  }
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const stream = url.searchParams.get("stream") === "1";

  if (!stream) {
    const logs: LogEntry[] = [];
    const add = (m: string) => logs.push({ t: new Date().toISOString(), m });
    try {
      const result = await runScrape(add);
      return NextResponse.json({ ...result, logs });
    } catch (error) {
      return NextResponse.json({ ok: false, error: (error as Error).message, logs }, { status: 500 });
    }
  }

  const encoder = new TextEncoder();
  const streamBody = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      const add = (m: string) => send({ type: "log", t: new Date().toISOString(), m });
      try {
        const result = await runScrape(add);
        send({ type: "result", ...result });
      } catch (error) {
        send({ type: "result", ok: false, error: (error as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(streamBody, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" } });
}


