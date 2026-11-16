import { NextResponse } from "next/server";
import { EXPORT_TABLES as TABLES } from "@/lib/export-tables";
import { createClient } from "@/lib/supabase/server";

const PAGE = 1000; // Supabase's default maximum rows per request

export const maxDuration = 60;

export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims.sub) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const out: Record<string, unknown[]> = {};
  for (const table of TABLES) {
    const rows: unknown[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase.from(table).select("*").range(from, from + PAGE - 1);
      if (error) return NextResponse.json({ error: `export failed on ${table}` }, { status: 500 });
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }
    out[table] = rows;
  }

  const body = JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      account: { id: auth.claims.sub, email: auth.claims.email ?? null },
      note: "The Garmin API key and access token are stored encrypted and are deliberately not included.",
      tables: out,
    },
    null,
    2,
  );
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="fitness-export-${date}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
