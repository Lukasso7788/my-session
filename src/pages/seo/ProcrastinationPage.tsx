import SeoPageTemplate from "./SeoPageTemplate";

export default function ProcrastinationPage() {
    return (
        <SeoPageTemplate
            pageTitle="Stop procrastinating"
            h1="Stop procrastinating by joining a live focus session"
            metaDescription="If you keep procrastinating on solo work, MySession gives you a live room, a timer, intentions, and accountability so starting becomes easier."
            relatedLinks={[
                { label: "Body doubling", to: "/body-doubling" },
                { label: "ADHD body doubling", to: "/adhd-body-doubling" },
                { label: "Group focus sessions", to: "/group-focus-sessions" },
                { label: "Silent coworking", to: "/silent-coworking" },
            ]}
            intro={[
                "Procrastination often gets worse when work stays vague, private, and endlessly delayable.",
                "MySession helps by turning solo work into a live focus session with a clear start, a timer, and other people working alongside you.",
                "You do not need to feel perfectly motivated. You need a simple structure that makes starting easier.",
            ]}
            sections={[
                {
                    h2: "Why procrastination is easier when you are alone",
                    paragraphs: [
                        "When nobody sees the start, it is easy to delay the start. When the task is vague, it is easy to keep preparing instead of doing.",
                        "A live focus session gives the work a container: a start time, a shared rhythm, and a small commitment.",
                    ],
                    bullets: [
                        "The task becomes visible.",
                        "The timer creates a real start.",
                        "Other people working reduce the feeling of isolation.",
                        "The recap makes progress concrete.",
                    ],
                },
                {
                    h2: "How MySession helps you start",
                    paragraphs: [
                        "MySession does not require a complex productivity system. It focuses on the smallest useful action: show up, name the task, start the timer.",
                    ],
                    bullets: [
                        "Join a live session instead of waiting for motivation.",
                        "Pick one concrete next action.",
                        "Use the focus block to begin immediately.",
                        "Use the recap to close the loop.",
                    ],
                },
                {
                    h2: "Why this can work better than another to-do list",
                    paragraphs: [
                        "To-do lists help you plan. They do not always help you execute.",
                        "A live focus session adds presence and accountability to the plan, making the first action easier to take.",
                    ],
                    bullets: [
                        "Lists organize tasks.",
                        "Timers create urgency.",
                        "Live presence creates accountability.",
                        "Recaps create closure.",
                    ],
                },
            ]}
            secondaryCta={{ label: "Start a focus session", to: "/sessions" }}
            faq={[
                {
                    q: "Can body doubling help with procrastination?",
                    a: "For many people, yes. Working alongside others can make it easier to start and stay with a task.",
                },
                {
                    q: "What should I do if I cannot start working?",
                    a: "Join a focus session, choose one tiny next action, set an intention, and start during the timer.",
                },
                {
                    q: "Do I need motivation before joining?",
                    a: "No. The point of the session is to help you start before motivation fully appears.",
                },
                {
                    q: "Is MySession a productivity app or a coworking app?",
                    a: "It is both: a live online coworking and body doubling platform built around structured focus sessions.",
                },
            ]}
        />
    );
}