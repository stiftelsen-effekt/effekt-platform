import type { Metadata } from "next";
import { getMinsideFrame } from "../../../../../lib/minside/content";
import { PageContent } from "../../../../../components/profile/layout/PageContent/PageContent";
import styles from "./vipps-anonymous.module.scss";

/**
 * For donors with an anonymous Vipps agreement (no account): where to stop or change it. Static,
 * no login.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { siteTitle } = await getMinsideFrame();
  return { title: `${siteTitle} | Anonym Vipps-avtale`, icons: { icon: "/favicon.ico" } };
}

export default function VippsAnonymousPage() {
  return (
    <PageContent title="Anonym Vipps-avtale" titleOnMobile>
      <div className={styles.text}>
        <p className="ds-lead">
          Du kan stoppe avtalen din når som helst under betalingsavtaler i Vipps-appen.
        </p>
        <p className="ds-body">
          Ønsker du å endre beløp, trekkdag eller fordeling, kan du kontakte oss på{" "}
          <a href="mailto:donasjon@gieffektivt.no" className="ds-link">
            donasjon@gieffektivt.no
          </a>
          , så hjelper vi deg.
        </p>
      </div>
    </PageContent>
  );
}
