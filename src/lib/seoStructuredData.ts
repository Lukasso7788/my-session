import type { SeoPageDefinition } from "../data/seoPageRegistry";

const SITE_ORIGIN = "https://mysession.club";

export function buildSeoPageStructuredData(page: SeoPageDefinition) {
  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_ORIGIN },
      { "@type": "ListItem", position: 2, name: page.h1, item: page.canonicalUrl },
    ],
  };
  const primary = page.pageType === "guide"
    ? {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: page.h1,
        description: page.metaDescription,
        datePublished: page.createdAt,
        dateModified: page.updatedAt,
        mainEntityOfPage: page.canonicalUrl,
        author: { "@type": "Organization", name: "MySession" },
        publisher: { "@type": "Organization", name: "MySession", url: SITE_ORIGIN },
      }
    : {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: "MySession",
        applicationCategory: "ProductivityApplication",
        operatingSystem: "Web",
        url: SITE_ORIGIN,
        description: page.metaDescription,
      };
  const faq = page.faqItems.length > 0
    ? {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: page.faqItems.map((item) => ({
          "@type": "Question",
          name: item.question,
          acceptedAnswer: { "@type": "Answer", text: item.answer },
        })),
      }
    : null;
  return [breadcrumb, primary, faq].filter(Boolean);
}
