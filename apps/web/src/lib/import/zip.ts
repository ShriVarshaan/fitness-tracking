/**
 * Minimal read-only ZIP reader for health exports (Garmin account export,
 * Apple Health export.zip). Reads the central directory from the end of the
 * file and decompresses only the entries asked for, with the platform's
 * DecompressionStream, so multi-gigabyte exports never sit in memory.
 * Supports stored and deflated entries and ZIP64 (large Apple exports).
 */

export interface ZipEntry {
  name: string;
  /** 0 = stored, 8 = deflate. */
  method: number;
  compressedSize: number;
  size: number;
  localHeaderOffset: number;
}

/** Anything that can be sliced into bytes: a browser File or Blob. */
export type ZipSource = Pick<Blob, "size" | "slice">;

const EOCD_SIG = 0x06054b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const ZIP64_EOCD_SIG = 0x06064b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

async function bytes(src: ZipSource, start: number, end: number): Promise<DataView> {
  const buf = await src.slice(start, end).arrayBuffer();
  return new DataView(buf);
}

const u64 = (v: DataView, o: number) => Number(v.getBigUint64(o, true));

export class ZipError extends Error {}

/** List the entries in a ZIP file. */
export async function listZip(src: ZipSource): Promise<ZipEntry[]> {
  // The end-of-central-directory record sits in the last 22 bytes + up to 64 KB of comment.
  const tailStart = Math.max(0, src.size - (22 + 65_535 + 20));
  const tail = await bytes(src, tailStart, src.size);
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError("not a zip file");

  let count = tail.getUint16(eocd + 10, true);
  let cdSize = tail.getUint32(eocd + 12, true);
  let cdOffset = tail.getUint32(eocd + 16, true);

  // ZIP64: the locator sits just before the EOCD and points at the ZIP64 EOCD record.
  if (eocd >= 20 && tail.getUint32(eocd - 20, true) === ZIP64_LOCATOR_SIG) {
    const z64Offset = u64(tail, eocd - 20 + 8);
    const z64 = await bytes(src, z64Offset, z64Offset + 56);
    if (z64.getUint32(0, true) !== ZIP64_EOCD_SIG) throw new ZipError("damaged zip64 directory");
    count = u64(z64, 32);
    cdSize = u64(z64, 40);
    cdOffset = u64(z64, 48);
  }

  const cd = await bytes(src, cdOffset, cdOffset + cdSize);
  const entries: ZipEntry[] = [];
  const decoder = new TextDecoder();
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (cd.getUint32(p, true) !== CENTRAL_SIG) throw new ZipError("damaged zip directory");
    const method = cd.getUint16(p + 10, true);
    let compressedSize = cd.getUint32(p + 20, true);
    let size = cd.getUint32(p + 24, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    let localHeaderOffset = cd.getUint32(p + 42, true);
    const name = decoder.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));

    // ZIP64 extra field (id 0x0001): 64-bit values for whichever fields were 0xFFFFFFFF, in order.
    let e = p + 46 + nameLen;
    const extraEnd = e + extraLen;
    while (e + 4 <= extraEnd) {
      const id = cd.getUint16(e, true);
      const len = cd.getUint16(e + 2, true);
      if (id === 0x0001) {
        let q = e + 4;
        if (size === 0xffffffff) {
          size = u64(cd, q);
          q += 8;
        }
        if (compressedSize === 0xffffffff) {
          compressedSize = u64(cd, q);
          q += 8;
        }
        if (localHeaderOffset === 0xffffffff) localHeaderOffset = u64(cd, q);
      }
      e += 4 + len;
    }
    entries.push({ name, method, compressedSize, size, localHeaderOffset });
    p = extraEnd + commentLen;
  }
  return entries;
}

/** A stream of the entry's uncompressed bytes. */
export async function openEntry(src: ZipSource, entry: ZipEntry): Promise<ReadableStream<Uint8Array>> {
  const header = await bytes(src, entry.localHeaderOffset, entry.localHeaderOffset + 30);
  if (header.getUint32(0, true) !== LOCAL_SIG) throw new ZipError(`damaged entry ${entry.name}`);
  const dataStart = entry.localHeaderOffset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
  const raw = src.slice(dataStart, dataStart + entry.compressedSize).stream() as ReadableStream<Uint8Array>;
  if (entry.method === 0) return raw;
  if (entry.method === 8) return raw.pipeThrough(new DecompressionStream("deflate-raw") as unknown as TransformStream<Uint8Array, Uint8Array>);
  throw new ZipError(`${entry.name} uses an unsupported compression method (${entry.method})`);
}

/** Read a whole (small) entry as text. */
export async function readEntryText(src: ZipSource, entry: ZipEntry): Promise<string> {
  return new Response(await openEntry(src, entry)).text();
}

/**
 * Stream an entry as text chunks (UTF-8), reporting progress in uncompressed
 * bytes. The callback may be async; reading waits for it.
 */
export async function streamEntryText(
  src: ZipSource,
  entry: ZipEntry,
  onChunk: (text: string, bytesSoFar: number) => void | Promise<void>,
): Promise<void> {
  await streamText(await openEntry(src, entry), onChunk);
}

export async function streamText(stream: ReadableStream<Uint8Array>, onChunk: (text: string, bytesSoFar: number) => void | Promise<void>): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let seen = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    seen += value.byteLength;
    await onChunk(decoder.decode(value, { stream: true }), seen);
  }
  const rest = decoder.decode();
  if (rest) await onChunk(rest, seen);
}
