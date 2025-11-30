// src/components/HeaderLite.tsx

import { useNavigate } from "react-router-dom";

export default function HeaderLite() {
    const navigate = useNavigate();

    return (
        <header className="border-b border-borderGray w-full bg-white">
            <div className="w-full max-w-6xl mx-auto px-8 py-5 flex justify-center">
                <button
                    onClick={() => navigate("/")}
                    className="text-[36px] font-extrabold leading-none hover:opacity-80 transition"
                >
                    MySession
                </button>
            </div>
        </header>
    );
}
