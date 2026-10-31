import { describe, expect, it } from "vitest";
import { PaymentMethod, RecurringDonation, ShareType } from "../types/Enums";
import { CauseArea } from "../types/CauseArea";
import {
  nextPane,
  prefillActions,
  prefillAmount,
  prevPane,
  selectPaymentMethod,
  selectReferral,
  setCauseAreaDistributionType,
  setCauseAreaSelection,
  setOperationsConfig,
  setPrefilledShares,
  setRecurring,
  setReferralCode,
  setVippsAgreement,
} from "./actions";
import { createInitialState, widgetReducer } from "./reducer";
import { State } from "./state";

const causeAreas = [
  { id: 1, name: "Global health", organizations: [] },
  { id: 3, name: "Climate", organizations: [] },
  { id: 4, name: "Operations", organizations: [] },
] as unknown as CauseArea[];

const config = {
  operationsCauseAreaId: 4,
  defaultPercentage: 5,
  enabledByDefaultGlobal: true,
  enabledByDefaultSingle: true,
  excludedCauseAreaIds: [3],
};

const reduce = (...actions: Parameters<typeof widgetReducer>[1][]) =>
  actions.reduce<State>(widgetReducer, createInitialState());

describe("widgetReducer", () => {
  it("sets up the distribution and the operations cut when the cause areas load", () => {
    const state = reduce(setOperationsConfig(config), {
      type: "causeAreasLoaded",
      causeAreas,
    });
    expect(state.layout.causeAreas).toBe(causeAreas);
    expect(state.donation).toMatchObject({
      selectionType: "single",
      selectedCauseAreaId: 1,
      causeAreaDistributionType: {
        1: ShareType.STANDARD,
        3: ShareType.STANDARD,
        4: ShareType.STANDARD,
      },
      // Never on the operations cause area itself, nor on an excluded one
      operationsPercentageModeByCauseArea: { 1: true, 3: false, 4: false },
      operationsPercentageByCauseArea: { 1: 5, 3: 5, 4: 5 },
      globalOperationsEnabled: true,
      globalOperationsPercentage: 5,
    });
  });

  it("keeps a selection made before the cause areas loaded (a prefill)", () => {
    const state = reduce(setCauseAreaSelection("single", 3), {
      type: "causeAreasLoaded",
      causeAreas,
    });
    expect(state.donation.selectedCauseAreaId).toBe(3);
  });

  it("records the registration and stops loading", () => {
    const state = reduce(
      { type: "setLoading", loading: true },
      {
        type: "registered",
        result: {
          KID: "12345678",
          registrationToken: "token",
          hasAnsweredReferral: false,
          paymentProviderUrl: "https://pay.example.org",
          donorID: 7,
        },
      },
    );
    expect(state.layout.loading).toBe(false);
    expect(state.donation).toMatchObject({
      kid: "12345678",
      registrationToken: "token",
      paymentProviderURL: "https://pay.example.org",
      donor: { donorID: 7 },
    });
  });

  it("clears the payment method when the donor switches between one-off and monthly", () => {
    const state = reduce(
      selectPaymentMethod(PaymentMethod.VIPPS),
      setRecurring(RecurringDonation.RECURRING),
    );
    expect(state.donation.method).toBeUndefined();
    expect(state.donation.recurring).toBe(RecurringDonation.RECURRING);
  });

  it("trims the referral code, and clears it when empty", () => {
    expect(reduce(setReferralCode("  CODE ")).donation.referralCode).toBe("CODE");
    expect(reduce(setReferralCode("CODE"), setReferralCode("  ")).donation.referralCode).toBe(
      undefined,
    );
  });

  it("resets the prefilled organization tracking along with new prefilled shares", () => {
    const state = reduce(
      { type: "setShowAllOrganizations", show: true },
      { type: "setHasManuallyEditedPrefilledOrgAmount", edited: true },
      setPrefilledShares({ 11: 100 }),
    );
    expect(state.donation).toMatchObject({
      prefilledShares: { 11: 100 },
      showAllOrganizations: false,
      hasManuallyEditedPrefilledOrgAmount: false,
    });
  });

  it("merges the Vipps agreement settings", () => {
    const state = reduce(setVippsAgreement({ initialCharge: false, monthlyChargeDay: 15 }));
    expect(state.donation.vippsAgreement).toEqual({ initialCharge: false, monthlyChargeDay: 15 });
  });

  it("moves between panes", () => {
    expect(reduce(nextPane(), nextPane(), prevPane()).layout.paneNumber).toBe(1);
  });

  it("adds and removes referral answers", () => {
    const state = reduce(
      selectReferral({ referralID: 1, active: true }),
      selectReferral({ referralID: 2, active: true }),
      selectReferral({ referralID: 1, active: false }),
    );
    expect(state.referrals.selectedReferrals).toEqual([2]);
  });

  it("returns the same state for an action that changes nothing", () => {
    const state = createInitialState();
    expect(widgetReducer(state, { type: "unknown" } as never)).toBe(state);
  });

  describe("prefillAmount", () => {
    const org = (id: number, isActive = true) => ({
      id,
      isActive,
      standardShare: 50,
      ordering: id,
    });
    const areas = [
      { id: 1, name: "Global health", isActive: true, organizations: [org(11), org(12)] },
      { id: 2, name: "Animals", isActive: true, organizations: [org(21)] },
      { id: 3, name: "Climate", isActive: true, organizations: [org(31), org(32, false)] },
      { id: 4, name: "Operations", isActive: true, organizations: [org(41)] },
    ] as unknown as CauseArea[];
    const loaded = (...actions: Parameters<typeof widgetReducer>[1][]) =>
      reduce(
        setOperationsConfig(config),
        { type: "causeAreasLoaded", causeAreas: areas },
        ...actions,
      );

    it("sets the selected cause area's amount, in whole kroner", () => {
      const state = loaded(prefillAmount(1234.6));
      expect(state.donation.causeAreaAmounts).toEqual({ 1: 1235 });
      expect(state.donation.prefilledAmount).toBe(1235);
      // Standard split: the organization amounts aren't used, and aren't touched
      expect(state.donation.orgAmounts).toEqual({});
    });

    it("sets the organization's amount too when the cause area has only one (active)", () => {
      expect(
        loaded(setCauseAreaSelection("single", 2), prefillAmount(500)).donation.orgAmounts,
      ).toEqual({ 21: 500 });
      expect(
        loaded(setCauseAreaSelection("single", 3), prefillAmount(500)).donation.orgAmounts,
      ).toEqual({ 31: 500 });
    });

    it("splits the amount between prefilled organizations that still track it", () => {
      const state = loaded(
        setCauseAreaDistributionType(1, ShareType.CUSTOM),
        setPrefilledShares({ 11: 50, 12: 50 }),
        prefillAmount(101),
      );
      expect(state.donation.causeAreaAmounts).toEqual({ 1: 101 });
      expect(state.donation.orgAmounts).toEqual({ 11: 51, 12: 50 });
      expect(state.donation.causeAreaDistributionType?.[1]).toBe(ShareType.CUSTOM);
    });

    it("goes back to the standard split when the donor split the cause area by hand", () => {
      const state = loaded(
        setCauseAreaDistributionType(1, ShareType.CUSTOM),
        { type: "setOrgAmount", orgId: 11, amount: 300 },
        prefillAmount(1000),
      );
      expect(state.donation.causeAreaAmounts).toEqual({ 1: 1000 });
      expect(state.donation.causeAreaDistributionType?.[1]).toBe(ShareType.STANDARD);
    });

    it("sets the smart distribution total for smart distribution and several cause areas", () => {
      expect(
        loaded(setCauseAreaSelection("single", -1), prefillAmount(800)).donation
          .smartDistributionTotal,
      ).toBe(800);
      const multiple = loaded(
        setCauseAreaSelection("multiple"),
        { type: "setCauseAreaAmount", causeAreaId: 2, amount: 100 },
        prefillAmount(800),
      );
      expect(multiple.donation.smartDistributionTotal).toBe(800);
      expect(multiple.donation.causeAreaAmounts).toEqual({ 2: 100 });
    });

    it("leaves the recurring choice and the operations cut alone", () => {
      const before = loaded(setRecurring(RecurringDonation.RECURRING));
      const after = widgetReducer(before, prefillAmount(500));
      expect(after.donation.recurring).toBe(RecurringDonation.RECURRING);
      expect(after.donation.operationsPercentageModeByCauseArea).toBe(
        before.donation.operationsPercentageModeByCauseArea,
      );
    });

    it("ignores amounts that aren't above 0", () => {
      const state = loaded();
      expect(widgetReducer(state, prefillAmount(0))).toBe(state);
      expect(widgetReducer(state, prefillAmount(-5))).toBe(state);
      expect(widgetReducer(state, prefillAmount(0.4))).toBe(state);
      expect(widgetReducer(state, prefillAmount(Number.NaN))).toBe(state);
      expect(widgetReducer(state, prefillAmount(null))).toBe(state);
    });

    it("sets the amount on a cause area selected afterwards that has none yet", () => {
      const state = loaded(prefillAmount(700), setCauseAreaSelection("single", 3));
      expect(state.donation.causeAreaAmounts).toEqual({ 1: 700, 3: 700 });
      expect(
        loaded(prefillAmount(700), setCauseAreaSelection("single", -1)).donation
          .smartDistributionTotal,
      ).toBe(700);
    });

    it("keeps an amount the donor entered when they switch cause area", () => {
      const state = loaded(
        prefillAmount(700),
        { type: "setCauseAreaAmount", causeAreaId: 2, amount: 50 },
        setCauseAreaSelection("single", 2),
      );
      expect(state.donation.causeAreaAmounts).toEqual({ 1: 700, 2: 50 });
    });

    it("forgets the amount for later selections on null, keeping the amounts", () => {
      const state = loaded(
        prefillAmount(700),
        prefillAmount(null),
        setCauseAreaSelection("single", 3),
      );
      expect(state.donation.prefilledAmount).toBeUndefined();
      expect(state.donation.causeAreaAmounts).toEqual({ 1: 700 });
    });

    it("waits for the cause areas when one cause area is selected", () => {
      const state = reduce(prefillAmount(700));
      expect(state.donation.causeAreaAmounts).toBeUndefined();
    });
  });

  describe("prefillActions", () => {
    const areas = [
      { id: 1, name: "Global health", isActive: true, organizations: [] },
      { id: 4, name: "Operations", isActive: true, organizations: [] },
    ] as unknown as CauseArea[];
    const opened = (start: State, context: Parameters<typeof prefillActions>[0]) =>
      prefillActions(context).reduce(widgetReducer, start);
    const loaded = reduce(setOperationsConfig(config), {
      type: "causeAreasLoaded",
      causeAreas: areas,
    });

    it("sets the amount and monthly when opened with both", () => {
      const state = opened(loaded, {
        prefilledSum: 1500,
        prefilledRecurring: RecurringDonation.RECURRING,
      });
      expect(state.donation.recurring).toBe(RecurringDonation.RECURRING);
      expect(state.donation.causeAreaAmounts).toEqual({ 1: 1500 });
    });

    it("goes through setRecurring, so a chosen payment method is cleared", () => {
      const withMethod = widgetReducer(loaded, selectPaymentMethod(PaymentMethod.BANK));
      expect(withMethod.donation.method).toBe(PaymentMethod.BANK);
      const state = opened(withMethod, {
        prefilledSum: 1500,
        prefilledRecurring: RecurringDonation.RECURRING,
      });
      expect(state.donation.method).toBeUndefined();
    });

    it("leaves the donor's choice as it is when no choice is passed", () => {
      const monthly = widgetReducer(loaded, setRecurring(RecurringDonation.RECURRING));
      expect(prefillActions({ prefilledSum: 1500, prefilledRecurring: null })).toEqual([
        prefillAmount(1500),
      ]);
      const state = opened(monthly, { prefilledSum: 1500, prefilledRecurring: null });
      expect(state.donation.recurring).toBe(RecurringDonation.RECURRING);
      expect(
        opened(loaded, { prefilledSum: 1500, prefilledRecurring: null }).donation.recurring,
      ).toBe(RecurringDonation.NON_RECURRING);
    });
  });
});
