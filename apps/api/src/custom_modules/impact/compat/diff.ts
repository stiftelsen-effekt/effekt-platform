import { randomUUID } from "crypto";
import { DAO } from "../../DAO";
import { answerLegacy } from "./index";
import type { LegacyEndpoint } from "./legacyResponse";
import { COMPAT_MATRIX, type MatrixCase } from "./matrix";

/**
 * The dual-run diff (docs/impact-api-migration.md, phase 5): every request of the compatibility
 * matrix, asked of the legacy impact API and answered by our compat REST in-process, compared
 * byte for byte. Runs daily (POST /scheduled/impact-compat-diff) until the legacy API is
 * decommissioned; results go to Import_logs, unexpected differences also to teknisk@.
 *
 * The legacy API is reached through the load balancer with `X-Impact-Backend: legacy`, which a
 * route rule pins to bs-impact-api whatever the weights (scripts/impact-compat/lb-weight.sh).
 * An answer without the `Content-Language` header Django sets did not come from the legacy API
 * and is reported as unreachable rather than compared.
 *
 * A difference is expected, not alarming, when:
 * - `edited`: the impact data changed after the freeze, in the admin or by a migration: an
 *   Impact_changes row touches an estimate, charity or intervention in either answer, or (for the
 *   grant endpoints) any fund grant. The legacy data stays frozen; ours moves on.
 * - `legacy-language`: a request without `language` that the legacy API answered in another
 *   language (it reused the thread's last one; we answer in English).
 */

export const LEGACY_IMPACT_API = "https://impact.gieffektivt.no/api";
export const PIN_HEADER = "X-Impact-Backend";

export type DiffStatus = "same" | "edited" | "legacy-language" | "unexpected" | "unreachable";

export type DiffResult = {
  endpoint: LegacyEndpoint;
  query: string;
  status: DiffStatus;
  /** The first differing JSON path and both values, for differences */
  detail?: string;
};

export type ImpactChangeRow = { entity: string; entity_id: number; Charity_ID: number | null };

export type LegacyFetch = (
  endpoint: LegacyEndpoint,
  query: string,
) => Promise<{ status: number; body: string; fromLegacy: boolean }>;

export const fetchLegacyAnswer: LegacyFetch = async (endpoint, query) => {
  const sep = query ? "&" : "";
  const res = await fetch(
    `${LEGACY_IMPACT_API}/${endpoint}?${query}${sep}cachebust=${randomUUID()}`,
    {
      headers: {
        [PIN_HEADER]: "legacy",
        "Accept-Language": "en",
        "User-Agent": "effekt-impact-compat-diff",
      },
      signal: AbortSignal.timeout(20_000),
    },
  );
  return {
    status: res.status,
    body: await res.text(),
    fromLegacy: res.headers.has("content-language"),
  };
};

/** IDs that appear in an answer */
export function referencedIds(body: unknown) {
  const ids = {
    evaluations: new Set<number>(),
    charities: new Set<number>(),
    interventions: new Set<number>(),
  };
  if (!body || typeof body !== "object") return ids;
  const b = body as Record<string, any[]>;
  for (const e of b.evaluations ?? []) {
    ids.evaluations.add(e.id);
    if (e.charity) ids.charities.add(e.charity.id);
    if (e.intervention) ids.interventions.add(e.intervention.id);
  }
  for (const g of [...(b.max_impact_fund_grants ?? []), ...(b.all_grants_fund_grants ?? [])])
    for (const a of g.allotment_set ?? []) {
      if (a.charity) ids.charities.add(a.charity.id);
      if (a.intervention) ids.interventions.add(a.intervention.id);
    }
  return ids;
}

/** Whether an Impact_changes row explains a difference in this endpoint's answers */
export function editedAfterFreeze(
  endpoint: LegacyEndpoint,
  answers: unknown[],
  changes: ImpactChangeRow[],
): boolean {
  const ids = answers.map(referencedIds);
  const any = (pick: (i: ReturnType<typeof referencedIds>) => Set<number>, id: number | null) =>
    id !== null && ids.some((i) => pick(i).has(id));
  return changes.some((c) => {
    switch (c.entity) {
      case "estimate":
        return any((i) => i.evaluations, c.entity_id) || any((i) => i.charities, c.Charity_ID);
      case "charity":
        return any((i) => i.charities, c.entity_id);
      case "intervention":
        return any((i) => i.interventions, c.entity_id);
      case "grant":
        return endpoint !== "evaluations";
      default:
        return false;
    }
  });
}

/** The first path where two JSON values differ, with both values (shortened) */
export function firstDifference(a: unknown, b: unknown, path = "$"): string | null {
  if (Object.is(a, b)) return null;
  const short = (v: unknown) => {
    const s = JSON.stringify(v) ?? String(v);
    return s.length > 80 ? s.slice(0, 77) + "..." : s;
  };
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const d = firstDifference(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return a.length === b.length ? null : `${path}: length ${a.length} ≠ ${b.length}`;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.join() !== keysB.join()) return `${path}: keys ${short(keysA)} ≠ ${short(keysB)}`;
    for (const k of keysA) {
      const d = firstDifference((a as any)[k], (b as any)[k], `${path}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return `${path}: ${short(a)} ≠ ${short(b)}`;
}

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/** Compares one request; `ours` is our exact answer text */
export function compareAnswers(
  c: MatrixCase,
  legacy: { status: number; body: string; fromLegacy: boolean },
  ours: { status: number; json: string },
  changes: ImpactChangeRow[],
): DiffResult {
  const base = { endpoint: c.endpoint, query: c.query };
  if (!legacy.fromLegacy || legacy.status !== 200)
    return { ...base, status: "unreachable", detail: `legacy HTTP ${legacy.status}` };
  if (ours.status === 200 && ours.json === legacy.body) return { ...base, status: "same" };
  const theirs = parse(legacy.body);
  const mine = parse(ours.json);
  const detail =
    firstDifference(mine, theirs) ?? `same JSON values, different text (HTTP ${ours.status})`;
  if (!/(^|&)language=/.test(c.query) && /"language": "(?!en")/.test(legacy.body))
    return { ...base, status: "legacy-language", detail };
  if (editedAfterFreeze(c.endpoint, [mine, theirs], changes))
    return { ...base, status: "edited", detail };
  return { ...base, status: "unexpected", detail };
}

export type DiffSummary = {
  requests: number;
  same: number;
  edited: number;
  legacyLanguage: number;
  unexpected: number;
  unreachable: number;
  /** Every request that was not the same, at most 50 */
  differences: DiffResult[];
};

export function summarize(results: DiffResult[]): DiffSummary {
  const count = (s: DiffStatus) => results.filter((r) => r.status === s).length;
  return {
    requests: results.length,
    same: count("same"),
    edited: count("edited"),
    legacyLanguage: count("legacy-language"),
    unexpected: count("unexpected"),
    unreachable: count("unreachable"),
    differences: results.filter((r) => r.status !== "same").slice(0, 50),
  };
}

export async function readImpactChanges(): Promise<ImpactChangeRow[]> {
  const [rows] = await DAO.query<ImpactChangeRow[]>(
    "SELECT entity, entity_id, Charity_ID FROM Impact_changes",
  );
  return rows;
}

/** Runs the whole matrix, a few requests at a time */
export async function runCompatDiff(
  options: {
    fetchLegacy?: LegacyFetch;
    changes?: ImpactChangeRow[];
    matrix?: MatrixCase[];
    concurrency?: number;
  } = {},
): Promise<DiffSummary> {
  const fetchLegacy = options.fetchLegacy ?? fetchLegacyAnswer;
  const changes = options.changes ?? (await readImpactChanges());
  const matrix = options.matrix ?? COMPAT_MATRIX;
  const results: DiffResult[] = [];
  let next = 0;
  const worker = async () => {
    while (next < matrix.length) {
      const i = next++;
      const c = matrix[i];
      let result: DiffResult;
      try {
        const [legacy, ours] = await Promise.all([
          fetchLegacy(c.endpoint, c.query),
          answerLegacy(c.endpoint, c.query),
        ]);
        result = compareAnswers(c, legacy, ours, changes);
        // The legacy API's language leak and its cold-start errors: ask once more
        if (result.status === "legacy-language" || result.status === "unreachable") {
          const again = await fetchLegacy(c.endpoint, c.query);
          result = compareAnswers(c, again, ours, changes);
        }
      } catch (ex) {
        result = {
          endpoint: c.endpoint,
          query: c.query,
          status: "unreachable",
          detail: ex instanceof Error ? ex.message : String(ex),
        };
      }
      results[i] = result;
    }
  };
  await Promise.all(Array.from({ length: options.concurrency ?? 8 }, worker));
  return summarize(results);
}
