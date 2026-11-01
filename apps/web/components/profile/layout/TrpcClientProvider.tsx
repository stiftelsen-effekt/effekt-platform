import React from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { TrpcClientContext, useNewTrpcClient } from "../../../lib/trpc/useTrpcClient";

/**
 * One tRPC client for every Min Side query and mutation on the page, so the queries a page starts
 * together go out as one batched request (one request and one CORS preflight instead of one each).
 * The Danish site's client is the REST link, which makes one REST request per call as before.
 */
export const TrpcClientProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { getAccessTokenSilently } = useAuth0();
  const client = useNewTrpcClient(getAccessTokenSilently);
  return <TrpcClientContext.Provider value={client}>{children}</TrpcClientContext.Provider>;
};
