// Site-specific Plausible (script v2) URLs, from each site's Plausible dashboard
// under Site settings → Site installation. They are public: the script ships in
// the page. Outbound links, tagged events and revenue tracking are enabled per
// site in that same dashboard rather than in code.
const PLAUSIBLE_SCRIPTS: Record<string, string> = {
  "gieffektivt.no": "https://plausible.io/js/pa-Ba10q-8ik-TZwkxQmNUFE.js",
  "geeffektivt.se": "https://plausible.io/js/pa-VLSeZzFiyFX17Sd4Yaquq.js",
  "giveffektivt.dk": "https://plausible.io/js/pa-bRMnJGGIvu8hitcYbxPel.js",
};

const normalizeDomain = (domain: string) =>
  domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");

/**
 * Resolves the Plausible script URL for the site being built, based on
 * NEXT_PUBLIC_PLAUSIBLE_DOMAIN (set per Vercel project). Throws on an unknown
 * domain so a misconfigured project fails its build instead of silently
 * reporting to another site's dashboard.
 */
export const getPlausibleScriptSrc = (
  domain = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN || "gieffektivt.no",
) => {
  const src = PLAUSIBLE_SCRIPTS[normalizeDomain(domain)];
  if (!src) {
    throw new Error(
      `No Plausible script configured for NEXT_PUBLIC_PLAUSIBLE_DOMAIN="${domain}". ` +
        `Add it to lib/plausible.ts.`,
    );
  }
  return src;
};

// Keep v3's proxy paths: proxy.page.ts skips /js/ and /proxy/, and this
// keeps the event endpoint out of our own pages/api namespace.
export const PLAUSIBLE_PROXY_PATHS = {
  scriptPath: "/js/script.js",
  apiPath: "/proxy/api/event",
};

/**
 * A gift card recipient's page has the gift's secret code in its path (/gave/<code>). Plausible
 * gets every such page as /gave/[code], so visits are counted together and codes never reach
 * Plausible. Passed to plausible.init() as `transformRequest`, which next-plausible writes into an
 * inline script: the function must be self-contained (no outside references).
 */
export function plausibleTransformRequest(payload: { u: string; r?: string | null }) {
  const anonymise = (url: string) => url.replace(/\/gave\/[a-z]+(?=[/?#]|$)/g, "/gave/[code]");
  payload.u = anonymise(payload.u);
  if (payload.r) payload.r = anonymise(payload.r);
  return payload;
}
