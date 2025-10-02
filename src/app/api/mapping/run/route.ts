import puppeteer from "puppeteer";
import { NextResponse } from "next/server";
import { mappingRegistry } from "@/lib/mapping/registry";
import type { MappingStep, MappingTask, StepAction } from "@/lib/mapping/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RunBody = {
  taskId?: string;
  steps?: MappingStep[];
  params?: Record<string, string>;
};

function expandText(text: string, params?: Record<string, string>): string {
  return String(text || "")
    .replace(/\$\{env:([A-Z0-9_]+)\}/gi, (_m, name) => process.env[String(name)] || "")
    .replace(/\$\{param:([A-Za-z0-9_]+)\}/g, (_m, key) => (params && params[key] ? params[key] : ""));
}

async function runAction(page: puppeteer.Page, action: StepAction): Promise<any> {
  switch (action.type) {
    case "goto":
      return page.goto(action.url, { waitUntil: "domcontentloaded" });
    case "waitFor":
      return page.waitForSelector(action.selector, { timeout: action.timeoutMs ?? 30000 });
    case "click":
      return page.$eval(action.selector, (el: any) => el.click());
    case "type":
      return page.type(action.selector, expandText(action.text), { delay: action.delay ?? 0 });
    case "select":
      return page.select(action.selector, action.value);
    case "sleep":
      return new Promise((r) => setTimeout(r, action.ms));
    case "extract":
      return page.evaluate((sel, attr) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (!el) return null;
        if (attr) return (el as any).getAttribute?.(attr) || null;
        return (el as HTMLElement).innerText || "";
      }, action.selector, action.attr || null);
    case "extractTable":
      return page.evaluate((rootSel) => {
        const root = document.querySelector(rootSel) as HTMLTableElement | null;
        const head = Array.from(root?.querySelectorAll("thead th") ?? []).map((th) => (th.textContent || "").trim());
        const rows = Array.from(root?.querySelectorAll("tbody tr") ?? []).map((tr) => {
          const tds = Array.from(tr.querySelectorAll("td"));
          const cells = tds.map((td) => {
            const link = td.querySelector("a[href]") as HTMLAnchorElement | null;
            const img = td.querySelector("img") as HTMLImageElement | null;
            const span = td.querySelector("span") as HTMLElement | null;
            const text = (span?.innerText || td.textContent || "").trim();
            const toAbs = (href: string) => { try { return new URL(href, location.origin).href; } catch { return href; } };
            return {
              text,
              link: link ? { href: toAbs(link.href), text: (link.textContent || "").trim() } : null,
              image: img ? { src: img.src, alt: img.alt } : null,
            };
          });
          return { cells };
        });
        return { head, rows, counts: { head: head.length, rows: rows.length } };
      }, action.rootSelector);
    case "eval":
      return page.evaluate((code) => {
        // Evaluate a function body string returning a value
        // eslint-disable-next-line no-new-func
        const fn = new Function(code);
        return fn();
      }, action.fn);
    default:
      return null;
  }
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const stream = url.searchParams.get("stream") === "1";
  const body = (await request.json().catch(() => ({}))) as RunBody;
  const task: MappingTask | undefined = mappingRegistry.find((t) => t.id === body.taskId);
  const steps: MappingStep[] = Array.isArray(body.steps) && body.steps.length ? body.steps : (task?.steps ?? []);

  if (!steps.length) {
    return NextResponse.json({ ok: false, error: "No steps provided" }, { status: 400 });
  }

  const username = process.env.SPY_USER;
  const password = process.env.SPY_PASS;
  if (!username || !password) {
    return NextResponse.json({ ok: false, error: "Missing SPY_USER or SPY_PASS" }, { status: 500 });
  }

  const encoder = new TextEncoder();
  if (!stream) {
    let browser: puppeteer.Browser | null = null;
    const logs: Array<{ t: string; m: string }> = [];
    const add = (m: string) => logs.push({ t: new Date().toISOString(), m });
    try {
      add("STEP: Launching browser");
      browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-setuid-sandbox"] });
      const page = await browser.newPage();
      await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");
      for (let i = 0; i < steps.length; i += 1) {
        const s = steps[i];
        add(`STEP: ${i + 1}/${steps.length} ${s.name}`);
        // Expand env placeholders in goto url
        if ((s.action as any).type === "goto") { (s.action as any).url = expandText((s.action as any).url, body.params); }
        const out = await runAction(page, s.action);
        if ((s.action as any).type === "extractTable" || (s.action as any).type === "extract" || (s.action as any).type === "eval") {
          add(`DATA: ${JSON.stringify(out).slice(0, 500)}`);
        }
      }
      await browser.close();
      browser = null;
      return NextResponse.json({ ok: true, logs });
    } catch (error) {
      if (browser) { try { await browser.close(); } catch {} }
      return NextResponse.json({ ok: false, error: (error as Error).message, logs }, { status: 500 });
    }
  }

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
        for (let i = 0; i < steps.length; i += 1) {
          const s = steps[i];
          add(`STEP: ${i + 1}/${steps.length} ${s.name}`);
          if ((s.action as any).type === "goto") { (s.action as any).url = expandText((s.action as any).url, body.params); }
          const out = await runAction(page, s.action);
          if ((s.action as any).type === "extractTable") {
            send({ type: "table", ok: true, ...out });
          } else if ((s.action as any).type === "extract") {
            send({ type: "data", ok: true, value: out, name: (s.action as any).name || s.name });
          } else if ((s.action as any).type === "eval") {
            send({ type: "data", ok: true, value: out, name: s.name });
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


