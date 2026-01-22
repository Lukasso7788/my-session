// src/pages/seo/OnlineCoworkingPage.tsx
import SeoPageTemplate from "./SeoPageTemplate";

export default function OnlineCoworkingPage() {
    return (
        <SeoPageTemplate
            pageTitle="Online coworking"
            h1="What is online coworking?"
            intro={[
                "Online coworking is working in a live virtual room with other people — typically on video — to replicate the focus, routine, and accountability of a shared workspace.",
                "Unlike meetings, online coworking is designed for doing your own tasks. The room provides presence and light structure, not discussion.",
                "Many formats use short intention-setting and timed focus blocks to keep momentum without constant talking.",
            ]}
            faq={[
                {
                    q: "Is online coworking always silent?",
                    a: "Often yes. Many rooms keep mics off by default so everyone can focus without noise.",
                },
                {
                    q: "Do I need to keep my camera on?",
                    a: "It’s recommended for the accountability effect, but different rooms may have different norms.",
                },
                {
                    q: "How is this different from a Zoom call with friends?",
                    a: "Online coworking is structured around working, not chatting — the goal is finishing tasks.",
                },
                {
                    q: "What should I prepare before joining?",
                    a: "A simple intention (one concrete task) and your next immediate action so you can start quickly.",
                },
                {
                    q: "Can I join anytime?",
                    a: "Some platforms offer scheduled sessions plus always-open rooms (24/7) so you can drop in on demand.",
                },
                {
                    q: "What if I get stuck mid-session?",
                    a: "A good flow includes a quick way to define the next step (e.g., notes, checklist, or an assistant) and continue.",
                },
            ]}
        />
    );
}
