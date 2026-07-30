import React, { useState } from 'react';

// Tracks whether the viewport width is at or below the given breakpoint, updating on resize.
export function useIsMobile(breakpoint = 640) {
  const [isMobile, setIsMobile] = useState(
    window.innerWidth <= breakpoint
  );

  React.useEffect(() => {
    const onResize = () => {
      setIsMobile(window.innerWidth <= breakpoint);
    };

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [breakpoint]);

  return isMobile;
}