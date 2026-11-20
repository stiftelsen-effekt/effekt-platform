import { agreementsRouter } from "./routers/agreements";
import { analysisRouter } from "./routers/analysis";
import { configRouter } from "./routers/config";
import { donationsRouter } from "./routers/donations";
import { donorsRouter } from "./routers/donors";
import { giftcardRouter } from "./routers/giftcard";
import { giftcardsRouter } from "./routers/giftcards";
import { giroRouter } from "./routers/giro";
import { homeRouter } from "./routers/home";
import { impactRouter } from "./routers/impact";
import { inflationRouter } from "./routers/inflation";
import { intentsRouter } from "./routers/intents";
import { metaRouter } from "./routers/meta";
import { minsideRouter } from "./routers/minside";
import { regrantingRouter } from "./routers/regranting";
import { reportsRouter } from "./routers/reports";
import { siteRouter } from "./routers/site";
import { vippsRouter } from "./routers/vipps";
import { widgetRouter } from "./routers/widget";
import { router } from "./trpc";

export const appRouter = router({
  meta: metaRouter,
  config: configRouter,
  donors: donorsRouter,
  donations: donationsRouter,
  vipps: vippsRouter,
  giro: giroRouter,
  reports: reportsRouter,
  agreements: agreementsRouter,
  inflation: inflationRouter,
  regranting: regrantingRouter,
  analysis: analysisRouter,
  intents: intentsRouter,
  home: homeRouter,
  impact: impactRouter,
  // Gift cards for ops; the website's gift card procedures are `giftcard` below
  giftcards: giftcardsRouter,
  // Donor-facing (Min Side on the website); everything above is admin-only
  minside: minsideRouter,
  // The public donation widget on the website (no login)
  widget: widgetRouter,
  // Gift cards on the website (no login)
  giftcard: giftcardRouter,
  // Public reads for the rest of the website: results, fundraisers, LTV (no login)
  site: siteRouter,
});

export type AppRouter = typeof appRouter;
