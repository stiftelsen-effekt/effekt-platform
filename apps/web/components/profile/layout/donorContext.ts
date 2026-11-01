import React, { createContext } from "react";
import { Donor } from "../../../models";

// Kept apart from DonorProvider so the donation widget can read it without pulling in Auth0
export const DonorContext = createContext<{
  donor: Donor | null;
  setDonor: React.Dispatch<React.SetStateAction<Donor | null>>;
  /** True while the login is being checked or the profile is loading (donor is null until then) */
  loading: boolean;
}>({ donor: null, setDonor: () => {}, loading: false });
