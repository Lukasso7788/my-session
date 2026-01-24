// src/pages/seo/SeoPageTemplate.tsx
import { useEffect } from "react";
import { Link } from "react-router-dom";

export type FaqItem = { q: string; a: string };

export default function SeoPageTemplate(props: {
    /** Used for title only */
    pageTitle: string;
    /** H1 must be "What is X?" */
    h1: string;
    intro: string[]; // 2–3 paragraphs
    faq: FaqItem[]; // 5–8 items
}) {
    const { pageTitle, h1, intro, faq } = props;

    useEffect(() => {
        try {
            document.title = `${pageTitle} | MySession`;
        } catch { }
    }, [pageTitle]);

    return (
        <div className="min-h-screen bg-white text-[#111827] px-4 py-14">
            <div className="max-w-3xl mx-auto">
                <div className="text-[12px] text-black/50">MySession • Canonical page</div>

                <h1 className="mt-3 text-3xl md:text-4xl font-semibold tracking-tight">
                    {h1}
                </h1>

                <div className="mt-6 space-y-4 text-[15px] leading-relaxed text-black/70">
                    {intro.map((p, idx) => (
                        <p key={idx}>{p}</p>
                    ))}
                </div>

                <div className="mt-8 flex flex-col sm:flex-row gap-3">
                    <Link
                        to="/sessions"
                        className="h-11 inline-flex items-center justify-center rounded-full px-6 text-[14px] font-semibold bg-[#111827] text-white hover:opacity-90 transition"
                    >
                        Join a session
                    </Link>
                    <Link
                        to="/"
                        className="h-11 inline-flex items-center justify-center rounded-full px-6 text-[14px] font-semibold border border-[#111827] text-[#111827] hover:bg-[#111827] hover:text-white transition"
                    >
                        Back to landing
                    </Link>
                </div>

                <div className="mt-12">
                    <h2 className="text-xl font-semibold">FAQ</h2>
                    <div className="mt-4 space-y-3">
                        {faq.map((item) => (
                            <div key={item.q} className="border border-black/10 rounded-2xl p-5">
                                <div className="font-semibold text-[14px]">{item.q}</div>
                                <div className="mt-2 text-[14px] text-black/65 leading-relaxed">
                                    {item.a}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>


            </div>
        </div>
    );
}
