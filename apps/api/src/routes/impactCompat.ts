import express from "express";
import rateLimit from "express-rate-limit";
import {
  answerLegacy,
  LEGACY_ENDPOINTS,
  type LegacyEndpoint,
} from "../custom_modules/impact/compat";

/**
 * The legacy impact API's endpoints (docs/impact-api-migration.md, phase 5), for third parties
 * that call impact.gieffektivt.no (One for the World's impact calculator, Annetame Targalt).
 * They stay REST for good (docs/web-trpc.md).
 *
 * Mounted twice:
 * - `/impact/api/<endpoint>` on every host: data.gieffektivt.no/impact/api/evaluations, for
 *   checks and the dual-run diff;
 * - `/api/<endpoint>` only when the Host header is impact.gieffektivt.no (IMPACT_COMPAT_HOSTS),
 *   so the load balancer can split impact.gieffektivt.no/api/* between the legacy service and
 *   effektapi with weights and no path rewrite (a URL map rewrite would apply to both backends).
 *
 * Public: any origin (CORS `*`), cached for an hour, GET only.
 */

const DEFAULT_HOSTS = "impact.gieffektivt.no";

export function compatHosts(env = process.env.IMPACT_COMPAT_HOSTS): Set<string> {
  return new Set(
    (env ?? DEFAULT_HOSTS)
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Per IP and instance; Cloud Armor allows 600 a minute per IP in front of it */
const RATE_LIMIT_PER_MINUTE = 300;

export function createImpactCompatRouter(options: { hosts?: Set<string> } = {}) {
  const hosts = options.hosts ?? compatHosts();
  const router = express.Router({ strict: true });

  const limiter = rateLimit({
    windowMs: 60 * 1000,
    limit: RATE_LIMIT_PER_MINUTE,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { trustProxy: false },
    handler: (_req, res) => {
      res.status(429).type("application/json").send('{"errors": ["Too many requests"]}');
    },
  });

  const handle =
    (endpoint: LegacyEndpoint): express.RequestHandler =>
    async (req, res, next) => {
      try {
        const queryString = req.originalUrl.includes("?")
          ? req.originalUrl.slice(req.originalUrl.indexOf("?") + 1)
          : "";
        const { status, json } = await answerLegacy(endpoint, queryString);
        res.setHeader("Cache-Control", status === 200 ? "public, max-age=3600" : "no-store");
        res.status(status).type("application/json").send(json);
      } catch (ex) {
        next({ ex });
      }
    };

  const cors: express.RequestHandler = (req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "accept, authorization, content-type, user-agent, x-csrftoken, x-requested-with",
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.removeHeader("Vary");
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Max-Age", "86400");
      res.status(204).end();
      return;
    }
    next();
  };

  const onCompatHost: express.RequestHandler = (req, _res, next) => {
    const host = (req.headers.host ?? "").toLowerCase().replace(/:\d+$/, "");
    if (hosts.has(host)) next();
    else next("router");
  };

  for (const endpoint of LEGACY_ENDPOINTS) {
    const path = `/impact/api/${endpoint}`;
    router.options(path, cors);
    router.get(path, cors, limiter, handle(endpoint));
  }

  const hostRouter = express.Router({ strict: true });
  hostRouter.use(onCompatHost);
  for (const endpoint of LEGACY_ENDPOINTS) {
    const path = `/api/${endpoint}`;
    hostRouter.options(path, cors);
    hostRouter.get(path, cors, limiter, handle(endpoint));
  }
  router.use(hostRouter);
  return router;
}
