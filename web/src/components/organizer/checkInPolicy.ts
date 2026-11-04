import { organizerSetupCopy } from "../../copy/organizerSetup";
import type { IconName } from "../ui/Icon";

export type PolicyType = "MULTI_ENTRY" | "SINGLE_USE" | "TIER_RESTRICTED" | "CAPACITY_CAPPED";

const ICONS: Record<PolicyType, IconName> = {
  SINGLE_USE: "ticket",
  MULTI_ENTRY: "sync",
  TIER_RESTRICTED: "lock",
  CAPACITY_CAPPED: "users",
};

/** Label, one-line hint and icon of each entry rule («قانون ورود»); an unknown rule keeps its name. */
export function checkInPolicyMeta(policy: string, locale: "fa" | "en"): { label: string; desc: string; icon: IconName } {
  const copy = organizerSetupCopy[locale].policy;
  if (!Object.hasOwn(copy, policy)) return { label: policy, desc: "", icon: "gate" };
  const key = policy as PolicyType;
  return { ...copy[key], icon: ICONS[key] };
}
