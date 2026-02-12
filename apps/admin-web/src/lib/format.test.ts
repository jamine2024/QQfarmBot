import { describe, expect, it } from "vitest";
import { formatBytes, formatUptime } from "./format";

describe("format", () => {
  it("formatBytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1 KB");
  });

  it("formatUptime", () => {
    expect(formatUptime(0)).toBe("0s");
    expect(formatUptime(61)).toBe("1m 1s");
  });
});

