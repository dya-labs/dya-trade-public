"use client";

import grid from "../brand/loading/grid.webp?url";

/** Quiet grid backdrop for the centered canonical brand mark. */
export function LoadingArtwork() {
  return <div className="pointer-events-none absolute inset-0 overflow-hidden bg-background" aria-hidden="true">
    <img src={grid} alt="" draggable={false} className="app-loading-grid absolute inset-0 size-full" style={{ mixBlendMode: "screen" }}/>
  </div>;
}
