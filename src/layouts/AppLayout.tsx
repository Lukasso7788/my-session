// src/layout/AppLayout.tsx
import { Outlet } from "react-router-dom";
import Footer from "../components/Footer";

// ⚠️ Подставь свой реальный Header (если он глобальный)
import Header from "../components/Header";

export default function AppLayout() {
    return (
        <div className="min-h-screen bg-white">
            <Header />
            <Outlet />
            <Footer />
        </div>
    );
}
