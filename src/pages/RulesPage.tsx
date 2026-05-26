import { useState } from "react";
import { Link } from "react-router-dom";

const APP_NAME = "MySession";

type RuleItem = {
    title: string;
    body: string;
};

const shortRules: string[] = [
    "Be respectful.",
    "Show up in good faith.",
    "Do not harass, insult, threaten, or intimidate others.",
    "Do not share sexual, hateful, violent, or otherwise inappropriate content.",
    "Do not distract or disrupt other participants.",
    "Political arguments, discrimination, and justification of violence, aggression, or harm are not allowed.",
    "Follow host instructions during hosted sessions.",
    "Do not record or share other users without permission.",
    "Do not spam, promote aggressively, or misuse the platform.",
    "Do not impersonate others or use the platform deceptively.",
    "Do not use MySession for illegal or harmful activity.",
];

const detailedRules: RuleItem[] = [
    {
        title: "1. Be respectful",
        body:
            "Treat other users with respect at all times. No harassment, insults, threats, bullying, intimidation, or hostile behavior.",
    },
    {
        title: "2. Use the platform for its intended purpose",
        body:
            "MySession is for focus sessions, coworking, body doubling, and related productivity use. Do not use the platform to disrupt sessions, troll, provoke others, or create an unsafe environment.",
    },
    {
        title: "3. Keep sessions appropriate",
        body:
            "Do not share sexual, violent, hateful, or otherwise inappropriate content. Do not use the platform in a way that makes other participants feel unsafe or uncomfortable.",
    },
    {
        title: "4. Respect others’ time and focus",
        body:
            "Join sessions with the intention to participate respectfully. Do not intentionally distract others, derail the session, spam chat, blast audio, or behave in a way that interferes with people trying to work.",
    },
    {
        title: "5. No political arguments, discrimination, or justification of violence",
        body:
            "MySession is a focus and coworking platform, not a place for political arguments. Political debates that disrupt sessions or community spaces, discriminatory harassment, and any justification of violence, aggression, war crimes, or harm towards other people are not allowed. If a host or moderator asks you to stop a topic, stop immediately.",
    },
    {
        title: "6. Russia-based access restriction",
        body:
            "MySession is not available for users who live in Russia, are based in Russia, work from Russia, or regularly spend time in Russia. This is a safety and ethical policy related to Russia’s war against Ukraine. This policy is not open for debate inside the community.",
    },
    {
        title: "7. Follow host and moderator instructions",
        body:
            "Some sessions are guided or moderated by a host. When joining a hosted session, follow the session format and reasonable instructions from the host or moderator. If a host or moderator asks you to stop a topic, stop immediately.",
    },
    {
        title: "8. No harassment or unwanted contact",
        body:
            "Do not pressure, manipulate, stalk, or repeatedly contact other users after they have shown disinterest. Do not use MySession to pursue unwanted personal, romantic, or commercial contact.",
    },
    {
        title: "9. Protect privacy",
        body:
            "Do not record, screenshot, distribute, or share another person’s image, voice, messages, or session activity without their clear permission and without any consent required by law.",
    },
    {
        title: "10. No impersonation or deception",
        body:
            "Do not impersonate another person, misrepresent your identity, or create misleading accounts in order to deceive others.",
    },
    {
        title: "11. No illegal, abusive, or harmful activity",
        body:
            "Do not use MySession for illegal activity, fraud, exploitation, hate speech, threats, doxxing, malware, or any other harmful conduct.",
    },
    {
        title: "12. No platform abuse",
        body:
            "Do not attempt to hack, scrape, overload, reverse engineer, bypass limits, or otherwise abuse the platform, rooms, systems, or data.",
    },
    {
        title: "13. Commercial promotion must stay limited",
        body:
            "Do not spam users with unsolicited promotions, links, offers, recruitment, or advertising. Reasonable sharing that is clearly relevant to a session may be allowed, but spam is not.",
    },
    {
        title: "14. Report problems responsibly",
        body:
            "If you experience harassment, abuse, inappropriate behavior, or serious rule violations, report it through the platform or contact support.",
    },
    {
        title: "15. Enforcement",
        body:
            "We may remove content, end sessions, restrict features, suspend accounts, or permanently ban users who violate these rules or create risk for the platform or its users.",
    },
    {
        title: "16. Use common sense",
        body:
            "Not every harmful behavior can be listed here. If something clearly undermines safety, trust, respect, or the purpose of MySession, we may still take action.",
    },
];

const faq = [
    {
        q: "Can I join without talking?",
        a: "Yes. Many sessions on MySession are silent by default. Respect the format of the room you join.",
    },
    {
        q: "Can I talk about politics in sessions?",
        a: "MySession is for focus and coworking, not political arguments. Political debates that disrupt sessions or community spaces, discriminatory harassment, and justification of violence, aggression, or harm are not allowed. If a host or moderator asks you to stop a topic, stop immediately.",
    },
    {
        q: "Can I promote my product or community in sessions?",
        a: "Not aggressively and not as spam. Keep the platform focused on productive coworking, unless sharing something is clearly relevant and welcome.",
    },
    {
        q: "Can I record a session?",
        a: "Not without clear permission from the people involved and any consent required by law.",
    },
    {
        q: "What happens if someone breaks the rules?",
        a: "We may warn, restrict, suspend, or permanently ban accounts depending on the severity and pattern of behavior.",
    },
];

function Section({
    title,
    children,
}: {
    title: string;
    children: React.ReactNode;
}) {
    return (
        <section className="border-t border-black/10 py-8 first:border-t-0 first:pt-0">
            <h2 className="text-[22px] sm:text-[26px] font-semibold tracking-tight text-[#0F172A]">
                {title}
            </h2>
            <div className="mt-4 space-y-4 text-[16px] leading-8 text-[#334155]">
                {children}
            </div>
        </section>
    );
}

export default function RulesPage() {
    const [showDetailedRules, setShowDetailedRules] = useState(false);

    return (
        <div className="min-h-[calc(100vh-80px)] bg-white text-[#0F172A]">
            <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
                <div className="rounded-[28px] border border-black/10 bg-white shadow-[0_12px_40px_rgba(0,0,0,0.06)] overflow-hidden">
                    <div className="px-6 py-8 sm:px-8 sm:py-10">
                        <div className="inline-flex items-center rounded-full border border-black/10 bg-black/[0.03] px-3 py-1 text-[12px] font-medium text-[#475569]">
                            Platform
                        </div>

                        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <h1 className="text-[32px] font-semibold tracking-tight text-[#0F172A] sm:text-[42px]">
                                MySession rules
                            </h1>

                            <button
                                type="button"
                                onClick={() => setShowDetailedRules((v) => !v)}
                                className="inline-flex items-center justify-center rounded-full border border-black/10 bg-white px-4 py-2 text-[13px] font-medium text-[#0F172A] transition hover:bg-black/[0.03]"
                            >
                                {showDetailedRules ? "Show short rules" : "Show detailed rules"}
                            </button>
                        </div>

                        <p className="mt-5 max-w-3xl text-[16px] leading-8 text-[#334155]">
                            {APP_NAME} is a place for focus, accountability, and respectful
                            coworking. These rules help keep sessions productive, safe, and
                            comfortable for everyone.
                        </p>

                        <div className="mt-6 flex flex-wrap gap-2">
                            <Link
                                to="/sessions"
                                className="rounded-full border border-black/10 bg-black text-white px-4 py-2 text-[14px] font-medium transition hover:opacity-90"
                            >
                                Browse sessions
                            </Link>
                            <Link
                                to="/terms"
                                className="rounded-full border border-black/10 bg-white px-4 py-2 text-[14px] font-medium text-[#0F172A] transition hover:bg-black/[0.03]"
                            >
                                Terms of service
                            </Link>
                            <Link
                                to="/privacy"
                                className="rounded-full border border-black/10 bg-white px-4 py-2 text-[14px] font-medium text-[#0F172A] transition hover:bg-black/[0.03]"
                            >
                                Privacy policy
                            </Link>
                        </div>
                    </div>

                    <div className="border-t border-black/10" />

                    <div className="px-6 py-8 sm:px-8 sm:py-10">
                        <Section title={showDetailedRules ? "Detailed rules" : "Core rules"}>
                            {!showDetailedRules ? (
                                <>
                                    <p>
                                        These are the core rules for using {APP_NAME}. They are kept
                                        intentionally short and simple.
                                    </p>

                                    <ul className="list-disc space-y-2 pl-6 marker:text-[#64748B]">
                                        {shortRules.map((rule) => (
                                            <li key={rule}>{rule}</li>
                                        ))}
                                    </ul>

                                    <p>
                                        We may suspend or remove accounts that violate these rules.
                                    </p>
                                </>
                            ) : (
                                <div className="space-y-5">
                                    {detailedRules.map((rule) => (
                                        <div
                                            key={rule.title}
                                            className="rounded-[20px] border border-black/10 bg-black/[0.02] p-5"
                                        >
                                            <h3 className="text-[17px] font-semibold text-[#0F172A]">
                                                {rule.title}
                                            </h3>
                                            <p className="mt-2 text-[15px] leading-7 text-[#334155]">
                                                {rule.body}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </Section>

                        <Section title="Why these rules exist">
                            <p>
                                MySession works best when people can join quickly, focus deeply,
                                and feel safe around others. The rules are not here to make the
                                platform heavy — they are here to protect the basic conditions
                                that make coworking and body doubling actually useful.
                            </p>
                            <p>
                                In simple terms: respect people, don’t create friction, and
                                don’t misuse the platform.
                            </p>
                        </Section>

                        <Section title="Frequently asked questions">
                            <div className="space-y-4">
                                {faq.map((item) => (
                                    <div
                                        key={item.q}
                                        className="rounded-[20px] border border-black/10 p-5"
                                    >
                                        <h3 className="text-[16px] font-semibold text-[#0F172A]">
                                            {item.q}
                                        </h3>
                                        <p className="mt-2 text-[15px] leading-7 text-[#334155]">
                                            {item.a}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        </Section>

                        <Section title="Related pages">
                            <div className="flex flex-wrap gap-3">
                                <Link
                                    to="/terms"
                                    className="rounded-full border border-black/10 px-4 py-2 text-[14px] text-[#0F172A] transition hover:bg-black/[0.03]"
                                >
                                    Terms of Service
                                </Link>
                                <Link
                                    to="/privacy"
                                    className="rounded-full border border-black/10 px-4 py-2 text-[14px] text-[#0F172A] transition hover:bg-black/[0.03]"
                                >
                                    Privacy Policy
                                </Link>
                                <Link
                                    to="/data-deletion"
                                    className="rounded-full border border-black/10 px-4 py-2 text-[14px] text-[#0F172A] transition hover:bg-black/[0.03]"
                                >
                                    Data deletion
                                </Link>
                                <Link
                                    to="/sessions"
                                    className="rounded-full border border-black/10 px-4 py-2 text-[14px] text-[#0F172A] transition hover:bg-black/[0.03]"
                                >
                                    Sessions
                                </Link>
                            </div>
                        </Section>
                    </div>
                </div>
            </main>
        </div>
    );
}