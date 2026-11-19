"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";

/** Elevation tiles: AWS Terrain Tiles open dataset (Terrarium encoding, free, no key). */
const DEM_TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

/**
 * Activity route on OpenFreeMap vector tiles (free, no key), with an optional
 * 3D view: terrain from elevation tiles, hillshading and a tilted camera. The
 * route arrives already trimmed near the start and finish, so those points are never sent.
 */
export function RouteMap({ coordinates }: { coordinates: Array<[number, number]> }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [threeD, setThreeD] = useState(false);

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
          mapRef.current = map!;
          setReady(true);
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
      mapRef.current = null;
      map?.remove();
    };
  }, [coordinates]);

  const toggle3d = () => {
    const map = mapRef.current;
    if (!map) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!threeD) {
      if (!map.getSource("dem")) {
        map.addSource("dem", { type: "raster-dem", tiles: [DEM_TILES], tileSize: 256, encoding: "terrarium", maxzoom: 15, attribution: "Elevation: AWS Terrain Tiles (Mapzen)" });
        map.addLayer({ id: "hillshade", type: "hillshade", source: "dem", paint: { "hillshade-exaggeration": 0.4 } }, "route");
      }
      map.setTerrain({ source: "dem", exaggeration: 1.5 });
      map.setLayoutProperty("hillshade", "visibility", "visible");
      map.easeTo({ pitch: 60, bearing: -20, duration: reduce ? 0 : 1200 });
    } else {
      map.setTerrain(null);
      if (map.getLayer("hillshade")) map.setLayoutProperty("hillshade", "visibility", "none");
      map.easeTo({ pitch: 0, bearing: 0, duration: reduce ? 0 : 800 });
    }
    setThreeD(!threeD);
  };

  return (
    <div className="relative">
      <div ref={container} className="h-72 w-full overflow-hidden rounded-lg border border-border sm:h-96" role="img" aria-label="Map of the route" />
      {ready && !failed && (
        <button
          type="button"
          onClick={toggle3d}
          aria-pressed={threeD}
          className="absolute left-2 top-2 rounded-md border border-border bg-surface/90 px-2.5 py-1 text-xs font-medium shadow-sm backdrop-blur"
        >
          {threeD ? "2D" : "3D"}
        </button>
      )}
      {failed && (
        <p className="absolute inset-0 flex items-center justify-center rounded-lg bg-surface text-sm text-muted">
          The map couldn&rsquo;t load.
        </p>
      )}
    </div>
  );
}
