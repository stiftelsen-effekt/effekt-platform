import type { Metadata } from "next";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import style from "./profile.module.scss";
import { getMinsideFrame, getProfilePageContent } from "../../../../../lib/minside/content";
import { donorTrpc, verifySession } from "../../../../../lib/minside/dal";
import { errorCode } from "../../../../../lib/minside/donations";
import { builtMinsidePaths } from "../../../../../lib/minside/sanityPaths";
import { isMobileUserAgent } from "../../../../../lib/minside/userAgent";
import type { Donor } from "../../../../../models";
import { PageContent } from "../../../../../components/profile/layout/PageContent/PageContent";
import { MinsidePageProviders } from "../../../../../components/profile/app/MinsidePageProviders";
import { DataInfo, ErrorMessage, ProfileInfo } from "../../../../../components/profile/app/client";

/** Rendered whole once the donor's profile is there, like the other Min Side pages */
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const { siteTitle } = await getMinsideFrame();
  return { title: `${siteTitle} | Profil` };
}

export default async function ProfilePage() {
  const [content, { mainLocale }] = await Promise.all([getProfilePageContent(), getMinsideFrame()]);
  const page = content.page;
  if (!page?.info_configuration || !page.title_template) {
    return (
      <PageContent>
        <ErrorMessage>
          <p>Missing profile page configuration</p>
        </ErrorMessage>
      </PageContent>
    );
  }

  let donorId: number | null = null;
  let donor: Donor | null = null;
  try {
    ({ donorId } = await verifySession("/" + (builtMinsidePaths().profile ?? []).join("/")));
    donor = (await (await donorTrpc(mainLocale)).minside.profile.query({ donorId })) as Donor;
  } catch (error) {
    unstable_rethrow(error); // the login redirect of verifySession
    console.error(`Min Side profile: loading failed (${errorCode(error)})`);
  }
  const userAgent = (await headers()).get("user-agent") ?? "";

  const title = page.title_template.replace(
    "{{name}}",
    donor?.name ? " " + donor.name.split(" ")[0] : "",
  );

  return (
    <PageContent title={title} titleOnMobile>
      <div className={style.gridContainer}>
        {donor && donorId !== null ? (
          <MinsidePageProviders donorId={donorId} mobileGuess={isMobileUserAgent(userAgent)}>
            <ProfileInfo config={page.info_configuration} initialDonor={donor} />
          </MinsidePageProviders>
        ) : (
          <ErrorMessage />
        )}
        <DataInfo page={page} />
      </div>
    </PageContent>
  );
}
