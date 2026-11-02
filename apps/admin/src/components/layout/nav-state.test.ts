import { describe, expect, it } from "vitest";
import { HouseIcon } from "lucide-react";
import type { NavGroup } from "./nav";
import { activeGroupLabel, splitPinned } from "./nav-state";

const item = (to: string, exact = false) => ({ to, label: to, icon: HouseIcon, exact });
const groups: NavGroup[] = [
  { items: [item("/", true)] },
  { label: "A", items: [item("/a"), item("/a/sub")] },
  { label: "B", items: [item("/b")] },
];

describe("splitPinned", () => {
  it("moves pinned items to the top in pin order and drops empty groups", () => {
    const result = splitPinned(groups, ["/b", "/a"]);
    expect(result.pinned.map((i) => i.to)).toEqual(["/b", "/a"]);
    expect(result.groups.map((g) => g.label)).toEqual([undefined, "A"]);
    expect(result.groups[1]!.items.map((i) => i.to)).toEqual(["/a/sub"]);
  });

  it("ignores pins for items that don't exist", () => {
    const result = splitPinned(groups, ["/gone"]);
    expect(result.pinned).toEqual([]);
    expect(result.groups).toHaveLength(3);
  });
});

describe("activeGroupLabel", () => {
  it("picks the longest matching item", () => {
    expect(activeGroupLabel(groups, "/a/sub/1")).toBe("A");
    expect(activeGroupLabel(groups, "/a/other")).toBe("A");
    expect(activeGroupLabel(groups, "/b")).toBe("B");
  });

  it("returns undefined when nothing matches", () => {
    expect(activeGroupLabel(groups, "/nope")).toBeUndefined();
  });
});
