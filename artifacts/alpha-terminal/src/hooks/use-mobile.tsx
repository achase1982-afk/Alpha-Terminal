import * as React from "react"
import { TERMINAL_MOBILE_SHELL_MAX_PX } from "@/lib/layout/breakpoints"

/** Matches terminal mobile shell (same gate as `useTerminalLayout().isMobileShell`). */
export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const query = `(max-width: ${TERMINAL_MOBILE_SHELL_MAX_PX}px)`
    const mql = window.matchMedia(query)
    const onChange = () => {
      setIsMobile(window.innerWidth <= TERMINAL_MOBILE_SHELL_MAX_PX)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth <= TERMINAL_MOBILE_SHELL_MAX_PX)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}