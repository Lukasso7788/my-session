import { createContext, useContext, useState, ReactNode } from "react";
import { CreateSessionModal } from "../components/CreateSessionModal";

interface Ctx {
    isOpen: boolean;
    open: () => void;
    close: () => void;
    setOnCreatedCallback: (cb: () => void) => void;
}

const CreateSessionModalContext = createContext<Ctx | null>(null);

export function CreateSessionModalProvider({ children }: { children: ReactNode }) {
    const [isOpen, setIsOpen] = useState(false);
    const [onCreated, setOnCreated] = useState<() => void>(() => () => { });

    const open = () => setIsOpen(true);
    const close = () => setIsOpen(false);

    return (
        <CreateSessionModalContext.Provider
            value={{
                isOpen,
                open,
                close,
                setOnCreatedCallback: (cb) => setOnCreated(() => cb),
            }}
        >
            {children}
            <CreateSessionModal
                isOpen={isOpen}
                onClose={close}
                onSessionCreated={onCreated}
            />
        </CreateSessionModalContext.Provider>
    );
}

export function useCreateSessionModal() {
    const ctx = useContext(CreateSessionModalContext);
    if (!ctx) throw new Error("useCreateSessionModal must be used inside Provider");
    return ctx;
}
