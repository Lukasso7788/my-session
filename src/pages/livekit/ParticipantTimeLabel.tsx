import { memo, useSyncExternalStore } from "react";
import { participantClock } from "../../lib/participantClock";
import { formatLocalTime, timeZoneCityName } from "../../lib/timezones";
import { shortPlaceName } from "../../lib/placeSearch";
import { getProfileLocationSnapshot, subscribeProfileLocations } from "../../lib/profileLocation";

// "Lukasheve · 4:12 PM": the settlement the person chose, or else the city of
// their timezone ("Berlin · 4:12 PM"), and their current local time. Fixed
// GMT offsets name no city, so those show the time alone.
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
    const place = shortPlaceName(location) || timeZoneCityName(timeZone);
    return (
        <div className={className} title={`${location || timeZone.replace(/_/g, " ")} · local time`}>
            {place ? `${place} · ${time}` : time}
        </div>
    );
});
