import { createContext, useContext, useState, ReactNode } from "react";
import { CreateSessionModal } from "../components/CreateSessionModal";

interface Ctx {
    isOpen: boolean;
    open: () => void;
    close: () => void;
}

const CreateSessionModalContext = createContext<Ctx | null>(null);

export function CreateSessionModalProvider({ children }: { children: ReactNode }) {
    const [isOpen, setIsOpen] = useState(false);

    const open = () => setIsOpen(true);
    const close = () => setIsOpen(false);

    return (
        <CreateSessionModalContext.Provider value={{ isOpen, open, close }}>
            {children}

            {/* модалка рендерится глобально */}
            <CreateSessionModal isOpen={isOpen} onClose={close} />
        </CreateSessionModalContext.Provider>
    );
}

export function useCreateSessionModal() {
    const ctx = useContext(CreateSessionModalContext);
    if (!ctx) throw new Error("useCreateSessionModal must be used inside CreateSessionModalProvider");
    return ctx;
}
