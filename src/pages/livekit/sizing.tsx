import React, { useCallback, useEffect, useMemo, useState } from "react";

// ----------------------- SIZING -----------------------

export type MobileVideoLayoutMode = "auto" | "one" | "two" | "strip";

export function useElementSize<T extends HTMLElement>() {
    const [node, setNode] = useState<T | null>(null);
    const [size, setSize] = useState({ width: 0, height: 0 });

    const ref = useCallback((el: T | null) => {
        setNode(el);
    }, []);

    useEffect(() => {
        if (!node) return;

        let raf = 0;

        const updateNow = () => {
            const r = node.getBoundingClientRect();
            setSize({
                width: Math.round(r.width),
                height: Math.round(r.height),
            });
        };

        const update = () => {
            if (raf) window.cancelAnimationFrame(raf);
            raf = window.requestAnimationFrame(updateNow);
        };

        updateNow();

        const RO: any = (window as any).ResizeObserver;
        if (RO) {
            const ro = new RO(() => update());
            ro.observe(node);

            window.addEventListener("orientationchange", update);

            return () => {
                if (raf) window.cancelAnimationFrame(raf);
                ro.disconnect();
                window.removeEventListener("orientationchange", update);
            };
        }

        window.addEventListener("resize", update);
        window.addEventListener("orientationchange", update);

        return () => {
            if (raf) window.cancelAnimationFrame(raf);
            window.removeEventListener("resize", update);
            window.removeEventListener("orientationchange", update);
        };
    }, [node]);

    return { ref, width: size.width, height: size.height };
}

function isMobileLikeSize(width: number, height: number) {
    const minSide = Math.min(width || 0, height || 0);
    const maxSide = Math.max(width || 0, height || 0);

    return minSide > 0 && minSide <= 520 && maxSide <= 980;
}

function isTabletLikeSize(width: number, height: number) {
    const minSide = Math.min(width || 0, height || 0);
    const maxSide = Math.max(width || 0, height || 0);

    return minSide > 520 && minSide <= 1024 && maxSide <= 1400;
}

function isMobileOrTabletLikeSize(width: number, height: number) {
    return isMobileLikeSize(width, height) || isTabletLikeSize(width, height);
}

function isLandscape(width: number, height: number) {
    return width > height;
}

function normalizeMobileMode(mode?: MobileVideoLayoutMode): MobileVideoLayoutMode {
    if (mode === "one" || mode === "two" || mode === "strip") return mode;
    return "auto";
}

function computeCols(count: number, containerWidth: number, rightPanelOpen = false) {
    const w = containerWidth || 1200;
    const isDesktop = w >= 1024;
    const isWideDesktop = w >= 1500;
    const isUltraWideDesktop = w >= 1750;

    if (count <= 1) return 1;
    if (count === 2) return 2;
    if (count === 4) return 2;

    if (count === 3) {
        if (!isDesktop) return 2;
        return w >= 1500 ? 3 : 2;
    }

    if (count === 5) return w >= 900 ? 3 : 2;
    if (count === 6) return w >= 780 ? 3 : 2;

    if (count >= 7 && count <= 8) {
        if (w < 760) return 2;
        if (isDesktop && !rightPanelOpen) return 4;
        return 3;
    }

    if (count === 9) {
        if (w < 760) return 2;
        return 3;
    }

    if (count >= 10 && count <= 12) {
        if (!isDesktop) return 3;
        return 4;
    }

    if (count >= 13 && count <= 14) {
        if (!isDesktop) return 3;
        if (isUltraWideDesktop) return 5;
        return 4;
    }

    if (count >= 15 && count <= 16) {
        if (!isDesktop) return 3;
        if (isUltraWideDesktop) return 6;
        if (isWideDesktop) return 5;
        return 4;
    }

    if (count >= 17) {
        if (!isDesktop) return 3;
        if (isUltraWideDesktop) return 6;
        if (isWideDesktop) return 5;
        return 4;
    }

    return 3;
}

function computeMobileCols(count: number, width: number, height: number, mode?: MobileVideoLayoutMode) {
    const resolved = normalizeMobileMode(mode);

    if (resolved === "one") return 1;
    if (resolved === "two") return count <= 1 ? 1 : 2;

    const landscape = isLandscape(width, height);
    const tablet = isTabletLikeSize(width, height);

    if (count <= 1) return 1;
    if (count === 2) return landscape ? 2 : 1;

    // Important mobile/tablet rule:
    // 6 and 8 participants should be 2 columns, not 3 columns.
    // On Surface/iPad-like widths, 3 columns makes tiles too tiny and leaves a huge empty stage.
    if (tablet && !landscape) {
        if (count <= 10) return 2;
        return 3;
    }

    if (landscape) {
        if (count <= 4) return 2;
        if (count <= 8) return 2;
        return 3;
    }

    if (count <= 10) return 2;
    return 3;
}

function calcMaxGridWidthPx(params: {
    containerWidth: number;
    containerHeight: number;
    cols: number;
    rows: number;
    gapPx: number;
    paddingPx: number;
    aspectHOverW: number;
}) {
    const { containerWidth, containerHeight, cols, rows, gapPx, paddingPx, aspectHOverW } = params;

    if (!containerWidth || !containerHeight || !cols || !rows) return null;

    const availW = Math.max(0, containerWidth - paddingPx * 2);
    const availH = Math.max(0, containerHeight - paddingPx * 2);

    const byWidth = (availW - (cols - 1) * gapPx) / cols;
    const byHeight = (availH - (rows - 1) * gapPx) / (rows * aspectHOverW);

    const tileW = Math.max(0, Math.min(byWidth, byHeight));
    const gridW = cols * tileW + (cols - 1) * gapPx;

    return Math.min(availW, gridW);
}

export function GridLayoutSizing<T extends { id: string }>(props: {
    items: T[];
    containerWidth: number;
    containerHeight: number;
    forceThreeAsTwoPlusOne?: boolean;
    rightPanelOpen?: boolean;
    mobileMode?: MobileVideoLayoutMode;
    renderItem: (t: T, idx: number) => React.ReactNode;
}) {
    const {
        items,
        containerWidth,
        containerHeight,
        forceThreeAsTwoPlusOne,
        rightPanelOpen = false,
        mobileMode = "auto",
        renderItem,
    } = props;

    const mobileOrTablet = isMobileOrTabletLikeSize(containerWidth, containerHeight);
    const paddingPx = containerWidth && containerWidth < 520 ? 6 : 10;
    const gapPx = containerWidth && containerWidth < 520 ? 6 : 10;

    const cols = useMemo(() => {
        if (mobileOrTablet) return computeMobileCols(items.length, containerWidth, containerHeight, mobileMode);
        if (forceThreeAsTwoPlusOne && items.length === 3) return 2;
        return computeCols(items.length, containerWidth || 1200, rightPanelOpen);
    }, [mobileOrTablet, items.length, containerWidth, containerHeight, mobileMode, rightPanelOpen, forceThreeAsTwoPlusOne]);

    const rows = useMemo(() => Math.ceil(items.length / Math.max(1, cols)), [items.length, cols]);

    const maxGridWidth = useMemo(() => {
        return calcMaxGridWidthPx({
            containerWidth: containerWidth || 0,
            containerHeight: containerHeight || 0,
            cols,
            rows,
            gapPx,
            paddingPx,
            aspectHOverW: 9 / 16,
        });
    }, [containerWidth, containerHeight, cols, rows, gapPx, paddingPx]);

    const shouldCenterY = useMemo(() => {
        if (!containerWidth || !containerHeight) return false;

        const availW = Math.max(0, containerWidth - paddingPx * 2);
        const availH = Math.max(0, containerHeight - paddingPx * 2);

        if (availW <= 0 || availH <= 0) return false;

        const byWidth = (availW - (cols - 1) * gapPx) / cols;
        const byHeight = (availH - (rows - 1) * gapPx) / (rows * (9 / 16));

        const tileW = Math.max(0, Math.min(byWidth, byHeight));
        const tileH = tileW * (9 / 16);
        const gridH = rows * tileH + (rows - 1) * gapPx;

        return gridH > 0 && gridH <= availH - 4;
    }, [containerWidth, containerHeight, paddingPx, gapPx, cols, rows]);

    return (
        <div
            className={
                "w-full h-full min-h-0 overflow-y-auto flex justify-center " +
                (shouldCenterY ? "items-center" : "items-start")
            }
            style={{ padding: paddingPx }}
        >
            <div
                className="w-full grid"
                style={{
                    gap: gapPx,
                    maxWidth: maxGridWidth ? `${maxGridWidth}px` : undefined,
                    gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                    alignContent: shouldCenterY ? "center" : "start",
                }}
            >
                {items.map((t, i) => (
                    <React.Fragment key={t.id}>{renderItem(t, i)}</React.Fragment>
                ))}
            </div>
        </div>
    );
}

export function P2PLayoutSizing<T extends { id: string }>(props: {
    items: T[];
    containerWidth: number;
    containerHeight: number;
    stack?: boolean;
    renderItem: (t: T, idx: number) => React.ReactNode;
}) {
    const { items, containerWidth, containerHeight, stack = false, renderItem } = props;

    const paddingPx = containerWidth && containerWidth < 520 ? 6 : 10;
    const gapPx = containerWidth && containerWidth < 520 ? 6 : 10;

    const count = items.length;
    const mobile = isMobileLikeSize(containerWidth, containerHeight);
    const landscape = isLandscape(containerWidth, containerHeight);

    const cols = stack || (mobile && !landscape) ? 1 : count <= 1 ? 1 : 2;
    const rows = count <= 1 ? 1 : cols === 1 ? count : 1;

    const maxGridWidth = useMemo(() => {
        return calcMaxGridWidthPx({
            containerWidth: containerWidth || 0,
            containerHeight: containerHeight || 0,
            cols,
            rows,
            gapPx,
            paddingPx,
            aspectHOverW: 9 / 16,
        });
    }, [containerWidth, containerHeight, cols, rows, gapPx, paddingPx]);

    return (
        <div
            className="w-full h-full min-h-0 overflow-y-auto flex justify-center items-center"
            style={{ padding: paddingPx }}
        >
            <div
                className="w-full grid"
                style={{
                    gap: gapPx,
                    maxWidth: maxGridWidth ? `${maxGridWidth}px` : undefined,
                    gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                    alignContent: "center",
                }}
            >
                {items.map((t, idx) => (
                    <React.Fragment key={t.id}>{renderItem(t, idx)}</React.Fragment>
                ))}
            </div>
        </div>
    );
}

export function MobileFillLayoutSizing<T extends { id: string }>(props: {
    items: T[];
    containerWidth: number;
    containerHeight: number;
    paddingBottomPx?: number;
    mobileMode?: MobileVideoLayoutMode;
    renderItem: (t: T, idx: number) => React.ReactNode;
}) {
    const { items, containerWidth, containerHeight, paddingBottomPx = 12, mobileMode = "auto", renderItem } = props;

    const count = items.length || 1;
    const mode = normalizeMobileMode(mobileMode);
    const paddingPx = containerWidth && containerWidth < 520 ? 6 : 8;
    const gapPx = containerWidth && containerWidth < 520 ? 6 : 8;

    const landscape = isLandscape(containerWidth, containerHeight);

    if ((mode === "strip" || (mode === "auto" && landscape)) && count > 2) {
        return (
            <MobileHorizontalStripLayoutSizing
                items={items}
                containerWidth={containerWidth}
                containerHeight={containerHeight}
                paddingBottomPx={paddingBottomPx}
                renderItem={renderItem}
            />
        );
    }

    if (mode === "two" && count > 2) {
        return (
            <MobileStackLayoutSizing
                items={items}
                containerWidth={containerWidth}
                containerHeight={containerHeight}
                paddingBottomPx={paddingBottomPx}
                mode="two"
                renderItem={renderItem}
            />
        );
    }

    const availW = Math.max(0, (containerWidth || 0) - paddingPx * 2);
    const availH = Math.max(0, (containerHeight || 0) - paddingPx * 2 - paddingBottomPx - (count - 1) * gapPx);

    const tileH = availH > 0 ? availH / count : 0;
    const tileWByH = tileH > 0 ? tileH * (16 / 9) : 0;
    const maxTileW = Math.max(0, Math.min(availW || 0, tileWByH || availW || 0));

    return (
        <div
            className="w-full h-full min-h-0 flex flex-col justify-center overflow-y-auto"
            style={{
                padding: paddingPx,
                paddingBottom: paddingBottomPx,
                gap: gapPx,
            }}
        >
            {items.map((t, idx) => (
                <div key={t.id} className="w-full flex justify-center">
                    <div className="w-full" style={{ maxWidth: maxTileW ? `${maxTileW}px` : undefined }}>
                        {renderItem(t, idx)}
                    </div>
                </div>
            ))}
        </div>
    );
}

export function MobileStackLayoutSizing<T extends { id: string }>(props: {
    items: T[];
    containerWidth: number;
    containerHeight: number;
    paddingBottomPx?: number;
    mode?: MobileVideoLayoutMode;
    renderItem: (t: T, idx: number) => React.ReactNode;
}) {
    const {
        items,
        containerWidth,
        containerHeight,
        paddingBottomPx = 12,
        mode = "auto",
        renderItem,
    } = props;

    const count = items.length || 1;
    const resolvedMode = normalizeMobileMode(mode);
    const paddingPx = containerWidth && containerWidth < 520 ? 6 : 8;
    const gapPx = containerWidth && containerWidth < 520 ? 6 : 8;

    const landscape = isLandscape(containerWidth, containerHeight);

    if (resolvedMode === "strip" || (resolvedMode === "auto" && landscape && count > 2)) {
        return (
            <MobileHorizontalStripLayoutSizing
                items={items}
                containerWidth={containerWidth}
                containerHeight={containerHeight}
                paddingBottomPx={paddingBottomPx}
                renderItem={renderItem}
            />
        );
    }

    if (resolvedMode === "one") {
        return (
            <MobileOneColumnListLayoutSizing
                items={items}
                containerWidth={containerWidth}
                containerHeight={containerHeight}
                paddingBottomPx={paddingBottomPx}
                renderItem={renderItem}
            />
        );
    }

    const cols = computeMobileCols(count, containerWidth, containerHeight, resolvedMode);
    const rows = Math.ceil(count / cols);

    const maxGridWidth = calcMaxGridWidthPx({
        containerWidth: containerWidth || 0,
        containerHeight: containerHeight || 0,
        cols,
        rows,
        gapPx,
        paddingPx,
        aspectHOverW: 9 / 16,
    });

    return (
        <div
            className="w-full h-full min-h-0 overflow-y-auto flex justify-center items-center"
            style={{
                padding: paddingPx,
                paddingBottom: paddingBottomPx,
            }}
        >
            <div
                className="w-full grid"
                style={{
                    gap: gapPx,
                    maxWidth: maxGridWidth ? `${maxGridWidth}px` : undefined,
                    gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                    alignContent: "center",
                }}
            >
                {items.map((t, idx) => (
                    <React.Fragment key={t.id}>{renderItem(t, idx)}</React.Fragment>
                ))}
            </div>
        </div>
    );
}

export function MobileOneColumnListLayoutSizing<T extends { id: string }>(props: {
    items: T[];
    containerWidth: number;
    containerHeight: number;
    paddingBottomPx?: number;
    renderItem: (t: T, idx: number) => React.ReactNode;
}) {
    const { items, containerWidth, paddingBottomPx = 12, renderItem } = props;

    const paddingPx = containerWidth && containerWidth < 520 ? 6 : 8;
    const gapPx = 8;

    return (
        <div
            className="w-full h-full min-h-0 overflow-y-auto"
            style={{
                padding: paddingPx,
                paddingBottom: paddingBottomPx,
                WebkitOverflowScrolling: "touch",
            }}
        >
            <div className="w-full flex flex-col" style={{ gap: gapPx }}>
                {items.map((t, idx) => (
                    <div key={t.id} className="w-full shrink-0">
                        {renderItem(t, idx)}
                    </div>
                ))}
            </div>
        </div>
    );
}

export function MobileHorizontalStripLayoutSizing<T extends { id: string }>(props: {
    items: T[];
    containerWidth: number;
    containerHeight: number;
    paddingBottomPx?: number;
    renderItem: (t: T, idx: number) => React.ReactNode;
}) {
    const { items, containerWidth, containerHeight, paddingBottomPx = 12, renderItem } = props;

    const paddingPx = containerWidth && containerWidth < 520 ? 6 : 8;
    const gapPx = 8;

    const availH = Math.max(0, (containerHeight || 0) - paddingPx * 2 - paddingBottomPx);
    const tileW = Math.max(180, Math.min(360, availH > 0 ? availH * (16 / 9) : 240));

    return (
        <div
            className="w-full h-full min-h-0 overflow-x-auto overflow-y-hidden"
            style={{
                padding: paddingPx,
                paddingBottom: paddingBottomPx,
                scrollSnapType: "x mandatory",
                WebkitOverflowScrolling: "touch",
            }}
        >
            <div className="h-full flex items-center" style={{ gap: gapPx }}>
                {items.map((t, idx) => (
                    <div
                        key={t.id}
                        className="shrink-0"
                        style={{
                            width: tileW,
                            scrollSnapAlign: "center",
                        }}
                    >
                        {renderItem(t, idx)}
                    </div>
                ))}
            </div>
        </div>
    );
}

// ----------------------- /SIZING -----------------------
