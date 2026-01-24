// src/pages/seo/BodyDoublingPage.tsx
import SeoPageTemplate from "./SeoPageTemplate";

export default function BodyDoublingPage() {
    return (
        <SeoPageTemplate
            pageTitle="Body doubling"
            h1="What is body doubling?"
            intro={[
                "Body doubling is a productivity method where you work alongside another person (in-person or online) to make it easier to start and stay on task.",
                "The “double” doesn’t manage you — their live presence acts like a lightweight accountability signal. It reduces procrastination friction and helps you keep momentum without needing motivation first.",
                "Online body doubling usually happens in live video-based coworking sessions (often silent): you set a simple intention, work during one or more focus blocks, then do a quick recap.",
                "People also call this online coworking, silent coworking, accountability sessions, or virtual coworking sessions — the core idea is the same: presence + structure beats willpower.",
                "MySession is a platform for live online body doubling and group focus sessions — with an optional real-time AI assistant (screenshare included) to unblock the next step without leaving the focus container.",
            ]}
            faq={[
                {
                    q: "Do you need to talk during body doubling?",
                    a: "No. Many sessions are silent by default. The minimum structure is often: intention → focus → recap.",
                },
                {
                    q: "Does body doubling work online?",
                    a: "For many people, yes. Live presence + a simple session structure can recreate the “someone is here with me” effect — without socializing.",
                },
                {
                    q: "Is body doubling the same as coworking?",
                    a: "It overlaps, but body doubling is specifically about accountability and follow-through. Coworking can be social; body doubling is usually minimal and task-focused.",
                },
                {
                    q: "What’s a typical body doubling session format?",
                    a: "A quick intention (what you’ll do), one or more focus blocks (often Pomodoro or deep work), and a recap (what you finished + your next step).",
                },
                {
                    q: "Do you need the camera on?",
                    a: "Often yes, because the ‘presence’ effect is stronger with video. But some sessions can be camera-optional — the key is consistent live presence and low distraction.",
                },
                {
                    q: "What makes a body doubling session effective?",
                    a: "A specific, realistic next action, minimal distractions, a clear start time, and a recap that locks in closure and the next step.",
                },
                {
                    q: "Can groups work, or is it only 1:1?",
                    a: "Both can work. Group focus sessions add energy and reduce scheduling friction because there’s often a session running when you need one.",
                },
                {
                    q: "Is body doubling good for ADHD?",
                    a: "Some people with ADHD report that body doubling helps them start and stay engaged. This isn’t medical advice — it’s a productivity format that some find supportive.",
                },
                {
                    q: "How is MySession different from “just joining a call”?",
                    a: "MySession is built for focus: silent coworking defaults, intention → focus blocks → recap, and an optional real-time AI assistant that can help you decide the next step mid-session (including via screenshare).",
                },
                {
                    q: "How do I try body doubling right now?",
                    a: "Join a live focus session, write a simple intention, start your first focus block immediately, then recap what you finished. The fastest path is to join a session and start.",
                },
            ]}
        />
    );
}
