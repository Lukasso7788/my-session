import SeoPageTemplate from "./SeoPageTemplate";

export default function FaqPage() {
    return (
        <SeoPageTemplate
            pageTitle="FAQ"
            h1="Frequently asked questions about MySession"
            metaDescription="Answers to common questions about MySession, live coworking, body doubling, focus sessions, ADHD-friendly productivity, pricing, talking, cameras, and how sessions work."
            relatedLinks={[
                { label: "How MySession works", to: "/how-it-works" },
                { label: "Body doubling", to: "/body-doubling" },
                { label: "ADHD body doubling", to: "/adhd-body-doubling" },
                { label: "Group focus sessions", to: "/group-focus-sessions" },
                { label: "Online coworking", to: "/online-coworking" },
                { label: "Pricing", to: "/pricing" },
            ]}
            intro={[
                "MySession is a live coworking and body doubling platform for people who want to start work faster, stay focused, and finish more with less friction.",
                "You join a structured focus room, set your intention, work alongside others, and finish with a short recap or check-in.",
                "This FAQ explains how MySession works, who it is for, what session formats are available, and what to expect before joining your first session.",
            ]}
            sections={[
                {
                    h2: "Quick answer",
                    paragraphs: [
                        "MySession helps you get work done by combining live presence, body doubling, structured focus sessions, intentions, timers, and gentle accountability.",
                        "You do not need to be perfectly motivated before joining. The point is to enter a room, choose one task, and let the structure help you start.",
                    ],
                },
                {
                    h2: "Who MySession is for",
                    paragraphs: [
                        "MySession is built for people who work better around others, procrastinate when working alone, get distracted at home, or need a simple external structure to stay consistent.",
                    ],
                    bullets: [
                        "Students studying for exams, writing papers, or working through assignments.",
                        "Remote workers who miss the structure of an office or library.",
                        "Freelancers, founders, creators, designers, developers, and builders.",
                        "People with ADHD-style focus challenges, procrastination, or task initiation friction.",
                        "Introverts who want quiet accountability without heavy social pressure.",
                    ],
                },
                {
                    h2: "What happens in a session",
                    paragraphs: [
                        "A typical MySession session is simple: you join a room, set an intention, work during a focus block, then check in or recap what you completed.",
                        "The goal is not to socialize all the time. The goal is to create a calm, structured environment where starting and staying focused becomes easier.",
                    ],
                    bullets: [
                        "Join a group session, 24/7 room, or smaller buddy format.",
                        "Set one clear intention for what you want to do.",
                        "Work quietly during a Pomodoro, deep work block, or custom sprint.",
                        "Check in or recap after the block.",
                        "Leave with visible progress and a clearer next step.",
                    ],
                },
                {
                    h2: "Session formats available",
                    paragraphs: [
                        "MySession supports multiple session formats so you can choose the structure that fits your day.",
                    ],
                    bullets: [
                        "Group sessions for momentum and accountability.",
                        "24/7 rooms for spontaneous work sessions.",
                        "Buddy Tripling for a smaller, cozier accountability circle.",
                        "50/10 deep work sessions.",
                        "25/5 Pomodoro sessions.",
                        "Short custom sprints like 5, 10, or 15 minutes.",
                        "Screenshare-friendly and calmer focus formats.",
                    ],
                },
                {
                    h2: "Privacy, talking, and camera expectations",
                    paragraphs: [
                        "You do not need to perform or talk a lot. MySession is designed to make showing up easier, especially if you are shy, introverted, or just want quiet focus.",
                        "Some sessions use verbal check-ins because they can improve accountability, but text check-ins are also okay.",
                    ],
                },
                {
                    h2: "MySession vs normal video calls",
                    paragraphs: [
                        "MySession is not just a normal video call. Zoom and Discord are general communication tools; MySession is designed specifically for focus sessions and body doubling.",
                        "The difference is the structure: intentions, timers, session formats, focus blocks, check-ins, and recaps.",
                    ],
                    bullets: [
                        "Zoom is for meetings; MySession is for focused work.",
                        "Discord can be noisy; MySession is built around calmer work rooms.",
                        "Study-with-me videos are passive; MySession creates live accountability.",
                        "To-do lists help you plan; MySession helps you execute.",
                    ],
                },
            ]}
            secondaryCta={{ label: "Join a session", to: "/sessions" }}
            faq={[
                {
                    q: "What is MySession?",
                    a: "MySession is a live coworking and body doubling platform where you join structured focus rooms, set your intention, work alongside others, and finish more work with less friction.",
                },
                {
                    q: "What is body doubling?",
                    a: "Body doubling is a productivity method where you work alongside another person or group to make it easier to start tasks, stay focused, and keep going.",
                },
                {
                    q: "How does MySession work?",
                    a: "You join a live session, set one clear intention, work during a focus block, and then check in or recap what you completed.",
                },
                {
                    q: "Do I have to talk?",
                    a: "No. Talking is optional. MySession often uses verbal check-ins because they help with accountability, but text check-ins are also completely okay.",
                },
                {
                    q: "Do I need to keep my camera on?",
                    a: "Not always. Camera-on sessions can increase accountability for some people, but the main point is showing up, setting your intention, and working alongside others.",
                },
                {
                    q: "Is MySession good for ADHD?",
                    a: "Many ADHD and procrastination-prone users find body doubling helpful because it makes starting easier, adds gentle accountability, and helps them stay on task. MySession is not a medical treatment.",
                },
                {
                    q: "Can MySession help with procrastination?",
                    a: "Yes, for many people. The live room, timer, and accountability structure can reduce the friction of starting and make it easier to continue working.",
                },
                {
                    q: "Can I join anytime?",
                    a: "Yes. You can join scheduled sessions, drop into 24/7 rooms, or use smaller buddy formats depending on what fits your day.",
                },
                {
                    q: "What session formats are available?",
                    a: "MySession supports group sessions, 24/7 rooms, Buddy Tripling, 50/10 deep work, 25/5 Pomodoro, short custom sprints, and calmer screenshare-friendly sessions.",
                },
                {
                    q: "Is MySession only for work?",
                    a: "No. You can use MySession for studying, coding, writing, admin tasks, creative work, business building, planning, reading, or any task where live accountability helps.",
                },
                {
                    q: "Can I use MySession for studying?",
                    a: "Yes. Students can use MySession to study together online, prepare for exams, read, write, solve problems, and stay accountable during study blocks.",
                },
                {
                    q: "What if I am shy or introverted?",
                    a: "That is completely fine. You do not need to perform, talk a lot, or be highly social. You can simply show up, set your task, and work alongside others.",
                },
                {
                    q: "Do I need to download anything?",
                    a: "No. MySession is browser-based. Open the app, join a room, and start working.",
                },
                {
                    q: "Is MySession free to start?",
                    a: "Yes. You can start for free. Payments are optional right now, and free access limits may apply as attendance grows.",
                },
                {
                    q: "How is MySession different from Zoom or Discord?",
                    a: "Zoom and Discord are general communication tools. MySession is built specifically for structured focus sessions, with intentions, timers, check-ins, recaps, and calmer work rooms.",
                },
                {
                    q: "How is MySession different from study-with-me videos?",
                    a: "Study-with-me videos are passive. MySession gives you live presence, real people, session structure, and accountability.",
                },
                {
                    q: "What should I write as my intention?",
                    a: "Write one concrete next action, such as “finish the first draft,” “solve 10 problems,” “reply to 5 emails,” or “work on the pricing page for 25 minutes.”",
                },
                {
                    q: "Can I leave a session early?",
                    a: "Yes. You can leave when needed. The goal is to make starting and focusing easier, not to create pressure.",
                },
                {
                    q: "What is Buddy Tripling?",
                    a: "Buddy Tripling is a smaller focus format with around three people. It is personal enough to feel comfortable and structured enough to keep you accountable.",
                },
                {
                    q: "What are 24/7 rooms?",
                    a: "24/7 rooms are always-open focus spaces where you can drop in whenever you need a work room instead of waiting for a scheduled session.",
                },
            ]}
        />
    );
}