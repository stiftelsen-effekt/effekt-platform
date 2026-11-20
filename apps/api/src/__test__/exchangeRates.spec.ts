import { describe, it, afterEach, expect, vi } from "vitest";
import { DAO } from "../custom_modules/DAO";
import {
  ecbCsvToUsdRates,
  rateOn,
  updateExchangeRates,
  type RateTable,
} from "../custom_modules/exchangeRates";

// The shape of the ECB's csvdata answer with detail=dataonly
const CSV = `KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE
EXR.D.NOK.EUR.SP00.A,D,NOK,EUR,SP00,A,2026-10-29,11.7000
EXR.D.NOK.EUR.SP00.A,D,NOK,EUR,SP00,A,2026-10-30,11.6000
EXR.D.SEK.EUR.SP00.A,D,SEK,EUR,SP00,A,2026-10-30,11.0000
EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-10-30,1.1600
EXR.D.ISK.EUR.SP00.A,D,ISK,EUR,SP00,A,2026-10-30,
`;

describe("ecbCsvToUsdRates", () => {
  it("turns per-EUR rates into per-USD rates and adds EUR", () => {
    expect(ecbCsvToUsdRates(CSV)).toStrictEqual([
      { date: "2026-10-30", currency: "EUR", perUsd: "0.86206897" },
      { date: "2026-10-30", currency: "NOK", perUsd: "10.00000000" },
      { date: "2026-10-30", currency: "SEK", perUsd: "9.48275862" },
      { date: "2026-10-30", currency: "USD", perUsd: "1.00000000" },
    ]);
  });

  it("leaves out days without a USD rate and empty values", () => {
    const rates = ecbCsvToUsdRates(CSV);
    expect(rates.some((r) => r.date === "2026-10-29")).toBe(false);
    expect(rates.some((r) => r.currency === "ISK")).toBe(false);
  });
});

describe("rateOn", () => {
  const table: RateTable = {
    currency: "NOK",
    dates: ["2026-10-29", "2026-10-30", "2026-11-02"],
    perUsd: [10.1, 10.2, 10.3],
  };

  it("takes the date itself or the latest earlier one", () => {
    expect(rateOn(table, "2026-10-30")).toStrictEqual({ date: "2026-10-30", perUsd: 10.2 });
    expect(rateOn(table, "2026-11-01")).toStrictEqual({ date: "2026-10-30", perUsd: 10.2 });
    expect(rateOn(table, "2027-01-01")).toStrictEqual({ date: "2026-11-02", perUsd: 10.3 });
  });

  it("has no rate before the first date, and USD is always 1", () => {
    expect(rateOn(table, "2026-10-28")).toBe(null);
    expect(rateOn({ currency: "USD", dates: [], perUsd: [] }, "2010-01-01")).toStrictEqual({
      date: "2010-01-01",
      perUsd: 1,
    });
  });
});

describe("updateExchangeRates", () => {
  afterEach(() => vi.restoreAllMocks());

  const stubDb = (latest: string | null) => {
    const inserts: unknown[][][] = [];
    vi.spyOn(DAO, "query").mockImplementation((async (sql: string, params: any) => {
      if (sql.includes("MAX(date)")) return [[{ latest }], []];
      inserts.push(params[0]);
      return [{ affectedRows: params[0].length }, []];
    }) as any);
    return inserts;
  };

  it("refetches the week before the newest stored day, up to today in Oslo", async () => {
    const inserts = stubDb("2026-10-30");
    const urls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((async (url: string) => {
      urls.push(url);
      return new Response(CSV, { status: 200 });
    }) as any);

    const result = await updateExchangeRates({ now: new Date("2026-10-31T23:30:00Z") });

    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("EXR/D..EUR.SP00.A?startPeriod=2026-10-23&endPeriod=2026-11-01");
    expect(result).toStrictEqual({ from: "2026-10-23", to: "2026-11-01", days: 1, rows: 4 });
    expect(inserts[0][1]).toStrictEqual(["2026-10-30", "NOK", "10.00000000", "ECB"]);
  });

  it("backfills from 2013 a year at a time when the table is empty", async () => {
    stubDb(null);
    const urls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((async (url: string) => {
      urls.push(url);
      return new Response("", { status: 404 });
    }) as any);

    const result = await updateExchangeRates({ now: new Date("2015-06-01T12:00:00Z") });

    expect(result.from).toBe("2013-01-01");
    expect(
      urls.map((u) => u.match(/startPeriod=([\d-]+)&endPeriod=([\d-]+)/)!.slice(1)),
    ).toStrictEqual([
      ["2013-01-01", "2013-12-31"],
      ["2014-01-01", "2014-12-31"],
      ["2015-01-01", "2015-06-01"],
    ]);
  });

  it("rejects a from date after today", async () => {
    stubDb(null);
    let error: Error | undefined;
    try {
      await updateExchangeRates({ from: "2030-01-01", now: new Date("2026-10-31T12:00:00Z") });
    } catch (e) {
      error = e as Error;
    }
    expect(error?.message).toContain("Invalid from date");
  });
});
