// src/pages/seo/OnlineCoworkingPage.tsx
import SeoPageTemplate from "./SeoPageTemplate";

export default function OnlineCoworkingPage() {
    return (
        <SeoPageTemplate
            pageTitle="Online coworking"
            h1="What is online coworking?"
            metaDescription="Online coworking is working alongside other people remotely (often on video) to improve focus, consistency, and accountability. Many online coworking sessions are silent and follow a simple structure: intention → focus blocks → recap."
            relatedLinks={[
                { label: "Body doubling", to: "/body-doubling" },
                { label: "Group focus sessions", to: "/group-focus-sessions" },
                { label: "Silent coworking", to: "/silent-coworking" },
                { label: "AI assistant", to: "/ai-assistant" },
            ]}
            intro={[
                "Online coworking is a productivity format where you work alongside other people remotely — usually in a live session — to make it easier to start, stay engaged, and finish tasks.",
                "Unlike a normal meeting, the goal is not discussion. The default is quiet work with a lightweight structure and a shared sense of presence.",
                "Many online coworking sessions are effectively online body doubling: you show up, state a simple intention, work through one or more focus blocks, then do a quick recap.",
                "People also call this virtual coworking sessions, silent coworking, accountability sessions, or focus sessions with video — the core mechanism is presence + structure.",
                "MySession is a platform for live online coworking and group focus sessions — with an optional real-time AI assistant (screenshare included) to unblock the next step without leaving the focus container.",
            ]}
            sections={[
                {
                    h2: "How online coworking works in practice",
                    paragraphs: [
                        "A good online coworking session feels like a “focus container”: you enter, set a direction, work quietly, then leave with closure.",
                        "The simplest loop is: intention → focus block → recap. Some sessions add a timer (Pomodoro) or a longer deep-work block.",
                    ],
                    bullets: [
                        "Join a live session (group or small circle).",
                        "Write or say one concrete intention (the next action, not a vague goal).",
                        "Work quietly during timed focus blocks (Pomodoro / deep work / sprints).",
                        "Recap: what you finished + the next step you’ll do after the session.",
                    ],
                },
                {
                    h2: "Who online coworking is useful for",
                    paragraphs: [
                        "Online coworking helps most when you can do the work — but struggle to start, to stay consistent, or to avoid distraction spirals.",
                    ],
                    bullets: [
                        "Remote workers who need structure and consistency without micromanagement.",
                        "Founders/builders who want accountability without meetings.",
                        "Students who want quiet study with real-time presence.",
                        "Anyone who benefits from a fixed time slot and “people are here too” momentum.",
                    ],
                },
                {
                    h2: "Common misconceptions about online coworking",
                    bullets: [
                        "“It’s just a Zoom call.” — No. The default is quiet work, not conversation.",
                        "“It’s only for extroverts.” — Many sessions are silent; you don’t need to socialize.",
                        "“It’s always 1:1.” — Groups often work better because sessions are easier to join and feel more alive.",
                        "“It will fix motivation.” — It’s not magic; it reduces friction and increases follow-through through structure.",
                    ],
                },
                {
                    h2: "Online coworking vs alternatives",
                    bullets: [
                        "Online coworking vs working alone: presence reduces friction and helps you stay on-task.",
                        "Online coworking vs study-with-me videos: videos are passive; live sessions create real accountability.",
                        "Online coworking vs Discord voice rooms: coworking sessions tend to be more structured and intention-driven.",
                        "Online coworking vs coworking cafés: cafés give ambience; live sessions give presence + a timed structure + a recap.",
                    ],
                },
                {
                    h2: "How MySession uses online coworking",
                    paragraphs: [
                        "MySession is designed around live online coworking that stays focused: silent-by-default rooms, simple intentions, timed blocks, and recaps.",
                        "If you get stuck mid-session, you can optionally use a real-time AI assistant (screenshare included) to decide the next step and keep momentum — without leaving the session.",
                    ],
                    bullets: [
                        "Group focus sessions (structured formats: Pomodoro / deep work / sprints).",
                        "24/7 rooms to reduce scheduling friction (join anytime).",
                        "Buddy Tripling (3 people) for a cozy high-accountability circle.",
                        "Optional AI assistant for fast unblocking and “what next?” guidance.",
                    ],
                },
            ]}
            secondaryCta={{ label: "See AI assistant", to: "/ai-assistant" }}
            faq={[
                {
                    q: "Is online coworking the same as body doubling?",
                    a: "Often yes. Online coworking is the broader category; body doubling is a common mechanism inside it: live presence that helps you start and stay on task.",
                },
                {
                    q: "Are online coworking sessions silent?",
                    a: "Many are. Silent coworking (mic off by default) is common because it minimizes distraction and keeps the session task-focused.",
                },
                {
                    q: "Do I need to talk during online coworking?",
                    a: "No. Talking is usually optional. The core structure is intention → focus blocks → recap.",
                },
                {
                    q: "Do I need the camera on?",
                    a: "Often yes, because the presence effect is stronger with video. But some rooms can be camera-optional — consistency matters more than perfection.",
                },
                {
                    q: "What’s the best session length?",
                    a: "Common formats are 25–50 minute focus blocks (Pomodoro-like) or longer deep-work blocks. Pick a length you can actually complete.",
                },
                {
                    q: "Is group online coworking better than 1:1?",
                    a: "It depends. Groups can add energy and reduce scheduling friction because it’s easier to find a session running when you need one.",
                },
                {
                    q: "How is MySession different from a normal meeting call?",
                    a: "MySession is built for focus: silent coworking defaults, intentions, timed focus blocks, recaps — plus an optional real-time AI assistant that can help you unblock mid-session (including via screenshare).",
                },
                {
                    q: "How do I try online coworking right now?",
                    a: "Join a live session, set one concrete intention, start the first focus block immediately, then recap what you finished and what’s next.",
                },
            ]}
        />
    );
}
