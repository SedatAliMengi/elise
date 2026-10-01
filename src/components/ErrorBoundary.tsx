import { Component, type ReactNode } from "react";

interface State {
  error: Error | null;
}

/** Shows what broke (with a reload button) instead of a blank window. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error("Elise crashed:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div style={{ padding: 32, color: "#ede6f7", fontFamily: "Outfit, sans-serif", height: "100%", overflow: "auto" }}>
        <h2 style={{ fontWeight: 500, margin: "0 0 8px" }}>Something went wrong.</h2>
        <p style={{ color: "#9a8db3", margin: "0 0 16px" }}>Your calendar data is safe. Send this message to get it fixed:</p>
        <pre style={{ whiteSpace: "pre-wrap", background: "#140e1f", border: "1px solid #2c2042", borderRadius: 10, padding: 14, fontSize: 12, userSelect: "text" }}>
          {String(error.stack || error)}
        </pre>
        <button
          onClick={() => location.reload()}
          style={{ marginTop: 16, height: 36, padding: "0 16px", borderRadius: 8, background: "#8b00ff", color: "#fff", border: "none", cursor: "pointer" }}
        >
          Reload
        </button>
      </div>
    );
  }
}
