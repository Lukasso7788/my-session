import SeoPageTemplate from "./SeoPageTemplate";

export default function HowItWorksPage() {
    return (
        <SeoPageTemplate
            pageTitle="How MySession works"
            h1="How MySession works"
            metaDescription="MySession helps you focus through live online body doubling sessions: join a room, set an intention, work during the timer, check in, and recap your progress."
            relatedLinks={[
                { label: "Body doubling", to: "/body-doubling" },
                { label: "Online coworking", to: "/online-coworking" },
                { label: "Group focus sessions", to: "/group-focus-sessions" },
                { label: "Silent coworking", to: "/silent-coworking" },
            ]}
            intro={[
                "MySession is a live online focus platform built around body doubling, quiet coworking, and simple accountability.",
                "Instead of trying to force yourself to work alone, you join a structured session with other people who are also there to focus.",
                "The core loop is intentionally simple: join, set an intention, focus, check in, and recap.",
                "This gives your work a clear start, a shared rhythm, and a concrete finish.",
            ]}
            sections={[
                {
                    h2: "Step 1: Join a live focus room",
                    paragraphs: [
                        "You start by joining a live room where other people are also preparing to work.",
                        "The room creates presence: you are no longer starting alone.",
                    ],
                },
                {
                    h2: "Step 2: Set your intention",
                    paragraphs: [
                        "Before the focus block starts, you choose one concrete task or next action.",
                        "A good intention is specific and small enough to begin immediately.",
                    ],
                    bullets: [
                        "Bad: “work on project.”",
                        "Better: “write the first draft of the pricing section.”",
                        "Bad: “study.”",
                        "Better: “solve 10 practice problems.”",
                    ],
                },
                {
                    h2: "Step 3: Work during the focus timer",
                    paragraphs: [
                        "During the focus block, the session is usually quiet. The goal is not conversation — the goal is work.",
                        "The timer gives the session a clear container so you do not need to negotiate with yourself every minute.",
                    ],
                },
                {
                    h2: "Step 4: Check in and recap",
                    paragraphs: [
                        "After a focus block, you briefly check in and recap what you completed.",
                        "This turns the session from vague effort into visible progress.",
                    ],
                },
                {
                    h2: "Why this structure works",
                    paragraphs: [
                        "MySession combines live presence with a simple work loop. That makes it easier to start, easier to stay accountable, and easier to repeat the process.",
                    ],
                    bullets: [
                        "Presence reduces isolation.",
                        "Intentions reduce vagueness.",
                        "Timers create a clear start and finish.",
                        "Recaps make progress visible.",
                    ],
                },
            ]}
            secondaryCta={{ label: "Browse sessions", to: "/sessions" }}
            faq={[
                {
                    q: "What happens in a MySession focus session?",
                    a: "You join a room, set an intention, work during a timer, check in, and recap what you completed.",
                },
                {
                    q: "Do I need to talk?",
                    a: "Usually no. Many sessions are quiet by default. The important part is showing up and working alongside others.",
                },
                {
                    q: "Can I use MySession for work or study?",
                    a: "Yes. MySession can be used for work, studying, admin tasks, creative work, planning, and deep work.",
                },
                {
                    q: "How is MySession different from Zoom?",
                    a: "Zoom is a general meeting tool. MySession is built specifically for focus sessions with intentions, timers, check-ins, and recaps.",
                },
            ]}
        />
    );
}