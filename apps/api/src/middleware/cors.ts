import { RequestHandler } from "express";
import { isPublicCachedRead } from "../trpc/express";

/**
 * How long browsers may reuse a preflight answer, in seconds. Chrome caps it at 7200 and Firefox
 * at 86400. Every Min Side call sends an Authorization header, so each one is preflighted; with
 * this the browser asks once per URL and origin for two hours instead of before every request.
 */
export const CORS_MAX_AGE_SECONDS = 7200;

const previewOriginRe = /^https:\/\/main-site-.*-effective-altruism-norway\.vercel\.app$/;

/**
 * The API's CORS headers. In production only the allowed origins (ALLOWED_PRODUCTION_ORIGINS)
 * and the website's Vercel previews get Access-Control-Allow-Origin, except the public cached
 * reads (isPublicCachedRead), which answer any origin. Elsewhere every origin is allowed.
 */
export const corsHeaders =
  ({
    env,
    allowedProductionOrigins,
  }: {
    env: string;
    allowedProductionOrigins: string[];
  }): RequestHandler =>
  (req, res, next) => {
    if (env === "production") {
      const remoteOrigin = req.get("Origin");

      const allowed =
        !!remoteOrigin &&
        (allowedProductionOrigins.includes(remoteOrigin) || previewOriginRe.test(remoteOrigin));

      if (isPublicCachedRead(req.path)) {
        res.setHeader("Access-Control-Allow-Origin", "*");
      } else if (allowed) {
        res.setHeader("Access-Control-Allow-Origin", remoteOrigin);
        res.setHeader("Vary", "Origin");
      }
    } else {
      res.setHeader("Access-Control-Allow-Origin", "*");
    }

    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, baggage, sentry-trace, trpc-accept",
    );
    res.setHeader("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE,PATCH,OPTIONS");
    res.setHeader("Access-Control-Max-Age", String(CORS_MAX_AGE_SECONDS));
    next();
  };
