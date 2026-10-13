import { createContext, useContext } from "react";
import type { MediaAssetOut } from "../../../api/client";
import type { PageImages, PageLocale } from "../../../lib/pageDocument";
import type { StudioCopy } from "./studioCopy";

/** What every field needs from the studio: copy, the content language, and the image library. */
export interface StudioContextValue {
  copy: StudioCopy;
  /** Language whose variant the editor is editing (and the preview shows). */
  lang: PageLocale;
  assets: MediaAssetOut[];
  images: PageImages;
  /** Opens the image library; resolves with the chosen asset id (or null when dismissed). */
  pickImage: () => Promise<string | null>;
}

export const StudioContext = createContext<StudioContextValue | null>(null);

export function useStudio(): StudioContextValue {
  const value = useContext(StudioContext);
  if (!value) throw new Error("Studio fields must be rendered inside <StudioContext.Provider>");
  return value;
}
