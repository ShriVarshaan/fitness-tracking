"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";

/**
 * Activity route on OpenFreeMap vector tiles (free, no key). The route arrives
 * already trimmed near the start and finish, so those points are never sent.
 */
export function RouteMap({ coordinates }: { coordinates: Array<[number, number]> }) {
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!container.current || coordinates.length < 2) return;
    let map: import("maplibre-gl").Map | undefined;
    let cancelled = false;

    import("maplibre-gl")
      .then(({ Map, LngLatBounds }) => {
        if (cancelled || !container.current) return;
        const bounds = coordinates.reduce((b, c) => b.extend(c), new LngLatBounds(coordinates[0], coordinates[0]));
        const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        map = new Map({
          container: container.current,
          style: `https://tiles.openfreemap.org/styles/${dark ? "dark" : "liberty"}`,
          bounds,
          fitBoundsOptions: { padding: 32 },
          attributionControl: { compact: true },
          cooperativeGestures: true,
        });
        map.on("error", () => setFailed(true));
        map.on("load", () => {
          map!.addSource("route", {
            type: "geojson",
            data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } },
          });
          map!.addLayer({
            id: "route",
            type: "line",
            source: "route",
            layout: { "line-join": "round", "line-cap": "round" },
            paint: { "line-color": dark ? "#4fb89c" : "#1f6f5c", "line-width": 4 },
          });
        });
      })
      .catch(() => setFailed(true));

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [coordinates]);

  if (failed) return <p className="text-sm text-muted">The map couldn&rsquo;t load.</p>;
  return <div ref={container} className="h-72 w-full overflow-hidden rounded-lg border border-border" role="img" aria-label="Map of the route" />;
}
