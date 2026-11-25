import { CornerUpLeft, X } from "lucide-react";
import { defaultAvatarUrl } from "../lib/defaultAvatar";
import "./chatReplyDraft.css";

/** Local proposal; intentionally not wired into ChatPanel until reviewed. */
export function ChatReplyDraft({ author, text, avatarUrl, dark = false, onCancel }: {
    author: string;
    text: string;
    avatarUrl?: string;
    dark?: boolean;
    onCancel: () => void;
}) {
    return (
        <div className={`chat-reply-draft${dark ? " chat-reply-draft--dark" : ""}`} role="group" aria-label={`Replying to ${author}`}>
            <CornerUpLeft className="chat-reply-draft__reply-icon" size={14} strokeWidth={1.8} aria-hidden="true" />
            <img className="chat-reply-draft__avatar" src={avatarUrl || defaultAvatarUrl(author, author, dark ? "dark" : "light")} alt={`Avatar of ${author}`} title={author} />
            <strong className="chat-reply-draft__author" title={author}>{author}</strong>
            <span className="chat-reply-draft__separator" aria-hidden="true">·</span>
            <p className="chat-reply-draft__excerpt" title={`${author}: ${text}`}>{text}</p>
            <button className="chat-reply-draft__cancel" type="button" onClick={onCancel} aria-label="Cancel reply" title="Cancel reply">
                <X size={14} strokeWidth={1.8} aria-hidden="true" />
            </button>
        </div>
    );
}
