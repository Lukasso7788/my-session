import { useState } from "react";
import { createRoot } from "react-dom/client";
import { CornerUpLeft, Smile, X, Mic, Send, MessageCircle } from "lucide-react";
import { ChatReplyDraft } from "../components/ChatReplyDraft";
import "./replyPreviewV2.css";

const messages = [
    { name: "Vaiga", avatar: "/images/landing/hero-card-avatar-sofia.png", time: "06:02 PM", text: "I'm going to revise all the experiments once again for now", reaction: "👍 1" },
    { name: "Rocky", avatar: "/images/landing/hero-card-avatar-alex.png", time: "06:11 PM", text: "Done with the first part, now doing the second section", reaction: "🙌 2" },
    { name: "Steve Sequeira", avatar: "/images/landing/hero-card-avatar-daniel.png", time: "06:15 PM", text: "Completed two topics", reaction: "" },
    { name: "Vaiga", avatar: "/images/landing/hero-card-avatar-sofia.png", time: "06:18 PM", text: "What are you working on today?", reaction: "❤️ 1" },
];
function PreviewChat({ dark = false }: { dark?: boolean }) {
    const [reply, setReply] = useState<typeof messages[number] | null>(messages[3]);
    return <section className={`draft-preview-panel${dark ? " draft-preview-panel--dark" : ""}`} aria-label={`${dark ? "Dark" : "Light"} chat preview`}>
        <header className="draft-preview-header"><MessageCircle size={15} fill="currentColor"/><strong>Chat</strong><span className="draft-preview-tab">All</span><span className="draft-preview-dms">DMs</span><button aria-label="Close chat preview"><X size={16}/></button></header>
        <div className="draft-preview-messages">
            {messages.map(message => <article key={message.time} className="draft-preview-message">
                <img className="draft-preview-avatar" src={message.avatar} alt=""/>
                <div className="draft-preview-message-body"><div className="draft-preview-meta"><span>{message.name}</span><time>{message.time}</time><button onClick={()=>setReply(message)} aria-label={`Reply to ${message.name}`}><CornerUpLeft size={13}/><span>Reply</span></button><Smile size={13}/></div><div className="draft-preview-bubble">{message.text}</div>{message.reaction && <div className="draft-preview-reaction">{message.reaction}</div>}</div>
            </article>)}
        </div>
        <footer className={`draft-preview-composer${reply ? " draft-preview-composer--reply" : ""}`}>
            {reply && <ChatReplyDraft author={reply.name} avatarUrl={reply.avatar} text={reply.text} dark={dark} onCancel={()=>setReply(null)}/>}
            <div className="draft-preview-input"><textarea aria-label={`${dark ? "Dark" : "Light"} message`} placeholder="Write a message…" rows={1}/><Mic size={16}/><Smile size={17}/><Send size={17}/></div>
            <p>Enter — send · Shift+Enter — new line</p>
        </footer>
    </section>;
}
function Preview(){return <main className="draft-preview-page"><div className="draft-preview-intro"><span>MySession · Local preview</span><h1>A quieter reply preview.</h1><p>Click Reply on any message, or × to cancel.</p></div><div className="draft-preview-layout"><div><h2>Light</h2><PreviewChat/></div><div><h2>Dark</h2><PreviewChat dark/></div></div></main>;}
createRoot(document.getElementById("reply-preview-root")!).render(<Preview/>);
