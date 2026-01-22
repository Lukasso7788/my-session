// src/pages/seo/BodyDoublingPage.tsx
import SeoPageTemplate from "./SeoPageTemplate";

export default function BodyDoublingPage() {
    return (
        <SeoPageTemplate
            pageTitle="Body doubling"
            h1="What is body doubling?"
            intro={[
                "Body doubling is a productivity method where you work alongside another person (in-person or online) to reduce friction to start and stay on task.",
                "The other person is not there to manage you — their presence acts as a simple accountability signal that helps you keep momentum and avoid drifting.",
                "Online body doubling usually happens in live video-based coworking sessions: you set an intention, work quietly, and do a quick recap.",
            ]}
            faq={[
                {
                    q: "Do you need to talk during body doubling?",
                    a: "No. Many sessions are silent by default. The minimum is usually: intention → focus → recap.",
                },
                {
                    q: "Is body doubling the same as coworking?",
                    a: "It’s a form of coworking focused on accountability and momentum, not socializing or collaboration.",
                },
                {
                    q: "Does body doubling work online?",
                    a: "For many people, yes — live presence plus a simple structure can recreate the “someone is here with me” effect.",
                },
                {
                    q: "What’s a typical body doubling session format?",
                    a: "A short intention (what you’ll do), one or more focus blocks, then a recap (what you finished / next step).",
                },
                {
                    q: "What makes a session effective?",
                    a: "Clear intention, minimal distractions, camera on for presence, and a realistic next action to start immediately.",
                },
                {
                    q: "Can groups work, or is it only 1:1?",
                    a: "Both work. Groups add energy and can reduce scheduling friction because there’s often a session running.",
                },
            ]}
        />
    );
}
