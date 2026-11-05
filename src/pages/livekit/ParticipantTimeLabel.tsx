import { memo, useSyncExternalStore } from "react";
import { participantClock } from "../../lib/participantClock";
import { formatLocalTime } from "../../lib/timezones";
import { shortPlaceName } from "../../lib/placeSearch";
import { getProfileLocationSnapshot, subscribeProfileLocations } from "../../lib/profileLocation";

// "Lukasheve · 4:12 PM": the settlement the person chose (if any) and their
// current local time. No zone name, and no place guessed from the timezone.
export const ParticipantTimeLabel = memo(function ParticipantTimeLabel({ timeZone, userId, className }: {
    timeZone: string; userId?: string | null; className: string;
}) {
    const at = useSyncExternalStore(participantClock.subscribe, participantClock.getSnapshot, participantClock.getSnapshot);
    const location = useSyncExternalStore(
        subscribeProfileLocations,
        () => getProfileLocationSnapshot(userId),
        () => null,
    );
    const time = formatLocalTime(timeZone, at);
    if (!time) return null;
    const place = shortPlaceName(location);
    return (
        <div className={className} title={location ? `${location} · local time` : "Local time"}>
            {place ? `${place} · ${time}` : time}
        </div>
    );
});
