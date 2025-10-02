"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Task = { id: string; label: string; description?: string };

export default function MappingPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<{ t: string; m: string }[]>([]);
  const [table, setTable] = useState<{ head: string[]; rows: any[]; counts?: { head: number; rows: number } } | null>(null);
  const [status, setStatus] = useState<string>("");
  const [current, setCurrent] = useState<string>("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/mapping/list");
        const data = await res.json();
        if (res.ok && data.ok) setTasks(data.tasks || []);
      } catch {}
    })();
  }, []);

  async function handleRun(taskId: string) {
    setLoading(true);
    setLogs([]);
    setTable(null);
    setStatus("");
    setCurrent("");
    try {
      const res = await fetch(`/api/mapping/run?stream=1`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId }),
      });
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("No stream reader");
      let buffer = "";
      let accLogs: { t: string; m: string }[] = [];
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
              accLogs.push({ t: obj.t, m: obj.m });
              setLogs([...accLogs]);
              if ((obj.m || "").startsWith("STEP:")) setCurrent(obj.m.replace("STEP: ", ""));
            } else if (obj.type === "table") {
              setTable({ head: obj.head ?? [], rows: obj.rows ?? [], counts: obj.counts ?? undefined });
            } else if (obj.type === "done") {
              setStatus(obj.ok ? "OK" : `Error: ${obj.error ?? "Unknown"}`);
            }
          } catch {}
        }
      }
      if (buffer.trim()) {
        try {
          const obj = JSON.parse(buffer.trim());
          if (obj.type === "done") setStatus(obj.ok ? "OK" : `Error: ${obj.error ?? "Unknown"}`);
        } catch {}
      }
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Mapping</h1>
        <p className="text-sm text-muted-foreground">Define URL + selector mappings and run tasks.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tasks</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {tasks.length ? (
            <div className="space-y-2">
              {tasks.map((t) => (
                <div key={t.id} className="flex items-center justify-between rounded border px-3 py-2">
                  <div>
                    <div className="text-sm font-medium">{t.label}</div>
                    {t.description ? <div className="text-xs text-muted-foreground">{t.description}</div> : null}
                  </div>
                  <Button size="sm" variant="outline" onClick={() => handleRun(t.id)} disabled={loading}>Run</Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">No tasks defined.</div>
          )}
          {status ? <div className={status === "OK" ? "text-green-600" : "text-red-600"}>{status}</div> : null}
          {current ? <div className="text-xs text-muted-foreground">Current: {current}</div> : null}
        </CardContent>
      </Card>

      {logs.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Logs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-52 overflow-auto rounded border p-2 text-xs">
              {logs.map((l, i) => (
                <div key={i} className="font-mono">[{l.t}] {l.m}</div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {table ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Extracted Table</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-auto">
              <div className="mb-2 text-xs text-muted-foreground">
                {typeof table.counts?.rows === "number" ? `${table.counts.rows} rows` : null}
                {typeof table.counts?.head === "number" ? ` • ${table.counts.head} columns` : null}
              </div>
              <table className="min-w-full text-sm">
                <thead>
                  <tr>
                    {(table.head ?? []).map((h: string, i: number) => (
                      <th key={i} className="border-b px-2 py-1 text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(table.rows ?? []).map((r: any, ri: number) => (
                    <tr key={ri}>
                      {r.cells.map((c: any, ci: number) => (
                        <td key={ci} className="border-b px-2 py-1">
                          {c.link ? (
                            <a href={c.link.href} className="underline" target="_blank" rel="noreferrer">{c.link.text || c.link.href}</a>
                          ) : c.image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={c.image.src} alt={c.image.alt} className="h-6 w-6 object-cover" />
                          ) : (
                            c.text
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}


