import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Fitness",
    short_name: "Fitness",
    description: "Personal Garmin training and recovery dashboard.",
    start_url: "/",
    display: "standalone",
    background_color: "#121211",
    theme_color: "#1f6f5c",
    icons: [
      { src: "/icons/192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
