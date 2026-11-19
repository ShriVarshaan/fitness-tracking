"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createCustomFood, findBarcode, findFoods, logFood, type SavedFood } from "./actions";

type Meal = "breakfast" | "lunch" | "dinner" | "snack";
type Tab = "search" | "scan" | "custom";

const input = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";
const primary = "rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-fg disabled:opacity-60";

/** Default meal from the local time of day. */
function mealNow(): Meal {
  const h = new Date().getHours();
  return h < 11 ? "breakfast" : h < 15 ? "lunch" : h < 21 ? "dinner" : "snack";
}

export function AddFood({ date }: { date: string }) {
  const [tab, setTab] = useState<Tab>("search");
  const [selected, setSelected] = useState<SavedFood | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      {selected ? (
        <Portion
          food={selected}
          date={date}
          onDone={(msg) => {
            setSelected(null);
            setMessage(msg);
          }}
        />
      ) : (
        <>
          <div role="tablist" aria-label="Add food" className="flex gap-1 rounded-md border border-border bg-background p-0.5 text-sm">
            {(
              [
                ["search", "Search"],
                ["scan", "Scan barcode"],
                ["custom", "Custom food"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                role="tab"
                type="button"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={`flex-1 rounded px-2.5 py-1.5 ${tab === k ? "bg-accent text-accent-fg" : "text-muted hover:text-foreground"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === "search" && <Search onPick={setSelected} />}
          {tab === "scan" && <Scan onPick={setSelected} />}
          {tab === "custom" && <Custom onPick={setSelected} />}
        </>
      )}
      {message && (
        <p role="status" className="text-sm text-muted">
          {message}
        </p>
      )}
    </div>
  );
}

function FoodRow({ f, onPick }: { f: SavedFood; onPick: (f: SavedFood) => void }) {
  return (
    <li>
      <button type="button" onClick={() => onPick(f)} className="flex w-full items-baseline justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-background">
        <span className="min-w-0">
          <span className="block truncate">{f.name}</span>
          {f.brand && <span className="block truncate text-xs text-muted">{f.brand}</span>}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-muted">{Math.round(f.kcal100g)} kcal/100 g</span>
      </button>
    </li>
  );
}

function Search({ onPick }: { onPick: (f: SavedFood) => void }) {
  const [q, setQ] = useState("");
  const [result, setResult] = useState<Awaited<ReturnType<typeof findFoods>> | null>(null);
  const [pending, start] = useTransition();
  const run = () => start(async () => setResult(await findFoods(q)));
  return (
    <div className="space-y-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <label className="sr-only" htmlFor="food-q">
          Food
        </label>
        <input id="food-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Porridge oats, banana…" className={input} minLength={2} maxLength={80} />
        <button type="submit" disabled={pending || q.trim().length < 2} className={primary}>
          {pending ? "Searching…" : "Search"}
        </button>
      </form>
      {result && (
        <div className="space-y-3">
          {result.mine.length > 0 && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Your foods</p>
              <ul>{result.mine.map((f) => <FoodRow key={`m${f.id}`} f={f} onPick={onPick} />)}</ul>
            </div>
          )}
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Open Food Facts</p>
            {result.offUnavailable ? (
              <p className="text-sm text-muted">Open Food Facts isn&rsquo;t responding right now.</p>
            ) : result.off.length ? (
              <ul>{result.off.map((f, i) => <FoodRow key={`o${i}`} f={f} onPick={onPick} />)}</ul>
            ) : (
              <p className="text-sm text-muted">No matches with nutrition values.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface Detector {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
}

function Scan({ onPick }: { onPick: (f: SavedFood) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [scanning, setScanning] = useState(false);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    queueMicrotask(() => setSupported("BarcodeDetector" in window && !!navigator.mediaDevices?.getUserMedia));
  }, []);

  const lookup = (barcode: string) =>
    start(async () => {
      setMessage(null);
      const res = await findBarcode(barcode);
      if (res.food) onPick(res.food);
      else setMessage(res.message ?? "Not found.");
    });

  useEffect(() => {
    if (!scanning) return;
    let stream: MediaStream | null = null;
    let stop = false;
    (async () => {
      try {
        const Ctor = (window as unknown as { BarcodeDetector: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
        const detector = new Ctor({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        while (!stop && video.current) {
          const found = await detector.detect(video.current).catch(() => []);
          const raw = found[0]?.rawValue;
          if (raw) {
            setScanning(false);
            setCode(raw);
            lookup(raw);
            return;
          }
          await new Promise((r) => setTimeout(r, 250));
        }
      } catch {
        setMessage("Couldn't use the camera. Allow camera access, or type the barcode instead.");
        setScanning(false);
      }
    })();
    return () => {
      stop = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
    // lookup is stable enough for this effect; re-running on each render would restart the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning]);

  return (
    <div className="space-y-3">
      {supported && (
        <div className="space-y-2">
          {scanning ? (
            <>
              <video ref={video} className="aspect-video w-full rounded-md bg-black object-cover" muted playsInline />
              <button type="button" onClick={() => setScanning(false)} className="rounded-md border border-border px-3 py-2 text-sm">
                Stop camera
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setScanning(true)} className={primary}>
              Scan with camera
            </button>
          )}
          <p className="text-xs text-muted">The camera image stays on your device; only the barcode number is looked up.</p>
        </div>
      )}
      {supported === false && <p className="text-sm text-muted">This browser can&rsquo;t scan barcodes with the camera, but you can type the number.</p>}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          lookup(code.trim());
        }}
      >
        <label className="sr-only" htmlFor="barcode">
          Barcode
        </label>
        <input id="barcode" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="Barcode number" className={input} maxLength={14} />
        <button type="submit" disabled={pending || code.length < 8} className={primary}>
          {pending ? "Looking up…" : "Look up"}
        </button>
      </form>
      {message && <p className="text-sm text-muted">{message}</p>}
    </div>
  );
}

function Custom({ onPick }: { onPick: (f: SavedFood) => void }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="grid grid-cols-2 gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
        start(async () => {
          const res = await createCustomFood(data);
          if (res.food) onPick(res.food);
          else setMessage(res.message ?? "Couldn't save that food.");
        });
      }}
    >
      <label className="col-span-2 space-y-1 text-sm">
        <span>Name</span>
        <input name="name" required maxLength={120} className={input} />
      </label>
      <label className="space-y-1 text-sm">
        <span>Energy per 100 g (kcal)</span>
        <input name="kcal" required type="number" min={0} max={900} step="any" className={input} />
      </label>
      <label className="space-y-1 text-sm">
        <span>Serving (g, optional)</span>
        <input name="serving" type="number" min={1} max={2000} step="any" className={input} />
      </label>
      {(
        [
          ["protein", "Protein"],
          ["carbs", "Carbohydrate"],
          ["fat", "Fat"],
        ] as const
      ).map(([n, label]) => (
        <label key={n} className="space-y-1 text-sm">
          <span>{label} per 100 g (g)</span>
          <input name={n} type="number" min={0} max={100} step="any" className={input} />
        </label>
      ))}
      <label className="space-y-1 text-sm">
        <span>Barcode (optional)</span>
        <input name="barcode" inputMode="numeric" pattern="\d{8}|\d{12,14}" className={input} />
      </label>
      <div className="col-span-2 flex items-center gap-3">
        <button type="submit" disabled={pending} className={primary}>
          {pending ? "Saving…" : "Save food"}
        </button>
        {message && <span className="text-sm text-danger">{message}</span>}
      </div>
    </form>
  );
}

function Portion({ food, date, onDone }: { food: SavedFood; date: string; onDone: (message: string | null) => void }) {
  const [grams, setGrams] = useState(String(food.servingG ?? 100));
  const [meal, setMeal] = useState<Meal>(mealNow);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const g = Number(grams);
  const kcal = Number.isFinite(g) && g > 0 ? Math.round((food.kcal100g * g) / 100) : null;
  return (
    <form
      className="space-y-3 rounded-md border border-border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await logFood({ food, grams: g, meal, date });
          if (res.ok) onDone(`Added ${food.name}.`);
          else setError(res.message ?? "Couldn't add that.");
        });
      }}
    >
      <div>
        <p className="font-medium">{food.name}</p>
        <p className="text-xs text-muted">
          {food.brand ? `${food.brand} · ` : ""}
          {Math.round(food.kcal100g)} kcal per 100 g{food.source === "off" ? " · Open Food Facts" : " · your food"}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1 text-sm">
          <span>Amount (g)</span>
          <input value={grams} onChange={(e) => setGrams(e.target.value)} type="number" min={1} max={5000} step="any" required className={input} />
        </label>
        <label className="space-y-1 text-sm">
          <span>Meal</span>
          <select value={meal} onChange={(e) => setMeal(e.target.value as Meal)} className={input}>
            <option value="breakfast">Breakfast</option>
            <option value="lunch">Lunch</option>
            <option value="dinner">Dinner</option>
            <option value="snack">Snack</option>
          </select>
        </label>
      </div>
      {food.servingG && <p className="text-xs text-muted">One serving is {food.servingG} g.</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending || kcal === null} className={primary}>
          {pending ? "Adding…" : kcal !== null ? `Add ${kcal} kcal` : "Add"}
        </button>
        <button type="button" onClick={() => onDone(null)} className="rounded-md border border-border px-3 py-2 text-sm">
          Cancel
        </button>
        {error && <span className="text-sm text-danger">{error}</span>}
      </div>
    </form>
  );
}
