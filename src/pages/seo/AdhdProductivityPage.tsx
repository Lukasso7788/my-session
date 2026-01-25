// src/pages/seo/AdhdProductivityPage.tsx
import SeoPageTemplate from "./SeoPageTemplate";

export default function AdhdProductivityPage() {
    return (
        <SeoPageTemplate
            pageTitle="ADHD productivity"
            h1="What is ADHD productivity?"
            metaDescription="ADHD productivity usually refers to practical strategies and environments that reduce friction to start, maintain focus, and finish tasks. Many people report that body doubling, silent coworking, and structured focus sessions can be supportive. This page is not medical advice."
            relatedLinks={[
                { label: "Body doubling", to: "/body-doubling" },
                { label: "Silent coworking", to: "/silent-coworking" },
                { label: "Online coworking", to: "/online-coworking" },
                { label: "AI assistant", to: "/ai-assistant" },
            ]}
            intro={[
                "“ADHD productivity” usually means practical ways to make work easier when starting, staying engaged, or finishing tasks feels unusually hard.",
                "People use this phrase to look for strategies that reduce friction (starting), reduce drift (staying on task), and create closure (finishing).",
                "Some people with ADHD report that body doubling (working alongside someone), silent coworking, and structured focus sessions can feel supportive because they add presence and structure without requiring motivation first.",
                "This page is not medical advice. It’s a practical overview of productivity formats that some people find helpful.",
            ]}
            sections={[
                {
                    h2: "What people usually mean by “ADHD productivity”",
                    paragraphs: [
                        "In practice, people often mean: “How do I reliably start and finish tasks when my attention and motivation are inconsistent?”",
                        "A useful framing is to focus on environments and constraints (containers) rather than relying on willpower.",
                    ],
                    bullets: [
                        "Lower the cost of starting (clear next action, low setup).",
                        "Reduce distraction and task-switching (simpler environment).",
                        "Create external structure (timers, sessions, accountability).",
                        "Build closure (recap, next step) so tasks don’t stay mentally open.",
                    ],
                },
                {
                    h2: "Why body doubling and coworking can feel supportive",
                    paragraphs: [
                        "Some people report that live presence changes the “activation energy” of work: it becomes easier to begin and less likely to drift.",
                        "This can happen even when sessions are silent — the effect is often about presence and structure, not conversation.",
                    ],
                    bullets: [
                        "Presence reduces the temptation to disappear into distractions.",
                        "A session creates a clear “start line” and “end line.”",
                        "Timers reduce decision fatigue (you don’t renegotiate work every 2 minutes).",
                        "A recap makes progress visible and defines the next action.",
                    ],
                },
                {
                    h2: "Practical formats people try",
                    paragraphs: [
                        "Different people respond to different structures. The goal is to find a format you can repeat consistently — not the perfect one.",
                    ],
                    bullets: [
                        "Silent coworking: mic off by default; calm focus with live presence.",
                        "Pomodoro-style blocks: 25–50 minutes focus, short breaks.",
                        "Deep work blocks: longer sessions when you have momentum.",
                        "Small groups (e.g., 3 people): cozy accountability without pressure.",
                        "Always-open rooms: reduce friction when you need a focus container “right now.”",
                    ],
                },
                {
                    h2: "Common misconceptions",
                    bullets: [
                        "“If it helps, it’s a cure.” — No. These are productivity supports, not treatment.",
                        "“You must be motivated first.” — Many formats aim to make starting easier even without motivation.",
                        "“Talking helps.” — For many people, silence works better. Conversation can derail focus.",
                        "“One method works for everyone.” — Try formats and keep what is repeatable for you.",
                    ],
                },
                {
                    h2: "How MySession can fit into this",
                    paragraphs: [
                        "MySession is a platform for live online body doubling and group focus sessions — with silent-by-default rooms and structured formats (intention → focus blocks → recap).",
                        "If you get stuck mid-session, you can optionally use a real-time AI assistant (screenshare included) to decide the next step without leaving the focus container.",
                    ],
                    bullets: [
                        "Silent coworking rooms to reduce distraction and social overhead.",
                        "Group focus sessions with clear structure and closure.",
                        "24/7 rooms to remove scheduling friction (join anytime).",
                        "Buddy Tripling (3 people) for a small, supportive accountability circle.",
                        "Optional AI assistant for fast unblocking and “what next?” guidance.",
                    ],
                },
            ]}
            secondaryCta={{ label: "See AI assistant", to: "/ai-assistant" }}
            faq={[
                {
                    q: "Is this page medical advice?",
                    a: "No. This page discusses productivity formats and environments that some people find helpful. If you need medical guidance, talk to a qualified professional.",
                },
                {
                    q: "Is body doubling good for ADHD?",
                    a: "Some people with ADHD report that body doubling helps them start and stay engaged. It’s not a guaranteed solution — it’s a productivity format worth trying.",
                },
                {
                    q: "Do online coworking sessions need to be social?",
                    a: "No. Many people prefer silent coworking: mic off by default, minimal check-in, then quiet focus blocks and a recap.",
                },
                {
                    q: "What’s the simplest format to try?",
                    a: "Try one session with a single concrete intention, one focus block, and a recap. Keep it small and repeatable.",
                },
                {
                    q: "Do I need the camera on for body doubling?",
                    a: "Video often strengthens the presence effect, but room policies vary. The key is live presence and a low-distraction structure.",
                },
                {
                    q: "What if I get stuck mid-session?",
                    a: "Many people use a short “unblock” step: define the next smallest action, or ask for help. On MySession you can optionally use a real-time AI assistant (including screenshare) to decide the next step without leaving the session.",
                },
                {
                    q: "Will group sessions be distracting?",
                    a: "They can be if they aren’t structured. Silent-by-default sessions with timers and a recap tend to stay focused.",
                },
                {
                    q: "How do I know if this works for me?",
                    a: "Treat it like an experiment: try 3–5 sessions, track whether you start faster and finish more, then keep the format that’s repeatable.",
                },
            ]}
        />
    );
}
