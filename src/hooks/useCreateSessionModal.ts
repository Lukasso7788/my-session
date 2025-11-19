// src/hooks/useCreateSessionModal.ts
import { createContext, useContext, useState } from "react";

interface ModalContextType {
    isOpen: boolean;
    open: () => void;
    close: () => void;
}

const CreateSessionModalContext = createContext<ModalContextType | null>(null);

export function CreateSessionModalProvider({ children }: { children: React.ReactNode }) {
    const [isOpen, setIsOpen] = useState(false);

    const value: ModalContextType = {
        isOpen,
        open: () => setIsOpen(true),
        close: () => setIsOpen(false),
    };

    return (
        <CreateSessionModalContext.Provider value= { value } >
        { children }
        </CreateSessionModalContext.Provider>
  );
}

export function useCreateSessionModal() {
    const ctx = useContext(CreateSessionModalContext);
    if (!ctx) {
        throw new Error("useCreateSessionModal must be used inside provider");
    }
    return ctx;
}
