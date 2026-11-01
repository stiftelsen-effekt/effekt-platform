import { getImpactData } from "../data";
import { loadLegacyRates, supportedCurrencies } from "./legacyRates";
import {
  BadRequest,
  legacyResponse,
  QueryParams,
  requestedCurrency,
  validationErrors,
  type LegacyEndpoint,
} from "./legacyResponse";
import { pythonJson } from "./pythonJson";

/**
 * The legacy impact API's REST endpoints on the main API (docs/impact-api-migration.md,
 * phase 5): legacyResponse.ts builds the answer, legacyRates.ts converts as the legacy API did,
 * pythonJson.ts writes the JSON as Django did. Routes: routes/impactCompat.ts.
 */
export { LEGACY_ENDPOINTS, type LegacyEndpoint } from "./legacyResponse";
export { clearLegacyRatesCache } from "./legacyRates";

/** The answer to `GET /api/<endpoint>?<query>`, as status and the exact JSON text */
export async function answerLegacy(
  endpoint: LegacyEndpoint,
  queryString: string,
): Promise<{ status: number; json: string }> {
  const query = QueryParams.fromQueryString(queryString);
  try {
    const currencies = await supportedCurrencies();
    if (validationErrors(query, currencies).length) {
      // No data needed for the error answer
      const answer = legacyResponse(endpoint, query, emptyData, emptyRates, currencies);
      return { status: answer.status, json: pythonJson(answer.body) };
    }
    const { currency } = requestedCurrency(query);
    const [data, rates] = await Promise.all([getImpactData(), loadLegacyRates(currency)]);
    if (rates.usd.dates.length === 0)
      return { status: 503, json: pythonJson({ errors: ["Exchange rates are not available"] }) };
    const answer = legacyResponse(endpoint, query, data, rates, currencies);
    return { status: answer.status, json: pythonJson(answer.body) };
  } catch (ex) {
    if (ex instanceof BadRequest)
      return { status: 400, json: pythonJson({ errors: [ex.message] }) };
    throw ex;
  }
}

const emptyRates = { usd: { dates: [], perEur: [] }, series: new Map() };
const emptyData = {
  charities: new Map(),
  interventions: new Map(),
  evaluationsByCharity: new Map(),
  grantsByFund: new Map(),
  charityByOrganization: new Map(),
  fundByOrganization: new Map(),
  organizationAbbreviations: new Map(),
  organizationNames: new Map(),
};
