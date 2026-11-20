import { groq } from "next-sanity";
import { getClient } from "../lib/sanity.client";

const fetchCertificate = groq`
*[_type == "giftcardproduct" && slug.current == $slug && !(_id in path('drafts.**'))][0] {
  "url": certificate.asset->url
}
`;

/**
 * The self-fill certificate PDF of the gift card product with this slug (Giftcard_products.Slug
 * in the API), as a download link, or null. /gavekort/<slug>/gavebevis redirects there; the API's
 * receipt e-mails link to that path.
 */
export const getGiftcardCertificateUrl = async (slug: string): Promise<string | null> => {
  const data = await getClient().fetch<{ url?: string | null } | null>(fetchCertificate, { slug });
  if (!data?.url) return null;
  return `${data.url}?dl=gavebevis-${encodeURIComponent(slug)}.pdf`;
};
