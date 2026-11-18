// Theme first, so component stylesheets can override the shared controls.
import "./styles/theme.css";
import "./styles/nihil.css";
import "@fontsource/outfit/300.css";
import "@fontsource/outfit/400.css";
import "@fontsource/outfit/500.css";
import "@fontsource/outfit/600.css";
import "@fontsource/cormorant-garamond/500-italic.css";
import "@fontsource/cormorant-garamond/600.css";
import ReactDOM from "react-dom/client";
import CalendarApp from "./calendar/CalendarApp";
import OverlayApp from "./overlay/OverlayApp";
import StageApp from "./stage/StageApp";
import ErrorBoundary from "./components/ErrorBoundary";
import { initMode } from "./lib/mode";

const which = new URLSearchParams(window.location.search).get("window");
if (which === "overlay") document.body.classList.add("overlay");
// Every stylesheet is loaded by now: put the remembered mode (normal or Nihil) on screen before the first paint.
initMode();

// No StrictMode: its double effects would double-speak and double-fire reminders.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <ErrorBoundary>{which === "overlay" ? <OverlayApp /> : which === "stage" ? <StageApp /> : <CalendarApp />}</ErrorBoundary>,
);
