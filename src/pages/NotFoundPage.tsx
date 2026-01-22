// src/pages/NotFoundPage.tsx
import { Link } from "react-router-dom";

export default function NotFoundPage() {
    return (
        <div className="min-h-[70vh] px-4 py-16">
            <div className="max-w-3xl mx-auto">
                <div className="text-sm text-black/50">404</div>
                <h1 className="mt-2 text-3xl md:text-4xl font-semibold text-[#111827]">
                    Page not found
                </h1>
                <p className="mt-4 text-[15px] leading-relaxed text-black/60">
                    This URL doesn’t exist (or was moved). Use the buttons below to get back.
                </p>

                <div className="mt-8 flex flex-col sm:flex-row gap-3">
                    <Link
                        to="/"
                        className="h-11 inline-flex items-center justify-center rounded-full px-6 text-[14px] font-semibold border border-[#111827] text-[#111827] hover:bg-[#111827] hover:text-white transition"
                    >
                        Go to home
                    </Link>
                    <Link
                        to="/sessions"
                        className="h-11 inline-flex items-center justify-center rounded-full px-6 text-[14px] font-semibold bg-[#111827] text-white hover:opacity-90 transition"
                    >
                        Join a session
                    </Link>
                </div>
            </div>
        </div>
    );
}
