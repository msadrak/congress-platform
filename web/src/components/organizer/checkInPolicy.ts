import type { TranslationDictionary } from "../../lib/i18n";
import type { IconName } from "../ui/Icon";

export type PolicyType = "MULTI_ENTRY" | "SINGLE_USE" | "TIER_RESTRICTED" | "CAPACITY_CAPPED";

/** Label, explanation and icon of each check-in point admission policy. */
export function checkInPolicyMeta(t: TranslationDictionary): Record<string, { label: string; desc: string; icon: IconName }> {
  return {
    SINGLE_USE: { label: t.policySingleUse, desc: t.policySingleUseDesc, icon: "ticket" },
    MULTI_ENTRY: { label: t.policyMultiEntry, desc: t.policyMultiEntryDesc, icon: "sync" },
    TIER_RESTRICTED: { label: t.policyTierRestricted, desc: t.policyTierRestrictedDesc, icon: "lock" },
    CAPACITY_CAPPED: { label: t.policyCapacityCapped, desc: t.policyCapacityCappedDesc, icon: "users" },
  };
}
