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
    let loaded = false;

    import("maplibre-gl")
      .then(({ Map, LngLatBounds, getVersion, setWorkerUrl }) => {
        if (cancelled || !container.current) return;
        // Bundling breaks MapLibre's own worker lookup; scripts/copy-maplibre-worker.mjs serves it here.
        setWorkerUrl(`/maplibre/maplibre-gl-worker-${getVersion()}.mjs`);

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

        // A missing tile or icon also raises "error" but the map still works:
        // only give up if the map never finishes loading.
        map.on("error", (e) => {
          console.warn("map:", e.error?.message ?? e);
          if (!loaded) setFailed(true);
        });
        map.on("load", () => {
          loaded = true;
          setFailed(false);
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
      .catch((err) => {
        console.warn("map:", err);
        setFailed(true);
      });

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [coordinates]);

  return (
    <div className="relative">
      <div ref={container} className="h-72 w-full overflow-hidden rounded-lg border border-border" role="img" aria-label="Map of the route" />
      {failed && (
        <p className="absolute inset-0 flex items-center justify-center rounded-lg bg-surface text-sm text-muted">
          The map couldn&rsquo;t load.
        </p>
      )}
    </div>
  );
}
