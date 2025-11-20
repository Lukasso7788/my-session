import { createContext, useContext, useState, ReactNode } from "react";
import { CreateSessionModal } from "../components/CreateSessionModal";

interface Ctx {
    isOpen: boolean;
    open: () => void;
    close: () => void;
    onCreatedCallback: () => void;
    setOnCreatedCallback: (cb: () => void) => void;
}

const CreateSessionModalContext = createContext<Ctx | null>(null);

export function CreateSessionModalProvider({ children }: { children: ReactNode }) {
    const [isOpen, setIsOpen] = useState(false);
    const [onCreatedCallback, setOnCreatedCallback] = useState(() => () => { });

    const open = () => setIsOpen(true);
    const close = () => setIsOpen(false);

    return (
        <CreateSessionModalContext.Provider
            value={{
                isOpen,
                open,
                close,
                onCreatedCallback,
                setOnCreatedCallback,
            }}
        >
            {children}

            <CreateSessionModal
                isOpen={isOpen}
                onClose={close}
                onSessionCreated={onCreatedCallback}
            />
        </CreateSessionModalContext.Provider>
    );
}

export function useCreateSessionModal() {
    const ctx = useContext(CreateSessionModalContext);
    if (!ctx) throw new Error("useCreateSessionModal must be used inside CreateSessionModalProvider");
    return ctx;
}
