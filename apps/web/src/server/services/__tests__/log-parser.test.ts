import { describe, it, expect } from "vitest";
import { parseOffsetState } from "../log-parser";

describe("parseOffsetState", () => {
  it("returns null when nothing is stored yet", () => {
    expect(parseOffsetState(undefined)).toBeNull();
  });

  it("parses the current {offset, ino} JSON shape", () => {
    expect(parseOffsetState(JSON.stringify({ offset: 1234, ino: 5678 }))).toEqual({
      offset: 1234, ino: 5678,
    });
  });

  it("treats a legacy bare-integer value as unknown identity (ino -1)", () => {
    expect(parseOffsetState("4096")).toEqual({ offset: 4096, ino: -1 });
  });

  it("returns null for garbage input rather than throwing", () => {
    expect(parseOffsetState("not json")).toBeNull();
    expect(parseOffsetState(JSON.stringify({ offset: "nope" }))).toBeNull();
  });
});
