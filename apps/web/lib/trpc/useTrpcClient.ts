import { createContext, useContext, useMemo } from "react";
import { useMainLocale } from "../../context/MainLocaleContext";
import { getAccessToken, getAccessTokenSilently } from "../../hooks/useApi";
import { TrpcClient, apiFlavorFor, createWebTrpcClient } from "./client";

/**
 * Min Side's client, provided once for the page by TrpcClientProvider
 * (components/profile/layout). httpBatchLink only batches calls made through the same client, so
 * every query on the page has to share it.
 */
export const TrpcClientContext = createContext<TrpcClient | null>(null);

/** A new client for the signed-in donor, on the backend this site uses (see apiFlavorFor) */
export const useNewTrpcClient = (fetchToken: getAccessTokenSilently, enabled = true) => {
  const flavor = apiFlavorFor(useMainLocale());
  return useMemo(
    () =>
      enabled ? createWebTrpcClient({ flavor, getToken: () => getAccessToken(fetchToken) }) : null,
    [enabled, flavor, fetchToken],
  );
};

/**
 * The tRPC client for the signed-in donor: the page's shared one inside the Min Side layout, so
 * the page's queries go out as one batch, or a client of its own elsewhere.
 */
export const useTrpcClient = (fetchToken: getAccessTokenSilently): TrpcClient => {
  const shared = useContext(TrpcClientContext);
  const own = useNewTrpcClient(fetchToken, shared === null);
  return (shared ?? own)!;
};
