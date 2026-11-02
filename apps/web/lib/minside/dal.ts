import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth0, donorIdOf } from "../auth0";
import type { MainLocale } from "../../context/MainLocaleContext";
import { apiFlavorFor, createWebTrpcClient, type TrpcClient } from "../trpc/client";

/**
 * Min Side's Data Access Layer (Next.js authentication guide): every Server Component, Server
 * Action and Route Handler that reads or changes donor data gets the session and the API client
 * here, so the check can't be forgotten. The proxy's redirect is only the fast, optimistic check;
 * this is the one that guards the data. The API then checks the token again (donorProcedure).
 *
 * Not for layouts: they don't re-render on navigation (Next.js guide, "Layouts and auth checks").
 */

export type MinsideSession = { donorId: number; firstName: string | null };

/**
 * The logged-in donor, or a redirect to the login. Memoised per request.
 * `returnTo` is the visible path to come back to (the App Router only knows the internal one).
 */
export const verifySession = cache(async (returnTo?: string): Promise<MinsideSession> => {
  // Request time, never prerendered (Cache Components): the SDK checks the session's expiry
  // against the clock before it reads the cookie
  await connection();
  const session = await auth0.getSession();
  const donorId = donorIdOf(session?.user);
  if (!session || donorId === null) {
    redirect(`/auth/login${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`);
  }
  return {
    donorId,
    firstName: (session.user.given_name as string | undefined) ?? null,
  };
});

/**
 * The tRPC client for the logged-in donor, calling the API from the server with the session's
 * access token, so the token never reaches the browser. One per request, so the queries a page
 * starts together go out in one batch. The Danish site gets the REST link (docs/web-trpc.md).
 *
 * The proxy refreshes the access token before it expires (tokenRefreshBuffer, lib/auth0.ts) and
 * hands the refreshed session on to the render, so this only reads it: a Server Component can't
 * store a refreshed token, and refreshing here could spend a rotating refresh token twice.
 */
export const donorTrpc = cache(async (mainLocale: MainLocale): Promise<TrpcClient> => {
  await verifySession();
  return createWebTrpcClient({
    flavor: apiFlavorFor(mainLocale),
    getToken: async () => (await auth0.getAccessToken()).token,
  });
});
