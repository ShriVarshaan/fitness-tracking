import { deflateRawSync } from "node:zlib";

/** Build a ZIP in memory (test helper): optional deflate, optional ZIP64 records. */
export function makeZip(files: Array<{ name: string; text: string; deflate?: boolean }>, opts: { zip64?: boolean; comment?: string } = {}): Blob {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const data = enc.encode(f.text);
    const body = f.deflate ? new Uint8Array(deflateRawSync(data)) : data;
    const name = enc.encode(f.name);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(8, f.deflate ? 8 : 0, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, body);

    const extra = opts.zip64 ? new DataView(new ArrayBuffer(28)) : null;
    if (extra) {
      extra.setUint16(0, 0x0001, true);
      extra.setUint16(2, 24, true);
      extra.setBigUint64(4, BigInt(data.length), true);
      extra.setBigUint64(12, BigInt(body.length), true);
      extra.setBigUint64(20, BigInt(offset), true);
    }
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(10, f.deflate ? 8 : 0, true);
    c.setUint32(20, extra ? 0xffffffff : body.length, true);
    c.setUint32(24, extra ? 0xffffffff : data.length, true);
    c.setUint16(28, name.length, true);
    c.setUint16(30, extra ? extra.byteLength : 0, true);
    c.setUint32(42, extra ? 0xffffffff : offset, true);
    central.push(new Uint8Array(c.buffer), name, ...(extra ? [new Uint8Array(extra.buffer)] : []));
    offset += 30 + name.length + body.length;
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const cdOffset = offset;
  const tail: Uint8Array[] = [];
  if (opts.zip64) {
    const z = new DataView(new ArrayBuffer(56));
    z.setUint32(0, 0x06064b50, true);
    z.setBigUint64(32, BigInt(files.length), true);
    z.setBigUint64(40, BigInt(cdSize), true);
    z.setBigUint64(48, BigInt(cdOffset), true);
    const loc = new DataView(new ArrayBuffer(20));
    loc.setUint32(0, 0x07064b50, true);
    loc.setBigUint64(8, BigInt(cdOffset + cdSize), true);
    tail.push(new Uint8Array(z.buffer), new Uint8Array(loc.buffer));
  }
  const comment = enc.encode(opts.comment ?? "");
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(10, opts.zip64 ? 0xffff : files.length, true);
  e.setUint32(12, opts.zip64 ? 0xffffffff : cdSize, true);
  e.setUint32(16, opts.zip64 ? 0xffffffff : cdOffset, true);
  e.setUint16(20, comment.length, true);
  return new Blob([...parts, ...central, ...tail, new Uint8Array(e.buffer), comment] as BlobPart[]);
}
