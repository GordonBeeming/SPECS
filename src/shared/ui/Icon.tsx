import { Box } from "lucide-react";

// Vite eager-imports every PNG in the icon dir at build time. The resulting
// map is keyed by file path; we strip the directory + extension so callers
// can pass the Satisfactory class name (e.g. `Desc_IronIngot_C`).
const modules = import.meta.glob<{ default: string }>(
  "/src/assets/icons/satisfactory/*.png",
  { eager: true },
);
const ICON_URLS: Map<string, string> = new Map();
for (const [path, mod] of Object.entries(modules)) {
  const file = path.split("/").pop();
  if (!file) continue;
  const id = file.replace(/\.png$/i, "");
  ICON_URLS.set(id, mod.default);
}

interface IconProps {
  /** Game-data class name — `Desc_IronIngot_C`, `Build_Manufacturer_C`, … */
  itemId: string;
  /** Falls back to the class-name suffix when the image is missing. */
  alt?: string;
  /** Tailwind size class — defaults to a `h-5 w-5` chip-sized icon. */
  className?: string;
}

/**
 * Resolves a Satisfactory game item / building id to its bundled icon.
 * Falls back to a generic Box glyph when the asset isn't bundled — keeps
 * the Library / Factory tables aligned even when a new dataset entry
 * outpaces the icon pack.
 */
export function Icon({ itemId, alt, className = "h-5 w-5" }: IconProps) {
  const url = ICON_URLS.get(itemId);
  if (!url) {
    return <Box className={`${className} text-fg-muted`} aria-label={alt ?? itemId} />;
  }
  return (
    <img
      src={url}
      alt={alt ?? itemId}
      loading="lazy"
      className={`${className} shrink-0 select-none`}
      draggable={false}
    />
  );
}
