"use client";

export function CodeInput({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  return (
    <div className="space-y-2">
      <label htmlFor="code" className="block text-sm font-medium">
        6-digit code
      </label>
      <input
        id="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
        className="w-full rounded-md border border-border bg-surface px-3 py-2 font-mono tracking-widest outline-none focus-visible:ring-2 focus-visible:ring-accent"
      />
    </div>
  );
}
