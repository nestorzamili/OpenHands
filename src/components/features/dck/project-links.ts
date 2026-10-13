import {
  buildPreviewUrl,
  buildPublishedUrl,
  type DckProjectMeta,
} from "#/dck/project-metadata";

export type DckProjectLinkKind = "live" | "preview";

export interface DckProjectLink {
  kind: DckProjectLinkKind;
  url: string;
}

export function getDckProjectLinks(
  meta: DckProjectMeta | null,
  origin: string | null,
): DckProjectLink[] {
  if (!meta || meta.lastStatus === "stopped" || meta.lastStatus === "error")
    return [];

  const liveUrl = buildPublishedUrl(meta.subdomain);
  if (liveUrl) return [{ kind: "live", url: liveUrl }];

  const previewUrl = buildPreviewUrl(meta.previewPath, origin);
  return previewUrl ? [{ kind: "preview", url: previewUrl }] : [];
}

export function getBrowserOrigin(): string | null {
  return typeof window === "undefined" ? null : window.location.origin;
}
