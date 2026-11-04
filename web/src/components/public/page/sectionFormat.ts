import { createContext, useContext } from "react";
import type { SectionStyle } from "../../../lib/pageDocument";

/** The section's own text settings, read by the prose renderer of every block inside it. */
export interface SectionFormat {
  textSize: SectionStyle["text_size"];
  direction: SectionStyle["direction"];
}

export const SectionFormatContext = createContext<SectionFormat>({ textSize: "md", direction: "auto" });

export const useSectionFormat = () => useContext(SectionFormatContext);

const RTL_LETTER = /[֐-ࣿיִ-﷿ﹰ-﻿]/g;
const LTR_LETTER = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/g;

/**
 * The reading direction of a piece of organizer prose: the script most of its letters are written in, so an
 * English paragraph that names a Persian speaker stays left-to-right (and the other way round). A forced
 * section direction wins.
 */
export function textDirection(text: string, forced: SectionFormat["direction"] = "auto"): { dir: "rtl" | "ltr"; lang: "fa" | "en" } {
  if (forced === "rtl") return { dir: "rtl", lang: "fa" };
  if (forced === "ltr") return { dir: "ltr", lang: "en" };
  const rtl = text.match(RTL_LETTER)?.length ?? 0;
  const ltr = text.match(LTR_LETTER)?.length ?? 0;
  return rtl > 0 && rtl >= ltr ? { dir: "rtl", lang: "fa" } : { dir: "ltr", lang: "en" };
}
