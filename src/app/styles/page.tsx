"use client";

import { useEffect, useState, Fragment } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import dynamic from "next/dynamic";

type StyleRow = {
  styleNo: string;
  url?: string;
  href?: string;
  styleName?: string;
  brand?: string;
  season?: string;
  supplier?: string;
  imageUrl?: string;
  updatedAt?: string;
  noos?: boolean;
  colorNoos?: Record<string, boolean>;
  sizeset?: { first: string; last: string };
  freeStat?: { stat?: Array<{ colorName: string; sizes: string[]; stock?: { perSize: number[]; total: number }; soldPerSeason?: Array<{ label: string; perSize: number[]; total: number }>; purchaseOrders?: Array<{ code: string; perSize: number[]; total: number }>; availableDedicatedToPre?: { perSize: number[]; total: number } }>; url?: string; styleName?: string };
};

export default function StylesPage() {
  const [rows, setRows] = useState<StyleRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [onlyNoos, setOnlyNoos] = useState(false);
  const [gathering, setGathering] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [totalToProcess, setTotalToProcess] = useState(0);
  const [doneCount, setDoneCount] = useState(0);
  const [currentStyle, setCurrentStyle] = useState<string>("");
  const [showProgress, setShowProgress] = useState(false);
  const [statusText, setStatusText] = useState<string>("");
  const [startTs, setStartTs] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState<number>(0);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/db/styles');
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to load');
        setRows(Array.isArray(data.items) ? data.items : []);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function toggleNoos(idx: number, checked: boolean) {
    const next = [...rows];
    next[idx] = { ...next[idx], noos: checked };
    setRows(next);
    try {
      await fetch('/api/db/styles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ styleNo: next[idx].styleNo, noos: checked }] }) });
    } catch {}
  }

  async function handleGather() {
    const targets = (onlyNoos ? rows.filter(r => r.noos) : rows).filter(r => r.url || r.href);
    if (!targets.length) return;
    setGathering(true);
    setShowProgress(true);
    setTotalToProcess(targets.length);
    setDoneCount(0);
    setCurrentStyle("");
    setStatusText("");
    setStartTs(Date.now());
    setElapsedSec(0);
    try {
      const links = targets.map(r => ({ href: r.url || r.href, styleNo: r.styleNo, styleName: r.styleName }));
      const res = await fetch('/api/spy/assortment-on-style?stream=1', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ links, mode: 'statstock_free', limit: links.length })
      });
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) return;
      let buffer = '';
      const updates: Record<string, any> = {};
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n');
        buffer = parts.pop() || '';
        for (const line of parts) {
          try {
            const obj = JSON.parse(line);
            if (obj.type === 'statstock_free' && obj.ok) {
              const stat = obj.stat || [];
              // sizeset from first color's sizes (first and last)
              let sizeset: { first: string; last: string } | undefined = undefined;
              try {
                const firstSizes = Array.isArray(stat?.[0]?.sizes) ? stat[0].sizes : [];
                if (firstSizes.length) sizeset = { first: String(firstSizes[0]), last: String(firstSizes[firstSizes.length - 1]) };
              } catch {}
              updates[obj.styleNo] = { freeStat: { stat, url: obj.url, styleName: obj.styleName }, ...(sizeset ? { sizeset } : {}), updatedAt: new Date().toISOString() };
              // DONE for this style
              setStatusText('DONE');
              setDoneCount((c) => c + 1);
              try { console.log(`[FREE] ${obj.styleNo}`, stat); } catch {}
            } else if (obj.type === 'log') {
              const m: string = obj.m || '';
              // Minimal messages: Gathering for STYLE, Processing data
              if (/Opening stat & stock tab/i.test(m)) {
                const urlMatch = m.match(/https?:\/\/\S+/);
                const href = urlMatch ? urlMatch[0] : '';
                const found = links.find(l => (l.href || '').split('#')[0] === href.split('#')[0]);
                const label = found?.styleName || found?.styleNo || '';
                setCurrentStyle(label);
                if (label) setStatusText(`Gathering data for ${label}`);
              }
              if (/Parsing FREE details/i.test(m)) {
                setStatusText('Processing data');
              }
              try { console.log(`[LOG ${obj.t || ''}] ${m}`); } catch {}
            }
          } catch {}
        }
      }
      // Persist updates
      const saveItems = Object.entries(updates).map(([styleNo, data]) => ({ styleNo, ...(data as any) }));
      if (saveItems.length) {
        await fetch('/api/db/styles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: saveItems }) });
      }
      // Update UI
      if (saveItems.length) {
        const map = new Map(rows.map(r => [r.styleNo, r]));
        for (const it of saveItems) {
          map.set(it.styleNo, { ...(map.get(it.styleNo) as any), ...it });
        }
        setRows(Array.from(map.values()));
      }
    } catch {}
    finally { setGathering(false); setShowProgress(false); setCurrentStyle(""); setStatusText(""); setStartTs(null); setElapsedSec(0); }
  }

  // Tick elapsed timer when progress is visible
  useEffect(() => {
    if (!showProgress || !startTs) return;
    const id = setInterval(() => {
      setElapsedSec(Math.max(0, Math.floor((Date.now() - startTs) / 1000)));
    }, 1000);
    return () => clearInterval(id);
  }, [showProgress, startTs]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Styles (Cached)</h1>
        <p className="text-sm text-muted-foreground">Cached results from Style List. Use ETA WEEK to refresh and save to cache.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cached Styles</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? <div className="text-sm">Loading…</div> : null}
          {error ? <div className="text-sm text-red-600">{error}</div> : null}
          {/* Toast container provided globally from layout */}
          {/* Floating minimal progress */}
          {showProgress ? (
            <div className="fixed bottom-4 right-4 z-50 w-[380px] rounded border bg-background/95 p-3 text-xs shadow-lg">
              <div className="mb-2 h-2 w-full overflow-hidden rounded bg-muted">
                <div className="h-2 bg-green-600" style={{ width: `${totalToProcess ? Math.round((doneCount / totalToProcess) * 100) : 0}%` }} />
              </div>
              <div className="flex items-center justify-between">
                <div className="font-semibold">{statusText || (currentStyle ? `Processing: ${currentStyle}` : 'Processing…')}</div>
                <div>{doneCount}/{totalToProcess}</div>
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {(() => { const m = Math.floor(elapsedSec / 60); const s = elapsedSec % 60; return `Time elapsed: ${m ? `${m}m ` : ''}${s}s`; })()}
              </div>
            </div>
          ) : null}
          {!loading && !error ? (
            <div className="overflow-auto">
              <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                <div>{rows.length} cached item(s)</div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={onlyNoos} onChange={(e) => setOnlyNoos(e.target.checked)} /> Only NOOS</label>
                  <button className="rounded border px-2 py-1" onClick={handleGather} disabled={gathering}>{gathering ? 'Gathering…' : 'Gather Stat & Stock (FREE)'}</button>
                </div>
              </div>
              <div className="overflow-hidden rounded-md border shadow-sm">
                <table className="min-w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Image</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Style No.</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Style Name</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Brand</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Season</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Supplier</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Size set</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">NOOS</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Updated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                  {rows.map((it, i) => (
                    <Fragment key={`frag-${it.styleNo || it.url || i}`}>
                      <tr key={`${it.styleNo || it.url || i}-${i}`} onClick={() => setExpanded((prev) => ({ ...prev, [it.styleNo]: !prev[it.styleNo] }))} className="cursor-pointer hover:bg-accent/40">
                        <td className="px-3 py-2">
                          {it.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={it.imageUrl} alt="" style={{ width: 48, height: 48, objectFit: 'cover' }} />
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {it.url || it.href ? (
                            <a className="underline" href={it.url || it.href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{it.styleNo}</a>
                          ) : (
                            it.styleNo
                          )}
                        </td>
                        <td className="px-3 py-2">{it.styleName || ""}</td>
                        <td className="px-3 py-2">{it.brand || ""}</td>
                        <td className="px-3 py-2">{it.season || ""}</td>
                        <td className="px-3 py-2">{it.supplier || ""}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{it.sizeset ? `${it.sizeset.first} - ${it.sizeset.last}` : '—'}</td>
                        <td className="px-3 py-2">
                          <Button
                            size="sm"
                            variant={it.noos ? "default" : "outline"}
                            className={it.noos ? "bg-green-600 hover:bg-green-700" : ""}
                            onClick={(e) => { e.stopPropagation(); toggleNoos(i, !Boolean(it.noos)); }}
                          >
                            {it.noos ? 'NOOS' : 'Set NOOS'}
                          </Button>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{it.updatedAt ? new Date(it.updatedAt).toLocaleString() : "—"}</td>
                      </tr>
                      {expanded[it.styleNo] && Array.isArray(it.freeStat?.stat) ? (
                        <tr>
                          <td colSpan={9} className="px-3 py-3 bg-accent/10">
                            <div className="space-y-4">
                              {it.freeStat!.stat!.map((box: any, idx: number) => {
                                const sizes: string[] = Array.isArray(box?.sizes) ? box.sizes : [];
                                const ensure = (arr?: number[]) => sizes.map((_, i) => (Array.isArray(arr) ? (arr[i] ?? 0) : 0));
                                const stock = ensure(box?.stock?.perSize);
                                let soldStock = Array(sizes.length).fill(0) as number[];
                                for (const row of (box?.soldPerSeason || [])) {
                                  if (!row || !Array.isArray(row.perSize)) continue;
                                  if ((row.label || '').toLowerCase().includes('stock')) {
                                    const ps = ensure(row.perSize); soldStock = soldStock.map((v, i) => v + (ps[i] || 0));
                                  }
                                }
                                let po = Array(sizes.length).fill(0) as number[];
                                for (const poRow of (box?.purchaseOrders || [])) { if (poRow?.perSize) { const ps = ensure(poRow.perSize); po = po.map((v, i) => v + (ps[i] || 0)); } }
                                const colorKey = box.colorName || `color-${idx}`;
                                const colorNoos = Boolean(it.colorNoos?.[colorKey] ?? it.noos);
                                const toggleColorNoos = async (checked: boolean) => {
                                  const next = new Map(Object.entries(it.colorNoos || {}));
                                  next.set(colorKey, checked);
                                  setRows((prev) => prev.map(r => r.styleNo === it.styleNo ? { ...r, colorNoos: Object.fromEntries(next) } : r));
                                  try { await fetch('/api/db/styles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ styleNo: it.styleNo, colorNoos: Object.fromEntries(next) }] }) }); } catch {}
                                };
                                return (
                                  <div key={colorKey} className="space-y-2">
                                    <div className="flex items-center justify-between">
                                      <div className="text-xs font-semibold">{box.colorName}</div>
                                      <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={colorNoos} onChange={(e) => toggleColorNoos(e.target.checked)} /> NOOS</label>
                                    </div>
                                    <table className="min-w-full text-xs rounded-md border">
                                      <thead>
                                        <tr>
                                          <th className="border-b px-2 py-1 text-left bg-muted/40">Row</th>
                                          {sizes.map((s: string) => (<th key={s} className="border-b px-2 py-1 text-center bg-muted/40">{s}</th>))}
                                          <th className="border-b px-2 py-1 text-center bg-muted/40">Total</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y">
                                        <tr className="hover:bg-accent/20">
                                          <td className="border-b px-2 py-1 text-left">Stock</td>
                                          {sizes.map((_, j) => (<td key={`st-${j}`} className="border-b px-2 py-1 text-center">{stock[j] ?? 0}</td>))}
                                          <td className="border-b px-2 py-1 text-center">{stock.reduce((a, b) => a + (b || 0), 0)}</td>
                                        </tr>
                                        <tr className="hover:bg-accent/20">
                                          <td className="border-b px-2 py-1 text-left">POs</td>
                                          {sizes.map((_, j) => (<td key={`po-${j}`} className="border-b px-2 py-1 text-center text-green-600">{po[j] ?? 0}</td>))}
                                          <td className="border-b px-2 py-1 text-center text-green-600">{po.reduce((a, b) => a + (b || 0), 0)}</td>
                                        </tr>
                                        <tr className="hover:bg-accent/20">
                                          <td className="border-b px-2 py-1 text-left">Sold Stock</td>
                                          {sizes.map((_, j) => (<td key={`ss-${j}`} className="border-b px-2 py-1 text-center text-red-600">{soldStock[j] ?? 0}</td>))}
                                          <td className="border-b px-2 py-1 text-center text-red-600">{soldStock.reduce((a, b) => a + (b || 0), 0)}</td>
                                        </tr>
                                      </tbody>
                                    </table>
                                  </div>
                                );
                              })}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}


