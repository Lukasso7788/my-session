// src/pages/seo/BodyDoublingPage.tsx
import SeoPageTemplate from "./SeoPageTemplate";

export default function BodyDoublingPage() {
    return (
        <SeoPageTemplate
            pageTitle="Body doubling"
            h1="What is body doubling?"
            metaDescription="Body doubling is working alongside another person (in-person or online) to make it easier to start and stay on task. Online body doubling often happens in silent video-based coworking sessions with a simple structure: intention → focus blocks → recap."
            relatedLinks={[
                { label: "Online coworking", to: "/online-coworking" },
                { label: "Group focus sessions", to: "/group-focus-sessions" },
                { label: "Silent coworking", to: "/silent-coworking" },
                { label: "ADHD productivity", to: "/adhd-productivity" },
            ]}
            intro={[
                "Body doubling is a productivity method where you work alongside another person (in-person or online) to make it easier to start and stay on task.",
                "The other person is not there to manage you — their live presence acts as a lightweight accountability signal that reduces procrastination friction and helps you keep momentum.",
                "Online body doubling usually happens in live video-based coworking sessions (often silent): you set a simple intention, work during one or more focus blocks, then do a quick recap.",
                "People also describe this as online coworking, silent coworking, accountability sessions, or virtual coworking sessions — the core idea is the same: presence + structure beats willpower.",
            ]}
            sections={[
                {
                    h2: "How body doubling works in practice",
                    paragraphs: [
                        "The simplest working loop is: choose a task → say what you’ll do (intention) → work quietly during a timed block → recap what you finished and what’s next.",
                        "The point is not conversation — the point is reducing the mental cost of starting and preventing “silent drift” into distractions.",
                    ],
                    bullets: [
                        "Intention: one concrete next action (not a vague goal).",
                        "Focus blocks: Pomodoro or deep work blocks with minimal switching.",
                        "Recap: what’s done + the next step you’ll do after the session.",
                    ],
                },
                {
                    h2: "Who body doubling is useful for",
                    paragraphs: [
                        "Body doubling is especially helpful when the hardest part is starting, staying engaged, or avoiding distraction spirals.",
                    ],
                    bullets: [
                        "People who procrastinate on solo work even when they know what to do.",
                        "Remote workers and builders who need a “container” for consistent deep work.",
                        "Students who want quiet study with live presence (not social).",
                        "Anyone who benefits from accountability without coaching or supervision.",
                    ],
                },
                {
                    h2: "Common misconceptions about body doubling",
                    bullets: [
                        "“You must talk.” — Most sessions are silent by default; talking is optional.",
                        "“It’s the same as a normal call.” — The difference is structure + accountability presence.",
                        "“It only works 1:1.” — Groups can work well and are often easier to join.",
                        "“It works for everyone.” — It’s a format; some people love it, others don’t. Try and see.",
                    ],
                },
                {
                    h2: "Body doubling vs alternatives",
                    bullets: [
                        "Body doubling vs to-do lists: lists help plan; presence helps execute.",
                        "Body doubling vs coworking café: a café gives ambience; a session gives live accountability + structure.",
                        "Body doubling vs “study with me” videos: videos are passive; live sessions create real-time presence.",
                        "Body doubling vs 1:1-only matching: groups reduce scheduling friction because sessions can be always available.",
                    ],
                },
                {
                    h2: "How MySession uses body doubling",
                    paragraphs: [
                        "MySession is built around live online body doubling and group focus sessions: silent coworking by default, simple intentions, focus blocks, and recaps.",
                        "The product goal is simple: reduce friction to start, increase follow-through, and make focused work repeatable.",
                    ],
                    bullets: [
                        "Group focus sessions for energy + momentum.",
                        "24/7 rooms to reduce scheduling friction (join anytime).",
                        "Buddy Tripling (3 people) for a cozy, high-accountability small group.",
                        "Fast join + minimal UI so you stay in the work loop.",
                    ],
                },
            ]}
            secondaryCta={{ label: "Browse sessions", to: "/sessions" }}
            faq={[
                {
                    q: "Do you need to talk during body doubling?",
                    a: "No. Many sessions are silent by default. The minimum structure is usually: intention → focus → recap.",
                },
                {
                    q: "Is body doubling the same as coworking?",
                    a: "It overlaps, but body doubling is specifically about accountability and follow-through. Coworking can be social; body doubling is usually minimal and task-focused.",
                },
                {
                    q: "Does body doubling work online?",
                    a: "For many people, yes — live presence plus a simple structure can recreate the “someone is here with me” effect.",
                },
                {
                    q: "What’s a typical body doubling session format?",
                    a: "A short intention (what you’ll do), one or more focus blocks, then a recap (what you finished and the next step).",
                },
                {
                    q: "Do I need the camera on?",
                    a: "Often yes, because the presence effect is stronger with video. But some sessions can be camera-optional — the key is consistent live presence and low distraction.",
                },
                {
                    q: "Can groups work, or is it only 1:1?",
                    a: "Both work. Groups add energy and reduce scheduling friction because there’s often a session running when you need one.",
                },
                {
                    q: "Is body doubling good for ADHD?",
                    a: "Some people with ADHD report that body doubling helps them start and stay engaged. This isn’t medical advice — it’s a productivity format that some find supportive.",
                },
                {
                    q: "How do I try body doubling right now?",
                    a: "Join a live focus session, write one concrete intention, start a focus block immediately, then recap what you finished.",
                },
            ]}
        />
    );
}
