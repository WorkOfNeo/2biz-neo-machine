"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function AssortmentOnStylePage() {
  const [styleUrl, setStyleUrl] = useState("");
  const [logs, setLogs] = useState<{ t: string; m: string }[]>([]);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  // List flow
  const [rowLimit, setRowLimit] = useState<number>(25);
  const [listLogs, setListLogs] = useState<{ t: string; m: string }[]>([]);
  const [listItems, setListItems] = useState<any[]>([]);
  const [listRunning, setListRunning] = useState(false);
  const [listOnly, setListOnly] = useState(true);
  const [detailRunning, setDetailRunning] = useState(false);
  const [detailLogs, setDetailLogs] = useState<{ t: string; m: string }[]>([]);
  const [detailItems, setDetailItems] = useState<any[]>([]);
  const [stockRunning, setStockRunning] = useState(false);
  const [stockLogs, setStockLogs] = useState<{ t: string; m: string }[]>([]);
  const [stockItems, setStockItems] = useState<any[]>([]);

  async function handleCheck() {
    setLoading(true);
    setLogs([]);
    setResult(null);
    try {
      const res = await fetch("/api/spy/check-style-detail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: styleUrl }),
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
          try {
            const obj = JSON.parse(line);
            if (obj.type === "log") {
              setLogs((prev) => [...prev, { t: obj.t, m: obj.m }]);
            } else if (obj.type === "result") {
              if (obj.ok) setResult(obj); else setLogs((prev) => [...prev, { t: new Date().toISOString(), m: `Error: ${obj.error}` }]);
            }
          } catch {}
        }
      }
      if (buffer.trim()) {
        try {
          const obj = JSON.parse(buffer.trim());
          if (obj.type === "result" && obj.ok) setResult(obj);
        } catch {}
      }
    } catch (err) {
      setLogs((prev) => [...prev, { t: new Date().toISOString(), m: `Error: ${(err as Error).message}` }]);
    } finally {
      setLoading(false);
    }
  }

  async function handleCheckAssortments() {
    setDetailRunning(true);
    setDetailLogs([]);
    setDetailItems([]);
    try {
      const links = listItems
        .map((it) => (it.url || it.href))
        .filter((v: string | undefined) => typeof v === "string" && v.length > 0);
      if (!links.length) throw new Error("No links from list. Run list first.");
      const res = await fetch("/api/spy/assortment-on-style?stream=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ links, skipDetails: false, limit: rowLimit }),
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
              setDetailLogs((prev) => [...prev, { t: obj.t, m: obj.m }]);
            } else if (obj.type === "item") {
              setDetailItems((prev) => [...prev, obj]);
            }
          } catch {}
        }
      }
    } catch (err) {
      setDetailLogs((prev) => [...prev, { t: new Date().toISOString(), m: `Error: ${(err as Error).message}` }]);
    } finally {
      setDetailRunning(false);
    }
  }

  async function handleStockCheck() {
    setStockRunning(true);
    setStockLogs([]);
    setStockItems([]);
    try {
      const links = listItems
        .map((it) => (it.url || it.href))
        .filter((v: string | undefined) => typeof v === "string" && v.length > 0);
      if (!links.length) throw new Error("No links from list. Run list first.");
      const res = await fetch("/api/spy/assortment-on-style?stream=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ links, mode: "stock", limit: rowLimit }),
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
              setStockLogs((prev) => [...prev, { t: obj.t, m: obj.m }]);
            } else if (obj.type === "stock") {
              setStockItems((prev) => [...prev, obj]);
            }
          } catch {}
        }
      }
    } catch (err) {
      setStockLogs((prev) => [...prev, { t: new Date().toISOString(), m: `Error: ${(err as Error).message}` }]);
    } finally {
      setStockRunning(false);
    }
  }

  async function handleRunList() {
    setListRunning(true);
    setListLogs([]);
    setListItems([]);
    try {
      const res = await fetch("/api/spy/assortment-on-style?stream=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: rowLimit, skipDetails: listOnly }),
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
            } else if (obj.type === "item" || obj.type === "row") {
              setListItems((prev) => [...prev, obj]);
            } else if (obj.type === "done") {
              // no-op, stream will end
            }
          } catch {}
        }
      }
      if (buffer.trim()) {
        try {
          const obj = JSON.parse(buffer.trim());
          if (obj.type === "done") {
            // finished
          }
        } catch {}
      }
    } catch (err) {
      setListLogs((prev) => [...prev, { t: new Date().toISOString(), m: `Error: ${(err as Error).message}` }]);
    } finally {
      setListRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Assortment on Style</h1>
        <p className="text-sm text-muted-foreground">Paste a Style No. URL to inspect FREE and Assortment allocations.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Check</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <input
              className="flex-1 rounded border px-2 py-1 text-sm"
              placeholder="https://2-biz.spysystem.dk/purchase_orders.php?...#tab=edit&data={...}"
              value={styleUrl}
              onChange={(e) => setStyleUrl(e.target.value)}
            />
            <Button onClick={handleCheck} disabled={loading || !styleUrl.trim()}>
              {loading ? "Checking..." : "CHECK"}
            </Button>
          </div>

          {logs.length ? (
            <div className="max-h-52 overflow-auto rounded border p-2 text-xs">
              {logs.map((l, i) => (
                <div key={i} className="font-mono">[{l.t}] {l.m}</div>
              ))}
            </div>
          ) : null}

          {result?.ok ? (
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground">Color: {result.colorName}</div>

              {/* FREE matrices */}
              {result.free ? (
                <div>
                  <div className="text-xs font-semibold mb-1">FREE (STOCK)</div>
                  <table className="min-w-full text-xs mb-2">
                    <thead>
                      <tr>
                        {result.sizes.map((s: string) => (
                          <th key={s} className="border-b px-2 py-1 text-center">{s}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        {result.sizes.map((s: string) => (
                          <td key={s} className="border-b px-2 py-1 text-center">{result.free.STOCK[s] ?? 0}</td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                  <div className="text-xs font-semibold mb-1">FREE (PRE)</div>
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr>
                        {result.sizes.map((s: string) => (
                          <th key={s} className="border-b px-2 py-1 text-center">{s}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        {result.sizes.map((s: string) => (
                          <td key={s} className="border-b px-2 py-1 text-center">{result.free.PRE[s] ?? 0}</td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              ) : null}

              {/* Assortment composition + qty */}
              {result.packs ? (
                <div>
                  <div className="text-xs font-semibold mb-1">Assortment composition</div>
                  <table className="min-w-full text-xs mb-2">
                    <thead>
                      <tr>
                        <th className="border-b px-2 py-1 text-left">Assortment</th>
                        {result.sizes.map((s: string) => (
                          <th key={s} className="border-b px-2 py-1 text-center">{s}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(result.packs.composition).map(([label, row]: any) => (
                        <tr key={label}>
                          <td className="border-b px-2 py-1">{label}</td>
                          {result.sizes.map((s: string) => (
                            <td key={s} className="border-b px-2 py-1 text-center">{row[s] ?? 0}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="text-xs font-semibold mb-1">Assortment QTY</div>
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr>
                        <th className="border-b px-2 py-1 text-left">Assortment</th>
                        <th className="border-b px-2 py-1 text-center">STOCK QTY</th>
                        <th className="border-b px-2 py-1 text-center">PRE QTY</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(result.packs.qty).map(([label, q]: any) => (
                        <tr key={label}>
                          <td className="border-b px-2 py-1">{label}</td>
                          <td className="border-b px-2 py-1 text-center">{q.stockQty}</td>
                          <td className="border-b px-2 py-1 text-center">{q.preQty}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

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
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={listOnly} onChange={(e) => setListOnly(e.target.checked)} />
              List only (don’t visit details)
            </label>
            <Button onClick={handleRunList} disabled={listRunning || !Number.isFinite(rowLimit) || rowLimit <= 0}>
              {listRunning ? "Running..." : "Run"}
            </Button>
            <Button onClick={handleCheckAssortments} disabled={detailRunning || listItems.length === 0} variant="secondary">
              {detailRunning ? "Checking..." : "Check Assortments"}
            </Button>
            <Button onClick={handleStockCheck} disabled={stockRunning || listItems.length === 0} variant="secondary">
              {stockRunning ? "Checking..." : "Stock Check"}
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
              <div className="text-xs text-muted-foreground">Processed: {listItems.length}</div>
              <table className="min-w-full text-xs">
                <thead>
                  <tr>
                    <th className="border-b px-2 py-1 text-left">Style No.</th>
                    <th className="border-b px-2 py-1 text-left">Brand</th>
                    <th className="border-b px-2 py-1 text-left">Season</th>
                    <th className="border-b px-2 py-1 text-left">Supplier</th>
                    {!listOnly && <th className="border-b px-2 py-1 text-left">Sizes</th>}
                    {!listOnly && <th className="border-b px-2 py-1 text-left">Assortments</th>}
                  </tr>
                </thead>
                <tbody>
                  {listItems.map((it, i) => (
                    <tr key={`${it.styleNo || it.url || i}-${i}`}>
                      <td className="border-b px-2 py-1">
                        <a className="underline" href={it.url || it.href} target="_blank" rel="noreferrer">{it.styleNo}</a>
                      </td>
                      <td className="border-b px-2 py-1">{it.brand || ""}</td>
                      <td className="border-b px-2 py-1">{it.season || ""}</td>
                      <td className="border-b px-2 py-1">{it.supplier || ""}</td>
                      {!listOnly && (
                        <td className="border-b px-2 py-1">{Array.isArray(it.sizes) ? it.sizes.join(", ") : ""}</td>
                      )}
                      {!listOnly && (
                        <td className="border-b px-2 py-1">
                          {Array.isArray(it.assortments) && it.assortments.length ? (
                            <div className="space-y-1">
                              {it.assortments.map((a: any) => (
                                <div key={a.label} className="flex items-center justify-between gap-2">
                                  <span>{a.label}</span>
                                  <span className={`rounded px-1 py-0.5 text-[10px] ${a.active ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                                    {a.active ? "ACTIVE" : "INACTIVE"}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">None</span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {detailLogs.length ? (
            <div className="max-h-52 overflow-auto rounded border p-2 text-xs">
              {detailLogs.map((l, i) => (
                <div key={i} className="font-mono">[{l.t}] {l.m}</div>
              ))}
            </div>
          ) : null}

          {detailItems.length && !listOnly ? (
            <div className="space-y-4">
              <div className="text-xs font-semibold">Assortment details collected: {detailItems.length}</div>
              {detailItems.map((it, i) => (
                <div key={`detail-${i}`} className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <div className="space-x-2">
                      <a className="underline" href={it.url} target="_blank" rel="noreferrer">{it.styleNo || `#${i + 1}`}</a>
                      <span className="text-muted-foreground">{it.brand || ""}</span>
                    </div>
                    {it.secondRow ? (
                      <div className="text-muted-foreground">
                        Second row: <span className="font-medium">{it.secondRow.value}</span> · State: <span className="font-medium">{it.secondRow.state}</span>
                      </div>
                    ) : null}
                  </div>
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr>
                        <th className="border-b px-2 py-1 text-left">Assortment</th>
                        {(it.sizes || []).map((s: string) => (
                          <th key={s} className="border-b px-2 py-1 text-center">{s}</th>
                        ))}
                        <th className="border-b px-2 py-1 text-center">Total</th>
                        <th className="border-b px-2 py-1 text-center">Min Qty.</th>
                        <th className="border-b px-2 py-1 text-center">State</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(it.rows || []).map((row: any, rIdx: number) => (
                        <tr key={`r-${rIdx}`}>
                          <td className="border-b px-2 py-1">{row.value}</td>
                          {(it.sizes || []).map((s: string) => (
                            <td key={s} className="border-b px-2 py-1 text-center">{row.perSize?.[s] ?? 0}</td>
                          ))}
                          <td className="border-b px-2 py-1 text-center">{row.total ?? 0}</td>
                          <td className="border-b px-2 py-1 text-center">{row.minQty ?? 0}</td>
                          <td className="border-b px-2 py-1 text-center">
                            <span className={`rounded px-1 py-0.5 text-[10px] ${row.state === 'disabled' ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>
                              {row.state?.toUpperCase()}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          ) : null}

          {stockLogs.length ? (
            <div className="max-h-52 overflow-auto rounded border p-2 text-xs">
              {stockLogs.map((l, i) => (
                <div key={i} className="font-mono">[{l.t}] {l.m}</div>
              ))}
            </div>
          ) : null}

          {stockItems.length ? (
            <div className="space-y-6">
              <div className="text-xs font-semibold">Stock matrices: {stockItems.length}</div>
              {stockItems.map((it, i) => (
                <div key={`stock-${i}`} className="space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <div className="space-x-2">
                      <a className="underline" href={it.url} target="_blank" rel="noreferrer">{it.styleNo || `#${i + 1}`}</a>
                    </div>
                  </div>
                  {(it.stock || []).map((box: any, j: number) => (
                    <div key={`box-${j}`} className="space-y-2">
                      <div className="text-xs font-semibold">{box.colorName}</div>
                      <table className="min-w-full text-xs">
                        <thead>
                          <tr>
                            <th className="border-b px-2 py-1 text-left">Row</th>
                            {box.sizes.map((s: string) => (
                              <th key={s} className="border-b px-2 py-1 text-center">{s}</th>
                            ))}
                            <th className="border-b px-2 py-1 text-center">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {['stock','soldStock','soldPre','available','po','delivered'].map((key) => {
                            const row = (box as any)[key];
                            if (!row) return null;
                            return (
                              <tr key={key}>
                                <td className="border-b px-2 py-1 text-left">{row.label || key}</td>
                                {row.perSize.map((v: number, k: number) => (
                                  <td key={k} className="border-b px-2 py-1 text-center">{v ?? 0}</td>
                                ))}
                                <td className="border-b px-2 py-1 text-center">{row.total ?? 0}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}


