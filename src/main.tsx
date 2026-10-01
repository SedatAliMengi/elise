// Theme first, so component stylesheets can override the shared controls.
import "./styles/theme.css";
import "@fontsource/outfit/300.css";
import "@fontsource/outfit/400.css";
import "@fontsource/outfit/500.css";
import "@fontsource/outfit/600.css";
import ReactDOM from "react-dom/client";
import CalendarApp from "./calendar/CalendarApp";
import OverlayApp from "./overlay/OverlayApp";
import StageApp from "./stage/StageApp";
import ErrorBoundary from "./components/ErrorBoundary";

const which = new URLSearchParams(window.location.search).get("window");
if (which === "overlay") document.body.classList.add("overlay");

// No StrictMode: its double effects would double-speak and double-fire reminders.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <ErrorBoundary>{which === "overlay" ? <OverlayApp /> : which === "stage" ? <StageApp /> : <CalendarApp />}</ErrorBoundary>,
);
