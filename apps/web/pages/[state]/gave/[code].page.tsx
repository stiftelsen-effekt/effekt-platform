import type { GetServerSidePropsContext } from "next";
import { TRPCClientError } from "@trpc/client";
import { groq } from "next-sanity";
import type { GiftcardGift } from "@effekt/api/giftcard";
import { getAppStaticProps } from "../../_app.page";
import { getClient } from "../../../lib/sanity.client";
import { publicTrpcFor } from "../../../lib/trpc/client";
import type { ConsentState } from "../../../proxy.page";
import { isGiftCode } from "../../../util/giftcardPaths";
import { Navbar } from "../../../components/shared/components/Navbar/Navbar";
import {
  GiftPage,
  type GiftPageProduct,
} from "../../../components/main/blocks/GiftcardRecipient/GiftPage";

/**
 * The recipient's page, gieffektivt.no/gave/<code>: the link in the gift card SMS. Rendered on
 * every request (getServerSideProps), never built ahead or cached: the page shows the recipient's
 * and giver's names and the greeting, and is only reachable with the random code. The API answers
 * NOT_FOUND for unknown, unpaid, cancelled and expired gift cards, which is a 404 here.
 */
export default GiftPage;

const fetchProduct = groq`
*[_type == "giftcardproduct" && slug.current == $slug && !(_id in path('drafts.**'))][0] {
  title,
  "slug": slug.current,
  description,
  images[] { ..., asset-> { _id, url, metadata { lqip, dimensions { width, height } } } },
  "productPage": page->slug.current,
  recipient {
    impact,
    cta_heading,
    cta_text,
    recurring_label,
    organization_label,
    story[] {
      _key,
      heading,
      text,
      stat,
      chart,
      waffle,
      map,
      image { ..., asset-> { _id, url, metadata { lqip, dimensions { width, height } } } }
    },
    organization_logo { ..., asset-> { _id, url, metadata { lqip, dimensions { width, height } } } },
    organization-> {
      name,
      subtitle,
      oneliner,
      logo { ..., asset-> { _id, url, metadata { lqip, dimensions { width, height } } } },
      "page": organization_page->slug.current
    }
  }
}
`;

/** null: no such gift card (404). "unavailable": the API couldn't answer (503, try again) */
const fetchGift = async (code: string): Promise<GiftcardGift | null | "unavailable"> => {
  try {
    return await publicTrpcFor("no").giftcard.gift.query({ code });
  } catch (err) {
    if (err instanceof TRPCClientError && err.data?.httpStatus === 404) return null;
    console.error("Gift card page: the API did not answer", err);
    return "unavailable";
  }
};

export const getServerSideProps = async (
  ctx: GetServerSidePropsContext<{ state: ConsentState; code: string }>,
) => {
  const code = ctx.params?.code ?? "";
  if (!isGiftCode(code)) return { notFound: true as const };
  const consentState = ctx.params?.state ?? "undecided";

  // Personal data: never in a shared cache, and not kept by the browser for other visitors
  ctx.res.setHeader("Cache-Control", "private, no-store");

  const [gift, appStaticProps, navbar] = await Promise.all([
    fetchGift(code),
    getAppStaticProps({ draftMode: false, consentState, showGiveButton: false }),
    // The main menu, shown after the story instead of on top
    Navbar.getStaticProps({ dashboard: false, draftMode: false }),
  ]);
  if (gift === null) return { notFound: true as const };
  const navigationItems = navbar.data.result.settings.main_navigation ?? [];
  // The site's logo from the site settings, as in the top menu elsewhere
  const siteLogo = navbar.data.result.settings.logo ?? null;
  if (gift === "unavailable") {
    ctx.res.statusCode = 503;
    return { props: { appStaticProps, gift: null, product: null, navigationItems, siteLogo } };
  }

  // From the API, not the CDN: rendered per request anyway, and Studio edits show at once
  const product = await getClient()
    .withConfig({ useCdn: false })
    .fetch<GiftPageProduct | null>(fetchProduct, {
      slug: gift.product,
    });
  return { props: { appStaticProps, gift, product, navigationItems, siteLogo } };
};
