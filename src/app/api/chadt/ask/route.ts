import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type ChatBody = { message: string };

function extractStyleQuery(message: string): string | null {
  const m = String(message || "");
  // Try quoted
  const q = m.match(/"([^"]+)"|'([^']+)'/);
  if (q) return (q[1] || q[2] || '').trim();
  // Try after "for"
  const forMatch = m.match(/(?:stock|inventory|levels|availability)[^\w]+(?:for|of)\s+([A-Za-z0-9 _\-./#]+)\??/i);
  if (forMatch) return (forMatch[1] || '').trim();
  // Fallback: last 4+ char token after 'stock'
  const simple = m.split(/for\s+/i).pop();
  if (simple && simple.length >= 3) return simple.trim();
  return null;
}

async function runMapping(request: Request, payload: any): Promise<any[]> {
  const url = new URL('/api/mapping/run?stream=1', request.url);
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const reader = res.body?.getReader();
  const decoder = new TextDecoder();
  if (!reader) return [];
  const events: any[] = [];
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n');
    buffer = parts.pop() || '';
    for (const line of parts) {
      try { events.push(JSON.parse(line)); } catch {}
    }
  }
  if (buffer.trim()) { try { events.push(JSON.parse(buffer.trim())); } catch {} }
  return events;
}

function findRowByName(table: { head: string[]; rows: any[] }, nameQuery: string) {
  const q = nameQuery.trim().toLowerCase();
  for (const r of table.rows || []) {
    for (const c of (r.cells || [])) {
      const t = String(c?.text || c?.link?.text || '').trim().toLowerCase();
      if (!t) continue;
      if (t.includes(q)) return r;
    }
  }
  return null;
}

function pickLinkFromRow(row: any): string | null {
  const cells = Array.isArray(row?.cells) ? row.cells : [];
  for (const c of cells) {
    if (c?.link?.href) return String(c.link.href);
  }
  return null;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as ChatBody;
  const message = String(body.message || '').trim();
  if (!message) return NextResponse.json({ ok: false, error: 'No message' }, { status: 400 });

  // Detect style stock intent
  const styleQuery = extractStyleQuery(message);
  if (/(stock|availability|levels)/i.test(message) && styleQuery) {
    const allLogs: Array<{ t: string; m: string }> = [];
    // 1) login
    {
      const ev = await runMapping(request, { taskId: 'login' });
      for (const e of ev) { if (e && e.type === 'log' && e.t && e.m) allLogs.push({ t: e.t, m: `[login] ${e.m}` }); }
    }
    // 2) list styles show all
    const events = await runMapping(request, { taskId: 'style-list-show-all' });
    for (const e of events) { if (e && e.type === 'log' && e.t && e.m) allLogs.push({ t: e.t, m: `[list] ${e.m}` }); }
    const tableEvt = events.find((e) => e && e.type === 'table');
    const table = tableEvt ? { head: tableEvt.head || [], rows: tableEvt.rows || [] } : { head: [], rows: [] };
    const row = findRowByName(table, styleQuery);
    if (!row) {
      return NextResponse.json({ ok: true, messages: [
        { role: 'assistant', content: `I could not find a style matching "${styleQuery}" in the list.` }
      ], logs: allLogs });
    }
    const url = pickLinkFromRow(row);
    if (!url) {
      return NextResponse.json({ ok: true, messages: [
        { role: 'assistant', content: `Found a matching row for "${styleQuery}" but no detail link was available.` }
      ], logs: allLogs });
    }
    // 3) extract FREE from style
    const statEvents = await runMapping(request, { taskId: 'statstock-free-from-style', params: { url } });
    for (const e of statEvents) { if (e && e.type === 'log' && e.t && e.m) allLogs.push({ t: e.t, m: `[free] ${e.m}` }); }
    const dataEvt = statEvents.find((e) => e && e.type === 'data' && e.ok && e.value && e.value.stat);
    const stat = dataEvt?.value?.stat || [];
    if (!Array.isArray(stat) || !stat.length) {
      return NextResponse.json({ ok: true, messages: [
        { role: 'assistant', content: `No Stat & Stock (FREE) data was found for that style.` }
      ], logs: allLogs, meta: { url } });
    }
    // Build concise summary
    const lines: string[] = [];
    for (const box of stat) {
      const color = box.colorName || 'Color';
      const sizes: string[] = Array.isArray(box.sizes) ? box.sizes : [];
      const stock = box.stock?.perSize || [];
      const sizePairs = sizes.map((s: string, i: number) => `${s}: ${stock[i] ?? 0}`);
      lines.push(`${color} -> ${sizePairs.join(', ')}`);
    }
    const content = `Stock (FREE) per color/size for "${styleQuery}":\n` + lines.join('\n');
    return NextResponse.json({ ok: true, messages: [ { role: 'assistant', content } ], logs: allLogs, meta: { url } });
  }

  // Default fallback
  return NextResponse.json({ ok: true, messages: [ { role: 'assistant', content: "I can check stock for a specific style. Ask e.g. 'What is the stock for \"STYLE NAME\"?'." } ] });
}


