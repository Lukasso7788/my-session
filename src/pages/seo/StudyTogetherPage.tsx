import SeoPageTemplate from "./SeoPageTemplate";

export default function StudyTogetherPage() {
    return (
        <SeoPageTemplate
            pageTitle="Study together online"
            h1="Study together online in live focus sessions"
            metaDescription="Study together online with live focus sessions, quiet coworking, intentions, timers, and recaps. MySession helps students and learners stay accountable without noisy group chats."
            relatedLinks={[
                { label: "Body doubling", to: "/body-doubling" },
                { label: "Group focus sessions", to: "/group-focus-sessions" },
                { label: "Silent coworking", to: "/silent-coworking" },
                { label: "Online coworking", to: "/online-coworking" },
            ]}
            intro={[
                "Studying alone can make it easy to procrastinate, drift into distractions, or keep waiting for the perfect moment to start.",
                "Studying together online gives you a shared room, a clear timer, and other people quietly working alongside you.",
                "MySession turns online study into structured focus sessions: set an intention, study during the block, then recap what you finished.",
                "It is not a noisy group chat. It is a calm study environment built around live presence and accountability.",
            ]}
            sections={[
                {
                    h2: "How online study sessions work",
                    paragraphs: [
                        "A study session starts with a simple intention: what subject, assignment, reading, or practice task you will work on.",
                        "Then the timer starts and everyone studies quietly. At the end, you recap what you completed and decide the next step.",
                    ],
                    bullets: [
                        "Join a live study room.",
                        "Write or say one study intention.",
                        "Study during a timed focus block.",
                        "Check in after the block.",
                        "Recap what you finished.",
                    ],
                },
                {
                    h2: "Who online study together sessions are useful for",
                    bullets: [
                        "Students who procrastinate before starting assignments.",
                        "Remote learners who miss the structure of a library or classroom.",
                        "People preparing for exams or certifications.",
                        "Anyone who studies better with quiet live accountability.",
                    ],
                },
                {
                    h2: "Study together vs study with me videos",
                    paragraphs: [
                        "Study with me videos can create atmosphere, but they are not live accountability.",
                        "In a live study session, other people are actually present, the timer is shared, and the recap creates a stronger completion loop.",
                    ],
                    bullets: [
                        "Videos are passive; live sessions create presence.",
                        "Videos do not know whether you started; sessions make starting explicit.",
                        "Videos do not recap; MySession closes the loop.",
                    ],
                },
                {
                    h2: "Why use MySession for studying",
                    paragraphs: [
                        "MySession is designed for focused work, not endless chatting.",
                        "The structure helps you start faster, stay with the task, and finish with a clearer sense of progress.",
                    ],
                    bullets: [
                        "Quiet study rooms.",
                        "Simple timers.",
                        "Intentions before studying.",
                        "Recaps after focus blocks.",
                        "Group energy without social pressure.",
                    ],
                },
            ]}
            secondaryCta={{ label: "Join a study session", to: "/sessions" }}
            faq={[
                {
                    q: "Can I use MySession to study online?",
                    a: "Yes. MySession can be used for online study sessions, exam preparation, reading, writing, assignments, and other focused learning tasks.",
                },
                {
                    q: "Do I need to talk during study sessions?",
                    a: "No. Many study sessions can be silent. The main structure is intention, focus block, and recap.",
                },
                {
                    q: "Is this like a study with me video?",
                    a: "It is similar in atmosphere, but stronger for accountability because the session is live and structured.",
                },
                {
                    q: "Can I join if I am not a student?",
                    a: "Yes. Study together sessions can also work for certifications, language learning, professional training, or self-study.",
                },
                {
                    q: "What should I write as my intention?",
                    a: "Use one concrete action, such as “read chapter 3,” “solve 10 problems,” or “write the first draft of my essay intro.”",
                },
            ]}
        />
    );
}