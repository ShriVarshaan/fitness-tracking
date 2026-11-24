import { describe, expect, it } from "vitest";
import { makeZip } from "./test-zip";
import { listZip, readEntryText, streamEntryText, ZipError } from "./zip";

describe("zip reader", () => {
  const long = "x".repeat(10_000) + "end";

  it("lists and reads stored and deflated entries", async () => {
    const zip = makeZip([
      { name: "a.json", text: '{"a":1}' },
      { name: "dir/b.txt", text: long, deflate: true },
    ], { comment: "exported" });
    const entries = await listZip(zip);
    expect(entries.map((e) => [e.name, e.method, e.size])).toEqual([
      ["a.json", 0, 7],
      ["dir/b.txt", 8, long.length],
    ]);
    expect(await readEntryText(zip, entries[0]!)).toBe('{"a":1}');
    expect(await readEntryText(zip, entries[1]!)).toBe(long);
  });

  it("reads ZIP64 directories", async () => {
    const zip = makeZip([{ name: "export.xml", text: "<HealthData/>", deflate: true }], { zip64: true });
    const [entry] = await listZip(zip);
    expect(entry).toMatchObject({ name: "export.xml", size: 13 });
    expect(await readEntryText(zip, entry!)).toBe("<HealthData/>");
  });

  it("streams text with progress", async () => {
    const zip = makeZip([{ name: "big.txt", text: long, deflate: true }]);
    const [entry] = await listZip(zip);
    let text = "";
    let last = 0;
    await streamEntryText(zip, entry!, (chunk, n) => {
      text += chunk;
      last = n;
    });
    expect(text).toBe(long);
    expect(last).toBe(long.length);
  });

  it("rejects files that aren't zips", async () => {
    await expect(listZip(new Blob(["hello"]))).rejects.toBeInstanceOf(ZipError);
  });
});
