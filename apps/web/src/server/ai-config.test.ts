import { describe, expect, it } from "vitest";
import { isTransientProviderError, withModelFallback } from "./ai-config";

describe("withModelFallback", () => {
  it("moves to the next model when one is busy", async () => {
    const tried: string[] = [];
    const out = await withModelFallback(["big", "lite"], async (m) => {
      tried.push(m);
      if (m === "big") throw new Error("This model is currently experiencing high demand. Please try again later.");
      return "ok";
    });
    expect(out).toEqual({ result: "ok", model: "lite" });
    expect(tried).toEqual(["big", "lite"]);
  });

  it("throws other errors without trying another model", async () => {
    const tried: string[] = [];
    await expect(
      withModelFallback(["big", "lite"], async (m) => {
        tried.push(m);
        throw new Error("API key not valid");
      }),
    ).rejects.toThrow("API key not valid");
    expect(tried).toEqual(["big"]);
  });

  it("throws when the last model is busy too", async () => {
    await expect(withModelFallback(["lite"], async () => Promise.reject(new Error("429 RESOURCE_EXHAUSTED")))).rejects.toThrow("429");
  });
});

describe("isTransientProviderError", () => {
  it("recognises busy and quota errors only", () => {
    expect(isTransientProviderError(new Error("The model is overloaded"))).toBe(true);
    expect(isTransientProviderError(new Error("You exceeded your current quota"))).toBe(true);
    expect(isTransientProviderError(new Error("Invalid JSON schema"))).toBe(false);
  });
});
