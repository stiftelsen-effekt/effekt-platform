import Link from "next/link";
import { useContext } from "react";
import { useIsAppRouter } from "../../../../context/AppRouterContext";
import { RouterContext } from "../../../../context/RouterContext";

interface CustomLinkProps extends React.ComponentProps<typeof Link> {
  children: React.ReactNode;
  href: string | { pathname: string; query?: { [key: string]: string } };
}

export const CustomLink = ({ href, ...props }: CustomLinkProps) => {
  const appRouter = useIsAppRouter();
  const dashboardPath = useContext(RouterContext)?.dashboardPath ?? null;

  const path =
    typeof href === "object" && href.pathname
      ? href.pathname
      : typeof href === "string"
        ? href
        : "/";
  // Remove any leading slash for consistency
  const cleanHref = path.startsWith("/") ? path.slice(1) : path;

  if (appRouter && !isMinsidePath(cleanHref, dashboardPath)) {
    // From Min Side (App Router) to the content site (pages router): a page of the other router
    // is always a full page load, so load it directly instead of trying a client-side navigation
    // first (which costs a round trip before the real load).
    const query = typeof href === "object" ? href.query : undefined;
    return (
      <a href={`/${cleanHref}${queryString(query)}`} {...anchorProps(props)}>
        {props.children}
      </a>
    );
  }

  if (typeof href === "object" && href.pathname) {
    return <Link href={{ pathname: `/${cleanHref}`, query: href.query }} {...props} />;
  }
  if (typeof href === "string") {
    // The App Router has no [state] route and ignores `as`
    return appRouter ? (
      <Link href={`/${cleanHref}`} {...props} />
    ) : (
      <Link href={`/[state]/${cleanHref}`} as={`/${cleanHref}`} {...props} />
    );
  }
  return <Link href="/" {...props} prefetch={false} />;
};

const isMinsidePath = (cleanHref: string, dashboardPath: string[] | null) => {
  if (!dashboardPath?.length) return false;
  const segments = cleanHref.split(/[?#]/)[0].split("/").filter(Boolean);
  return dashboardPath.every((segment, i) => segments[i] === segment);
};

const queryString = (query: Record<string, string> | undefined) =>
  query && Object.keys(query).length ? `?${new URLSearchParams(query)}` : "";

/** The props a plain <a> takes (next/link's own, like `scroll` or `prefetch`, left out) */
const anchorProps = (
  props: Omit<CustomLinkProps, "href">,
): React.AnchorHTMLAttributes<HTMLAnchorElement> => {
  const {
    as: _as,
    replace: _replace,
    scroll: _scroll,
    shallow: _shallow,
    passHref: _passHref,
    prefetch: _prefetch,
    locale: _locale,
    legacyBehavior: _legacyBehavior,
    onNavigate: _onNavigate,
    children: _children,
    ...anchor
  } = props as Record<string, unknown>;
  return anchor as React.AnchorHTMLAttributes<HTMLAnchorElement>;
};
