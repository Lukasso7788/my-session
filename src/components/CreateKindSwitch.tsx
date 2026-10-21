// Admin switch between creating a scheduled group session and a 24/7
// (Infinite) room. The two live in different dialogs: the Create session modal
// (global) and the Infinite room creator on the Sessions page. Choosing the
// other kind closes this dialog and opens the other one.

export const OPEN_INFINITE_ROOM_CREATOR_EVENT = "mysession:open-infinite-room-creator";
const PENDING_KEY = "mysession:open-infinite-room-creator";

/** Opens the Infinite room creator; navigates to /sessions first if needed. */
export function requestInfiniteRoomCreator(navigate: (to: string) => void, pathname: string) {
  if (pathname === "/sessions") {
    window.dispatchEvent(new Event(OPEN_INFINITE_ROOM_CREATOR_EVENT));
    return;
  }
  try {
    sessionStorage.setItem(PENDING_KEY, "1");
  } catch {
    // Storage blocked: the page still opens; the creator just stays closed.
  }
  navigate("/sessions#infinite-rooms");
}

/** True once if another page asked the Sessions page to open the creator. */
export function takePendingInfiniteRoomCreator(): boolean {
  try {
    if (sessionStorage.getItem(PENDING_KEY) !== "1") return false;
    sessionStorage.removeItem(PENDING_KEY);
    return true;
  } catch {
    return false;
  }
}

export default function CreateKindSwitch({
  value,
  onChange,
  className = "",
}: {
  value: "group" | "infinite";
  onChange: (value: "group" | "infinite") => void;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label="What to create" className={`inline-flex rounded-full bg-[#F1F1F1] p-1 font-inter ${className}`}>
      {([
        ["group", "Group session"],
        ["infinite", "24/7 room"],
      ] as const).map(([key, label]) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={value === key}
          onClick={() => {
            if (value !== key) onChange(key);
          }}
          className={`rounded-full px-4 py-2 text-[13px] font-semibold transition ${value === key ? "bg-[#2F2F2F] text-white" : "text-[#555] hover:text-[#2F2F2F]"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
