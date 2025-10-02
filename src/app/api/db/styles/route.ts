import { NextResponse } from "next/server";
import { getAllStyles, getStyle, upsertStyles } from "@/lib/db/styles";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const styleNo = url.searchParams.get("styleNo");
  if (styleNo) {
    const one = await getStyle(styleNo);
    return NextResponse.json({ ok: true, item: one });
  }
  const items = await getAllStyles();
  return NextResponse.json({ ok: true, items });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (Array.isArray(body?.items)) {
    const res = await upsertStyles(body.items);
    return NextResponse.json({ ok: true, ...res });
  }
  return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
}


