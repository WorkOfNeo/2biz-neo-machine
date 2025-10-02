import { NextResponse } from "next/server";
import { mappingRegistry } from "@/lib/mapping/registry";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true, tasks: mappingRegistry.map((t) => ({ id: t.id, label: t.label, description: t.description })) });
}


