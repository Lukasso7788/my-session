// src/pages/seo/AdhdProductivityPage.tsx
import SeoPageTemplate from "./SeoPageTemplate";

export default function AdhdProductivityPage() {
    return (
        <SeoPageTemplate
            pageTitle="ADHD productivity"
            h1="What is ADHD productivity?"
            intro={[
                "“ADHD productivity” usually refers to practical, non-medical strategies people use to reduce friction and increase follow-through when attention and initiation feel hard.",
                "Common approaches focus on environment and structure: short timed blocks, clear next actions, external accountability (like body doubling), and reducing context switching.",
                "This is not medical advice. It’s a collection of productivity formats and habits that some people find supportive in everyday work.",
            ]}
            faq={[
                {
                    q: "Is this medical advice?",
                    a: "No. This page describes productivity formats and routines, not diagnosis or treatment.",
                },
                {
                    q: "Why do timed blocks help?",
                    a: "They reduce the “infinite task” feeling. A short block makes starting easier and gives a clear finish line.",
                },
                {
                    q: "What is body doubling in this context?",
                    a: "Working alongside others (in-person or online) to make starting and staying engaged easier through presence and accountability.",
                },
                {
                    q: "What’s the fastest way to start when I’m stuck?",
                    a: "Pick a 2-minute next action (open the doc, write the first line, outline 3 bullets) and start the timer.",
                },
                {
                    q: "How do I avoid perfectionism spirals?",
                    a: "Define “done” before you start (a small deliverable), and use short blocks to ship progress instead of waiting for perfect.",
                },
                {
                    q: "What if I lose focus mid-session?",
                    a: "Pause, write the next concrete step, remove one distraction, and re-enter with a shorter block (e.g., 10 minutes).",
                },
            ]}
        />
    );
}
