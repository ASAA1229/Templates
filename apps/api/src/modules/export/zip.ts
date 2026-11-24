import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";
import { unsafePathReason } from "@asaa/contracts";

/**
 * Minimal, dependency-free ZIP writer and verifying reader (RG-08).
 * Output is deterministic (fixed timestamps, sorted entries) so identical content gives identical bytes.
 * Entry names are validated on write and on read: absolute paths, "..", backslashes, drive letters,
 * control characters and duplicate names (including case-insensitive clashes) are refused (zip-slip).
 */
export interface ZipEntry {
  name: string;
  content: Buffer;
}

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipError";
  }
}

const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1; // 1980-01-01
const MAX_ENTRIES = 5_000;

/** Reason an archive entry name is unsafe to extract, or null. */
export function unsafeEntryName(name: string): string | null {
  if (!name || name.length > 240) return "Entry names must be 1-240 characters.";
  if (name.includes("\\")) return "Entry names may not contain backslashes.";
  if (/^[a-zA-Z]:/.test(name)) return "Entry names may not start with a drive letter.";
  if (name.startsWith("/")) return "Entry names may not be absolute.";
  if (name.split("/").some((part) => part === ".." || part === "."))
    return "Entry names may not contain . or .. segments.";
  return unsafePathReason(name);
}

function u16(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}
function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
}

export function createZip(entries: ZipEntry[]): Buffer {
  if (entries.length > MAX_ENTRIES) throw new ZipError("Too many entries.");
  const seen = new Set<string>();
  const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of sorted) {
    const reason = unsafeEntryName(entry.name);
    if (reason) throw new ZipError(`${entry.name}: ${reason}`);
    const folded = entry.name.toLowerCase();
    if (seen.has(folded)) throw new ZipError(`Duplicate entry ${entry.name}.`);
    seen.add(folded);
    const name = Buffer.from(entry.name, "utf8");
    const checksum = crc32(entry.content);
    const deflated = deflateRawSync(entry.content, { level: 9 });
    const useDeflate = deflated.length < entry.content.length;
    const data = useDeflate ? deflated : entry.content;
    const method = useDeflate ? 8 : 0;
    const flags = 0x0800; // UTF-8 names
    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(flags),
      u16(method),
      u16(DOS_TIME),
      u16(DOS_DATE),
      u32(checksum),
      u32(data.length),
      u32(entry.content.length),
      u16(name.length),
      u16(0),
      name,
      data,
    ]);
    central.push(
      Buffer.concat([
        u32(0x02014b50),
        u16(0x031e), // made by: Unix, spec 3.0
        u16(20),
        u16(flags),
        u16(method),
        u16(DOS_TIME),
        u16(DOS_DATE),
        u32(checksum),
        u32(data.length),
        u32(entry.content.length),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0o100644 << 16),
        u32(offset),
        name,
      ]),
    );
    locals.push(local);
    offset += local.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(sorted.length),
    u16(sorted.length),
    u32(centralBytes.length),
    u32(offset),
    u16(0),
  ]);
  return Buffer.concat([...locals, centralBytes, end]);
}

/**
 * Parse and verify an archive: every name must be safe, every CRC and size must match, and the central
 * directory must agree with the local headers. Throws ZipError on the first problem.
 */
export function readZip(
  archive: Buffer,
  limits = { maxEntries: MAX_ENTRIES, maxTotalBytes: 256 * 1024 * 1024 },
): ZipEntry[] {
  try {
    return parseZip(archive, limits);
  } catch (error) {
    // Offsets or lengths that point outside the buffer surface as RangeError; report them as a bad archive.
    if (error instanceof RangeError) throw new ZipError("Corrupt archive structure.");
    throw error;
  }
}

function parseZip(archive: Buffer, limits: { maxEntries: number; maxTotalBytes: number }): ZipEntry[] {
  const endAt = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endAt < 0 || archive.length - endAt < 22) throw new ZipError("Not a ZIP archive.");
  const count = archive.readUInt16LE(endAt + 10);
  const centralSize = archive.readUInt32LE(endAt + 12);
  const centralOffset = archive.readUInt32LE(endAt + 16);
  if (count > limits.maxEntries) throw new ZipError("Too many entries.");
  if (centralOffset + centralSize > endAt) throw new ZipError("Corrupt central directory.");
  const entries: ZipEntry[] = [];
  const seen = new Set<string>();
  let total = 0;
  let cursor = centralOffset;
  for (let index = 0; index < count; index++) {
    if (archive.readUInt32LE(cursor) !== 0x02014b50) throw new ZipError("Corrupt central directory entry.");
    const method = archive.readUInt16LE(cursor + 10);
    const checksum = archive.readUInt32LE(cursor + 16);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const size = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const name = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    cursor += 46 + nameLength + extraLength + commentLength;

    const reason = unsafeEntryName(name);
    if (reason) throw new ZipError(`Unsafe entry "${name}": ${reason}`);
    const folded = name.toLowerCase();
    if (seen.has(folded)) throw new ZipError(`Duplicate entry "${name}".`);
    seen.add(folded);
    total += size;
    if (total > limits.maxTotalBytes) throw new ZipError("Archive expands beyond the allowed size.");

    if (archive.readUInt32LE(localOffset) !== 0x04034b50) throw new ZipError(`Corrupt local header for "${name}".`);
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const localName = archive.subarray(localOffset + 30, localOffset + 30 + localNameLength).toString("utf8");
    if (localName !== name) throw new ZipError(`Local and central names differ for "${name}".`);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const raw = archive.subarray(start, start + compressedSize);
    if (raw.length !== compressedSize) throw new ZipError(`Truncated data for "${name}".`);
    let content: Buffer;
    if (method === 0) content = Buffer.from(raw);
    else if (method === 8) {
      try {
        content = inflateRawSync(raw, { maxOutputLength: Math.max(size, 1) });
      } catch {
        throw new ZipError(`Corrupt compressed data for "${name}".`);
      }
    } else throw new ZipError(`Unsupported compression for "${name}".`);
    if (content.length !== size) throw new ZipError(`Size mismatch for "${name}".`);
    if (crc32(content) !== checksum) throw new ZipError(`Checksum mismatch for "${name}".`);
    entries.push({ name, content });
  }
  return entries;
}
