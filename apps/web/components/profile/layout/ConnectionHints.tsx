import Head from "next/head";

/** The origin of a URL or a bare host name (Auth0's domain setting is a host), or null */
export const originOf = (value: string | undefined): string | null => {
  if (!value) return null;
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).origin;
  } catch {
    return null;
  }
};

/**
 * Opens the connections Min Side needs first while its JavaScript loads: Auth0 (the silent login
 * check runs in an iframe, then the token request is a CORS fetch, so both kinds of connection)
 * and the site's API (CORS fetches without cookies). Both come from the site's build settings.
 */
export const ConnectionHints: React.FC = () => {
  const auth = originOf(process.env.NEXT_PUBLIC_AUTH_DOMAIN);
  const api = originOf(process.env.NEXT_PUBLIC_EFFEKT_API);
  return (
    <Head>
      {auth && <link key="preconnect-auth" rel="preconnect" href={auth} />}
      {auth && (
        <link key="preconnect-auth-cors" rel="preconnect" href={auth} crossOrigin="anonymous" />
      )}
      {api && api !== auth && (
        <link key="preconnect-api" rel="preconnect" href={api} crossOrigin="anonymous" />
      )}
      {auth && <link key="dns-prefetch-auth" rel="dns-prefetch" href={auth} />}
      {api && <link key="dns-prefetch-api" rel="dns-prefetch" href={api} />}
    </Head>
  );
};
