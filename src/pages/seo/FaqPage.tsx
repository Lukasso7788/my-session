import faqPage from "../../data/faq-page.json";
import SeoPageTemplate from "./SeoPageTemplate";

export default function FaqPage() {
    return (
        <SeoPageTemplate
            pageTitle={faqPage.pageTitle}
            h1={faqPage.h1}
            metaDescription={faqPage.metaDescription}
            relatedLinks={faqPage.relatedLinks}
            intro={faqPage.intro}
            sections={faqPage.sections}
            secondaryCta={{ label: "Join a session", to: "/sessions" }}
            faq={faqPage.faq}
        />
    );
}
