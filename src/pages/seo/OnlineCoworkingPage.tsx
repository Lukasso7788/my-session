// src/pages/seo/OnlineCoworkingPage.tsx
import SeoPageTemplate from "./SeoPageTemplate";

export default function OnlineCoworkingPage() {
    return (
        <SeoPageTemplate
            pageTitle="Online coworking"
            h1="What is online coworking?"
            metaDescription="Online coworking is working alongside other people remotely (often on video) to improve focus and accountability. It’s commonly run as silent coworking sessions with a simple structure: intention → focus blocks → recap."
            relatedLinks={[
                { label: "Body doubling", to: "/body-doubling" },
                { label: "Group focus sessions", to: "/group-focus-sessions" },
                { label: "Silent coworking", to: "/silent-coworking" },
                { label: "AI assistant", to: "/ai-assistant" },
                { label: "ADHD productivity", to: "/adhd-productivity" },
            ]}
            intro={[
                "Online coworking is a way to work alongside other people remotely — often in live video-based rooms — to make it easier to start and stay on task.",
                "It’s not a meeting and not collaboration by default. The point is shared presence: you work on your own tasks, quietly, while others do the same.",
                "Many online coworking sessions are silent coworking (mic off by default) and use a lightweight structure: intention → focus blocks → recap.",
                "Online coworking overlaps with body doubling: live presence acts as a simple accountability signal that reduces procrastination friction and helps you keep momentum.",
            ]}
            sections={[
                {
                    h2: "How online coworking works in practice",
                    paragraphs: [
                        "A typical online coworking session is a predictable focus container. You join, commit to a small intention, work through timed blocks, and leave with closure.",
                        "The simplest working version is: intention → focus block(s) → recap. Most people don’t need discussion — they need a clean structure and live presence.",
                    ],
                    bullets: [
                        "Join a room (scheduled session or always-open room).",
                        "State a short intention (the next action you can actually do).",
                        "Work quietly during timed focus blocks (Pomodoro / deep work / sprints).",
                        "Recap: what you finished + what’s next.",
                    ],
                },
                {
                    h2: "Why online coworking helps people focus",
                    paragraphs: [
                        "Online coworking works when it reduces two common failure modes: not starting, and drifting once you start.",
                        "Live presence makes it harder to “disappear into distractions,” and structure reduces decision fatigue.",
                    ],
                    bullets: [
                        "Lower friction to start: a session creates a clear start line.",
                        "Less drifting: presence makes distraction loops less likely.",
                        "More momentum: timers create rhythm and small wins.",
                        "More closure: recaps turn progress into something real.",
                    ],
                },
                {
                    h2: "Online coworking vs similar concepts",
                    paragraphs: [
                        "People use different words for similar things. Here’s how they usually map in practice.",
                    ],
                    bullets: [
                        "Online coworking: remote “work together” presence (often video).",
                        "Virtual coworking sessions: another common name for online coworking.",
                        "Body doubling: the mechanism — presence reduces friction to start/stay on task.",
                        "Group focus sessions: a structured type of online coworking optimized for execution.",
                        "Silent coworking: a format where mic is off by default to reduce distraction.",
                    ],
                },
                {
                    h2: "Who online coworking is useful for",
                    paragraphs: [
                        "Online coworking is most useful when you can do the work, but your consistency suffers when you work alone.",
                    ],
                    bullets: [
                        "Remote workers who want execution time on the calendar.",
                        "Founders and builders who need momentum and follow-through.",
                        "Students who want silent study with live accountability.",
                        "People who procrastinate, drift, or context-switch too much.",
                    ],
                },
                {
                    h2: "Common misconceptions about online coworking",
                    bullets: [
                        "“It’s a meeting.” — No. The default is quiet work, not discussion.",
                        "“You must talk.” — No. Talking is optional; silence is common.",
                        "“It’s just a Discord call.” — A good session adds structure and closure, not only a call link.",
                        "“It’s only for extroverts.” — Silent-by-default formats often work well for introverts.",
                    ],
                },
                {
                    h2: "How MySession uses online coworking",
                    paragraphs: [
                        "MySession is a platform for live online body doubling and group focus sessions. Online coworking is the category — structured focus sessions are the core product.",
                        "You can join group sessions, drop into always-open rooms (24/7), or use small circles like Buddy Tripling (3 people).",
                        "If you get stuck mid-session, MySession also offers an optional real-time AI assistant (screenshare included) to unblock the next step without leaving the focus container.",
                    ],
                    bullets: [
                        "Silent-by-default rooms designed for focus.",
                        "Structured formats: Pomodoro, deep work, short sprints.",
                        "24/7 rooms to join anytime (low scheduling friction).",
                        "Small groups (e.g., 3 people) for cozy accountability.",
                        "Optional AI assistant for “what next?” and fast unblocking (including screenshare).",
                    ],
                },
            ]}
            secondaryCta={{ label: "Join a focus session", to: "/sessions" }}
            faq={[
                {
                    q: "What is online coworking in simple terms?",
                    a: "It’s working alongside other people remotely (often on video) to improve focus and accountability — you work on your own tasks, usually quietly.",
                },
                {
                    q: "Is online coworking the same as body doubling?",
                    a: "They overlap. Body doubling is the mechanism (presence helps you start and stay on task). Online coworking is the format (remote coworking rooms/sessions).",
                },
                {
                    q: "Are online coworking sessions silent?",
                    a: "Many are. Silent coworking (mic off by default) is common because it reduces distraction and keeps the session work-first.",
                },
                {
                    q: "Do I need to talk during online coworking?",
                    a: "No. Talking is usually optional. A simple intention at the start and a recap at the end is often enough.",
                },
                {
                    q: "Do I need the camera on?",
                    a: "Video often strengthens the presence effect, but policies vary by room. The key is consistent live presence and low-distraction structure.",
                },
                {
                    q: "Does online coworking actually work?",
                    a: "For many people, yes. Live presence plus a simple structure can reduce procrastination friction and help maintain momentum.",
                },
                {
                    q: "Is online coworking good for ADHD?",
                    a: "Some people with ADHD report it helps them start and stay engaged. This is not medical advice — it’s a productivity format that some people find supportive.",
                },
                {
                    q: "How is MySession different from a normal coworking call?",
                    a: "MySession is built for execution: silent-by-default sessions, intentions, timed focus blocks, recaps — plus an optional real-time AI assistant that can unblock you mid-session (including via screenshare).",
                },
                {
                    q: "How do I try online coworking right now?",
                    a: "Join a live session, set one concrete intention, start the first focus block immediately, then recap what you finished and what’s next.",
                },
            ]}
        />
    );
}
