import { describe, expect, it } from "vitest";
import { toCanonical, fromCanonical, fractionToPercent } from "./units";

describe("toCanonical", () => {
  it("converts distance to metres", () => {
    expect(toCanonical(5, "km")).toBe(5000);
    expect(toCanonical(1, "mi")).toBeCloseTo(1609.344, 6);
    expect(toCanonical(250, "cm")).toBe(2.5);
  });

  it("converts mass to kilograms", () => {
    expect(toCanonical(1000, "g_mass")).toBe(1);
    expect(toCanonical(10, "lb")).toBeCloseTo(4.5359237, 6);
  });

  it("converts durations to seconds", () => {
    expect(toCanonical(1500, "ms_duration")).toBe(1.5);
    expect(toCanonical(2, "min")).toBe(120);
    expect(toCanonical(1, "h")).toBe(3600);
  });

  it("converts speed to m/s", () => {
    expect(toCanonical(36, "km/h")).toBeCloseTo(10, 9);
  });

  it("converts energy to kcal", () => {
    expect(toCanonical(4184, "kJ")).toBeCloseTo(1000, 9);
  });

  it("converts temperature to °C", () => {
    expect(toCanonical(212, "degF")).toBeCloseTo(100, 9);
  });

  it("passes canonical units through unchanged", () => {
    expect(toCanonical(42, "m")).toBe(42);
    expect(toCanonical(60, "bpm")).toBe(60);
  });

  it("rejects non-finite input", () => {
    expect(() => toCanonical(Number.NaN, "m")).toThrow(/finite/);
  });
});

describe("fromCanonical", () => {
  it("round-trips through display units", () => {
    expect(fromCanonical(toCanonical(26.2, "mi"), "mi")).toBeCloseTo(26.2, 9);
    expect(fromCanonical(37, "degF")).toBeCloseTo(98.6, 9);
  });
});

describe("fractionToPercent", () => {
  it("turns 0–1 fractions into 0–100 percentages", () => {
    expect(fractionToPercent(0.97)).toBeCloseTo(97, 9);
  });

  it("rejects values outside 0–1", () => {
    expect(() => fractionToPercent(97)).toThrow(/0–1/);
  });
});
