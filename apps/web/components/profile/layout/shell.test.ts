import { createElement as h, useContext } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserWrapper } from "./userwrapper";
import { DonorContext, DonorProvider } from "./donorProvider";
import { NavbarAuthProvider } from "./NavbarAuthProvider";
import { NavbarAuthContext } from "../../shared/components/Navbar/NavbarAuthContext";

// What useAuth0() answers in each test
const auth = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));
vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => auth.current }));

// The profile query, as SWR answers it
const profile = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("../../../_queries", () => ({ useDonor: () => profile.current }));
vi.mock("../../shared/layout/FullPageError/FullPageError", () => ({
  FullPageError: () => "full page error",
}));

const loginWithRedirect = vi.fn();
const user = { "https://gieffektivt.no/user-id": 900001 };
const donor = { id: 900001, name: "E2E Donor", email: "e2e@example.org", newsletter: false };

const page = h("p", null, "page shell");
const wrapper = (skipAuthentication = false) =>
  renderToStaticMarkup(
    h(UserWrapper, {
      siteTitle: "Site",
      loginErrorConfig: {} as any,
      skipAuthentication,
      children: page,
    }),
  );

const DonorState = () => {
  const { donor, loading } = useContext(DonorContext);
  return h("p", null, `loading=${loading} donor=${donor?.id ?? "none"}`);
};
const donorState = () => renderToStaticMarkup(h(DonorProvider, { children: h(DonorState) }));

const NavState = () => h("p", null, `loggedIn=${useContext(NavbarAuthContext).loggedIn}`);
const navState = () => renderToStaticMarkup(h(NavbarAuthProvider, { children: h(NavState) }));

beforeEach(() => {
  loginWithRedirect.mockReset();
  profile.current = { loading: false, data: undefined, error: undefined };
});

describe("Min Side shell", () => {
  it("renders the page while Auth0 checks the session (and on the server)", () => {
    auth.current = { isLoading: true, isAuthenticated: false, user: undefined, loginWithRedirect };
    expect(wrapper()).toContain("page shell");
    expect(loginWithRedirect).not.toHaveBeenCalled();
    expect(donorState()).toContain("loading=true donor=none");
    expect(navState()).toContain("loggedIn=true");
  });

  it("sends a logged-out visitor to the login, showing nothing of the page", () => {
    auth.current = { isLoading: false, isAuthenticated: false, user: undefined, loginWithRedirect };
    const html = wrapper();
    expect(html).not.toContain("page shell");
    expect(loginWithRedirect).toHaveBeenCalledOnce();
    expect(navState()).toContain("loggedIn=false");
  });

  it("does not redirect the pages that skip the login", () => {
    auth.current = { isLoading: false, isAuthenticated: false, user: undefined, loginWithRedirect };
    expect(wrapper(true)).toContain("page shell");
    expect(loginWithRedirect).not.toHaveBeenCalled();
  });

  it("renders the page while the profile loads, and flags it as loading", () => {
    auth.current = { isLoading: false, isAuthenticated: true, user, loginWithRedirect };
    profile.current = { loading: true, data: undefined, error: undefined };
    expect(wrapper()).toContain("page shell");
    expect(donorState()).toContain("loading=true donor=none");
    expect(navState()).toContain("loggedIn=true");
  });

  it("provides the donor once the profile has loaded", () => {
    auth.current = { isLoading: false, isAuthenticated: true, user, loginWithRedirect };
    profile.current = { loading: false, data: donor, error: undefined };
    expect(donorState()).toContain("loading=false donor=900001");
  });

  it("still replaces the page with an error when the profile fails", () => {
    auth.current = { isLoading: false, isAuthenticated: true, user, loginWithRedirect };
    profile.current = { loading: false, data: undefined, error: new Error("boom") };
    expect(donorState()).toBe("full page error");
  });
});
