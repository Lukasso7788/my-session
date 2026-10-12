import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { PreJoinDisclosure } from "./PreJoinMenus";

/** Lazy controls stay mounted for exit motion; closed content is inert. */
export function RoomSettingsDisclosure({ open, children, id }: { open: boolean; children: ReactNode; id?: string }) {
  const [hasOpened, setHasOpened] = useState(open);
  useEffect(() => { if (open) setHasOpened(true); }, [open]);
  return <PreJoinDisclosure open={open} id={id}>{open || hasOpened ? children : null}</PreJoinDisclosure>;
}
