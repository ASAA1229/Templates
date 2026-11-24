import { describe, expect, it } from "vitest";
import { createZip, readZip, ZipError } from "./zip.js";

describe("readZip hostile structure", () => {
  it("reports out-of-range offsets as a ZipError, not a RangeError", () => {
    const archive = createZip([{ name: "a.txt", content: Buffer.from("hello") }]);
    const end = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    const centralOffset = archive.readUInt32LE(end + 16);
    const broken = Buffer.from(archive);
    broken.writeUInt32LE(0xfffffff0, centralOffset + 42); // local header offset beyond the buffer
    expect(() => readZip(broken)).toThrow(ZipError);
    const tiny = Buffer.from(archive.subarray(0, end));
    expect(() =>
      readZip(
        Buffer.concat([
          tiny,
          archive.subarray(end, end + 16),
          Buffer.from([0xff, 0xff, 0xff, 0x7f]),
          archive.subarray(end + 20),
        ]),
      ),
    ).toThrow(ZipError);
  });
});
