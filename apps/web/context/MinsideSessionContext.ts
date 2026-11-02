import { createContext, useContext } from "react";
import type { TaxUnit } from "../models";
import type { CauseArea } from "../components/shared/components/Widget/types/CauseArea";

/**
 * What a Min Side page hands its client components from the server (MinsidePageProviders): the
 * logged-in donor, from the session (lib/minside/dal.ts), and the data the components would
 * otherwise fetch themselves. No component fetches in the browser.
 */
export type MinsideSession = {
  donorId: number;
  /** The donor's tax units, when the page already has them (no fetch of their own) */
  taxUnits?: TaxUnit[];
  /** Every cause area with its organizations (public), for distribution editing */
  causeAreas?: CauseArea[];
  /** The reasons a donor can give for stopping an agreement (public) */
  agreementFeedbackTypes?: AgreementFeedbackType[];
};

export type AgreementFeedbackType = { ID: number; name: string; isOther: boolean };

export const MinsideSessionContext = createContext<MinsideSession | null>(null);

export const useMinsideSession = (): MinsideSession => {
  const session = useContext(MinsideSessionContext);
  if (!session) throw new Error("Min Side session missing: render inside a Min Side page");
  return session;
};

/** For components also rendered outside a Min Side page */
export const useOptionalMinsideSession = () => useContext(MinsideSessionContext);
