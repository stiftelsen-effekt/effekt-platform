import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Express plumbing that lets tRPC procedures take `multipart/form-data` (FormData) input, used by
 * the report upload procedures.
 *
 * - express-fileupload is mounted globally and would consume multipart bodies before tRPC sees
 *   them, so it is skipped for /trpc.
 * - express.json() defines `req.body` (as undefined) on every request it doesn't parse. tRPC's
 *   Express adapter uses `req.body` whenever the property exists instead of reading the stream, so
 *   it is removed for multipart requests to /trpc and tRPC parses the FormData itself.
 */

/** Upload size limit for tRPC multipart requests, same as the REST file upload limit */
export const TRPC_MAX_BODY_SIZE = 10 * 1024 * 1024;

const isTrpcPath = (path: string) => {
  // Express routing is case-insensitive, so match /TRPC too
  const lower = path.toLowerCase();
  return lower === "/trpc" || lower.startsWith("/trpc/");
};

/** Wraps an app-level middleware so it doesn't run for /trpc requests */
export const skipForTrpc =
  (middleware: RequestHandler): RequestHandler =>
  (req, res, next) =>
    isTrpcPath(req.path) ? next() : middleware(req, res, next);

/**
 * Express 4's default of `req.body = {}` for requests no parser read (Express 5 leaves it
 * undefined). Mounted for the REST routes only (server.ts).
 */
export const defaultEmptyBody: RequestHandler = (req, _res, next) => {
  if (req.body === undefined) req.body = {};
  next();
};

/** Mount before the tRPC middleware */
export const passMultipartBodyToTrpc = (req: Request, _res: Response, next: NextFunction) => {
  if (req.is("multipart/form-data")) delete req.body;
  next();
};
