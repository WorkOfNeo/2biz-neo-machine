"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function CheckAssortmentsPage() {
  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<{ t: string; m: string }[]>([]);
  const [tableData, setTableData] = useState<{ head: string[]; rows: any[]; counts?: { head: number; rows: number } } | null>(null);
  const [currentStep, setCurrentStep] = useState<string>("");
  const [limit, setLimit] = useState<number>(5);
  const [nested, setNested] = useState<Record<number, { url: string; head: string[]; rows: any[]; counts?: { head: number; rows: number } }>>({});
  const [nestedLogs, setNestedLogs] = useState<{ t: string; m: string }[]>([]);
  const [indexMap, setIndexMap] = useState<number[]>([]); // maps streamed item.index -> original row index
  const [styleDetail, setStyleDetail] = useState<Record<number, { sizes: string[]; stock?: Record<string, Record<string, number>>; pre?: Record<string, Record<string, number>>; allocations?: any[]; free?: { STOCK: Record<string, number>; PRE: Record<string, number> }; packs?: { composition: Record<string, Record<string, number>>; qty: Record<string, { stockQty: number; preQty: number }> } }>>({});

  async function handleLogin() {
    setLoading(true);
    setStatus("");
    try {
      const res = await fetch("/api/spy/login", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.ok) {
        setStatus("OK");
      } else {
        setStatus(`Error: ${data.error ?? "Unknown"}`);
      }
    } catch (err) {
      setStatus(`Error: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  function getPoLinksFromRowsPairs() {
    if (!tableData) return [] as { rowIndex: number; href: string }[];
    // Try to find a column whose header includes PO or links exist in a cell
    const head = tableData.head.map((h) => (h || "").toLowerCase());
    let linkCol = head.findIndex((h) => h.includes("po") || h.includes("actions"));
    if (linkCol === -1) {
      // fallback: first cell that has a link per row
      return tableData.rows
        .map((r, ri) => {
          const hit = r.cells.find((c: any) => c && c.link && c.link.href);
          const href = hit?.link?.href as string | undefined;
          return href ? { rowIndex: ri, href } : null;
        })
        .filter(Boolean) as { rowIndex: number; href: string }[];
    }
    return tableData.rows
      .map((r, ri) => {
        const href = r.cells?.[linkCol]?.link?.href as string | undefined;
        return href ? { rowIndex: ri, href } : null;
      })
      .filter(Boolean) as { rowIndex: number; href: string }[];
  }

  async function handleFetchPurchases() {
    setLoading(true);
    setStatus("");
    setLogs([]);
    setTableData(null);
    setCurrentStep("");
    try {
      const res = await fetch("/api/spy/check-purchases?stream=1", { method: "POST" });
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("No stream reader");
      let fullLogs: { t: string; m: string }[] = [];
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n");
        buffer = parts.pop() || ""; // keep last partial line
        for (const line of parts) {
          try {
            const obj = JSON.parse(line);
            if (obj.type === "log") {
              fullLogs.push({ t: obj.t, m: obj.m });
              setLogs([...fullLogs]);
              if (obj.m.startsWith("STEP:")) setCurrentStep(obj.m.replace("STEP: ", ""));
            } else if (obj.type === "result") {
              if (obj.ok) {
                setStatus("OK");
                setTableData({ head: obj.head ?? [], rows: obj.rows ?? [], counts: obj.counts ?? undefined });
              } else {
                setStatus(`Error: ${obj.error ?? "Unknown"}`);
              }
            }
          } catch {}
        }
      }
      // flush leftover line if any
      if (buffer.trim()) {
        try {
          const obj = JSON.parse(buffer.trim());
          if (obj.type === "result") {
            if (obj.ok) {
              setStatus("OK");
              setTableData({ head: obj.head ?? [], rows: obj.rows ?? [], counts: obj.counts ?? undefined });
            } else {
              setStatus(`Error: ${obj.error ?? "Unknown"}`);
            }
          }
        } catch {}
      }
    } catch (err) {
      setStatus(`Error: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleCheckStockPre() {
    if (!tableData) return;
    const pairs = getPoLinksFromRowsPairs();
    const selected = pairs.slice(0, Math.max(0, Number(limit) || 0));
    const toSend = selected.map((p) => p.href);
    setIndexMap(selected.map((p) => p.rowIndex));
    setNested({});
    setNestedLogs([]);
    setLoading(true);
    try {
      const res = await fetch("/api/spy/check-stock-pre?stream=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ links: toSend, limit: toSend.length }),
      });
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("No stream reader");
      let fullLogs: { t: string; m: string }[] = [];
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
              fullLogs.push({ t: obj.t, m: obj.m });
              setNestedLogs([...fullLogs]);
            } else if (obj.type === "item") {
              const originalRowIndex = indexMap[obj.index] ?? obj.index;
              setNested((prev) => ({ ...prev, [originalRowIndex]: { url: obj.url, head: obj.head ?? [], rows: obj.rows ?? [], counts: obj.counts ?? undefined } }));
            }
          } catch {}
        }
      }
      if (buffer.trim()) {
        try {
          const obj = JSON.parse(buffer.trim());
          if (obj.type === "item") {
            const originalRowIndex = indexMap[obj.index] ?? obj.index;
            setNested((prev) => ({ ...prev, [originalRowIndex]: { url: obj.url, head: obj.head ?? [], rows: obj.rows ?? [], counts: obj.counts ?? undefined } }));
          }
        } catch {}
      }
    } catch (err) {
      // show error in nested logs
      setNestedLogs((prev) => [...prev, { t: new Date().toISOString(), m: `Error: ${(err as Error).message}` }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Check Purchases</h1>
        <p className="text-sm text-muted-foreground">Authenticate to SpySystem to proceed.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Login</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <Button onClick={handleLogin} disabled={loading}>
            {loading ? "Logging in..." : "Login to SpySystem"}
          </Button>
          {status && (
            <span className={status === "OK" ? "text-green-600" : "text-red-600"}>{status}</span>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Running Purchases</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={handleFetchPurchases} disabled={loading}>
              {loading ? "Checking..." : "Fetch Running Purchases"}
            </Button>
            {status && (
              <span className={status === "OK" ? "text-green-600" : "text-red-600"}>{status}</span>
            )}
          </div>

          {currentStep && (
            <div className="text-xs text-muted-foreground">Current step: {currentStep}</div>
          )}

          {logs?.length ? (
            <div className="max-h-52 overflow-auto rounded border p-2 text-xs">
              {logs.map((l, i) => (
                <div key={i} className="font-mono">
                  [{l.t}] {l.m}
                </div>
              ))}
            </div>
          ) : null}

          {tableData ? (
            <div className="overflow-auto">
              <div className="mb-2 text-xs text-muted-foreground">
                {typeof tableData.counts?.rows === "number" ? `${tableData.counts.rows} rows` : null}
                {typeof tableData.counts?.head === "number" ? ` • ${tableData.counts.head} columns` : null}
              </div>
              <table className="min-w-full text-sm">
                <thead>
                  <tr>
                    {(tableData.head ?? []).map((h: string, i: number) => (
                      <th key={i} className="border-b px-2 py-1 text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(tableData.rows ?? []).map((r: any, ri: number) => (
                    <tr key={ri}>
                      {r.cells.map((c: any, ci: number) => (
                        <td key={ci} className="border-b px-2 py-1">
                          {c.link ? (
                            <a href={c.link.href} className="underline" target="_blank" rel="noreferrer">
                              {c.link.text || c.link.href}
                            </a>
                          ) : c.image ? (
                            <img src={c.image.src} alt={c.image.alt} className="h-8 w-8 object-cover" />
                          ) : (
                            c.text
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="mt-4">
                <div className="mb-1 text-xs text-muted-foreground">
                  Raw rows ({tableData.counts?.rows ?? (tableData.rows ?? []).length})
                </div>
                <div className="max-h-80 overflow-auto rounded border p-2 text-xs font-mono">
                  {(tableData.rows ?? []).map((r: any, ri: number) => {
                    const obj = Object.fromEntries((tableData.head ?? []).map((h: string, i: number) => {
                      const c = r.cells[i];
                      const v = c ? (c.link ? (c.link.text || c.link.href) : (c.image ? c.image.src : c.text)) : "";
                      return [h, v];
                    }));
                    return (
                      <div key={ri}>{JSON.stringify(obj)}</div>
                    );
                  })}
                </div>
              </div>

            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Separate section below for the next function */}
      {tableData ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Check Stock / Pre</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <input
                type="number"
                className="w-24 rounded border px-2 py-1 text-sm"
                min={1}
                value={limit}
                onChange={(e) => setLimit(parseInt(e.target.value || "0", 10))}
              />
              <Button onClick={handleCheckStockPre} disabled={loading}>
                {loading ? "Processing..." : "Check Stock / Pre for first N"}
              </Button>
            </div>

            {nestedLogs.length ? (
              <div className="max-h-52 overflow-auto rounded border p-2 text-xs">
                {nestedLogs.map((l, i) => (
                  <div key={i} className="font-mono">[{l.t}] {l.m}</div>
                ))}
              </div>
            ) : null}

            {/* Nested results under each source row */}
            {(tableData.rows ?? []).map((r: any, ri: number) => {
              const linkInRow = r.cells.find((c: any) => c && c.link && c.link.href)?.link?.href as string | undefined;
              const nestedEntry = nested[ri];
              return (
                <div key={ri} className="rounded border p-2">
                  <div className="mb-1 text-xs text-muted-foreground">Row {ri + 1}{linkInRow ? ` • ${linkInRow}` : ""}</div>
                  {nestedEntry ? (
                    <div className="overflow-auto">
                      <div className="mb-1 text-xs text-muted-foreground">
                        {typeof nestedEntry.counts?.rows === "number" ? `${nestedEntry.counts.rows} rows` : null}
                        {typeof nestedEntry.counts?.head === "number" ? ` • ${nestedEntry.counts.head} columns` : null}
                      </div>
                      {/* Per-style CHECK controls */}
                      <div className="mb-2 flex items-center gap-2">
                        <Button
                          variant="outline"
                          onClick={async () => {
                            // Prefer Style No. link from the nested stock/pre table (usually column with 6-digit text)
                            const pickFromNested = () => {
                              const rows = nestedEntry.rows || [];
                              for (const nr of rows) {
                                for (const cell of nr.cells || []) {
                                  const link = cell?.link;
                                  if (!link?.href) continue;
                                  const text = (link.text || '').trim();
                                  if (/^\d{5,}$/.test(text)) return link.href;
                                  if (link.href.includes('purchase_orders.php') && link.href.includes('#tab=edit')) return link.href;
                                }
                              }
                              return undefined;
                            };
                            let styleLink = pickFromNested();
                            if (!styleLink) {
                              // Fallback to any link in the original row
                              styleLink = r.cells.find((c: any) => c && c.link && c.link.href)?.link?.href as string | undefined;
                            }
                            if (!styleLink) return;
                            setNestedLogs((prev) => [...prev, { t: new Date().toISOString(), m: `STEP: Checking style detail -> ${styleLink}` }]);
                            const res = await fetch('/api/spy/check-style-detail', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ url: styleLink }),
                            });
                            const reader = res.body?.getReader();
                            const decoder = new TextDecoder();
                            if (!reader) return;
                            let buffer = "";
                            for (;;) {
                              const { value, done } = await reader.read();
                              if (done) break;
                              buffer += decoder.decode(value, { stream: true });
                              const parts = buffer.split('\n');
                              buffer = parts.pop() || '';
                              for (const line of parts) {
                                try {
                                  const obj = JSON.parse(line);
                                  if (obj.type === 'log') {
                                    setNestedLogs((prev) => [...prev, { t: obj.t, m: obj.m }]);
                                  } else if (obj.type === 'result') {
                                    if (obj.ok) {
                                      const summary = (obj.allocationsQty || obj.allocations || []).map((a: any) => `${a.label}: STOCK ${a.stockTotal} • PRE ${a.preTotal}`).join(' | ');
                                      setNestedLogs((prev) => [...prev, { t: new Date().toISOString(), m: `STEP: Detail allocations -> ${summary || 'none'}` }]);
                                      if (obj.freeTotals) {
                                        setNestedLogs((prev) => [...prev, { t: new Date().toISOString(), m: `STEP: FREE totals -> STOCK ${obj.freeTotals.stockTotal} • PRE ${obj.freeTotals.preTotal}` }]);
                                      }
                                      if (obj.sizeMatrix && obj.sizes) {
                                        const lines: string[] = [];
                                        lines.push(`Matrix (STOCK):`);
                                        for (const label of Object.keys(obj.sizeMatrix.STOCK || {})) {
                                          const row = obj.sizeMatrix.STOCK[label] || {};
                                          const vals = (obj.sizes as string[]).map((s: string) => String(row[s] ?? 0)).join(', ');
                                          lines.push(`${label}: [${vals}]`);
                                        }
                                        lines.push(`Matrix (PRE):`);
                                        for (const label of Object.keys(obj.sizeMatrix.PRE || {})) {
                                          const row = obj.sizeMatrix.PRE[label] || {};
                                          const vals = (obj.sizes as string[]).map((s: string) => String(row[s] ?? 0)).join(', ');
                                          lines.push(`${label}: [${vals}]`);
                                        }
                                        for (const ln of lines) {
                                          setNestedLogs((prev) => [...prev, { t: new Date().toISOString(), m: ln }]);
                                        }
                                        // persist matrix for HTML rendering
                                        setStyleDetail((prev) => ({
                                          ...prev,
                                          [ri]: {
                                            sizes: obj.sizes as string[],
                                            free: obj.free || undefined,
                                            packs: obj.packs || undefined,
                                            allocations: obj.allocationsQty || obj.allocations || [],
                                          },
                                        }));
                                      }
                                    } else {
                                      setNestedLogs((prev) => [...prev, { t: new Date().toISOString(), m: `STEP: Detail error -> ${obj.error}` }]);
                                    }
                                  }
                                } catch {}
                              }
                            }
                            if (buffer.trim()) {
                              try {
                                const obj = JSON.parse(buffer.trim());
                                if (obj.type === 'result' && obj.ok) {
                                  const summary = (obj.allocationsQty || obj.allocations || []).map((a: any) => `${a.label}: STOCK ${a.stockTotal} • PRE ${a.preTotal}`).join(' | ');
                                  setNestedLogs((prev) => [...prev, { t: new Date().toISOString(), m: `STEP: Detail allocations -> ${summary || 'none'}` }]);
                                  if (obj.freeTotals) {
                                    setNestedLogs((prev) => [...prev, { t: new Date().toISOString(), m: `STEP: FREE totals -> STOCK ${obj.freeTotals.stockTotal} • PRE ${obj.freeTotals.preTotal}` }]);
                                  }
                                  if (obj.sizeMatrix && obj.sizes) {
                                    setStyleDetail((prev) => ({
                                      ...prev,
                                      [ri]: {
                                        sizes: obj.sizes as string[],
                                        free: obj.free || undefined,
                                        packs: obj.packs || undefined,
                                        allocations: obj.allocationsQty || obj.allocations || [],
                                      },
                                    }));
                                  }
                                }
                              } catch {}
                            }
                          }}
                        >
                          CHECK
                        </Button>
                      </div>
                      <table className="min-w-full text-xs">
                        <thead>
                          <tr>
                            {(nestedEntry.head ?? []).map((h: string, i: number) => (
                              <th key={i} className="border-b px-2 py-1 text-left">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(nestedEntry.rows ?? []).map((nr: any, nri: number) => (
                            <tr key={nri}>
                              {nr.cells.map((c: any, ci: number) => (
                                <td key={ci} className="border-b px-2 py-1">
                                  {c.link ? (
                                    <a href={c.link.href} className="underline" target="_blank" rel="noreferrer">
                                      {c.link.text || c.link.href}
                                    </a>
                                  ) : c.image ? (
                                    <img src={c.image.src} alt={c.image.alt} className="h-8 w-8 object-cover" />
                                  ) : (
                                    c.text
                                  )}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      {/* Style detail matrices (render sizes as headers) */}
                      {styleDetail[ri] ? (
                        <div className="mt-3 space-y-3">
                          {styleDetail[ri].allocations?.length ? (
                            <div>
                              <div className="text-xs font-semibold mb-1">Assortment totals (QTY)</div>
                              <table className="min-w-full text-xs">
                                <thead>
                                  <tr>
                                    <th className="border-b px-2 py-1 text-left">Assortment</th>
                                    <th className="border-b px-2 py-1 text-center">STOCK QTY</th>
                                    <th className="border-b px-2 py-1 text-center">PRE QTY</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {styleDetail[ri].allocations!.map((a: any) => (
                                    <tr key={a.label}>
                                      <td className="border-b px-2 py-1">{a.label}</td>
                                      <td className="border-b px-2 py-1 text-center">{a.stockTotal}</td>
                                      <td className="border-b px-2 py-1 text-center">{a.preTotal}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : null}
                          {styleDetail[ri].free ? (
                            <div>
                              <div className="text-xs font-semibold mb-1">FREE (STOCK)</div>
                              <table className="min-w-full text-xs mb-2">
                                <thead>
                                  <tr>
                                    {styleDetail[ri].sizes.map((s) => (
                                      <th key={s} className="border-b px-2 py-1 text-center">{s}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  <tr>
                                    {styleDetail[ri].sizes.map((s) => (
                                      <td key={s} className="border-b px-2 py-1 text-center">{styleDetail[ri].free!.STOCK[s] ?? 0}</td>
                                    ))}
                                  </tr>
                                </tbody>
                              </table>
                              <div className="text-xs font-semibold mb-1">FREE (PRE)</div>
                              <table className="min-w-full text-xs">
                                <thead>
                                  <tr>
                                    {styleDetail[ri].sizes.map((s) => (
                                      <th key={s} className="border-b px-2 py-1 text-center">{s}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  <tr>
                                    {styleDetail[ri].sizes.map((s) => (
                                      <td key={s} className="border-b px-2 py-1 text-center">{styleDetail[ri].free!.PRE[s] ?? 0}</td>
                                    ))}
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          ) : null}

                          {styleDetail[ri].packs ? (
                            <div>
                              <div className="text-xs font-semibold mb-1">Assortment composition</div>
                              <table className="min-w-full text-xs mb-2">
                                <thead>
                                  <tr>
                                    <th className="border-b px-2 py-1 text-left">Assortment</th>
                                    {styleDetail[ri].sizes.map((s) => (
                                      <th key={s} className="border-b px-2 py-1 text-center">{s}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {Object.entries(styleDetail[ri].packs!.composition).map(([label, row]) => (
                                    <tr key={label}>
                                      <td className="border-b px-2 py-1">{label}</td>
                                      {styleDetail[ri].sizes.map((s) => (
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
                                  {Object.entries(styleDetail[ri].packs!.qty).map(([label, q]) => (
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

                          {/* Concise summary lines as requested */}
                          <div className="mt-2 text-xs">
                            <div className="font-semibold mb-1">Summary</div>
                            {styleDetail[ri].free ? (
                              <>
                                <div>
                                  FREE - STOCK {styleDetail[ri].sizes.map((s, i) => `${s}: ${styleDetail[ri].free!.STOCK[s] ?? 0}`).join(', ')}
                                </div>
                                <div>
                                  FREE - PRE {styleDetail[ri].sizes.map((s, i) => `${s}: ${styleDetail[ri].free!.PRE[s] ?? 0}`).join(', ')}
                                </div>
                              </>
                            ) : null}
                            {styleDetail[ri].packs ? (
                              Object.entries(styleDetail[ri].packs!.qty).map(([label, q]) => (
                                <div key={label}>
                                  {label} - STOCK: {q.stockQty} • PRE: {q.preQty}
                                </div>
                              ))
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">No nested result yet.</div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}


