// src/context/CreateSessionModalContext.tsx
import { createContext, useContext, useState, ReactNode } from "react";
import { CreateSessionModal } from "../components/CreateSessionModal";

type CreateSessionModalContextType = {
    isOpen: boolean;
    open: () => void;
    close: () => void;
    onCreatedCallback: (() => void) | null;
    setOnCreatedCallback: (cb: () => void) => void;
};

const CreateSessionModalContext =
    createContext<CreateSessionModalContextType | null>(null);

export function CreateSessionModalProvider({ children }: { children: ReactNode }) {
    const [isOpen, setIsOpen] = useState(false);
    const [onCreatedCallback, setOnCreatedCallbackState] =
        useState<(() => void) | null>(null);

    const open = () => setIsOpen(true);
    const close = () => setIsOpen(false);

    const setOnCreatedCallback = (cb: () => void) => {
        setOnCreatedCallbackState(() => cb);
    };

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

            {/* ГЛОБАЛЬНАЯ модалка — рендерится один раз */}
            <CreateSessionModal
                isOpen={isOpen}
                onClose={close}
                onSessionCreated={onCreatedCallback || (() => { })}
            />
        </CreateSessionModalContext.Provider>
    );
}

export function useCreateSessionModal() {
    const ctx = useContext(CreateSessionModalContext);
    if (!ctx) {
        throw new Error(
            "useCreateSessionModal must be used inside CreateSessionModalProvider"
        );
    }
    return ctx;
}
