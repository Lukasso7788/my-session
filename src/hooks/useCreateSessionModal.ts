// src/hooks/useCreateSessionModal.ts
import { create } from "zustand";
import { createContext, useContext } from "react";

interface CreateSessionModalStore {
    isOpen: boolean;
    open: () => void;
    close: () => void;
    onCreated: () => void;
    setOnCreatedCallback: (fn: () => void) => void;
    onCreatedCallback?: () => void;
}

export const useCreateSessionModal = create<CreateSessionModalStore>((set) => ({
    isOpen: false,

    open: () => set({ isOpen: true }),
    close: () => set({ isOpen: false }),

    onCreatedCallback: undefined,

    onCreated: () =>
        set((state) => {
            state.onCreatedCallback?.();
            return {};
        }),

    setOnCreatedCallback: (fn) => set({ onCreatedCallback: fn }),
}));
