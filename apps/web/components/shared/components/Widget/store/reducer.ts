import { getEarliestPossibleChargeDate } from "../components/panes/PaymentPane/AvtaleGiro/AvtaleGiroDatePicker/avtalegirodates";
import { CauseArea } from "../types/CauseArea";
import { RecurringDonation, ShareType } from "../types/Enums";
import { splitAmountByShares } from "../utils/donationCalculations";
import { WidgetAction } from "./actions";
import { Donation, Layout, Referrals, State } from "./state";

/** One per page load: referral answers from every widget on the page share it */
const WEBSITE_SESSION = new Date().getTime().toString();

export const createInitialState = (): State => {
  const today = new Date().getDate();
  return {
    donation: {
      recurring: RecurringDonation.NON_RECURRING,
      donor: {
        taxDeduction: false,
        newsletter: false,
      },
      dueDay: getEarliestPossibleChargeDate(),
      globalOperationsEnabled: false,
      vippsAgreement: {
        initialCharge: true,
        monthlyChargeDay: today <= 28 ? today : 0,
      },
    },
    layout: {
      paneNumber: 0,
      loading: false,
    },
    referrals: {
      websiteSession: WEBSITE_SESSION,
      selectedReferrals: [],
      otherText: "",
    },
  };
};

/** Sets up the distribution and the default selection once the cause areas have loaded */
const donationWithCauseAreas = (donation: Donation, areas: CauseArea[]): Donation => {
  const config = donation.operationsConfig;
  return {
    ...donation,
    // Default to the first cause area, unless something (a prefill) chose already
    selectionType: donation.selectionType ?? (areas.length > 0 ? "single" : undefined),
    selectedCauseAreaId:
      donation.selectedCauseAreaId ?? (areas.length > 0 ? areas[0].id : undefined),
    causeAreaDistributionType: Object.fromEntries(
      areas.map((area) => [area.id, ShareType.STANDARD]),
    ),
    operationsPercentageModeByCauseArea: config
      ? Object.fromEntries(
          areas.map((area) => {
            // The operations cause area itself never gets a tip on top of itself, whatever
            // excludedCauseAreaIds says
            const isExcluded =
              area.id === config.operationsCauseAreaId ||
              config.excludedCauseAreaIds.includes(area.id);
            return [area.id, !isExcluded && config.enabledByDefaultSingle];
          }),
        )
      : {},
    operationsPercentageByCauseArea: config
      ? Object.fromEntries(areas.map((area) => [area.id, config.defaultPercentage]))
      : {},
    globalOperationsEnabled: config?.enabledByDefaultGlobal ?? false,
    globalOperationsPercentage: config?.defaultPercentage,
  };
};

/**
 * Sets an amount passed in from another block as the total of the current selection, the same
 * way the amount pane stores what the donor enters:
 * - smart distribution (-1) and several cause areas: the smart distribution total (amounts the
 *   donor already entered per cause area are kept)
 * - one cause area: its amount, and its organization's amount when it has only one. Prefilled
 *   organization shares that still track the amount get their split of it. A split the donor
 *   entered by organization would ignore the amount, so the cause area goes back to its
 *   standard split.
 * The operations cut is taken from the amount, not added to it, so the total stays the amount.
 */
const donationWithAmount = (
  donation: Donation,
  causeAreas: CauseArea[] | undefined,
  amount: number,
): Donation => {
  const { selectionType, selectedCauseAreaId } = donation;
  if (selectedCauseAreaId === -1 || selectionType === "multiple") {
    return { ...donation, smartDistributionTotal: amount };
  }

  const causeArea = causeAreas?.find((area) => area.id === selectedCauseAreaId);
  if (selectionType !== "single" || !causeArea) return donation;

  const causeAreaAmounts = { ...donation.causeAreaAmounts, [causeArea.id]: amount };
  const orgAmounts = { ...donation.orgAmounts };
  let causeAreaDistributionType = donation.causeAreaDistributionType;

  const activeOrganizations = causeArea.organizations.filter((org) => org.isActive);
  const singleOrganization =
    causeArea.organizations.length <= 1
      ? causeArea.organizations[0]
      : activeOrganizations.length === 1
        ? activeOrganizations[0]
        : undefined;
  const trackedShares = trackedSharesOf(donation, causeArea);

  if (singleOrganization) {
    orgAmounts[singleOrganization.id] = amount;
  } else if (trackedShares) {
    const amountByOrgId = splitAmountByShares(amount, trackedShares);
    Object.keys(trackedShares).forEach((orgId) => {
      orgAmounts[Number(orgId)] = amountByOrgId[Number(orgId)] ?? 0;
    });
  } else if (causeAreaDistributionType?.[causeArea.id] === ShareType.CUSTOM) {
    causeAreaDistributionType = {
      ...causeAreaDistributionType,
      [causeArea.id]: ShareType.STANDARD,
    };
  }

  return { ...donation, causeAreaAmounts, orgAmounts, causeAreaDistributionType };
};

/** The prefilled organization shares in a cause area while they still track its amount */
const trackedSharesOf = (
  donation: Donation,
  causeArea: CauseArea,
): Record<number, number> | undefined => {
  if (donation.hasManuallyEditedPrefilledOrgAmount) return undefined;
  const shares: Record<number, number> = {};
  for (const org of causeArea.organizations) {
    const share = donation.prefilledShares?.[org.id];
    if (share !== undefined) shares[org.id] = share;
  }
  return Object.keys(shares).length > 0 ? shares : undefined;
};

/** Whether the donor (or a prefill) has entered any amount for the current selection */
const selectionHasAmount = (donation: Donation, causeAreas: CauseArea[] | undefined): boolean => {
  const { selectionType, selectedCauseAreaId, causeAreaAmounts = {}, orgAmounts = {} } = donation;
  if (selectedCauseAreaId === -1) return (donation.smartDistributionTotal ?? 0) > 0;
  if (selectionType === "multiple") {
    return (
      (donation.smartDistributionTotal ?? 0) > 0 ||
      Object.values(causeAreaAmounts).some((amount) => amount > 0) ||
      Object.values(orgAmounts).some((amount) => amount > 0)
    );
  }
  const causeArea = causeAreas?.find((area) => area.id === selectedCauseAreaId);
  if (!causeArea) return true;
  return (
    (causeAreaAmounts[causeArea.id] ?? 0) > 0 ||
    causeArea.organizations.some((org) => (orgAmounts[org.id] ?? 0) > 0)
  );
};

/** prefillAmount, and a selection made afterwards that has no amount yet */
const prefillReducer = (state: State, action: WidgetAction): State => {
  const { donation } = state;
  const causeAreas = state.layout.causeAreas;
  if (action.type === "prefillAmount") {
    if (action.amount === null) {
      return donation.prefilledAmount === undefined
        ? state
        : { ...state, donation: { ...donation, prefilledAmount: undefined } };
    }
    // Whole kroner, as the amount inputs allow
    const amount = Math.round(action.amount);
    if (!Number.isFinite(amount) || amount <= 0) return state;
    return {
      ...state,
      donation: { ...donationWithAmount(donation, causeAreas, amount), prefilledAmount: amount },
    };
  }
  if (
    action.type === "setCauseAreaSelection" &&
    donation.prefilledAmount !== undefined &&
    !selectionHasAmount(donation, causeAreas)
  ) {
    return {
      ...state,
      donation: donationWithAmount(donation, causeAreas, donation.prefilledAmount),
    };
  }
  return state;
};

const donationReducer = (state: Donation, action: WidgetAction): Donation => {
  switch (action.type) {
    case "causeAreasLoaded":
      return donationWithCauseAreas(state, action.causeAreas);
    case "registered":
      return {
        ...state,
        kid: action.result.KID,
        registrationToken: action.result.registrationToken ?? undefined,
        paymentProviderURL: action.result.paymentProviderUrl,
        donor: { ...state.donor, donorID: action.result.donorID },
      };
    case "setCauseAreaSelection":
      // Amounts and the operations choice are kept, so the donor can switch back and forth
      return {
        ...state,
        selectionType: action.selectionType,
        selectedCauseAreaId: action.causeAreaId,
        causeAreaAmounts: state.causeAreaAmounts ?? {},
        globalOperationsEnabled: state.globalOperationsEnabled || false,
      };
    case "setCauseAreaAmount":
      return {
        ...state,
        causeAreaAmounts: { ...state.causeAreaAmounts, [action.causeAreaId]: action.amount },
      };
    case "setCauseAreaDistributionType":
      return {
        ...state,
        causeAreaDistributionType: {
          ...state.causeAreaDistributionType,
          [action.causeAreaId]: action.distributionType,
        },
      };
    case "setOrgAmount":
      return { ...state, orgAmounts: { ...state.orgAmounts, [action.orgId]: action.amount } };
    case "setPrefilledShares":
      return {
        ...state,
        prefilledShares: action.shares,
        showAllOrganizations: false,
        hasManuallyEditedPrefilledOrgAmount: false,
      };
    case "setShowAllOrganizations":
      return { ...state, showAllOrganizations: action.show };
    case "setHasManuallyEditedPrefilledOrgAmount":
      return { ...state, hasManuallyEditedPrefilledOrgAmount: action.edited };
    case "setReferralCode":
      return { ...state, referralCode: action.referralCode?.trim() || undefined };
    case "setDonorFormDraft":
      return { ...state, donorFormDraft: action.draft };
    case "setSmartDistributionTotal":
      return { ...state, smartDistributionTotal: action.smartDistributionTotal };
    case "setGlobalOperationsEnabled":
      return { ...state, globalOperationsEnabled: action.enabled };
    case "setOperationsPercentageModeByCauseArea":
      return {
        ...state,
        operationsPercentageModeByCauseArea: {
          ...state.operationsPercentageModeByCauseArea,
          [action.causeAreaId]: action.isPercentageMode,
        },
      };
    case "setGlobalOperationsPercentage":
      return { ...state, globalOperationsPercentage: action.percentage };
    case "setOperationsPercentageByCauseArea":
      return {
        ...state,
        operationsPercentageByCauseArea: {
          ...state.operationsPercentageByCauseArea,
          [action.causeAreaId]: action.percentage,
        },
      };
    case "setOperationsConfig":
      return { ...state, operationsConfig: action.config };
    case "selectPaymentMethod":
      return { ...state, method: action.method };
    case "submitDonorInfo":
      return { ...state, donor: { ...action.donor } };
    case "setDueDay":
      return { ...state, dueDay: action.day };
    case "setRecurring":
      return { ...state, recurring: action.recurring, method: undefined };
    case "setPaymentProviderURL":
      return { ...state, paymentProviderURL: action.url };
    case "setVippsAgreement":
      return { ...state, vippsAgreement: { ...state.vippsAgreement, ...action.vippsAgreement } };
    case "setApiError":
      return { ...state, apiError: action.message };
    case "clearApiError":
      return { ...state, apiError: undefined };
    default:
      return state;
  }
};

const layoutReducer = (state: Layout, action: WidgetAction): Layout => {
  switch (action.type) {
    case "causeAreasLoaded":
      return { ...state, causeAreas: action.causeAreas };
    case "setPaneNumber":
      return { ...state, paneNumber: action.paneNumber };
    case "nextPane":
      return { ...state, paneNumber: state.paneNumber + 1 };
    case "prevPane":
      return { ...state, paneNumber: state.paneNumber - 1 };
    case "setLoading":
      return { ...state, loading: action.loading };
    case "registered":
      return { ...state, loading: false };
    default:
      return state;
  }
};

const referralsReducer = (state: Referrals, action: WidgetAction): Referrals => {
  switch (action.type) {
    case "referralTypesLoaded":
      return { ...state, referrals: action.referralTypes };
    case "selectReferral":
      return {
        ...state,
        selectedReferrals: action.ref.active
          ? [...state.selectedReferrals, action.ref.referralID]
          : state.selectedReferrals.filter((id) => id !== action.ref.referralID),
      };
    case "setOtherText":
      return { ...state, otherText: action.text };
    default:
      return state;
  }
};

/** Pure: the widget's next state. Slices an action doesn't touch keep their identity. */
export const widgetReducer = (state: State, action: WidgetAction): State => {
  const donation = donationReducer(state.donation, action);
  const layout = layoutReducer(state.layout, action);
  const referrals = referralsReducer(state.referrals, action);
  const next =
    donation === state.donation && layout === state.layout && referrals === state.referrals
      ? state
      : { donation, layout, referrals };
  // Needs the cause areas from the layout slice and the selection from the donation slice
  return prefillReducer(next, action);
};
