import React, { useCallback, useEffect, useMemo, useState } from "react";

// ----------------------- SIZING (ported from VideoRoom, ONLY sizing) -----------------------
export function useElementSize<T extends HTMLElement>() {
    const [node, setNode] = useState<T | null>(null);
    const [size, setSize] = useState({ width: 0, height: 0 });

    const ref = useCallback((el: T | null) => {
        setNode(el);
    }, []);

    useEffect(() => {
        if (!node) return;

        const update = () => {
            const r = node.getBoundingClientRect();
            setSize({
                width: Math.round(r.width),
                height: Math.round(r.height),
            });
        };

        update();

        const RO: any = (window as any).ResizeObserver;
        if (RO) {
            const ro = new RO(() => update());
            ro.observe(node);
            return () => ro.disconnect();
        }

        window.addEventListener("resize", update);
        return () => window.removeEventListener("resize", update);
    }, [node]);

    return { ref, width: size.width, height: size.height };
}

function computeCols(count: number, containerWidth: number) {
    const w = containerWidth || 1200;
    const isDesktop = w >= 1024;

    if (count <= 1) return 1;
    if (count === 2) return 2;
    if (count === 4) return 2;

    if (count === 3) {
        if (!isDesktop) return 2;
        return w >= 1280 ? 3 : 2;
    }

    if (count === 5) return w >= 900 ? 3 : 2;
    if (count === 6) return w >= 780 ? 3 : 2;

    if (count >= 7 && count <= 9) {
        if (!isDesktop) return 2;
        return w >= 1380 ? 4 : 3;
    }

    if (count >= 10 && count <= 12) {
        if (!isDesktop) return 3;
        return w >= 1080 ? 4 : 3;
    }

    if (count >= 13) {
        if (!isDesktop) return 3;
        return w >= 1320 ? 5 : 4;
    }

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

    if (!containerWidth || !containerHeight) return null;

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
    renderItem: (t: T, idx: number) => React.ReactNode;
}) {
    const { items, containerWidth, containerHeight, forceThreeAsTwoPlusOne, renderItem } = props;

    const paddingPx = containerWidth && containerWidth < 520 ? 8 : 10;
    const gapPx = containerWidth && containerWidth < 520 ? 6 : 10;

    const cols = useMemo(() => {
        if (forceThreeAsTwoPlusOne && items.length === 3) return 2;
        return computeCols(items.length, containerWidth || 1200);
    }, [items.length, containerWidth, forceThreeAsTwoPlusOne]);

    const rows = useMemo(() => Math.ceil(items.length / cols), [items.length, cols]);

    const maxGridWidth = useMemo(() => {
        const w = calcMaxGridWidthPx({
            containerWidth: containerWidth || 0,
            containerHeight: containerHeight || 0,
            cols,
            rows,
            gapPx,
            paddingPx,
            aspectHOverW: 9 / 16,
        });
        return w;
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

    const count = items.length;
    const remainder = cols > 0 ? count % cols : 0;
    const fullCount = remainder === 0 ? count : count - remainder;

    const oneColWidth = `calc((100% - ${(cols - 1) * gapPx}px) / ${cols})`;

    const fullRows = items.slice(0, fullCount);
    const lastRow = items.slice(fullCount);

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
                {fullRows.map((t, i) => (
                    <React.Fragment key={t.id}>{renderItem(t, i)}</React.Fragment>
                ))}

                {lastRow.length > 0 && (
                    <div
                        className="col-span-full w-full flex justify-center"
                        style={{
                            gap: gapPx,
                            alignItems: shouldCenterY ? "center" : "flex-start",
                        }}
                    >
                        {lastRow.map((t, i) => (
                            <div key={t.id} className="shrink-0" style={{ width: oneColWidth }}>
                                {renderItem(t, fullCount + i)}
                            </div>
                        ))}
                    </div>
                )}
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

    const paddingPx = containerWidth && containerWidth < 520 ? 8 : 10;
    const gapPx = containerWidth && containerWidth < 520 ? 6 : 10;

    const count = items.length;

    const cols = stack ? 1 : count <= 1 ? 1 : 2;
    const rows = count <= 1 ? 1 : stack ? 2 : 1;

    const maxGridWidth = useMemo(() => {
        const w = calcMaxGridWidthPx({
            containerWidth: containerWidth || 0,
            containerHeight: containerHeight || 0,
            cols,
            rows,
            gapPx,
            paddingPx,
            aspectHOverW: 9 / 16,
        });

        if (!w) return null;
        return w;
    }, [containerWidth, containerHeight, cols, rows, gapPx, paddingPx]);

    return (
        <div
            className="w-full h-full min-h-0 overflow-hidden flex justify-center items-center"
            style={{ padding: paddingPx }}
        >
            <div
                className="w-full grid"
                style={{
                    gap: gapPx,
                    maxWidth: maxGridWidth ? `${maxGridWidth}px` : undefined,
                    gridTemplateColumns: cols === 1 ? "1fr" : "1fr 1fr",
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
    renderItem: (t: T, idx: number) => React.ReactNode;
}) {
    const { items, containerWidth, containerHeight, paddingBottomPx = 12, renderItem } = props;
    const count = items.length || 1;

    const paddingPx = containerWidth && containerWidth < 520 ? 8 : 10;
    const gapPx = containerWidth && containerWidth < 520 ? 6 : 10;

    const availW = Math.max(0, (containerWidth || 0) - paddingPx * 2);
    const availH = Math.max(0, (containerHeight || 0) - paddingPx * 2 - paddingBottomPx - (count - 1) * gapPx);

    const tileH = availH > 0 ? availH / count : 0;
    const tileWByH = tileH > 0 ? tileH * (16 / 9) : 0;

    const maxTileW = Math.max(0, Math.min(availW || 0, tileWByH || availW || 0));

    return (
        <div
            className="w-full h-full min-h-0 flex flex-col justify-center"
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
    renderItem: (t: T, idx: number) => React.ReactNode;
}) {
    const { items, containerWidth, containerHeight, paddingBottomPx = 12, renderItem } = props;

    const count = items.length || 1;
    const paddingPx = containerWidth && containerWidth < 520 ? 8 : 10;
    const gapPx = containerWidth && containerWidth < 520 ? 6 : 8;

    const availW = Math.max(0, (containerWidth || 0) - paddingPx * 2);
    const availH = Math.max(0, (containerHeight || 0) - paddingPx * 2 - paddingBottomPx);

    // ✅ До 4 участников включительно — всегда вертикальный стек
    if (count <= 4) {
        const totalGap = Math.max(0, (count - 1) * gapPx);
        const tileH = count > 0 ? Math.max(0, (availH - totalGap) / count) : 0;
        const tileWByH = tileH > 0 ? tileH * (16 / 9) : 0;
        const stackWidth = Math.max(0, Math.min(availW, tileWByH || availW));

        return (
            <div
                className="w-full h-full min-h-0 overflow-y-auto flex justify-center items-center"
                style={{
                    padding: paddingPx,
                    paddingBottom: paddingBottomPx,
                }}
            >
                <div
                    className="w-full flex flex-col justify-center items-center"
                    style={{
                        gap: gapPx,
                        maxWidth: stackWidth ? `${stackWidth}px` : undefined,
                    }}
                >
                    {items.map((t, idx) => (
                        <div key={t.id} className="w-full shrink-0">
                            {renderItem(t, idx)}
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    // ✅ С 5 участников — 2 колонки
    const cols = 2;
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
                    gridTemplateColumns: "1fr 1fr",
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
// ----------------------- /SIZING -----------------------