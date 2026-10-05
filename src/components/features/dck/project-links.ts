import {
  buildPreviewUrl,
  buildPublishedUrl,
  type DckProjectMeta,
} from "#/dck/project-metadata";

export type DckProjectLinkKind = "live" | "preview" | "local";

export interface DckProjectLink {
  kind: DckProjectLinkKind;
  url: string;
}

export function getDckProjectLinks(
  meta: DckProjectMeta | null,
  origin: string | null,
): DckProjectLink[] {
  if (!meta) return [];

  const links: DckProjectLink[] = [];

  const liveUrl = buildPublishedUrl(meta.subdomain);
  if (liveUrl) links.push({ kind: "live", url: liveUrl });

  const previewUrl = buildPreviewUrl(meta.previewPath, origin);
  if (previewUrl) links.push({ kind: "preview", url: previewUrl });

  if (links.length === 0 && meta.url && meta.port !== null) {
    links.push({ kind: "local", url: meta.url });
  }

  return links;
}

export function getBrowserOrigin(): string | null {
  return typeof window === "undefined" ? null : window.location.origin;
}
