import puppeteer from "puppeteer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type PurchaseOrder = { code?: string; eta?: string; total?: number };
type ColorBlock = {
  colorName: string;
  imageUrl?: string;
  sizes: string[];
  availablePerSize: number[];
  poPerSize: number[];
  soldStockPerSize: number[];
  netNeedPerSize: number[];
  availableTotal: number;
  poTotal: number;
  pos: PurchaseOrder[];
  netNeedTotal: number;
};
type StyleBlock = { styleNo?: string; styleName?: string; colors: ColorBlock[] };

function htmlEscape(s: string) {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
}

function buildHtml(items: StyleBlock[]) {
  const blocks = items.map((it) => {
    const styles = (it.colors || []).map((c) => {
      const header = `${htmlEscape(it.styleName || it.styleNo || "")} — ${htmlEscape(c.colorName || "")}`;
      const img = c.imageUrl ? `<img src="${htmlEscape(c.imageUrl)}" alt="" style="width:260px;height:260px;object-fit:cover;border-radius:8px;border:1px solid #eee;"/>` : "";
      const poLines = (c.pos || []).map((po) => {
        const code = htmlEscape(po.code || "PO");
        const eta = htmlEscape(po.eta || "");
        const tot = typeof po.total === 'number' ? po.total : 0;
        return `<div style=\"display:flex;justify-content:space-between;\"><span>${code}${eta ? ` · ${eta}` : ''}</span><span>${tot}</span></div>`;
      }).join("");
      const sizeHead = (c.sizes || []).map((s) => `<th>${htmlEscape(s)}</th>`).join("");
      const row = (title: string, cls: string, arr: number[]) => `<tr><td>${title}</td>${(c.sizes||[]).map((_,i)=>`<td class=\"${cls}\">${Number(arr[i]||0)}</td>`).join("")}<td class=\"${cls}\">${(arr||[]).reduce((a,b)=>a+(b||0),0)}</td></tr>`;
      return `
        <div class=\"card\">
          <div class=\"header\">${header}</div>
          <div class=\"row\">
            <div class=\"left\">${img}</div>
            <div class=\"right\">
              <table class=\"tbl\">
                <tbody>
                  <tr><td>Available (Stock − Sold Stock)</td><td class=\"v\">${c.availableTotal}</td></tr>
                  <tr><td>PO Total</td><td class=\"v green\">${c.poTotal}</td></tr>
                  <tr><td>Net Need</td><td class=\"v ${c.netNeedTotal < 0 ? 'red' : (c.netNeedTotal > 0 ? 'green' : '')}\">${c.netNeedTotal}</td></tr>
                </tbody>
              </table>
              <table class=\"per\">
                <thead>
                  <tr><th>Row</th>${sizeHead}<th>Total</th></tr>
                </thead>
                <tbody>
                  ${row('Available', '', c.availablePerSize)}
                  ${row('POs', 'green', c.poPerSize)}
                  ${row('Sold Stock', 'red', c.soldStockPerSize)}
                  ${row('Net Need', '', c.netNeedPerSize)}
                </tbody>
              </table>
              ${poLines ? `<div class=\"subhead\">Purchase Orders</div><div class=\"polist\">${poLines}</div>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join("");
    return styles;
  }).join("<div style=\"page-break-after: always\"></div>");

  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #111827; }
        .card { padding: 24px; }
        .header { font-size: 18px; font-weight: 600; margin-bottom: 16px; }
        .row { display: flex; gap: 24px; }
        .left { flex: 0 0 260px; }
        .right { flex: 1 1 auto; }
        .tbl { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 12px; }
        .tbl td { border-bottom: 1px solid #e5e7eb; padding: 8px; }
        .tbl td.v { text-align: right; font-weight: 600; }
        .per { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 12px; }
        .per th, .per td { border-bottom: 1px solid #e5e7eb; padding: 6px; text-align: center; }
        .per th:first-child, .per td:first-child { text-align: left; }
        .green { color: #059669; }
        .red { color: #dc2626; }
        .subhead { font-size: 12px; font-weight: 600; margin-bottom: 6px; }
        .polist { font-size: 12px; display: grid; gap: 4px; }
      </style>
    </head>
    <body>
      ${blocks}
    </body>
  </html>`;
}

export async function POST(request: Request) {
  let browser: puppeteer.Browser | null = null;
  try {
    const { items } = await request.json().catch(() => ({ items: [] as StyleBlock[] }));
    const data: StyleBlock[] = Array.isArray(items) ? items : [];
    browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage();
    await page.setContent(buildHtml(data), { waitUntil: "networkidle0" });
    const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "12mm", right: "12mm", bottom: "12mm", left: "12mm" } });
    await browser.close();
    browser = null;
    return new Response(pdf, { headers: { "Content-Type": "application/pdf", "Content-Disposition": "attachment; filename=export_for_customer.pdf" } });
  } catch (e) {
    if (browser) { try { await browser.close(); } catch {} }
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}


