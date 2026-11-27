import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  // You can set this via NEXT_PUBLIC_LANG in your deployment environment
  const lang = process.env.NEXT_PUBLIC_LANG || "no";

  return (
    <Html lang={lang}>
      <Head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="alternate icon" href="/favicon.ico" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
