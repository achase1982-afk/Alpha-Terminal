import { useLayoutEffect } from "react";

export function useViewportShell() {
  useLayoutEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      const doc = document.documentElement;
      doc.style.setProperty("--vvh", `${vv.height}px`);
      doc.style.setProperty("--vvw", `${vv.width}px`);
      doc.style.setProperty("--vv-top", `${vv.offsetTop}px`);
      doc.style.setProperty("--vv-left", `${vv.offsetLeft}px`);
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);

    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
}
