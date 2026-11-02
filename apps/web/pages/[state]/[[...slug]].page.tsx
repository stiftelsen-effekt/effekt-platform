import { GetStaticPropsContext, InferGetStaticPropsType } from "next";
import { fetchRouterContext } from "../../context/RouterContext";
import dynamic from "next/dynamic";
// Only referenced from getStaticProps and getStaticPaths, so Next strips these imports from the
// client bundle
import { ArticlePage as ArticlePageData, getArticlePaths } from "../ArticlePage";
import { GenericPage as GenericPageData, getGenericPagePaths } from "../GenericPage";
import { ArticlesPage as ArticlesPageData } from "../ArticlesPage";
import { VippsAgreementPage as VippsAgreementPageData } from "../VippsAgreementPage";
import { ResultsPage as ResultsPageData } from "../ResultsPage";
import { FundraiserPage as FundraiserPageData, getFundraiserPagePaths } from "../FundraiserPage";
import { LiveQuery } from "../../components/shared/LiveQuery";
import type { ConsentState } from "../../proxy.page";
import { renderLatexInData } from "../../components/main/blocks/Paragraph/renderLatex";

enum PageType {
  GenericPage = "generic",
  ArticlesPage = "articles",
  ResultsPage = "results",
  ArticlePage = "article",
  FundraiserPage = "fundraiser",
  VippsAgreementPage = "vipps-agreement",
}

// Content pages are split out so they don't load each other's block types. They are
// server-rendered, and Next loads the chunk of the rendered one before hydrating, so content pages
// paint and hydrate as before. A placeholder only shows on client-side navigation.
const GenericPage = dynamic(() => import("../GenericPage").then((m) => m.GenericPage));
const ArticlesPage = dynamic(() => import("../ArticlesPage").then((m) => m.ArticlesPage));
const ArticlePage = dynamic(() => import("../ArticlePage").then((m) => m.ArticlePage));
const ResultsPage = dynamic(() => import("../ResultsPage").then((m) => m.ResultsPage));
const FundraiserPage = dynamic(() => import("../FundraiserPage").then((m) => m.FundraiserPage));
const VippsAgreementPage = dynamic(() =>
  import("../VippsAgreementPage").then((m) => m.VippsAgreementPage),
);

const Page: React.FC<InferGetStaticPropsType<typeof getStaticProps>> = (props) => {
  if (props.draftMode) {
    switch (props.pageType as PageType) {
      case PageType.GenericPage:
        return <PreviewGenericPage {...(props as any)} />;
      case PageType.ArticlesPage:
        return <PreviewArticlesPage {...(props as any)} />;
      case PageType.ArticlePage:
        return <PreviewArticlePage {...(props as any)} />;
      case PageType.ResultsPage:
        return <PreviewResultsPage {...(props as any)} />;
      case PageType.FundraiserPage:
        return <PreviewFundraiserPage {...(props as any)} />;
    }
  }

  switch (props.pageType as PageType) {
    case PageType.GenericPage:
      return <GenericPage {...(props as any)} />;
    case PageType.ArticlesPage:
      return <ArticlesPage {...(props as any)} />;
    case PageType.ArticlePage:
      return <ArticlePage {...(props as any)} />;
    case PageType.ResultsPage:
      return <ResultsPage {...(props as any)} />;
    case PageType.FundraiserPage:
      return <FundraiserPage {...(props as any)} />;
    case PageType.VippsAgreementPage:
      return <VippsAgreementPage {...(props as any)} />;
  }
};

const PreviewGenericPage: React.FC<InferGetStaticPropsType<typeof getStaticProps>> = (props) => {
  return (
    <LiveQuery data={props.data}>
      {(data) => <GenericPage {...(props as any)} data={data} />}
    </LiveQuery>
  );
};

const PreviewArticlesPage: React.FC<InferGetStaticPropsType<typeof getStaticProps>> = (props) => {
  return (
    <LiveQuery data={props.data}>
      {(data) => <ArticlesPage {...(props as any)} data={data} />}
    </LiveQuery>
  );
};

const PreviewArticlePage: React.FC<InferGetStaticPropsType<typeof getStaticProps>> = (props) => {
  return (
    <LiveQuery data={props.data}>
      {(data) => <ArticlePage {...(props as any)} data={data} />}
    </LiveQuery>
  );
};

const PreviewResultsPage: React.FC<InferGetStaticPropsType<typeof getStaticProps>> = (props) => {
  return (
    <LiveQuery data={props.data}>
      {(data) => <ResultsPage {...(props as any)} data={data} />}
    </LiveQuery>
  );
};

const PreviewFundraiserPage: React.FC<InferGetStaticPropsType<typeof getStaticProps>> = (props) => {
  return (
    <LiveQuery data={props.data}>
      {(data) => <FundraiserPage {...(props as any)} data={data} />}
    </LiveQuery>
  );
};

function compareArrays<T>(a: T[], b: T[]) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

const inferPageTypeFromPath = async (path: string[]) => {
  const {
    articlesPagePath,
    fundraisersPath,
    resultsPagePath,
    vippsAgreementPagePath,
    dashboardPath,
  } = await fetchRouterContext();

  const isVippsAgreementPage =
    vippsAgreementPagePath &&
    compareArrays(path.slice(0, vippsAgreementPagePath.length), vippsAgreementPagePath);
  if (isVippsAgreementPage) return PageType.VippsAgreementPage;

  const isArticle =
    compareArrays(path.slice(0, articlesPagePath.length), articlesPagePath) &&
    path.length > articlesPagePath.length;
  if (isArticle) return PageType.ArticlePage;

  const isFundraiser =
    compareArrays(path.slice(0, fundraisersPath.length), fundraisersPath) &&
    path.length > fundraisersPath.length;
  if (isFundraiser) return PageType.FundraiserPage;

  const isArticlesPage = compareArrays(path.slice(0, articlesPagePath.length), articlesPagePath);
  if (isArticlesPage) return PageType.ArticlesPage;

  const isResultsPage = resultsPagePath
    ? compareArrays(path.slice(0, resultsPagePath.length), resultsPagePath)
    : false;
  if (isResultsPage) return PageType.ResultsPage;

  const isDashboard = dashboardPath
    ? compareArrays(path.slice(0, dashboardPath.length), dashboardPath)
    : false;

  // Min Side is the App Router's (app/(minside)); the proxy never sends its paths here
  if (isDashboard) return null;
  return PageType.GenericPage;
};

export const getStaticProps = async (
  ctx: GetStaticPropsContext<{
    slug: string[];
    state: ConsentState;
  }>,
) => {
  const result = await getPageStaticProps(ctx);
  // Render LaTeX on the server, so neither katex nor stale Studio-rendered HTML reaches the client
  return (
    result && "props" in result ? { ...result, props: renderLatexInData(result.props) } : result
  ) as typeof result;
};

const getPageStaticProps = async (
  ctx: GetStaticPropsContext<{
    slug: string[];
    state: ConsentState;
  }>,
) => {
  const path = ctx.params?.slug ?? [];
  const draftMode = ctx.draftMode ?? false;
  const consentState = ctx.params?.state ?? "undecided";

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const isDanishSite = siteUrl.includes("giveffektivt.dk");
  const revalidate = isDanishSite || draftMode ? 1 : 3600;

  const pageType = await inferPageTypeFromPath(path);
  if (pageType === null) return { notFound: true } as const;

  switch (pageType) {
    case PageType.GenericPage: {
      const props = await GenericPageData.getStaticProps({ draftMode, consentState, path });
      if (!props.data.result.page && !draftMode) {
        return {
          notFound: true,
        };
      }
      return {
        props: {
          ...props,
          pageType,
          consentState,
        },
        revalidate,
      } as const;
    }
    case PageType.ArticlesPage: {
      const props = await ArticlesPageData.getStaticProps({ draftMode, consentState });
      return {
        props: {
          ...props,
          pageType,
          consentState,
        },
        revalidate,
      } as const;
    }
    case PageType.ArticlePage: {
      const slug = path.slice(1).join("/");
      const props = await ArticlePageData.getStaticProps({ draftMode, consentState, slug });
      return {
        props: {
          ...props,
          pageType,
          consentState,
        },
        revalidate,
      } as const;
    }
    case PageType.FundraiserPage: {
      const slug = path.slice(1).join("/");
      const props = await FundraiserPageData.getStaticProps({ draftMode, consentState, slug });
      if (!props.data.result.page && !draftMode) {
        return {
          notFound: true,
        };
      }
      return {
        props: {
          ...props,
          pageType,
          consentState,
        },
        revalidate,
      } as const;
    }
    case PageType.ResultsPage: {
      const props = await ResultsPageData.getStaticProps({ draftMode, consentState });
      return {
        props: {
          ...props,
          pageType,
          consentState,
        },
        revalidate,
      } as const;
    }
    case PageType.VippsAgreementPage: {
      const props = await VippsAgreementPageData.getStaticProps({ draftMode, consentState });
      return {
        props: {
          ...props,
          pageType,
          consentState,
        },
        revalidate,
      } as const;
    }
  }
};

export async function getStaticPaths() {
  const routerContext = await fetchRouterContext();

  const basePaths = await Promise.all([
    getGenericPagePaths(),
    getArticlePaths(routerContext.articlesPagePath),
    // The full-stack e2e builds the site while its API is still starting (scripts/e2e-fullstack.sh).
    // Fundraiser pages read the API, so there they are rendered on first request instead
    // (fallback: "blocking"). Production builds never set this.
    process.env.E2E_DEFER_API_PAGES === "1"
      ? Promise.resolve([])
      : getFundraiserPagePaths(routerContext.fundraisersPath),
  ]).then(([genericPagePaths, articlePaths, fundraiserPagePaths]) => [
    ...genericPagePaths,
    ...articlePaths,
    ...fundraiserPagePaths,
    // The content site's own listing pages; Min Side's paths belong to the App Router
    ...([
      routerContext.articlesPagePath,
      routerContext.resultsPagePath,
      routerContext.vippsAgreementPagePath,
      routerContext.fundraisersPath,
    ].filter((path) => path !== null) as string[][]),
  ]);

  const consentStates: ConsentState[] = ["accepted", "rejected", "undecided"];

  return {
    paths: basePaths.flatMap((path) =>
      consentStates.map((state) => ({
        params: {
          // The frontpage slug "/" splits into ["", ""]; empty segments produce a
          // trailing-slash path ("/accepted/") that breaks Vercel's Next.js adapter
          slug: path.filter((segment) => segment !== ""),
          state,
        },
      })),
    ),
    fallback: "blocking",
  };
}

export default Page;
