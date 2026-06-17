import { useEffect } from "react";

type AiHostStage = {
    name?: string;
    type?: string;
} | null;

type AiHostTile = {
    id: string;
    label?: string;
    isLocal?: boolean;
    participantUserId?: string;
    participantIdentity?: string;
};

type Props = {
    sessionId: string;
    currentUserId: string;
    currentUserName: string;
    tiles?: AiHostTile[];
    currentStage?: AiHostStage;
    chatTable?: string;
    theme?: string;
};

export default function AIHostedRoomController({
    sessionId,
    currentUserId,
    currentUserName,
    tiles = [],
    currentStage = null,
    chatTable = "session_chat_messages",
    theme = "dark",
}: Props) {
    useEffect(() => {
        console.log("[AI HOST] mounted", {
            sessionId,
            currentUserId,
            currentUserName,
            tilesCount: tiles.length,
            currentStage,
            chatTable,
            theme,
        });

        return () => {
            console.log("[AI HOST] unmounted", { sessionId });
        };
    }, [sessionId, currentUserId, currentUserName, tiles.length, currentStage, chatTable, theme]);

    return null;
}