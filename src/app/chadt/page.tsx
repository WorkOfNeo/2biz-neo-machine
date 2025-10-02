"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Msg = { role: "user" | "assistant"; content: string };

const CAPABILITIES: string[] = [
  "Login to SpySystem (always run before other actions)",
  "Run Style List (Show All)",
  "Find a specific style by name from the list",
  "Get Stat & Stock (FREE) data for that style",
];

export default function ChadtPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

  async function handleSend() {
    const msg = input.trim();
    if (!msg) return;
    setMessages((prev) => [...prev, { role: "user", content: msg }]);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/chadt/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: msg }) });
      const data = await res.json();
      try {
        if (Array.isArray(data?.logs)) {
          // Prefer grouped/table view for readability
          // eslint-disable-next-line no-console
          console.groupCollapsed('Chad(t) logs');
          try { console.table(data.logs); } catch { console.log(data.logs); }
          if (data?.meta?.url) console.log('Detail URL:', data.meta.url);
          console.groupEnd();
        }
      } catch {}
      const replies: Msg[] = (data?.messages || []).map((m: any) => ({ role: m.role || "assistant", content: m.content || "" }));
      if (replies.length) {
        setMessages((prev) => [...prev, ...replies]);
      } else if (data?.error) {
        setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${data.error}` }]);
      } else {
        setMessages((prev) => [...prev, { role: "assistant", content: "I couldn't process that. Try: What is the stock for \"STYLE NAME\"?" }]);
      }
    } catch (e) {
      setMessages((prev) => [...prev, { role: "assistant", content: "Sorry, I hit an error while processing that." }]);
    } finally { setLoading(false); }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Chad(t)</h1>
        <p className="text-sm text-muted-foreground">Ask for specific actions, e.g. stock for a style.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What you can ask right now</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-disc pl-6 text-sm">
            {CAPABILITIES.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Chat</CardTitle>
        </CardHeader>
        <CardContent>
          <div ref={listRef} className="mb-3 max-h-80 overflow-auto rounded border p-2 text-sm">
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
                <span className="inline-block rounded px-2 py-1" style={{ background: m.role === "user" ? "#eef" : "#eee" }}>
                  {m.content}
                </span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input className="flex-1 rounded border px-2 py-1 text-sm" value={input} onChange={(e) => setInput(e.target.value)} placeholder='Ask: What is the stock for "STYLE NAME"?' />
            <Button onClick={handleSend} disabled={loading}>{loading ? "Working..." : "Send"}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}


