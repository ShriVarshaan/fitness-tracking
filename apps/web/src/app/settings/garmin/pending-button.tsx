"use client";

import { useFormStatus } from "react-dom";

export function PendingButton({ idle, pending, variant = "default" }: { idle: string; pending: string; variant?: "default" | "danger" }) {
  const { pending: isPending } = useFormStatus();
  const style =
    variant === "danger"
      ? "border border-border text-danger"
      : "bg-accent text-accent-fg";
  return (
    <button type="submit" disabled={isPending} className={`rounded-md px-3 py-2 text-sm font-medium disabled:opacity-60 ${style}`}>
      {isPending ? pending : idle}
    </button>
  );
}
