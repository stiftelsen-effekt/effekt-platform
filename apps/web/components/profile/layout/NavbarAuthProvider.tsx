import React from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { NavbarAuthContext } from "../../shared/components/Navbar/NavbarAuthContext";

export const NavbarAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isLoading, logout } = useAuth0();

  return (
    <NavbarAuthContext.Provider
      value={{
        // Min Side is only shown logged in (or while being redirected to the login), so keep the
        // logged-in buttons while the session is checked instead of swapping them in afterwards
        loggedIn: !!user || isLoading,
        logout: () => logout({ logoutParams: { returnTo: process.env.NEXT_PUBLIC_SITE_URL } }),
      }}
    >
      {children}
    </NavbarAuthContext.Provider>
  );
};
