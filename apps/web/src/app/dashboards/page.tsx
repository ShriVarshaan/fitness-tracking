import type { Metadata } from "next";
import Link from "next/link";
import { AppNav } from "@/components/app-nav";
import { DASHBOARD_TEMPLATES } from "@/lib/dashboard";
import { createClient } from "@/lib/supabase/server";
import { createDashboard } from "./actions";

export const metadata: Metadata = { title: "Dashboards" };

export default async function DashboardsPage() {
  const supabase = await createClient();
  const { data: boards } = await supabase.from("dashboards").select("id, name, panels, updated_at").order("updated_at", { ascending: false });

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-8 sm:py-10">
      <header className="space-y-3">
        <AppNav current="/dashboards" />
        <h1 className="text-2xl font-semibold tracking-tight">Dashboards</h1>
        <p className="text-sm text-muted">Build your own pages of charts from any metric the app has, over 30 days to a year.</p>
      </header>

      {boards && boards.length > 0 && (
        <section className="space-y-2 rounded-lg border border-border bg-surface p-5">
          <h2 className="font-medium">Yours</h2>
          <ul className="divide-y divide-border">
            {(boards as Array<{ id: number; name: string; panels: unknown[] }>).map((b) => (
              <li key={b.id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                <Link href={`/dashboards/${b.id}`} className="font-medium underline-offset-4 hover:underline">
                  {b.name}
                </Link>
                <span className="text-muted">
                  {b.panels.length} chart{b.panels.length === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-3 rounded-lg border border-border bg-surface p-5">
        <h2 className="font-medium">New dashboard</h2>
        <p className="text-sm text-muted">Start from a template and change anything, or start empty.</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {[...DASHBOARD_TEMPLATES.map((t) => ({ key: t.key, name: t.name, n: t.panels.length })), { key: "blank", name: "Empty", n: 0 }].map((t) => (
            <form key={t.key} action={createDashboard}>
              <input type="hidden" name="template" value={t.key} />
              <button type="submit" className="w-full rounded-md border border-border p-3 text-left hover:border-accent">
                <span className="block text-sm font-medium">{t.name}</span>
                <span className="block text-xs text-muted">{t.n ? `${t.n} charts` : "Add your own charts"}</span>
              </button>
            </form>
          ))}
        </div>
      </section>
    </main>
  );
}
