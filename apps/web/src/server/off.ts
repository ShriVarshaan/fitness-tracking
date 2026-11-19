import "server-only";
import { isBarcode, parseOffProduct, type FoodProduct } from "@/lib/off";

/**
 * Open Food Facts lookups, made from the server so the user's browser never
 * contacts OFF directly. Only the barcode or search words are sent (no user data).
 * OFF asks API users to identify their app in the User-Agent.
 */
const BASE = "https://world.openfoodfacts.org";
const HEADERS = { "User-Agent": "FitnessTracker/0.1 (personal non-commercial project)", Accept: "application/json" };
const FIELDS = "code,product_name,product_name_en,generic_name,brands,serving_quantity,nutriments";

export async function lookupBarcode(barcode: string): Promise<FoodProduct | null | "unavailable"> {
  if (!isBarcode(barcode)) return null;
  try {
    const res = await fetch(`${BASE}/api/v2/product/${barcode}.json?fields=${FIELDS}`, { headers: HEADERS, signal: AbortSignal.timeout(8000), cache: "no-store" });
    if (res.status === 404) return null;
    if (!res.ok) return "unavailable";
    const body = (await res.json()) as { status?: number; product?: unknown };
    if (body.status !== 1) return null;
    const p = parseOffProduct({ ...(body.product as object), code: barcode });
    return p;
  } catch {
    return "unavailable";
  }
}

export async function searchFoods(query: string): Promise<FoodProduct[] | "unavailable"> {
  const q = query.trim().slice(0, 80);
  if (q.length < 2) return [];
  const params = new URLSearchParams({ search_terms: q, search_simple: "1", action: "process", json: "1", page_size: "12", fields: FIELDS });
  try {
    const res = await fetch(`${BASE}/cgi/search.pl?${params}`, { headers: HEADERS, signal: AbortSignal.timeout(10000), cache: "no-store" });
    if (!res.ok) return "unavailable";
    const body = (await res.json()) as { products?: unknown[] };
    return (body.products ?? []).map(parseOffProduct).filter((p): p is FoodProduct => p !== null);
  } catch {
    return "unavailable";
  }
}
