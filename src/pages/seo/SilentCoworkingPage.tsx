// src/pages/seo/SilentCoworkingPage.tsx
import SeoPageTemplate from "./SeoPageTemplate";

export default function SilentCoworkingPage() {
    return (
        <SeoPageTemplate
            pageTitle="Silent coworking"
            h1="What is silent coworking?"
            metaDescription="Silent coworking is an online coworking format where people work together quietly (mic off by default), often on video, to increase focus and accountability. A typical flow is intention → focus blocks → recap."
            relatedLinks={[
                { label: "Body doubling", to: "/body-doubling" },
                { label: "Online coworking", to: "/online-coworking" },
                { label: "Group focus sessions", to: "/group-focus-sessions" },
                { label: "ADHD productivity", to: "/adhd-productivity" },
            ]}
            intro={[
                "Silent coworking is an online coworking format where people work alongside each other quietly — typically with microphones off by default — to reduce distraction and increase follow-through.",
                "It’s not a meeting and not a social call. The goal is to create a calm, predictable focus container where you can start faster and drift less.",
                "Silent coworking often overlaps with body doubling: live presence + minimal structure makes it easier to stay on task without needing motivation first.",
                "A common session backbone is simple: intention → focus blocks → recap. You don’t need to talk — you just need to show up and work.",
            ]}
            sections={[
                {
                    h2: "How silent coworking works in practice",
                    paragraphs: [
                        "Silent coworking removes the biggest enemy of focus sessions: accidental conversation. With mic off by default, the environment stays “work-first.”",
                        "Most sessions follow the same rhythm: set a simple intention, work quietly during timed focus blocks, then recap what you finished and the next step.",
                    ],
                    bullets: [
                        "Join a live room (group, small circle, or always-open room).",
                        "Set one concrete intention (the next action you can start immediately).",
                        "Work silently during a timed focus block (Pomodoro / deep work / sprints).",
                        "Recap: what’s done + what you’ll do next.",
                    ],
                },
                {
                    h2: "Why silence helps focus",
                    paragraphs: [
                        "Silence reduces cognitive load: you don’t need to monitor conversation, decide when to speak, or manage social context.",
                        "With fewer interruptions, it’s easier to enter flow and maintain momentum — especially when the task is boring or emotionally “sticky.”",
                    ],
                    bullets: [
                        "Lower distraction: less chance of derailment into chat.",
                        "Lower performance pressure: you’re not “on stage.”",
                        "More consistent rhythm: timers + quiet makes the session predictable.",
                        "Better follow-through: presence remains, but friction stays low.",
                    ],
                },
                {
                    h2: "Who silent coworking is useful for",
                    paragraphs: [
                        "Silent coworking is useful when you want accountability and presence — but you don’t want social energy, small talk, or interruptions.",
                    ],
                    bullets: [
                        "People who get distracted easily by conversation.",
                        "Remote workers who want a calm focus container.",
                        "Students who want quiet study with live presence.",
                        "Anyone who procrastinates alone but dislikes social calls.",
                    ],
                },
                {
                    h2: "Common misconceptions about silent coworking",
                    bullets: [
                        "“Silent means awkward.” — Not if the session has a simple structure and clear purpose.",
                        "“You must keep camera on.” — Video often strengthens presence, but policies vary by room.",
                        "“It’s only for studying.” — It works for any solo work: coding, writing, admin, building.",
                        "“You can’t ask for help.” — You can; just keep the default silent and use help intentionally.",
                    ],
                },
                {
                    h2: "Silent coworking vs alternatives",
                    bullets: [
                        "Silent coworking vs normal coworking calls: less chatter, more execution.",
                        "Silent coworking vs solo Pomodoro: timers help, but live presence increases follow-through.",
                        "Silent coworking vs ambient videos: videos are passive; live sessions create real accountability.",
                        "Silent coworking vs public cafés: cafés can be noisy; silent rooms are designed to stay calm.",
                    ],
                },
                {
                    h2: "How MySession uses silent coworking",
                    paragraphs: [
                        "MySession is built around silent-by-default focus sessions: you join, set an intention, work through timed blocks, then recap.",
                        "The product goal is simple: reduce friction to start, reduce drifting once you start, and leave with a concrete next step.",
                    ],
                    bullets: [
                        "Silent group sessions with structured formats (Pomodoro / deep work / sprints).",
                        "24/7 rooms to join anytime without scheduling friction.",
                        "Buddy Tripling (3 people) for a cozy, calm accountability circle.",
                        "Clear closure: a recap that locks in progress and the next step.",
                    ],
                },
            ]}
            secondaryCta={{ label: "Join a focus session", to: "/sessions" }}
            faq={[
                {
                    q: "What does “silent coworking” mean?",
                    a: "It means people work together quietly in a live session — usually mic off by default — to reduce distraction and increase accountability.",
                },
                {
                    q: "Do I need to talk during silent coworking?",
                    a: "No. Talking is optional. Most sessions use a simple structure: intention → focus blocks → recap.",
                },
                {
                    q: "Is silent coworking awkward?",
                    a: "It can be if there’s no structure. With a simple intention and a timer, it feels natural: everyone is there to work.",
                },
                {
                    q: "Do I need the camera on?",
                    a: "Often yes, because video strengthens the presence effect. But policies vary by room — the key is consistent live presence and low distraction.",
                },
                {
                    q: "How long should a silent coworking session be?",
                    a: "Common formats are 25–50 minute focus blocks (Pomodoro-like) or longer deep work blocks. Choose what you can consistently complete.",
                },
                {
                    q: "Is silent coworking the same as body doubling?",
                    a: "It overlaps. Silent coworking is a format; body doubling is a mechanism. Silent rooms often work because body doubling reduces friction to start and stay on task.",
                },
                {
                    q: "Can I join silent coworking anytime?",
                    a: "On MySession, yes — you can join scheduled sessions or use always-open rooms (24/7) when you need a focus container right now.",
                },
                {
                    q: "How is MySession different from a quiet Zoom room?",
                    a: "MySession sessions are built for execution: intentions, timed blocks, and recaps — not just a quiet call link.",
                },
            ]}
        />
    );
}
