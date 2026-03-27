import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

if (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) {
  document.addEventListener("focusin", () => {
    requestAnimationFrame(() => { window.scrollTo(0, 0); });
  });

  document.addEventListener("scroll", (e) => {
    if (e.target === document || e.target === document.documentElement) {
      window.scrollTo(0, 0);
    }
  }, { passive: false });

  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", () => {
      document.documentElement.style.height = `${window.visualViewport!.height}px`;
      window.scrollTo(0, 0);
    });
    window.visualViewport.addEventListener("scroll", () => {
      window.scrollTo(0, 0);
    });
  }
}

createRoot(document.getElementById("root")!).render(<App />);
