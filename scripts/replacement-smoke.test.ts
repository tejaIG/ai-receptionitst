import { describe, expect, it } from "vitest";

import { smokeTargets } from "./replacement-smoke";

describe("replacement smoke targets", () => {
  it("checks only core Palakarimpu AI services", () => {
    expect(smokeTargets({}).map((target) => target.name)).toEqual([
      "admin",
      "admin-ready",
      "worker",
      "worker-ready",
    ]);
  });
});
