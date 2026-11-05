import { memo, useSyncExternalStore } from "react";
import { participantClock } from "../../lib/participantClock";
import { formatLocalTimeInZone } from "../../lib/timezones";

// Only the person's local time and zone; the room never guesses a place from it.
export const ParticipantTimeLabel = memo(function ParticipantTimeLabel({ timeZone, className }: {
    timeZone: string; className: string;
}) {
    const at = useSyncExternalStore(participantClock.subscribe, participantClock.getSnapshot, participantClock.getSnapshot);
    const label = formatLocalTimeInZone(timeZone, at);
    if (!label) return null;
    return <div className={className} title={`Local time · ${timeZone.replace(/_/g, " ")}`}>{label}</div>;
});
