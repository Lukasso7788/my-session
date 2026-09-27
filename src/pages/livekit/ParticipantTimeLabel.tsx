import { memo, useSyncExternalStore } from "react";
import { participantClock } from "../../lib/participantClock";
import { formatTimeZoneCityLabel } from "../../lib/timezones";

export const ParticipantTimeLabel = memo(function ParticipantTimeLabel({ timeZone, className }: {
    timeZone: string; className: string;
}) {
    const at = useSyncExternalStore(participantClock.subscribe, participantClock.getSnapshot, participantClock.getSnapshot);
    try {
        const time = new Intl.DateTimeFormat(undefined, {
            timeZone, hour: "numeric", minute: "2-digit",
        }).format(new Date(at));
        return <div className={className} title={timeZone}>{formatTimeZoneCityLabel(timeZone)} · {time}</div>;
    } catch {
        return null;
    }
});
