"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function EtaWeekPage() {
  const [rowLimit, setRowLimit] = useState<number>(25);
  const [listLogs, setListLogs] = useState<{ t: string; m: string }[]>([]);
  const [listItems, setListItems] = useState<any[]>([]);
  const [listRunning, setListRunning] = useState(false);
  const [listOnly] = useState(true);
  const [seasonText, setSeasonText] = useState("");
  const [gatherRunning, setGatherRunning] = useState(false);
  const [gatherLogs, setGatherLogs] = useState<{ t: string; m: string }[]>([]);
  const [gatherItems, setGatherItems] = useState<any[]>([]);
  const [showGather, setShowGather] = useState(true);
  const [selectedMap, setSelectedMap] = useState<Record<string, boolean>>({});

  function toCsv(rows: Array<Record<string, any>>): string {
    if (!rows.length) return "";
    const headers = Array.from(rows.reduce((s, r) => { Object.keys(r).forEach(k => s.add(k)); return s; }, new Set<string>())) as string[];
    const esc = (v: any) => {
      const s = String(v ?? "");
      if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    };
    const lines = [headers.join(",")];
    for (const r of rows) {
      lines.push(headers.map(h => esc(r[h])).join(","));
    }
    return lines.join("\n");
  }

  function buildFlatRowsForExport() {
    const rows: Array<Record<string, any>> = [];
    for (const item of gatherItems) {
      const styleNo = item.styleNo || "";
      const styleName = item.styleName || "";
      const url = item.url || item.href || "";
      for (const box of (item.stat || [])) {
        const color = box.colorName || "";
        const sizes = Array.isArray(box.sizes) ? box.sizes : [];
        const sizeMap = (vals: number[]) => {
          const m: Record<string, number> = {};
          sizes.forEach((s: string, i: number) => { m[`size_${s}`] = vals[i] ?? 0; });
          return m;
        };
        if (box.stock) {
          rows.push({ type: "stock", styleNo, styleName, url, color, ...sizeMap(box.stock.perSize || []), total: box.stock.total ?? 0 });
        }
        for (const s of (box.soldPerSeason || [])) {
          rows.push({ type: "sold", subType: s.label, styleNo, styleName, url, color, ...sizeMap(s.perSize || []), total: s.total ?? 0 });
        }
        for (const p of (box.purchaseTotals || [])) {
          rows.push({ type: "purchase_total", subType: p.label, styleNo, styleName, url, color, ...sizeMap(p.perSize || []), total: p.total ?? 0 });
        }
        for (const po of (box.purchaseOrders || [])) {
          rows.push({ type: "purchase_order", po: po.code, eta: po.eta, href: po.href, styleNo, styleName, url, color, ...sizeMap(po.perSize || []), total: po.total ?? 0 });
        }
      }
    }
    return rows;
  }

  function handleExportCsv() {
    const rows = buildFlatRowsForExport();
    const csv = toCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `eta_week_export_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleRunList() {
    setListRunning(true);
    setListLogs([]);
    setListItems([]);
    setSelectedMap({});
    try {
      try {
        const u = new URL(window.location.href);
        if (seasonText.trim()) u.searchParams.set("season", seasonText.trim()); else u.searchParams.delete("season");
        window.history.replaceState(null, "", u.toString());
      } catch {}
      const res = await fetch("/api/spy/assortment-on-style?stream=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: rowLimit, skipDetails: listOnly, seasonText }),
      });
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("No stream reader");
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n");
        buffer = parts.pop() || "";
        for (const line of parts) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            if (obj.type === "log") {
              setListLogs((prev) => [...prev, { t: obj.t, m: obj.m }]);
              const m: string = obj.m || "";
              const match = m.match(/selectedValue='(\d+)'/);
              if (match && match[1]) {
                try {
                  const u = new URL(window.location.href);
                  u.searchParams.set("seasonId", match[1]);
                  window.history.replaceState(null, "", u.toString());
                } catch {}
              }
            } else if (obj.type === "item" || obj.type === "row") {
              setListItems((prev) => [...prev, obj]);
            }
          } catch {}
        }
      }
    } catch (err) {
      setListLogs((prev) => [...prev, { t: new Date().toISOString(), m: `Error: ${(err as Error).message}` }]);
    } finally {
      setListRunning(false);
    }
  }

  async function handleGatherStatStockFree() {
    setGatherRunning(true);
    setGatherLogs([]);
    setGatherItems([]);
    try {
      const keyOf = (it: any, i: number) => String(it.url || it.href || it.styleNo || i);
      const selected = listItems
        .map((it, i) => ({ it, i, k: keyOf(it, i) }))
        .filter(({ k }) => !!selectedMap[k])
        .map(({ it }) => it);
      const source = selected.length > 0 ? selected : listItems;
      const links = source
        .map((it) => {
          const href = it.url || it.href;
          if (!href) return null;
          return { href, styleNo: it.styleNo, styleName: it.styleName, supplier: it.supplier, brand: it.brand, season: it.season };
        })
        .filter((v) => v && typeof v.href === "string" && v.href.length > 0);
      if (!links.length) throw new Error("No links from list. Run list first.");
      const res = await fetch("/api/spy/assortment-on-style?stream=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ links, mode: "statstock_free", limit: rowLimit }),
      });
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("No stream reader");
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n");
        buffer = parts.pop() || "";
        for (const line of parts) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            if (obj.type === "log") {
              setGatherLogs((prev) => [...prev, { t: obj.t, m: obj.m }]);
            } else if (obj.type === "statstock_free") {
              setGatherItems((prev) => [...prev, obj]);
            }
          } catch {}
        }
      }
    } catch (err) {
      setGatherLogs((prev) => [...prev, { t: new Date().toISOString(), m: `Error: ${(err as Error).message}` }]);
    } finally {
      setGatherRunning(false);
    }
  }

  const sizeLabel = (s: string) => {
    const map: Record<string, string> = { "34": "S", "36": "M", "38": "L", "40": "XL", "42": "XXL" };
    const letter = map[s] || "";
    return letter ? `${s} / ${letter}` : s;
  };

  function computePerSizeSummary(box: any) {
    const sizes: string[] = Array.isArray(box?.sizes) ? box.sizes : [];
    const ensure = (arr?: number[]) => {
      const a = Array.isArray(arr) ? arr : [];
      return sizes.map((_, i) => a[i] ?? 0);
    };
    const stock = ensure(box?.stock?.perSize);
    let soldStock = Array(sizes.length).fill(0) as number[];
    let soldSeasons = Array(sizes.length).fill(0) as number[];
    for (const row of (box?.soldPerSeason || [])) {
      if (!row || !Array.isArray(row.perSize)) continue;
      const ps = ensure(row.perSize);
      if ((row.label || '').toLowerCase().includes('stock')) {
        soldStock = soldStock.map((v, i) => v + (ps[i] || 0));
      } else {
        soldSeasons = soldSeasons.map((v, i) => v + (ps[i] || 0));
      }
    }
    // PO summary should be the sum of individual POs (do not add season-level totals to avoid double-counting)
    let po = Array(sizes.length).fill(0) as number[];
    if (Array.isArray(box?.purchaseOrders) && box.purchaseOrders.length) {
      for (const poRow of box.purchaseOrders) {
        if (!poRow || !Array.isArray(poRow.perSize)) continue;
        const ps = ensure(poRow.perSize);
        po = po.map((v, i) => v + (ps[i] || 0));
      }
    }
    const net = sizes.map((_, i) => (stock[i] || 0) + (po[i] || 0) - (soldStock[i] || 0) - (soldSeasons[i] || 0));
    return { sizes, stock, soldStock, soldSeasons, po, net };
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">ETA WEEK</h1>
        <p className="text-sm text-muted-foreground">Run the style list and include Style Name for planning ETA weeks.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">List Runner</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <input
              type="number"
              className="w-32 rounded border px-2 py-1 text-sm"
              min={1}
              value={rowLimit}
              onChange={(e) => setRowLimit(parseInt(e.target.value || "0", 10))}
              placeholder="Rows to process"
            />
            <input
              type="text"
              className="w-56 rounded border px-2 py-1 text-sm"
              value={seasonText}
              onChange={(e) => setSeasonText(e.target.value)}
              placeholder="Season (e.g., 25 WINTER)"
            />
            <Button onClick={handleRunList} disabled={listRunning || !Number.isFinite(rowLimit) || rowLimit <= 0}>
              {listRunning ? "Running..." : "Run"}
            </Button>
            <Button onClick={async () => {
              try {
                const payload = listItems.map((it) => ({
                  styleNo: it.styleNo,
                  url: it.url || it.href,
                  href: it.href,
                  styleName: it.styleName,
                  brand: it.brand,
                  season: it.season,
                  supplier: it.supplier,
                  imageUrl: it.imageUrl,
                }));
                const res = await fetch('/api/db/styles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: payload }) });
                const data = await res.json();
                if (!res.ok || !data.ok) throw new Error(data.error || 'Failed');
                alert(`Saved ${data.upserted} styles to local cache.`);
              } catch (e) {
                alert(`Failed to save: ${(e as Error).message}`);
              }
            }} disabled={listItems.length === 0} variant="outline">
              Save to Cache
            </Button>
            <Button onClick={handleGatherStatStockFree} disabled={gatherRunning || listItems.length === 0} variant="secondary">
              {gatherRunning ? "Gathering..." : "Gather Stat & Stock (FREE)"}
            </Button>
            <label className="ml-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={showGather} onChange={(e) => setShowGather(e.target.checked)} />
              Show gathered details
            </label>
            <Button onClick={handleExportCsv} disabled={gatherItems.length === 0} variant="outline">
              Export to Excel
            </Button>
            <Button onClick={async () => {
              try {
                const payload = (gatherItems || []).map((it: any) => {
                  const imageUrl = (listItems.find((li: any) => (li.url || li.href) === it.url)?.imageUrl) || "";
                  const colors = (it.stat || []).map((box: any) => {
                    const sizes: string[] = Array.isArray(box?.sizes) ? box.sizes : [];
                    const ensure = (arr?: number[]) => sizes.map((_, i) => (Array.isArray(arr) ? (arr[i] ?? 0) : 0));
                    const stock = ensure(box?.stock?.perSize);
                    let soldStock = Array(sizes.length).fill(0) as number[];
                    for (const row of (box?.soldPerSeason || [])) {
                      if (!row || !Array.isArray(row.perSize)) continue;
                      if ((row.label || '').toLowerCase().includes('stock')) {
                        const ps = ensure(row.perSize);
                        soldStock = soldStock.map((v, i) => v + (ps[i] || 0));
                      }
                    }
                    const available = stock.map((v, i) => v - (soldStock[i] || 0));
                    let po = Array(sizes.length).fill(0) as number[];
                    for (const tot of (box?.purchaseTotals || [])) { if (tot?.perSize) { const ps = ensure(tot.perSize); po = po.map((v, i) => v + (ps[i] || 0)); } }
                    for (const poRow of (box?.purchaseOrders || [])) { if (poRow?.perSize) { const ps = ensure(poRow.perSize); po = po.map((v, i) => v + (ps[i] || 0)); } }
                    const netNeed = sizes.map((_, i) => (available[i] || 0) + (po[i] || 0));
                    const pos = (box?.purchaseOrders || []).map((poRow: any) => ({ code: poRow.code, eta: poRow.eta, total: typeof poRow.total === 'number' ? poRow.total : (Array.isArray(poRow.perSize) ? poRow.perSize.reduce((a: number, b: number) => a + (b || 0), 0) : 0) }));
                    return {
                      colorName: box.colorName,
                      imageUrl,
                      sizes,
                      availablePerSize: available,
                      poPerSize: po,
                      soldStockPerSize: soldStock,
                      netNeedPerSize: netNeed,
                      availableTotal: available.reduce((a, b) => a + (b || 0), 0),
                      poTotal: po.reduce((a, b) => a + (b || 0), 0),
                      pos,
                      netNeedTotal: netNeed.reduce((a, b) => a + (b || 0), 0),
                    };
                  });
                  return { styleNo: it.styleNo, styleName: it.styleName, colors };
                });
                const res = await fetch('/api/export/customer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: payload }) });
                if (!res.ok) throw new Error('Failed to generate PDF');
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'export_for_customer.pdf';
                a.click();
                URL.revokeObjectURL(url);
              } catch (e) {
                console.error(e);
                alert('Failed to export PDF');
              }
            }} disabled={gatherItems.length === 0}>
              Export for Customer (PDF)
            </Button>
          </div>

          {listLogs.length ? (
            <div className="max-h-52 overflow-auto rounded border p-2 text-xs">
              {listLogs.map((l, i) => (
                <div key={i} className="font-mono">[{l.t}] {l.m}</div>
              ))}
            </div>
          ) : null}

          {listItems.length ? (
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground">Processed: {listItems.length} {(() => { const keyOf = (it: any, i: number) => String(it.url || it.href || it.styleNo || i); const selectedCount = listItems.reduce((a, it, i) => a + (selectedMap[keyOf(it, i)] ? 1 : 0), 0); return selectedCount ? `• Selected: ${selectedCount}` : ''; })()}</div>
              <table className="min-w-full text-xs">
                <thead>
                  <tr>
                    <th className="border-b px-2 py-1 text-left">
                      <input
                        type="checkbox"
                        onChange={(e) => {
                          const checked = e.target.checked;
                          if (!checked) { setSelectedMap({}); return; }
                          const map: Record<string, boolean> = {};
                          const keyOf = (it: any, i: number) => String(it.url || it.href || it.styleNo || i);
                          listItems.forEach((it, i) => { map[keyOf(it, i)] = true; });
                          setSelectedMap(map);
                        }}
                        aria-label="Select all"
                      />
                    </th>
                    <th className="border-b px-2 py-1 text-left">Image</th>
                    <th className="border-b px-2 py-1 text-left">Style No.</th>
                    <th className="border-b px-2 py-1 text-left">Style Name</th>
                    <th className="border-b px-2 py-1 text-left">Brand</th>
                    <th className="border-b px-2 py-1 text-left">Season</th>
                    <th className="border-b px-2 py-1 text-left">Supplier</th>
                    <th className="border-b px-2 py-1 text-left">Sales Orders</th>
                    <th className="border-b px-2 py-1 text-left">Purchase Orders</th>
                  </tr>
                </thead>
                <tbody>
                  {listItems.map((it, i) => (
                    <tr key={`${it.styleNo || it.url || i}-${i}`}>
                      <td className="border-b px-2 py-1">
                        <input
                          type="checkbox"
                          checked={Boolean(selectedMap[String(it.url || it.href || it.styleNo || i)])}
                          onChange={(e) => {
                            const k = String(it.url || it.href || it.styleNo || i);
                            const checked = e.target.checked;
                            setSelectedMap((prev) => ({ ...prev, [k]: checked }));
                          }}
                          aria-label="Select row"
                        />
                      </td>
                      <td className="border-b px-2 py-1">
                        {it.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={it.imageUrl} alt="" style={{ width: 48, height: 48, objectFit: 'cover' }} />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="border-b px-2 py-1">
                        <a className="underline" href={it.url || it.href} target="_blank" rel="noreferrer">{it.styleNo}</a>
                      </td>
                      <td className="border-b px-2 py-1">{it.styleName || ""}</td>
                      <td className="border-b px-2 py-1">{it.brand || ""}</td>
                      <td className="border-b px-2 py-1">{it.season || ""}</td>
                      <td className="border-b px-2 py-1">{it.supplier || ""}</td>
                      <td className="border-b px-2 py-1">
                        {it.salesOrdersUrl ? (
                          <a className="underline" href={it.salesOrdersUrl} target="_blank" rel="noreferrer">Open</a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="border-b px-2 py-1">
                        {it.purchaseOrdersUrl ? (
                          <a className="underline" href={it.purchaseOrdersUrl} target="_blank" rel="noreferrer">Open</a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {gatherLogs.length && showGather ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Gather Logs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-52 overflow-auto rounded border p-2 text-xs">
              {gatherLogs.map((l, i) => (
                <div key={i} className="font-mono">[{l.t}] {l.m}</div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {gatherItems.length && showGather ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">FREE Stat & Stock Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {gatherItems.map((it, i) => (
              <div key={`g-${i}`} className="space-y-3">
                <div className="text-xs">
                  <a className="underline" href={it.url} target="_blank" rel="noreferrer">{it.styleName || it.styleNo || `#${i + 1}`}</a>
                </div>
                {(it.stat || []).map((box: any, j: number) => {
                  const summary = computePerSizeSummary(box);
                  const sum = (arr: number[]) => (Array.isArray(arr) ? arr.reduce((a, b) => a + (b || 0), 0) : 0);
                  const soldSeasonRows: Array<{ label: string; perSize: number[] }> = Array.isArray(box?.soldPerSeason)
                    ? box.soldPerSeason.filter((row: any) => row && typeof row.label === 'string' && !/stock/i.test(row.label)).map((row: any) => ({ label: row.label, perSize: row.perSize || [] }))
                    : [];
                  return (
                    <div key={`box-${j}`} className="space-y-2">
                      <div className="text-xs font-semibold">{box.colorName}</div>
                      <table className="min-w-full text-xs">
                        <thead>
                          <tr>
                            <th className="border-b px-2 py-1 text-left">Row</th>
                            {summary.sizes.map((s: string) => (
                              <th key={s} className="border-b px-2 py-1 text-center">{sizeLabel(s)}</th>
                            ))}
                            <th className="border-b px-2 py-1 text-center">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td className="border-b px-2 py-1 text-left">Stock</td>
                            {summary.sizes.map((_, idx) => (
                              <td key={`st-${idx}`} className="border-b px-2 py-1 text-center text-black">{summary.stock[idx] ?? 0}</td>
                            ))}
                            <td className="border-b px-2 py-1 text-center text-black">{sum(summary.stock)}</td>
                          </tr>
                          {box?.availableDedicatedToPre ? (
                            <tr>
                              <td className="border-b px-2 py-1 text-left">Stock Dedicated To Pre (Available)</td>
                              {summary.sizes.map((_, idx) => (
                                <td key={`adp-${idx}`} className="border-b px-2 py-1 text-center text-amber-600">{Array.isArray(box.availableDedicatedToPre?.perSize) ? (box.availableDedicatedToPre.perSize[idx] ?? 0) : 0}</td>
                              ))}
                              <td className="border-b px-2 py-1 text-center text-amber-600">{typeof box.availableDedicatedToPre?.total === 'number' ? box.availableDedicatedToPre.total : 0}</td>
                            </tr>
                          ) : null}
                          <tr>
                            <td className="border-b px-2 py-1 text-left">POs</td>
                            {summary.sizes.map((_, idx) => (
                              <td key={`po-${idx}`} className="border-b px-2 py-1 text-center text-green-600">{summary.po[idx] ?? 0}</td>
                            ))}
                            <td className="border-b px-2 py-1 text-center text-green-600">{sum(summary.po)}</td>
                          </tr>
                          {Array.isArray(box.purchaseOrders) && box.purchaseOrders.length ? (
                            box.purchaseOrders.flatMap((po: any, pIdx: number) => {
                              const ensure = (arr?: number[]) => {
                                const a = Array.isArray(arr) ? arr : [];
                                return summary.sizes.map((_, i) => a[i] ?? 0);
                              };
                              const rows: JSX.Element[] = [];
                              // Primary PO row
                              const perSize = ensure(po.perSize);
                              const rowTotal = typeof po.total === 'number' ? po.total : perSize.reduce((a, b) => a + (b || 0), 0);
                              rows.push(
                                <tr key={`po-row-${pIdx}`}>
                                  <td className="border-b px-2 py-1 text-left">
                                    {po.href ? (
                                      <a className="underline" href={po.href} target="_blank" rel="noreferrer">{po.code || 'PO'}</a>
                                    ) : (
                                      po.code || 'PO'
                                    )}
                                    {po.eta ? <span className="ml-2 text-muted-foreground">{po.eta}</span> : null}
                                  </td>
                                  {perSize.map((v: number, k: number) => (
                                    <td key={`po-row-${pIdx}-${k}`} className="border-b px-2 py-1 text-center text-green-600">{v ?? 0}</td>
                                  ))}
                                  <td className="border-b px-2 py-1 text-center text-green-600">{rowTotal}</td>
                                </tr>
                              );
                              // Dedicated rows immediately under the same PO
                              if (po?.dedicatedStockPerSize) {
                                const dps = ensure(po.dedicatedStockPerSize);
                                const tot = typeof po.dedicatedStockTotal === 'number' ? po.dedicatedStockTotal : dps.reduce((a, b) => a + (b || 0), 0);
                                rows.push(
                                  <tr key={`po-row-${pIdx}-ded-stock`}>
                                    <td className="border-b px-2 py-1 text-left text-amber-700">↳ Stock Dedicated</td>
                                    {dps.map((v: number, k: number) => (
                                      <td key={`po-row-${pIdx}-ded-stock-${k}`} className="border-b px-2 py-1 text-center text-amber-700">{v ?? 0}</td>
                                    ))}
                                    <td className="border-b px-2 py-1 text-center text-amber-700">{tot}</td>
                                  </tr>
                                );
                              }
                              if (po?.dedicatedPrePerSize) {
                                const dpp = ensure(po.dedicatedPrePerSize);
                                const tot = typeof po.dedicatedPreTotal === 'number' ? po.dedicatedPreTotal : dpp.reduce((a, b) => a + (b || 0), 0);
                                rows.push(
                                  <tr key={`po-row-${pIdx}-ded-pre`}>
                                    <td className="border-b px-2 py-1 text-left text-amber-700">↳ Pre Dedicated</td>
                                    {dpp.map((v: number, k: number) => (
                                      <td key={`po-row-${pIdx}-ded-pre-${k}`} className="border-b px-2 py-1 text-center text-amber-700">{v ?? 0}</td>
                                    ))}
                                    <td className="border-b px-2 py-1 text-center text-amber-700">{tot}</td>
                                  </tr>
                                );
                              }
                              return rows;
                            })
                          ) : null}
                          <tr>
                            <td className="border-b px-2 py-1 text-left">Sold Stock</td>
                            {summary.sizes.map((_, idx) => (
                              <td key={`ss-${idx}`} className="border-b px-2 py-1 text-center text-red-600">{summary.soldStock[idx] ?? 0}</td>
                            ))}
                            <td className="border-b px-2 py-1 text-center text-red-600">{sum(summary.soldStock)}</td>
                          </tr>
                          {soldSeasonRows.map((row, rIdx) => (
                            <tr key={`sv-${rIdx}`}>
                              <td className="border-b px-2 py-1 text-left">Sold - {row.label}</td>
                              {summary.sizes.map((_, idx) => (
                                <td key={`sv-${rIdx}-${idx}`} className="border-b px-2 py-1 text-center text-red-600">{row.perSize[idx] ?? 0}</td>
                              ))}
                              <td className="border-b px-2 py-1 text-center text-red-600">{sum(row.perSize)}</td>
                            </tr>
                          ))}
                          <tr>
                            <td className="border-b px-2 py-1 text-left font-semibold">Net Need</td>
                            {summary.sizes.map((_, idx) => {
                              const val = summary.net[idx] ?? 0;
                              const cn = val < 0 ? 'text-red-600' : (val > 0 ? 'text-green-600' : '');
                              return (
                                <td key={`nn-${idx}`} className={`border-b px-2 py-1 text-center font-semibold ${cn}`}>{val}</td>
                              );
                            })}
                            {(() => { const tot = sum(summary.net); const cn = tot < 0 ? 'text-red-600' : (tot > 0 ? 'text-green-600' : ''); return (<td className={`border-b px-2 py-1 text-center font-semibold ${cn}`}>{tot}</td>); })()}
                          </tr>
                        </tbody>
                      </table>
                      {/* Removed separate Purchase Orders list; PO rows are inline above */}
                    </div>
                  );
                })}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}


