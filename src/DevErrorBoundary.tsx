import React from "react";

export class DevErrorBoundary extends React.Component<
    { children: React.ReactNode },
    { error: any }
> {
    constructor(props) {
        super(props);
        this.state = { error: null };
    }

    static getDerivedStateFromError(error) {
        return { error };
    }

    render() {
        if (this.state.error) {
            return (
                <div style={{ padding: 40 }}>
                    <h1 style={{ color: "red" }}>🔥 RUNTIME ERROR</h1>
                    <pre>{String(this.state.error)}</pre>
                </div>
            );
        }
        return this.props.children;
    }
}
