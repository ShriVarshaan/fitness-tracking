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
  { href: "/settings/garmin", label: "Garmin" },
  { href: "/settings/security", label: "Security" },
  { href: "/settings/account", label: "Account" },
] as const;

/** Top navigation shared by signed-in pages. `current` marks the active link for screen readers. */
export function AppNav({ current }: { current?: (typeof LINKS)[number]["href"] }) {
  return (
    <nav aria-label="Main" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={current === l.href ? "page" : undefined}
          className={current === l.href ? "font-medium text-foreground" : "text-muted underline-offset-4 hover:underline"}
        >
          {l.label}
        </Link>
      ))}
      <span className="text-muted">
        <SignOutButton />
      </span>
    </nav>
  );
}
