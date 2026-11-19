import Link from "next/link";
import { SignOutButton } from "@/app/sign-out-button";

const LINKS = [
  { href: "/", label: "Today" },
  { href: "/week", label: "Week" },
  { href: "/trends", label: "Trends" },
  { href: "/activities", label: "Activities" },
  { href: "/training", label: "Training" },
  { href: "/nutrition", label: "Nutrition" },
  { href: "/dashboards", label: "Dashboards" },
  { href: "/chat", label: "Chat" },
  { href: "/recap", label: "Year" },
  { href: "/settings/account", label: "Settings" },
] as const;

const SETTINGS = [
  { href: "/settings/account", label: "Account" },
  { href: "/settings/garmin", label: "Garmin" },
  { href: "/settings/security", label: "Security" },
] as const;

type Href = (typeof LINKS)[number]["href"] | (typeof SETTINGS)[number]["href"];

/** Top navigation shared by signed-in pages. `current` marks the active link for screen readers. */
export function AppNav({ current }: { current?: Href }) {
  const inSettings = current?.startsWith("/settings/") ?? false;
  return (
    <div className="space-y-2">
      <nav aria-label="Main" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {LINKS.map((l) => {
          const active = l.href === "/settings/account" ? inSettings : current === l.href;
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={active ? "font-medium text-foreground" : "text-muted underline-offset-4 hover:underline"}
            >
              {l.label}
            </Link>
          );
        })}
        <span className="text-muted">
          <SignOutButton />
        </span>
      </nav>
      {inSettings && (
        <nav aria-label="Settings" className="flex gap-1 rounded-md border border-border bg-surface p-0.5 text-sm sm:w-fit">
          {SETTINGS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={current === l.href ? "page" : undefined}
              className={`flex-1 rounded px-3 py-1 text-center ${current === l.href ? "bg-accent text-accent-fg" : "text-muted hover:text-foreground"}`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
