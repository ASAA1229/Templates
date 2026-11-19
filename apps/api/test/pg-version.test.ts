import { describe, expect, it } from "vitest";

const modulePath = new URL("../../../scripts/pg-version-check.mjs", import.meta.url).href;
const { parsePgVersion, comparePgVersions } = (await import(/* @vite-ignore */ modulePath)) as {
  parsePgVersion: (text: string) => string | null;
  comparePgVersions: (o: Record<string, string>) => { ok: boolean; message: string };
};

describe("PostgreSQL binary version check", () => {
  it("parses tool output", () => {
    expect(parsePgVersion("postgres (PostgreSQL) 18.6")).toBe("18.6");
    expect(parsePgVersion("initdb (PostgreSQL) 18.7\r\n")).toBe("18.7");
    expect(parsePgVersion("16beta1")).toBe("16");
    expect(parsePgVersion("garbage")).toBeNull();
  });

  it("accepts consistent binaries", () => {
    const r = comparePgVersions({ postgres: "postgres (PostgreSQL) 18.6", initdb: "initdb (PostgreSQL) 18.6" });
    expect(r.ok).toBe(true);
  });

  it("reports a partial upgrade clearly", () => {
    const r = comparePgVersions({ postgres: "postgres (PostgreSQL) 18.6", initdb: "initdb (PostgreSQL) 18.7" });
    expect(r.ok).toBe(false);
    expect(r.message).toBe(
      "PostgreSQL binaries version mismatch: postgres 18.6 vs initdb 18.7; repair the PostgreSQL install.",
    );
  });

  it("fails on unreadable output", () => {
    expect(comparePgVersions({ psql: "" }).ok).toBe(false);
  });
});
