"use client";

import { useMemo, type ReactNode } from "react";
import { MinsideSessionContext } from "../../../context/MinsideSessionContext";
import { MobileGuessContext } from "../../../hooks/useIsMobile";
import type { TaxUnit } from "../../../models";
import type { CauseArea } from "../../shared/components/Widget/types/CauseArea";
import type { AgreementFeedbackType } from "../../../context/MinsideSessionContext";

/**
 * What a Min Side page (App Router) hands its client components from the server: the logged-in
 * donor (and their tax units, so no component fetches them again) and the user agent's guess of a
 * phone, so the server renders the right layout.
 */
export function MinsidePageProviders({
  donorId,
  taxUnits,
  causeAreas,
  agreementFeedbackTypes,
  mobileGuess,
  children,
}: {
  donorId: number;
  taxUnits?: TaxUnit[];
  causeAreas?: CauseArea[];
  agreementFeedbackTypes?: AgreementFeedbackType[];
  mobileGuess: boolean;
  children: ReactNode;
}) {
  const session = useMemo(
    () => ({ donorId, taxUnits, causeAreas, agreementFeedbackTypes }),
    [donorId, taxUnits, causeAreas, agreementFeedbackTypes],
  );
  return (
    <MinsideSessionContext.Provider value={session}>
      <MobileGuessContext.Provider value={mobileGuess}>{children}</MobileGuessContext.Provider>
    </MinsideSessionContext.Provider>
  );
}
