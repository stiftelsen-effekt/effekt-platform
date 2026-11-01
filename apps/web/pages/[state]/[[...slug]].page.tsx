import { GetStaticPropsContext, InferGetStaticPropsType } from "next";
import { fetchRouterContext } from "../../context/RouterContext";
import dynamic from "next/dynamic";
import { useEffect } from "react";
import { FullPageSpinner } from "../../components/shared/layout/FullPageSpinner/FullPageSpinner";
import { getDonationsPageSubpaths, getTaxPageSubPaths } from "../dashboard/paths";
// Only referenced from getStaticProps and getStaticPaths, so Next strips these imports from the
// client bundle
import { ArticlePage as ArticlePageData, getArticlePaths } from "../ArticlePage";
import { GenericPage as GenericPageData, getGenericPagePaths } from "../GenericPage";
import { ArticlesPage as ArticlesPageData } from "../ArticlesPage";
import { VippsAgreementPage as VippsAgreementPageData } from "../VippsAgreementPage";
import { ResultsPage as ResultsPageData } from "../ResultsPage";
import { FundraiserPage as FundraiserPageData, getFundraiserPagePaths } from "../FundraiserPage";
import { DonationsPage as DonationsPageData } from "../dashboard/DonationsPage";
import { AgreementsPage as AgreementsPageData } from "../dashboard/AgreementsPage";
import { ProfilePage as ProfilePageData } from "../dashboard/ProfilePage";
import { TaxPage as TaxPageData } from "../dashboard/TaxPage";
import { VippsAnonymousPage as VippsAnonymousPageData } from "../dashboard/VippsAnonymousPage";
import { LiveQuery } from "../../components/shared/LiveQuery";
import { ConsentState } from "../../proxy.page";
import { renderLatexInData } from "../../components/main/blocks/Paragraph/renderLatex";

enum PageType {
  GenericPage = "generic",
  ArticlesPage = "articles",
  ResultsPage = "results",
  ArticlePage = "article",
  FundraiserPage = "fundraiser",
  VippsAgreementPage = "vipps-agreement",
  VippsAnonymousPage = "vipps-anonymous",
  AgreementsPage = "agreements",
  DonationsPage = "donations",
  ProfilePage = "profile",
  TaxPage = "tax",
}

// Content pages are split out so Min side (and each other) don't load every block type. They are
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

// Min side pages are split out so ordinary content pages don't load them (or Auth0). They are
// still server-rendered, and Next loads the chunks of rendered ones before hydrating. The
// placeholder matches what the profile layout shows while it checks the login.
const dashboardPageLoading = () => <FullPageSpinner />;
const DonationsPage = dynamic(
  () => import("../dashboard/DonationsPage").then((m) => m.DonationsPage),
  { loading: dashboardPageLoading },
);
const AgreementsPage = dynamic(
  () => import("../dashboard/AgreementsPage").then((m) => m.AgreementsPage),
  { loading: dashboardPageLoading },
);
const ProfilePage = dynamic(() => import("../dashboard/ProfilePage").then((m) => m.ProfilePage), {
  loading: dashboardPageLoading,
});
const TaxPage = dynamic(() => import("../dashboard/TaxPage").then((m) => m.TaxPage), {
  loading: dashboardPageLoading,
});
const VippsAnonymousPage = dynamic(
  () => import("../dashboard/VippsAnonymousPage").then((m) => m.VippsAnonymousPage),
  { loading: dashboardPageLoading },
);

// Min side pages only render once the login check passes, so start loading their code early
const preloadDashboardPage: Partial<Record<PageType, () => Promise<unknown>>> = {
  [PageType.DonationsPage]: () => import("../dashboard/DonationsPage"),
  [PageType.AgreementsPage]: () => import("../dashboard/AgreementsPage"),
  [PageType.ProfilePage]: () => import("../dashboard/ProfilePage"),
  [PageType.TaxPage]: () => import("../dashboard/TaxPage"),
  [PageType.VippsAnonymousPage]: () => import("../dashboard/VippsAnonymousPage"),
};

const Page: React.FC<InferGetStaticPropsType<typeof getStaticProps>> = (props) => {
  useEffect(() => {
    // nosemgrep: javascript.lang.security.audit.unsafe-dynamic-method.unsafe-dynamic-method -- pageType is set by getStaticProps, and the lookup is a fixed map of imports
    preloadDashboardPage[props.pageType as PageType]?.();
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- preloads once per page type
  }, [props.pageType]);

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
    case PageType.AgreementsPage:
      return <AgreementsPage {...(props as any)} />;
    case PageType.VippsAnonymousPage:
      return <VippsAnonymousPage {...(props as any)} />;
    case PageType.DonationsPage:
      return <DonationsPage {...(props as any)} />;
    case PageType.ProfilePage:
      return <ProfilePage {...(props as any)} />;
    case PageType.TaxPage:
      return <TaxPage {...(props as any)} />;
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
    agreementsPagePath,
    taxPagePath,
    profilePagePath,
    vippsAnonymousPagePath,
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

  if (isDashboard) {
    const isAgreementsPage = agreementsPagePath
      ? compareArrays(path.slice(0, agreementsPagePath.length), agreementsPagePath)
      : false;
    if (isAgreementsPage) return PageType.AgreementsPage;

    const isVippsAnonymousPage = vippsAnonymousPagePath
      ? compareArrays(path.slice(0, vippsAnonymousPagePath.length), vippsAnonymousPagePath)
      : false;
    if (isVippsAnonymousPage) return PageType.VippsAnonymousPage;

    const isTaxPage = taxPagePath
      ? compareArrays(path.slice(0, taxPagePath.length), taxPagePath)
      : false;
    if (isTaxPage) return PageType.TaxPage;

    const isProfilePage = profilePagePath
      ? compareArrays(path.slice(0, profilePagePath.length), profilePagePath)
      : false;
    if (isProfilePage) return PageType.ProfilePage;

    return PageType.DonationsPage;
  }
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
    case PageType.VippsAnonymousPage: {
      const props = await VippsAnonymousPageData.getStaticProps({ draftMode, consentState });
      return {
        props: {
          ...props,
          pageType,
          consentState,
        },
        revalidate,
      } as const;
    }
    case PageType.DonationsPage: {
      const props = await DonationsPageData.getStaticProps({ draftMode, consentState, path });
      return {
        props: {
          ...props,
          pageType,
          consentState,
        },
        revalidate,
      } as const;
    }
    case PageType.AgreementsPage: {
      const props = await AgreementsPageData.getStaticProps({
        draftMode,
        consentState,
        slug: path,
      });
      return {
        props: {
          ...props,
          pageType,
          consentState,
        },
        revalidate,
      } as const;
    }
    case PageType.ProfilePage: {
      const props = await ProfilePageData.getStaticProps({ draftMode, consentState });
      return {
        props: {
          ...props,
          pageType,
          consentState,
        },
        revalidate,
      } as const;
    }
    case PageType.TaxPage: {
      const props = await TaxPageData.getStaticProps({ draftMode, path, consentState });
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
    getDonationsPageSubpaths(),
    getTaxPageSubPaths(),
  ]).then(
    ([
      genericPagePaths,
      articlePaths,
      fundraiserPagePaths,
      donationsPageSubpaths,
      taxPageSubPaths,
    ]) => [
      ...genericPagePaths,
      ...articlePaths,
      ...fundraiserPagePaths,
      ...donationsPageSubpaths,
      ...taxPageSubPaths,
      ...(Object.values(routerContext).filter((path) => path !== null) as string[][]),
    ],
  );

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
