// src/pages/seo/GroupFocusSessionsPage.tsx
import SeoPageTemplate from "./SeoPageTemplate";

export default function GroupFocusSessionsPage() {
    return (
        <SeoPageTemplate
            pageTitle="Group focus sessions"
            h1="What are group focus sessions?"
            metaDescription="Group focus sessions are live online coworking sessions where multiple people work quietly at the same time. They combine body doubling with a simple structure (intention → focus blocks → recap) to improve accountability and follow-through."
            relatedLinks={[
                { label: "Body doubling", to: "/body-doubling" },
                { label: "Online coworking", to: "/online-coworking" },
                { label: "Silent coworking", to: "/silent-coworking" },
                { label: "AI assistant", to: "/ai-assistant" },
            ]}
            intro={[
                "Group focus sessions are live online coworking sessions where multiple people work at the same time to increase accountability, momentum, and consistency.",
                "They’re not meetings. The goal is quiet execution: you show up, state a simple intention, work during timed focus blocks, then do a quick recap.",
                "This format is a practical version of online body doubling: the group’s live presence reduces procrastination friction and helps you stay on-task without needing willpower first.",
                "MySession runs group focus sessions as the core product — with an optional real-time AI assistant (screenshare included) to unblock the next step mid-session without leaving the focus container.",
            ]}
            sections={[
                {
                    h2: "How group focus sessions work in practice",
                    paragraphs: [
                        "A good group focus session is a “container” that makes the next hour predictable: you enter, commit to a small intention, work quietly, then leave with closure.",
                        "Most formats follow the same backbone: intention → focus blocks → recap. Timers create rhythm and reduce decision fatigue.",
                    ],
                    bullets: [
                        "Join a session that’s already running or starting soon.",
                        "Set one concrete intention (the next action you can actually complete).",
                        "Work quietly during one or more focus blocks (Pomodoro / deep work / sprints).",
                        "Recap: what you finished + what you’ll do next.",
                    ],
                },
                {
                    h2: "Why groups can work better than 1:1",
                    paragraphs: [
                        "1:1 matching is strong, but it has friction: scheduling, cancellations, and the effort to coordinate.",
                        "Groups reduce friction because a session can be available when you need it — and the shared presence can feel more energizing.",
                    ],
                    bullets: [
                        "Lower scheduling friction (more chances to join immediately).",
                        "More momentum and “social gravity” without socializing.",
                        "Less pressure: you’re not performing for one person.",
                        "Better for recurring habits (same time, same structure).",
                    ],
                },
                {
                    h2: "Who group focus sessions are useful for",
                    paragraphs: [
                        "Group focus sessions are useful when you can do the work — but struggle to start, to stay engaged, or to avoid distraction loops.",
                    ],
                    bullets: [
                        "Remote workers and founders who want execution time on the calendar.",
                        "Students who want silent study with live accountability.",
                        "People who procrastinate or drift when working alone.",
                        "Anyone who benefits from predictable structure and closure.",
                    ],
                },
                {
                    h2: "Common misconceptions about group focus sessions",
                    bullets: [
                        "“It’s a meeting.” — No. The default is quiet work, not discussion.",
                        "“You must talk or share details.” — No. Minimal check-in and recap is enough.",
                        "“Groups are distracting.” — Not if sessions are silent-by-default with clear structure.",
                        "“It only works if everyone has the same task.” — Tasks can be different; the container is shared.",
                    ],
                },
                {
                    h2: "Group focus sessions vs alternatives",
                    bullets: [
                        "Group focus sessions vs normal coworking calls: sessions are structured and optimized for execution, not conversation.",
                        "Group focus sessions vs study streams/videos: live presence gives real accountability, not passive ambience.",
                        "Group focus sessions vs solo Pomodoro: solo timers help, but group presence increases follow-through.",
                        "Group focus sessions vs 1:1 body doubling: 1:1 is intimate; groups reduce friction and add energy.",
                    ],
                },
                {
                    h2: "How MySession runs group focus sessions",
                    paragraphs: [
                        "MySession group sessions are designed to be silent coworking by default with clear structure: intention → timed focus blocks → recap.",
                        "If you get stuck mid-session, you can optionally use a real-time AI assistant (screenshare included) to decide the next step and keep momentum — without leaving the session.",
                    ],
                    bullets: [
                        "Structured formats: Pomodoro, deep work, short sprints.",
                        "Low friction: join scheduled sessions or use always-available rooms.",
                        "Clear closure: recap reinforces progress and the next step.",
                        "Optional AI assistant for fast unblocking and “what next?” guidance.",
                    ],
                },
            ]}
            secondaryCta={{ label: "See AI assistant", to: "/ai-assistant" }}
            faq={[
                {
                    q: "Are group focus sessions the same as online coworking?",
                    a: "Group focus sessions are a common form of online coworking. They emphasize structure and accountability: intention → focus blocks → recap.",
                },
                {
                    q: "Are group focus sessions silent?",
                    a: "Many are. Silent coworking (mic off by default) is common because it minimizes distraction and keeps the session task-focused.",
                },
                {
                    q: "Do I need to talk during a group focus session?",
                    a: "No. Talking is usually optional. The minimum is a simple intention at the start and a short recap at the end.",
                },
                {
                    q: "Is group focus better than 1:1 body doubling?",
                    a: "It depends. Groups reduce scheduling friction and can add energy. 1:1 can feel more personal. Many people use both depending on the day.",
                },
                {
                    q: "What’s a good format for group focus sessions?",
                    a: "Common formats are Pomodoro-style blocks (25–50 minutes) or longer deep-work blocks. The best format is the one you can consistently complete.",
                },
                {
                    q: "Can I join a group focus session anytime?",
                    a: "On MySession, yes — you can join scheduled sessions or use always-available rooms (24/7) when you need a focus container right now.",
                },
                {
                    q: "How is MySession different from a normal call?",
                    a: "MySession is built for focus: silent-by-default sessions, intentions, timed focus blocks, recaps — plus an optional real-time AI assistant that can help you unblock mid-session (including via screenshare).",
                },
                {
                    q: "How do I try a group focus session right now?",
                    a: "Join a live session, set one concrete intention, start the first focus block immediately, then recap what you finished and what’s next.",
                },
            ]}
        />
    );
}
