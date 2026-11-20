import { describe, it, afterEach, expect, vi } from "vitest";
import * as sftp from "../custom_modules/sftp";
import * as giroSftp from "../custom_modules/giroSftp";
import { ocrFileKey, selectOCRFilesToImport } from "../custom_modules/ocrFiles";

const files = [
  { name: "b", modifyTime: 200 },
  { name: "a", modifyTime: 100 },
  { name: "c", modifyTime: 300 },
];

describe("selectOCRFilesToImport", () => {
  it("imports only the latest file until a file has been recorded", () => {
    const selected = selectOCRFilesToImport(files, { imported: new Set(), trackedSince: null });
    expect(selected.map((f) => f.name)).toStrictEqual(["c"]);
  });

  it("imports every unimported file since the first recorded one, oldest first", () => {
    const selected = selectOCRFilesToImport(files, {
      imported: new Set([ocrFileKey({ name: "a", modifyTime: 100 })]),
      trackedSince: 100,
    });
    expect(selected.map((f) => f.name)).toStrictEqual(["b", "c"]);
  });

  it("skips files older than the first recorded import", () => {
    const selected = selectOCRFilesToImport(files, {
      imported: new Set([ocrFileKey({ name: "b", modifyTime: 200 })]),
      trackedSince: 200,
    });
    expect(selected.map((f) => f.name)).toStrictEqual(["c"]);
  });

  it("treats a reused file name with a new modification time as a new file", () => {
    const selected = selectOCRFilesToImport([{ name: "a", modifyTime: 500 }], {
      imported: new Set([ocrFileKey({ name: "a", modifyTime: 100 })]),
      trackedSince: 100,
    });
    expect(selected.map((f) => f.modifyTime)).toStrictEqual([500]);
  });

  it("returns nothing when there are no files", () => {
    expect(selectOCRFilesToImport([], { imported: new Set(), trackedSince: null })).toStrictEqual(
      [],
    );
  });
});

describe("giro SFTP helpers close their connection", () => {
  afterEach(() => vi.restoreAllMocks());

  const fakeConnection = () => ({
    list: vi.fn().mockResolvedValue([
      { type: "-", name: "x", modifyTime: 2 },
      { type: "d", name: "dir", modifyTime: 3 },
      { type: "-", name: "y", modifyTime: 1 },
    ]),
    get: vi.fn().mockImplementation(async (path: string) => Buffer.from(path)),
    put: vi.fn().mockResolvedValue(undefined),
    end: vi.fn().mockResolvedValue(undefined),
  });

  it("fetches the selected files, ignoring directories", async () => {
    const conn = fakeConnection();
    vi.spyOn(sftp, "getConnection").mockResolvedValue(conn as any);
    let listed: string[] = [];
    const result = await giroSftp.getOCRFiles((listing) => {
      listed = listing.map((f) => f.name);
      return listing;
    });
    expect(listed).toStrictEqual(["x", "y"]);
    expect(result.map((f) => f.contents.toString())).toStrictEqual(["/Outbound/x", "/Outbound/y"]);
    expect(conn.end).toHaveBeenCalledOnce();
  });

  it("closes the connection when a download fails", async () => {
    const conn = fakeConnection();
    conn.get.mockRejectedValue(new Error("timeout"));
    vi.spyOn(sftp, "getConnection").mockResolvedValue(conn as any);
    let caught: unknown;
    try {
      await giroSftp.getOCRFiles((listing) => listing);
    } catch (ex) {
      caught = ex;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(conn.end).toHaveBeenCalledOnce();
  });

  it("does not fail a sent file because closing the connection failed", async () => {
    vi.spyOn(console, "error").mockReturnValue(undefined);
    const conn = fakeConnection();
    conn.end.mockRejectedValue(new Error("already closed"));
    vi.spyOn(sftp, "getConnection").mockResolvedValue(conn as any);
    const file = Buffer.from("claims");
    expect(await giroSftp.sendFile(file, "DIRREM")).toBe(file);
    expect(conn.put).toHaveBeenCalledOnce();
  });
});
