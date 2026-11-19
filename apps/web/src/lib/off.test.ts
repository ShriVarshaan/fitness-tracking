import { describe, expect, it } from "vitest";
import { isBarcode, parseOffProduct } from "./off";

describe("parseOffProduct", () => {
  it("reads per-100 g nutrients, the first brand and the serving size", () => {
    const p = parseOffProduct({
      code: "5000168001142",
      product_name: "Porridge oats",
      brands: "Scott's, Quaker",
      serving_quantity: "40",
      nutriments: { "energy-kcal_100g": 375, proteins_100g: 11, carbohydrates_100g: 60, fat_100g: 8, fiber_100g: "9,0" },
    });
    expect(p).toEqual({
      name: "Porridge oats",
      brand: "Scott's",
      barcode: "5000168001142",
      kcal100g: 375,
      protein100g: 11,
      carbs100g: 60,
      fat100g: 8,
      fibre100g: 9,
      servingG: 40,
    });
  });

  it("converts kJ when kcal is missing and drops impossible values", () => {
    const p = parseOffProduct({ product_name: "Apple", nutriments: { "energy-kj_100g": 218, proteins_100g: 140, fat_100g: -1 } });
    expect(p).toMatchObject({ kcal100g: 52.1, protein100g: null, fat100g: null, barcode: null, brand: null });
  });

  it("rejects products without a name or energy", () => {
    expect(parseOffProduct({ product_name: "", nutriments: { "energy-kcal_100g": 100 } })).toBeNull();
    expect(parseOffProduct({ product_name: "Mystery", nutriments: {} })).toBeNull();
    expect(parseOffProduct(null)).toBeNull();
  });
});

describe("isBarcode", () => {
  it("accepts EAN-8, UPC-A, EAN-13 and GTIN-14 digits only", () => {
    expect(isBarcode("96385074")).toBe(true);
    expect(isBarcode("036000291452")).toBe(true);
    expect(isBarcode("5000168001142")).toBe(true);
    expect(isBarcode("12345")).toBe(false);
    expect(isBarcode("50001680011a2")).toBe(false);
  });
});
