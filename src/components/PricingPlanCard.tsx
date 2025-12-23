import React from "react";

type Props = {
    title: string;
    price: string;
    subtitle?: string;
    highlights: string[];
    ctaLabel: string;
    ctaVariant?: "primary" | "secondary";
    badge?: string;
    footnote?: string;
    onCta?: () => void;
};

export function PricingPlanCard({
    title,
    price,
    subtitle,
    highlights,
    ctaLabel,
    ctaVariant = "primary",
    badge,
    footnote,
    onCta,
}: Props) {
    const isPrimary = ctaVariant === "primary";

    return (
        <div className="rounded-[28px] border border-black/10 bg-white p-6 shadow-[0_1px_0_rgba(0,0,0,0.02)]">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <div className="flex items-center gap-2">
                        <h3 className="text-[22px] font-semibold tracking-[-0.01em]">{title}</h3>
                        {badge ? (
                            <span className="rounded-full border border-black/10 bg-black/5 px-2 py-1 text-xs font-medium">
                                {badge}
                            </span>
                        ) : null}
                    </div>
                    {subtitle ? <p className="mt-1 text-sm text-black/60">{subtitle}</p> : null}
                </div>

                <div className="text-right">
                    <div className="text-[28px] font-semibold tracking-[-0.02em]">{price}</div>
                    <div className="text-xs text-black/50">USD</div>
                </div>
            </div>

            <ul className="mt-5 space-y-2 text-[15px] text-black/80">
                {highlights.map((h) => (
                    <li key={h} className="flex gap-2">
                        <span className="mt-[7px] h-1.5 w-1.5 rounded-full bg-black/60" />
                        <span>{h}</span>
                    </li>
                ))}
            </ul>

            <div className="mt-6 flex items-center justify-between gap-3">
                <button
                    onClick={onCta}
                    className={[
                        "h-10 rounded-full px-4 text-sm font-medium transition",
                        isPrimary
                            ? "bg-black text-white hover:bg-black/90"
                            : "border border-black/20 bg-white text-black hover:bg-black/5",
                    ].join(" ")}
                >
                    {ctaLabel}
                </button>

                {footnote ? <span className="text-xs text-black/50">{footnote}</span> : <span />}
            </div>
        </div>
    );
}
