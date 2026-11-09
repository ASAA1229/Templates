import { describe, expect, it } from "vitest";
import { APP_NAME } from "./App";

describe("App", () => {
  it("has a name", () => {
    expect(APP_NAME.length).toBeGreaterThan(0);
  });
});
