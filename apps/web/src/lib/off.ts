/** Open Food Facts product parsing (pure). Docs: https://openfoodfacts.github.io/openfoodfacts-server/api/ */

export interface FoodProduct {
  name: string;
  brand: string | null;
  barcode: string | null;
  kcal100g: number;
  protein100g: number | null;
  carbs100g: number | null;
  fat100g: number | null;
  fibre100g: number | null;
  servingG: number | null;
}

/** EAN-8, UPC-A (12), EAN-13 or GTIN-14. */
export function isBarcode(s: string): boolean {
  return /^(\d{8}|\d{12,14})$/.test(s);
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * One OFF product → our per-100 g shape, or null when it has no name or energy.
 * Energy uses kcal when given, otherwise kJ ÷ 4.184.
 */
export function parseOffProduct(p: unknown): FoodProduct | null {
  if (!p || typeof p !== "object") return null;
  const o = p as Record<string, unknown>;
  const n = (o.nutriments ?? {}) as Record<string, unknown>;
  const name = [o.product_name_en, o.product_name, o.generic_name].find((x): x is string => typeof x === "string" && x.trim().length > 0)?.trim();
  if (!name) return null;
  let kcal = num(n["energy-kcal_100g"]);
  if (kcal === null) {
    const kj = num(n["energy-kj_100g"]) ?? num(n["energy_100g"]);
    kcal = kj === null ? null : Math.round((kj / 4.184) * 10) / 10;
  }
  if (kcal === null || kcal > 900) return null;
  const brand = typeof o.brands === "string" && o.brands.trim() ? o.brands.split(",")[0]!.trim() : null;
  const code = typeof o.code === "string" && isBarcode(o.code) ? o.code : null;
  const serving = num(o.serving_quantity);
  const cap = (v: number | null) => (v === null || v > 100 ? null : v);
  return {
    name: name.slice(0, 120),
    brand: brand ? brand.slice(0, 80) : null,
    barcode: code,
    kcal100g: kcal,
    protein100g: cap(num(n.proteins_100g)),
    carbs100g: cap(num(n.carbohydrates_100g)),
    fat100g: cap(num(n.fat_100g)),
    fibre100g: cap(num(n.fiber_100g)),
    servingG: serving !== null && serving > 0 && serving <= 2000 ? serving : null,
  };
}
