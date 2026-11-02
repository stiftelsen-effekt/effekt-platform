import { createContext, useContext } from "react";
import type { TrpcClient } from "./client";

/**
 * Min Side's tRPC client in the browser, provided by MinsideAppProviders. It sends mutations to a
 * Server Action (serverActionLink), which calls the API with the session's token; the pages render
 * their data on the server, so it sends no queries.
 */
export const TrpcClientContext = createContext<TrpcClient | null>(null);

/** The Min Side page's tRPC client (TrpcClientContext) */
export const useMinsideTrpc = (): TrpcClient => {
  const client = useContext(TrpcClientContext);
  if (!client) throw new Error("Min Side tRPC client missing: render inside a Min Side page");
  return client;
};
