// src/pages/seo/AiAssistantPage.tsx
import SeoPageTemplate from "./SeoPageTemplate";

export default function AiAssistantPage() {
    return (
        <SeoPageTemplate
            pageTitle="Real-time AI assistant"
            h1="What is a real-time AI assistant?"
            metaDescription="A real-time AI assistant helps you keep momentum while you work by turning “what should I do next?” into a concrete next step. In MySession it’s integrated into focus sessions and can optionally use screenshare context so you don’t leave the focus container."
            relatedLinks={[
                { label: "Body doubling", to: "/body-doubling" },
                { label: "Online coworking", to: "/online-coworking" },
                { label: "Group focus sessions", to: "/group-focus-sessions" },
                { label: "Silent coworking", to: "/silent-coworking" },
            ]}
            intro={[
                "A real-time AI assistant is an assistant designed to support you while you’re actively working — not before or after.",
                "Instead of giving generic advice, it helps you keep momentum by converting confusion into a concrete next step: “what should I do next?”, “why am I stuck?”, “what’s the smallest action right now?”",
                "In MySession, the AI assistant is integrated into the focus session workflow: intention → focus blocks → recap. The assistant is there to unblock you without breaking the session.",
                "Optionally, it can use screenshare context so it can see what you’re looking at and guide you through the next action without you having to explain everything from scratch.",
            ]}
            sections={[
                {
                    h2: "What problem a real-time AI assistant solves",
                    paragraphs: [
                        "Most people don’t fail because they lack motivation — they fail because they get stuck, drift, or start context-switching.",
                        "A real-time AI assistant is designed to reduce those failure modes during execution.",
                    ],
                    bullets: [
                        "Unblocking: turn “I’m stuck” into a concrete next step.",
                        "Decision compression: reduce choices to one actionable option.",
                        "Momentum protection: avoid leaving the task to search, scroll, or ask elsewhere.",
                        "Clarity under load: simplify when the task feels messy or overwhelming.",
                    ],
                },
                {
                    h2: "How it works in practice",
                    paragraphs: [
                        "The assistant is most useful when you ask short, execution-level questions — not long theory questions.",
                        "The output should be an action you can do in 1–5 minutes, then a second action, then a checkpoint.",
                    ],
                    bullets: [
                        "You set an intention (what you want to finish).",
                        "You start a focus block.",
                        "If you get stuck, you ask the assistant: “What’s the next step?”",
                        "You execute the smallest next action immediately.",
                        "You continue the block and recap what changed.",
                    ],
                },
                {
                    h2: "Screenshare context (optional)",
                    paragraphs: [
                        "Screenshare context is an optional mode where the assistant can use what’s on your screen to give more precise guidance.",
                        "This is useful when describing the situation would take longer than doing the next step.",
                    ],
                    bullets: [
                        "Debugging and setup (“which setting do I change here?”).",
                        "Learning workflows (“what do I click next?”).",
                        "Writing and editing (“what should this paragraph become?”).",
                        "Productivity rescue (“I’m drifting — what’s the smallest next action?”).",
                    ],
                },
                {
                    h2: "Real-time AI assistant vs “just ChatGPT”",
                    paragraphs: [
                        "The difference is not the model name. The difference is the workflow.",
                        "A real-time assistant is integrated into execution, optimized for next actions, and designed to avoid context-switching.",
                    ],
                    bullets: [
                        "Inside the loop: used during focus blocks, not outside them.",
                        "Action-first outputs: concrete next steps, not long essays.",
                        "Optional screenshare context: less explaining, faster unblocking.",
                        "Momentum-preserving: you don’t leave the focus container.",
                    ],
                },
                {
                    h2: "How MySession uses a real-time AI assistant",
                    paragraphs: [
                        "MySession is a platform for live online body doubling and group focus sessions. The AI assistant is a second pillar that amplifies the core product: structured focus sessions.",
                        "You can use it for planning and breakdown, but the strongest use case is mid-session unblocking: when you’re stuck and need the next action now.",
                    ],
                    bullets: [
                        "Unblock mid-session without leaving the room.",
                        "Turn vague intentions into next actions.",
                        "Keep the session structure (intention → focus → recap) intact.",
                        "Optional screenshare guidance when text explanation is too slow.",
                    ],
                },
                {
                    h2: "Good prompts to use during a focus session",
                    paragraphs: [
                        "If you want the assistant to be useful during execution, keep requests small and concrete.",
                    ],
                    bullets: [
                        "“Give me the next smallest action to start this task in 2 minutes.”",
                        "“I’m stuck — list 3 possible next steps and pick the best one.”",
                        "“Rewrite this into a clean checklist I can execute right now.”",
                        "“Based on what you see on my screen: what do I click/change next?”",
                        "“I’m drifting — give me a 5-minute rescue plan to regain momentum.”",
                    ],
                },
            ]}
            secondaryCta={{ label: "Join a focus session", to: "/sessions" }}
            faq={[
                {
                    q: "What is a real-time AI assistant in simple terms?",
                    a: "It’s an assistant designed to help while you’re working by turning “what next?” into a concrete action you can do immediately — so you keep momentum.",
                },
                {
                    q: "Is this different from using ChatGPT in a separate tab?",
                    a: "Yes in workflow. A real-time assistant is integrated into the focus session loop and optimized for next steps and momentum, so you don’t break focus by context-switching.",
                },
                {
                    q: "Do I have to use screenshare?",
                    a: "No. Screenshare is optional. It’s useful when explaining the situation would take longer than doing the next step.",
                },
                {
                    q: "What kinds of tasks does it help with?",
                    a: "Anything where you get stuck: deciding next step, breaking down a task, debugging, learning a workflow, writing/editing, and “focus rescue” when you start drifting.",
                },
                {
                    q: "Will it do the work for me?",
                    a: "It’s designed to guide and unblock, not to replace execution. The goal is to help you take the next action and continue your session.",
                },
                {
                    q: "Is it always accurate?",
                    a: "No. Like any AI, it can be wrong. Treat it as guidance: verify important steps, especially for high-stakes actions.",
                },
                {
                    q: "How do I get the most value from it?",
                    a: "Ask for small, actionable outputs: the next smallest action, 3 options and a recommendation, or a short checklist you can execute immediately.",
                },
                {
                    q: "How does this connect to MySession’s main product?",
                    a: "MySession’s core is structured focus sessions (body doubling / online coworking). The AI assistant is the second pillar that helps you keep momentum when you get stuck — without leaving the focus container.",
                },
            ]}
        />
    );
}
