import { CornerUpLeft, X } from "lucide-react";
import "./chatReplyPreview.css";

export function ChatReplyPreview({ author, preview, isLight, onCancel }: {
    author: string;
    preview: string;
    isLight: boolean;
    onCancel: () => void;
}) {
    return (
        <div className={`ms-chat-reply-preview${isLight ? " ms-chat-reply-preview--light" : ""}`} role="group" aria-label={`Replying to ${author}`}>
            <div className="ms-chat-reply-preview__icon" aria-hidden="true"><CornerUpLeft size={16} strokeWidth={1.8} /></div>
            <div className="ms-chat-reply-preview__content">
                <div className="ms-chat-reply-preview__heading"><span>Replying to</span><strong title={author}>{author}</strong></div>
                <div className="ms-chat-reply-preview__text">{preview}</div>
            </div>
            <button type="button" onClick={onCancel} className="ms-chat-reply-preview__cancel" title="Cancel reply" aria-label="Cancel reply">
                <X size={15} strokeWidth={1.8} />
            </button>
        </div>
    );
}
