import { groq } from "next-sanity";
import { pageBannersContentQuery } from "../_queries";
import { Navbar, PreviewNavbar } from "../components/shared/components/Navbar/Navbar";
import { MainHeader } from "../components/shared/layout/Header/Header";
import { SectionContainer } from "../components/main/layout/SectionContainer/sectionContainer";
import { SEO } from "../components/shared/seo/Seo";
import { getClient } from "../lib/sanity.client";
import { GeneralPageProps, getAppStaticProps } from "./_app.page";
import { ConsentState } from "../proxy.page";
import { GetStaticProps } from "next";
import { SiteMenuTable } from "../components/shared/components/SiteMenuTable/SiteMenuTable";
import styles from "../styles/404.module.css";

const fetch404Page = groq`{
  "settings": *[_type == "site_settings"] {
    title,
    not_found_title,
    ${pageBannersContentQuery}
  }
}`;

interface Custom404Props extends GeneralPageProps {
  data: {
    result: {
      settings: Array<{
        title: string;
        not_found_title?: string;
        cookie_banner_configuration: any;
        general_banner: any;
      }>;
    };
    queryParams: {};
    query: string;
  };
  navbar: Awaited<ReturnType<typeof Navbar.getStaticProps>>;
}

export const getStaticProps: GetStaticProps<Custom404Props> = async () => {
  const draftMode = false;
  const consentState = "undecided" as ConsentState;

  const appStaticProps = await getAppStaticProps({ draftMode, consentState });
  const client = getClient();
  const result = await client.fetch(fetch404Page);

  return {
    props: {
      appStaticProps,
      draftMode,
      preview: draftMode,
      token: null,
      navbar: await Navbar.getStaticProps({ dashboard: false, draftMode }),
      data: {
        result,
        queryParams: {},
        query: fetch404Page,
      },
      pageType: "404",
    },
  };
};

export default function Custom404({ data, navbar, draftMode }: Custom404Props) {
  const settings = data.result.settings[0];

  const navigationItems = navbar.data.result.settings.main_navigation;

  return (
    <>
      <SEO
        title={settings.not_found_title || "Page not found"}
        description="404 - Page not found"
        titleTemplate={`${settings.title} | %s`}
        siteName={settings.title}
      />

      <MainHeader hideOnScroll={true} generalBannerConfig={settings.general_banner}>
        {draftMode ? <PreviewNavbar {...navbar} /> : <Navbar {...navbar} />}
      </MainHeader>

      <SectionContainer nodivider>
        <div className={styles.container}>
          <h1 className={styles.header}>{settings.not_found_title || "Page not found"}</h1>
          <SiteMenuTable navigationItems={navigationItems} />
        </div>
      </SectionContainer>
    </>
  );
}
