import React from "react";

export type UpdateItem = {
    date: string;      // "2025-12-23"
    title: string;     // "Room stability improvements"
    tag?: string;      // "Room"
    bullets: string[];
};

export function UpdateCard({ item }: { item: UpdateItem }) {
    return (
        <div className="rounded-[28px] border border-black/10 bg-white p-6">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <div className="flex items-center gap-2">
                        <h3 className="text-[18px] font-semibold tracking-[-0.01em]">{item.title}</h3>
                        {item.tag ? (
                            <span className="rounded-full border border-black/10 bg-black/5 px-2 py-1 text-xs font-medium">
                                {item.tag}
                            </span>
                        ) : null}
                    </div>
                    <p className="mt-1 text-xs text-black/50">{item.date}</p>
                </div>
            </div>

            <ul className="mt-4 space-y-2 text-[15px] text-black/80">
                {item.bullets.map((b) => (
                    <li key={b} className="flex gap-2">
                        <span className="mt-[7px] h-1.5 w-1.5 rounded-full bg-black/60" />
                        <span>{b}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}
