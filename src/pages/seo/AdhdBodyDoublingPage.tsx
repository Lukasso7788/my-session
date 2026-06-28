import SeoPageTemplate from "./SeoPageTemplate";

export default function AdhdBodyDoublingPage() {
    return (
        <SeoPageTemplate
            pageTitle="ADHD body doubling"
            h1="ADHD body doubling sessions online"
            metaDescription="ADHD body doubling is a structured way to work alongside other people online so starting tasks, staying engaged, and returning to focus can feel easier. MySession offers live focus sessions with intentions, timers, and recaps."
            relatedLinks={[
                { label: "Body doubling", to: "/body-doubling" },
                { label: "ADHD productivity", to: "/adhd-productivity" },
                { label: "Group focus sessions", to: "/group-focus-sessions" },
                { label: "Online coworking", to: "/online-coworking" },
            ]}
            intro={[
                "ADHD body doubling is a productivity format where you work alongside another person or group to make it easier to start, stay present, and keep momentum.",
                "The goal is not supervision or pressure. The goal is live presence, simple structure, and a clear work loop that makes it harder to drift away from the task.",
                "For many people with ADHD-style focus challenges, the hardest part is not knowing what to do — it is starting, staying with it, and returning after distraction.",
                "MySession uses online body doubling with intentions, focus blocks, check-ins, and recaps to make focused work feel more concrete and repeatable.",
            ]}
            sections={[
                {
                    h2: "How ADHD body doubling works",
                    paragraphs: [
                        "A simple ADHD-friendly body doubling session usually starts with one specific intention: what you will work on during the next focus block.",
                        "Then everyone works quietly during a timed block. At the end, you recap what happened and choose the next step.",
                    ],
                    bullets: [
                        "Join a live session instead of trying to start alone.",
                        "Set one concrete intention before the timer starts.",
                        "Work quietly alongside others.",
                        "Use the session structure to return after distractions.",
                        "Recap what you completed and what comes next.",
                    ],
                },
                {
                    h2: "Why body doubling can help with ADHD-style procrastination",
                    paragraphs: [
                        "Body doubling can reduce the emotional friction of starting because you are no longer entering the task alone.",
                        "The live room creates a light accountability signal: other people are also working, the timer is running, and the session has a clear beginning and end.",
                    ],
                    bullets: [
                        "Less isolation during difficult tasks.",
                        "More structure than working alone.",
                        "A visible start point instead of an endless vague plan.",
                        "A simple way to restart after getting distracted.",
                    ],
                },
                {
                    h2: "What makes MySession ADHD-friendly",
                    paragraphs: [
                        "MySession is designed around simple, repeated focus loops instead of noisy chat or complicated productivity systems.",
                        "The structure is intentionally lightweight: intention, focus, check-in, recap.",
                    ],
                    bullets: [
                        "Live focus sessions with real people.",
                        "Silent coworking by default.",
                        "Intentions before work starts.",
                        "Timers and session stages.",
                        "Recaps to close the loop.",
                        "Groups that reduce scheduling friction.",
                    ],
                },
                {
                    h2: "Important note",
                    paragraphs: [
                        "MySession is not a medical treatment and does not diagnose or treat ADHD.",
                        "It is a productivity and accountability format that some people with ADHD or ADHD-style focus challenges may find supportive.",
                    ],
                },
            ]}
            secondaryCta={{ label: "Try a focus session", to: "/sessions" }}
            faq={[
                {
                    q: "What is ADHD body doubling?",
                    a: "ADHD body doubling is working alongside another person or group to make it easier to start tasks, stay engaged, and keep momentum.",
                },
                {
                    q: "Does body doubling treat ADHD?",
                    a: "No. Body doubling is not a medical treatment. It is a productivity and accountability method that some people with ADHD-style focus challenges find helpful.",
                },
                {
                    q: "Can body doubling help with procrastination?",
                    a: "For many people, yes. The live presence and session structure can reduce the friction of starting and make it easier to continue.",
                },
                {
                    q: "Do I need to talk during ADHD body doubling sessions?",
                    a: "Usually no. Many sessions are silent by default. The key structure is intention → focus → recap.",
                },
                {
                    q: "Is online body doubling enough, or does it need to be in person?",
                    a: "Online body doubling can work well when the session has live presence, a clear timer, and a simple accountability structure.",
                },
                {
                    q: "How is MySession different from a normal video call?",
                    a: "MySession is built for focus sessions specifically, with intentions, timers, check-ins, recaps, and a calmer work environment.",
                },
            ]}
        />
    );
}