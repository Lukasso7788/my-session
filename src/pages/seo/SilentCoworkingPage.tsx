// src/pages/seo/SilentCoworkingPage.tsx
import SeoPageTemplate from "./SeoPageTemplate";

export default function SilentCoworkingPage() {
    return (
        <SeoPageTemplate
            pageTitle="Silent coworking"
            h1="What is silent coworking?"
            intro={[
                "Silent coworking is a live coworking format where people work together in the same virtual room with minimal talking.",
                "Most silent coworking sessions keep microphones off by default. The point is presence and focus — not conversation.",
                "A simple structure (intention → focus → recap) helps participants stay accountable without breaking concentration.",
            ]}
            faq={[
                {
                    q: "Is silent coworking awkward?",
                    a: "It can feel unusual at first, but many people quickly find it calming and effective for deep focus.",
                },
                {
                    q: "Do we ever speak?",
                    a: "Talking is usually optional. Some rooms allow a short intention and recap; others are fully silent.",
                },
                {
                    q: "What’s the main benefit?",
                    a: "Reduced distractions with real-time presence — it’s easier to start and keep going.",
                },
                {
                    q: "Do I need video on?",
                    a: "Often recommended for accountability, but policies vary by room.",
                },
                {
                    q: "What should I do if I need a break?",
                    a: "Take a quick break during the break block, or step away briefly and return to the next focus block.",
                },
                {
                    q: "Can silent coworking be 24/7?",
                    a: "Yes — some platforms offer always-open rooms so you can join any time.",
                },
            ]}
        />
    );
}
