import type { MetadataRoute } from "next";
import { APP_NAME, BRAND } from "@/lib/brand";

/** Lets the team "Add to Home Screen" on a phone and open the panel like an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: "HTLB Tracker",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#f5f5f2",
    theme_color: BRAND.forest,
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
