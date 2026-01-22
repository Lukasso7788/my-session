// src/pages/seo/GroupFocusSessionsPage.tsx
import SeoPageTemplate from "./SeoPageTemplate";

export default function GroupFocusSessionsPage() {
    return (
        <SeoPageTemplate
            pageTitle="Group focus sessions"
            h1="What is group focus sessions?"
            intro={[
                "Group focus sessions are live coworking sessions with multiple participants working in parallel on their own tasks, using shared presence for accountability.",
                "They typically follow a light structure: set an intention, focus for timed blocks (Pomodoro, deep work, sprints), then do a quick recap.",
                "Compared to 1:1 formats, groups can be easier to join on-demand and often feel more energizing.",
            ]}
            faq={[
                {
                    q: "How big are group focus sessions?",
                    a: "They can range from 3 people to larger rooms. Smaller groups feel cozier; larger rooms can feel more energetic.",
                },
                {
                    q: "Do we work on the same task together?",
                    a: "Usually no — everyone works on their own tasks. The shared room provides accountability and momentum.",
                },
                {
                    q: "What are common timing formats?",
                    a: "Pomodoro-style (25/5), deep work blocks (50/10), or short sprints (15/3), depending on the room.",
                },
                {
                    q: "What happens at the start of a session?",
                    a: "You set a concrete intention: what you will complete during the next block.",
                },
                {
                    q: "What happens at the end?",
                    a: "A recap: what you finished, what’s next, and what you’ll do after the session.",
                },
                {
                    q: "Is it okay to join late?",
                    a: "Depends on the room. Many formats allow joining mid-block; the main goal is to start working quickly.",
                },
            ]}
        />
    );
}
