import React, { useEffect, useRef, useState } from "react";
import QRCode from "react-qr-code";
import { Link, useLocation, useOutletContext, useParams } from "react-router-dom";
import {
  createApiClient,
  formatApiError,
  type BoothOut,
  type CheckInPointOut,
  type DeskOperatorOut,
  type EventOut,
  type TicketTierOut,
} from "../api/client";
import { formatLocalizedDate, formatLocalizedNumber } from "../lib/i18n";
import { formatMobile, normalizeIranMobile } from "../lib/mobile";
import type { OrganizerOutletContext } from "./OrganizerLayout";
import { Badge } from "../components/ui/Badge";
import { Button, LinkButton } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Dialog } from "../components/ui/Dialog";
import { Icon, type IconName } from "../components/ui/Icon";
import { CongressSignature } from "../components/brand/CongressSignature";
import {
  DialogActions,
  EmptyState,
  EventStatusBadge,
  Field,
  FormAlert,
  Meter,
  Notice,
  SectionHeader,
  SectionIndex,
} from "../components/organizer/WorkspaceUi";
import { eventTiming } from "../components/organizer/eventTiming";
import { ScannerPairingDialog } from "../components/organizer/ScannerPairingDialog";
import { eventSectionFromPath, eventTimeStatus, eventWorkspacePath } from "../lib/organizerWorkspace";

type PolicyType =
  | "MULTI_ENTRY"
  | "SINGLE_USE"
  | "TIER_RESTRICTED"
  | "CAPACITY_CAPPED";

// Remount per event so a late response for event A can never write into event B's state.
export default function OrganizerEventDetail() {
  const { eventId } = useParams<{ eventId: string }>();
  return <OrganizerEventDetailContent key={eventId} />;
}

function OrganizerEventDetailContent() {
  const { eventId } = useParams<{ eventId: string }>();
  const { apiKey, onKeyRejected, reportEvent, locale, t, isRtl } = useOutletContext<OrganizerOutletContext>();
  const location = useLocation();

  const [event, setEvent] = useState<EventOut | null>(null);
  const [tiers, setTiers] = useState<TicketTierOut[]>([]);
  const [points, setPoints] = useState<CheckInPointOut[]>([]);
  const [booths, setBooths] = useState<BoothOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Fixed at mount so the derived event status never flickers between renders.
  const [now] = useState(() => Date.now());

  // Active section tab
  // The section comes from the route (the workspace navigation lives in the layout).
  const section = eventSectionFromPath(location.pathname);
  const activeTab: "overview" | "tiers" | "points" | "booths" | "operators" =
    section === "check-in" ? "points" : section === "tiers" || section === "booths" || section === "operators" ? section : "overview";

  // Result of the last change, announced politely; errors are announced assertively.
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<DeskOperatorOut | null>(null);
  const [confirmCloseTier, setConfirmCloseTier] = useState(false);
  const closeTierConfirmed = useRef(false);

  // Front desk operators state
  const [operators, setOperators] = useState<DeskOperatorOut[]>([]);
  const [isOperatorModalOpen, setIsOperatorModalOpen] = useState(false);
  const [newOperatorName, setNewOperatorName] = useState("");
  const [newOperatorMobile, setNewOperatorMobile] = useState("");
  const [submittingOperator, setSubmittingOperator] = useState(false);
  const [operatorFormError, setOperatorFormError] = useState<string | null>(null);
  const [revokingOperatorId, setRevokingOperatorId] = useState<string | null>(null);
  const [isTierModalOpen, setIsTierModalOpen] = useState(false);
  const [tierName, setTierName] = useState("");
  const [tierDescription, setTierDescription] = useState("");
  const [tierQuota, setTierQuota] = useState(100);
  const [tierIsOpen, setTierIsOpen] = useState(true);
  const [submittingTier, setSubmittingTier] = useState(false);
  const [tierFormError, setTierFormError] = useState<string | null>(null);

  // New check-in point form & modal state
  const [isPointModalOpen, setIsPointModalOpen] = useState(false);
  const [pointName, setPointName] = useState("");
  const [pointLocation, setPointLocation] = useState("");
  const [policyType, setPolicyType] = useState<PolicyType>("MULTI_ENTRY");
  const [allowedTiers, setAllowedTiers] = useState<string[]>([]);
  const [maxCapacity, setMaxCapacity] = useState<number | undefined>(undefined);
  const [submittingPoint, setSubmittingPoint] = useState(false);
  const [pointFormError, setPointFormError] = useState<string | null>(null);

  // New booth form & modal state
  const [isBoothModalOpen, setIsBoothModalOpen] = useState(false);
  const [boothName, setBoothName] = useState("");
  const [boothSlug, setBoothSlug] = useState("");
  const [boothLocation, setBoothLocation] = useState("");
  const [boothDescription, setBoothDescription] = useState("");
  const [boothWebsite, setBoothWebsite] = useState("");
  const [boothBrochure, setBoothBrochure] = useState("");
  const [submittingBooth, setSubmittingBooth] = useState(false);
  const [boothFormError, setBoothFormError] = useState<string | null>(null);

  // Assign staff modal state
  const [assigningBooth, setAssigningBooth] = useState<BoothOut | null>(null);
  const [staffMobile, setStaffMobile] = useState("");
  const [staffName, setStaffName] = useState("");
  const [assigningStaff, setAssigningStaff] = useState(false);
  const [staffFeedback, setStaffFeedback] = useState<string | null>(null);
  const [staffError, setStaffError] = useState<string | null>(null);

  // Standee QR modal state
  const [selectedBoothQr, setSelectedBoothQr] = useState<BoothOut | null>(null);

  // Edit event modal state
  const [isEditEventModalOpen, setIsEditEventModalOpen] = useState(false);
  const [editEventName, setEditEventName] = useState("");
  const [editEventLocation, setEditEventLocation] = useState("");
  const [editEventStartsAt, setEditEventStartsAt] = useState("");
  const [editEventEndsAt, setEditEventEndsAt] = useState("");
  const [editEventDescription, setEditEventDescription] = useState("");
  const [submittingEventEdit, setSubmittingEventEdit] = useState(false);
  const [eventEditError, setEventEditError] = useState<string | null>(null);

  // Edit ticket tier modal state
  const [editingTier, setEditingTier] = useState<TicketTierOut | null>(null);
  const [editTierName, setEditTierName] = useState("");
  const [editTierDescription, setEditTierDescription] = useState("");
  const [editTierQuota, setEditTierQuota] = useState(100);
  const [editTierIsOpen, setEditTierIsOpen] = useState(true);
  const [submittingTierEdit, setSubmittingTierEdit] = useState(false);
  const [tierEditError, setTierEditError] = useState<string | null>(null);

  // Edit check-in point modal state
  const [editingPoint, setEditingPoint] = useState<CheckInPointOut | null>(null);
  const [editPointName, setEditPointName] = useState("");
  const [editPointLocation, setEditPointLocation] = useState("");
  const [editPointPolicy, setEditPointPolicy] = useState<PolicyType>("MULTI_ENTRY");
  const [editPointAllowedTiers, setEditPointAllowedTiers] = useState<string[]>([]);
  const [editPointMaxCapacity, setEditPointMaxCapacity] = useState<number | undefined>(undefined);
  const [submittingPointEdit, setSubmittingPointEdit] = useState(false);
  const [pointEditError, setPointEditError] = useState<string | null>(null);

  // Scanner device pairing (token issue, QR pairing link, device list)
  const [pairingPoint, setPairingPoint] = useState<CheckInPointOut | null>(null);
  useEffect(() => {
    // Without an organizer key nothing is dispatched; the layout shows the key gate.
    if (!eventId || !apiKey) return;
    let isMounted = true;

    const loadData = async () => {
      setLoading(true);
      setError(null);
      const client = createApiClient({ kind: "organizer", token: apiKey });

      const [eventRes, tiersRes, pointsRes, boothsRes, operatorsRes] = await Promise.all([
        client.GET("/api/events/{event_id}", {
          params: { path: { event_id: eventId } },
        }),
        client.GET("/api/events/{event_id}/ticket-tiers", {
          params: { path: { event_id: eventId } },
        }),
        client.GET("/api/events/{event_id}/checkin-points", {
          params: { path: { event_id: eventId } },
        }),
        client.GET("/api/events/{event_id}/booths", {
          params: { path: { event_id: eventId } },
        }),
        client.GET("/api/events/{event_id}/desk/operators", {
          params: { path: { event_id: eventId } },
        }),
      ]);

      // 401 invalidates only the key that was sent, even if this page has since unmounted.
      if ([eventRes, tiersRes, pointsRes, boothsRes, operatorsRes].some((res) => res.response.status === 401)) {
        onKeyRejected(apiKey);
      }
      if (!isMounted) return;

      if (eventRes.error) {
        setError(formatApiError(eventRes.error));
      } else if (eventRes.data) {
        setEvent(eventRes.data);
      }

      if (tiersRes.data) setTiers(tiersRes.data);
      if (pointsRes.data) setPoints(pointsRes.data);
      if (boothsRes.data) setBooths(boothsRes.data);
      if (operatorsRes.data) setOperators(operatorsRes.data);

      setLoading(false);
    };

    loadData();
    return () => {
      isMounted = false;
    };
  }, [eventId, apiKey, onKeyRejected]);

  useEffect(() => {
    if (event) reportEvent(event);
  }, [event, reportEvent]);

  const handleCreateTier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventId) return;
    setTierFormError(null);

    if (!tierName.trim() || tierQuota < 1) {
      setTierFormError(isRtl ? "لطفاً نام رده و ظرفیت معتبر وارد کنید." : "Please enter a valid tier name and positive quota.");
      return;
    }

    if (!apiKey) return;
    setSubmittingTier(true);
    const client = createApiClient({ kind: "organizer", token: apiKey });
    const { data, error: err, response } = await client.POST(
      "/api/events/{event_id}/ticket-tiers",
      {
        params: { path: { event_id: eventId } },
        body: {
          name: tierName.trim(),
          description: tierDescription.trim(),
          quota: tierQuota,
          is_open: tierIsOpen,
        },
      }
    );

    if (response.status === 401) onKeyRejected(apiKey);
    setSubmittingTier(false);
    if (err) {
      setTierFormError(formatApiError(err));
    } else if (data) {
      setTiers((prev) => [...prev, data]);
      setTierName("");
      setTierDescription("");
      setTierQuota(100);
      setTierIsOpen(true);
      setIsTierModalOpen(false);
      setNotice({ tone: "ok", text: isRtl ? `رده «${data.name}» ایجاد شد.` : `Ticket tier “${data.name}” created.` });
    }
  };

  const handleCreatePoint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventId) return;
    setPointFormError(null);

    if (!pointName.trim()) {
      setPointFormError(isRtl ? "لطفاً نام گیت بازرسی را وارد کنید." : "Please provide a name for the check-in point.");
      return;
    }

    if (!apiKey) return;
    setSubmittingPoint(true);
    const client = createApiClient({ kind: "organizer", token: apiKey });
    const { data, error: err, response } = await client.POST(
      "/api/events/{event_id}/checkin-points",
      {
        params: { path: { event_id: eventId } },
        body: {
          name: pointName.trim(),
          location: pointLocation.trim(),
          policy_type: policyType,
          allowed_tier_ids: policyType === "TIER_RESTRICTED" ? allowedTiers : undefined,
          max_capacity: policyType === "CAPACITY_CAPPED" && maxCapacity ? maxCapacity : undefined,
        },
      }
    );

    if (response.status === 401) onKeyRejected(apiKey);
    setSubmittingPoint(false);
    if (err) {
      setPointFormError(formatApiError(err));
    } else if (data) {
      setPoints((prev) => [...prev, data]);
      setPointName("");
      setPointLocation("");
      setPolicyType("MULTI_ENTRY");
      setAllowedTiers([]);
      setMaxCapacity(undefined);
      setIsPointModalOpen(false);
      setNotice({ tone: "ok", text: isRtl ? `گیت «${data.name}» ایجاد شد.` : `Check-in point “${data.name}” created.` });
    }
  };

  const handleCreateBooth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventId) return;
    setBoothFormError(null);

    if (!boothName.trim() || !boothSlug.trim()) {
      setBoothFormError(isRtl ? "لطفاً نام و شناسه اینترنتی غرفه را وارد کنید." : "Please provide both a booth name and slug.");
      return;
    }

    if (!apiKey) return;
    setSubmittingBooth(true);
    const client = createApiClient({ kind: "organizer", token: apiKey });
    const { data, error: err, response } = await client.POST(
      "/api/events/{event_id}/booths",
      {
        params: { path: { event_id: eventId } },
        body: {
          name: boothName.trim(),
          slug: boothSlug.trim(),
          location: boothLocation.trim(),
          description: boothDescription.trim(),
          website_url: boothWebsite.trim(),
          brochure_url: boothBrochure.trim(),
        },
      }
    );

    if (response.status === 401) onKeyRejected(apiKey);
    setSubmittingBooth(false);
    if (err) {
      setBoothFormError(formatApiError(err));
    } else if (data) {
      setBooths((prev) => [...prev, data]);
      setBoothName("");
      setBoothSlug("");
      setBoothLocation("");
      setBoothDescription("");
      setBoothWebsite("");
      setBoothBrochure("");
      setIsBoothModalOpen(false);
      setNotice({ tone: "ok", text: isRtl ? `غرفه «${data.name}» ایجاد شد.` : `Booth “${data.name}” created.` });
    }
  };

  const handleAssignStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventId || !assigningBooth) return;
    setStaffError(null);
    setStaffFeedback(null);
    const mobile = normalizeIranMobile(staffMobile);
    if (!mobile) {
      setStaffError(isRtl ? "یک شماره موبایل معتبر وارد کنید؛ مثلاً ۰۹۱۲ ۳۴۵ ۶۷۸۹." : "Enter a valid Iranian mobile number, e.g. 0912 345 6789.");
      return;
    }

    if (!apiKey) return;
    setAssigningStaff(true);
    const client = createApiClient({ kind: "organizer", token: apiKey });

    const { data, error: err, response } = await client.POST(
      "/api/events/{event_id}/booths/{booth_id}/staff",
      {
        params: { path: { event_id: eventId, booth_id: assigningBooth.id } },
        body: { mobile, full_name: staffName.trim() },
      }
    );

    if (response.status === 401) onKeyRejected(apiKey);
    setAssigningStaff(false);
    if (err) {
      setStaffError(formatApiError(err));
    } else if (data) {
      setStaffFeedback(
        isRtl
          ? "نماینده تخصیص یافت. او با کد پیامکی به این شماره وارد پورتال غرفه می‌شود."
          : "Representative assigned. They sign in to the booth portal with an SMS code sent to this number."
      );
      setStaffMobile("");
      setStaffName("");
      setTimeout(() => {
        setAssigningBooth(null);
        setStaffFeedback(null);
      }, 1200);
    }
  };

  const openEditEventModal = () => {
    if (!event) return;
    setEditEventName(event.name);
    setEditEventLocation(event.location);
    try {
      setEditEventStartsAt(new Date(event.starts_at).toISOString().slice(0, 16));
      setEditEventEndsAt(new Date(event.ends_at).toISOString().slice(0, 16));
    } catch {
      setEditEventStartsAt("");
      setEditEventEndsAt("");
    }
    setEditEventDescription(event.description || "");
    setEventEditError(null);
    setIsEditEventModalOpen(true);
  };

  const handleCreateOperator = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventId) return;
    setOperatorFormError(null);
    const operatorMobile = normalizeIranMobile(newOperatorMobile);
    if (!newOperatorName.trim() || !operatorMobile) {
      setOperatorFormError(
        isRtl
          ? "نام اپراتور و یک شماره موبایل معتبر (مثلاً ۰۹۱۲ ۳۴۵ ۶۷۸۹) را وارد کنید."
          : "Enter the operator's name and a valid mobile number (e.g. 0912 345 6789)."
      );
      return;
    }
    if (!apiKey) return;
    setSubmittingOperator(true);
    const client = createApiClient({ kind: "organizer", token: apiKey });
    const { data, error: err, response } = await client.POST("/api/events/{event_id}/desk/operators", {
      params: { path: { event_id: eventId } },
      body: {
        operator_name: newOperatorName.trim(),
        mobile: operatorMobile,
      },
    });
    if (response.status === 401) onKeyRejected(apiKey);
    setSubmittingOperator(false);
    if (err) {
      setOperatorFormError(formatApiError(err));
    } else if (data) {
      setOperators((prev) => {
        const exists = prev.some((o) => o.id === data.id);
        return exists ? prev.map((o) => (o.id === data.id ? data : o)) : [...prev, data];
      });
      setNewOperatorName("");
      setNewOperatorMobile("");
      setIsOperatorModalOpen(false);
      setNotice({
        tone: "ok",
        text: isRtl
          ? `${data.operator_name} مجاز شد و با کد پیامکی به شماره خود وارد میز پذیرش می‌شود.`
          : `${data.operator_name} is authorized and signs in to the Front Desk with an SMS code sent to their number.`,
      });
    }
  };

  const handleRevokeOperator = async (operatorId: string) => {
    if (!eventId) return;
    if (!apiKey) return;
    setRevokingOperatorId(operatorId);
    const client = createApiClient({ kind: "organizer", token: apiKey });
    const { data, error: err, response } = await client.POST(
      "/api/events/{event_id}/desk/operators/{operator_id}/revoke",
      {
        params: { path: { event_id: eventId, operator_id: operatorId } },
      }
    );
    if (response.status === 401) onKeyRejected(apiKey);
    setRevokingOperatorId(null);
    if (err) {
      setNotice({ tone: "error", text: isRtl ? "لغو دسترسی انجام نشد؛ دوباره تلاش کنید." : `Could not revoke access: ${formatApiError(err)}` });
    } else if (data) {
      setOperators((prev) => prev.map((o) => (o.id === data.id ? data : o)));
      setNotice({ tone: "ok", text: isRtl ? `دسترسی ${data.operator_name} لغو شد.` : `Access revoked for ${data.operator_name}.` });
    }
  };
  const handleUpdateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!event || !eventId) return;
    setEventEditError(null);
    if (!editEventName.trim() || !editEventStartsAt || !editEventEndsAt || !editEventLocation.trim()) {
      setEventEditError(isRtl ? "لطفاً تمامی فیلدهای ستاره‌دار را تکمیل نمایید." : "Please fill out all required fields.");
      return;
    }
    const startsDate = new Date(editEventStartsAt);
    const endsDate = new Date(editEventEndsAt);
    if (endsDate <= startsDate) {
      setEventEditError(isRtl ? "زمان پایان همایش باید پس از زمان آغاز باشد." : "End time must be after start time.");
      return;
    }
    if (!apiKey) return;
    setSubmittingEventEdit(true);
    const client = createApiClient({ kind: "organizer", token: apiKey });
    const { data, error: err, response } = await client.PATCH("/api/events/{event_id}", {
      params: { path: { event_id: eventId } },
      body: {
        name: editEventName.trim(),
        location: editEventLocation.trim(),
        starts_at: startsDate.toISOString(),
        ends_at: endsDate.toISOString(),
        description: editEventDescription.trim(),
      },
    });
    if (response.status === 401) onKeyRejected(apiKey);
    setSubmittingEventEdit(false);
    if (err) {
      setEventEditError(formatApiError(err));
    } else if (data) {
      setEvent(data);
      setIsEditEventModalOpen(false);
      setNotice({ tone: "ok", text: isRtl ? "تنظیمات همایش ذخیره شد." : "Event settings saved." });
    }
  };

  const openEditTierModal = (tier: TicketTierOut) => {
    setEditingTier(tier);
    setEditTierName(tier.name);
    setEditTierDescription(tier.description || "");
    setEditTierQuota(tier.quota);
    setEditTierIsOpen(tier.is_open);
    setTierEditError(null);
  };

  const handleUpdateTier = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!editingTier || !eventId) return;
    setTierEditError(null);
    if (!editTierName.trim() || editTierQuota < 1) {
      setTierEditError(isRtl ? "لطفاً نام رده و ظرفیت معتبر وارد نمایید." : "Please enter a valid tier name and quota.");
      return;
    }
    if (editingTier.is_open && !editTierIsOpen && !closeTierConfirmed.current) {
      setConfirmCloseTier(true);
      return;
    }
    closeTierConfirmed.current = false;
    if (!apiKey) return;
    setSubmittingTierEdit(true);
    const client = createApiClient({ kind: "organizer", token: apiKey });
    const { data, error: err, response } = await client.PATCH(
      "/api/events/{event_id}/ticket-tiers/{tier_id}",
      {
        params: { path: { event_id: eventId, tier_id: editingTier.id } },
        body: {
          name: editTierName.trim(),
          description: editTierDescription.trim(),
          quota: editTierQuota,
          is_open: editTierIsOpen,
        },
      }
    );
    if (response.status === 401) onKeyRejected(apiKey);
    setSubmittingTierEdit(false);
    if (err) {
      setTierEditError(formatApiError(err));
    } else if (data) {
      setTiers((prev) => prev.map((t) => (t.id === data.id ? data : t)));
      setEditingTier(null);
      setNotice({ tone: "ok", text: isRtl ? `رده «${data.name}» ذخیره شد.` : `Ticket tier “${data.name}” saved.` });
    }
  };

  const openEditPointModal = (pt: CheckInPointOut) => {
    setEditingPoint(pt);
    setEditPointName(pt.name);
    setEditPointLocation(pt.location || "");
    setEditPointPolicy(pt.policy_type as PolicyType);
    setEditPointAllowedTiers(pt.allowed_tier_ids || []);
    setEditPointMaxCapacity(pt.max_capacity ?? undefined);
    setPointEditError(null);
  };

  const handleUpdatePoint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPoint || !eventId) return;
    setPointEditError(null);
    if (!editPointName.trim()) {
      setPointEditError(isRtl ? "لطفاً نام گیت را وارد نمایید." : "Please enter a gate name.");
      return;
    }
    if (editPointPolicy === "TIER_RESTRICTED" && editPointAllowedTiers.length === 0) {
      setPointEditError(isRtl ? "حداقل یک رده بلیط مجاز برای این گیت انتخاب کنید." : "Select at least one allowed tier.");
      return;
    }
    if (!apiKey) return;
    setSubmittingPointEdit(true);
    const client = createApiClient({ kind: "organizer", token: apiKey });
    const { data, error: err, response } = await client.PATCH(
      "/api/events/{event_id}/checkin-points/{point_id}",
      {
        params: { path: { event_id: eventId, point_id: editingPoint.id } },
        body: {
          name: editPointName.trim(),
          location: editPointLocation.trim(),
          policy_type: editPointPolicy,
          allowed_tier_ids: editPointPolicy === "TIER_RESTRICTED" ? editPointAllowedTiers : [],
          max_capacity: editPointPolicy === "CAPACITY_CAPPED" ? (editPointMaxCapacity || null) : null,
        },
      }
    );
    if (response.status === 401) onKeyRejected(apiKey);
    setSubmittingPointEdit(false);
    if (err) {
      setPointEditError(formatApiError(err));
    } else if (data) {
      setPoints((prev) => prev.map((p) => (p.id === data.id ? data : p)));
      setEditingPoint(null);
      setNotice({ tone: "ok", text: isRtl ? `گیت «${data.name}» ذخیره شد.` : `Check-in point “${data.name}” saved.` });
    }
  };
  if (loading && !event) {
    return (
      <div className="space-y-6" aria-hidden="true">
        <div className="skeleton h-60 shape-arc-lg" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="skeleton h-32 rounded-2xl" />
          <div className="skeleton h-32 rounded-2xl" />
          <div className="skeleton h-32 rounded-2xl" />
          <div className="skeleton h-32 rounded-2xl" />
        </div>
        <div className="skeleton h-64 rounded-2xl" />
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="relative overflow-hidden shape-arc border border-status-danger-border bg-status-danger-bg px-6 py-12 text-center sm:py-16">
        <div aria-hidden="true" className="pointer-events-none absolute -end-24 -top-24 size-56 rounded-full border border-status-danger-border" />
        <div aria-hidden="true" className="pointer-events-none absolute -end-14 -top-14 size-36 rounded-full border border-status-danger-border" />
        <div className="relative mx-auto max-w-md space-y-3">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-white text-status-danger-text shadow-soft">
            <Icon name="alert" size={26} />
          </span>
          <h1 className="pt-1 text-xl font-bold text-status-danger-text">{isRtl ? "خطا در بارگذاری همایش" : "Failed to Load Event"}</h1>
          <p className="text-sm text-text-secondary">{error}</p>
          <div className="pt-3">
            <LinkButton to="/organizer" variant="secondary" size="md">
              <Icon name="arrow-left" size={18} />
              {t.breadcrumbEvents}
            </LinkButton>
          </div>
        </div>
      </div>
    );
  }

  const fmt = (n: number) => formatLocalizedNumber(n, locale);
  const cancelLabel = isRtl ? "انصراف" : "Cancel";
  const status = eventTimeStatus(event.starts_at, event.ends_at, now);
  const totalReserved = tiers.reduce((n, x) => n + x.reserved_count, 0);
  const totalQuota = tiers.reduce((n, x) => n + x.quota, 0);
  const capacityPct = totalQuota > 0 ? Math.min(100, Math.round((totalReserved / totalQuota) * 100)) : 0;
  const activeOperators = operators.filter((o) => !o.is_revoked).length;
  const tierNames = new Map(tiers.map((tr) => [tr.id, tr.name]));
  const policyMeta: Record<string, { label: string; desc: string; icon: IconName }> = {
    SINGLE_USE: { label: t.policySingleUse, desc: t.policySingleUseDesc, icon: "ticket" },
    MULTI_ENTRY: { label: t.policyMultiEntry, desc: t.policyMultiEntryDesc, icon: "sync" },
    TIER_RESTRICTED: { label: t.policyTierRestricted, desc: t.policyTierRestrictedDesc, icon: "lock" },
    CAPACITY_CAPPED: { label: t.policyCapacityCapped, desc: t.policyCapacityCappedDesc, icon: "users" },
  };
  const tierPct = (tier: TicketTierOut) =>
    tier.quota > 0 ? Math.min(100, Math.round(((tier.reserved_count ?? 0) / tier.quota) * 100)) : 0;
  const sectionAction = (label: string, onClick: () => void) => (
    <Button type="button" variant="primary" size="md" onClick={onClick}>
      <Icon name="plus" size={18} />
      <span>{label}</span>
    </Button>
  );

  return (
    <div className="space-y-8 sm:space-y-10">
      {/* 1. Section header: the congress hero on Overview, an editorial header elsewhere */}
      {activeTab === "overview" && (
        <section aria-labelledby="event-hero-title" className="org-ink relative isolate overflow-hidden shape-arc-lg bg-surface-ink text-white shadow-lift">
          <CongressSignature seed={event.slug} tone="ink" animate className="absolute inset-0 -z-10 h-full w-full" />
          <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-r from-surface-ink via-surface-ink/90 to-surface-ink/0 rtl:bg-gradient-to-l" />
          <div className="px-5 py-7 sm:px-10 sm:py-10 lg:px-12 lg:py-12">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-ink-300">
              <span className="flex items-center gap-2.5 font-semibold">
                <SectionIndex n={1} className="text-aiteb-orchid" />
                {t.tabOverview}
              </span>
              <span aria-hidden="true" className="h-3 w-px bg-white/20" />
              <EventStatusBadge status={status} isRtl={isRtl} />
              <span>{eventTiming(event.starts_at, event.ends_at, now, locale)}</span>
            </div>
            <h1
              id="event-hero-title"
              className="mt-5 max-w-3xl font-display text-[2rem] font-[680] leading-[1.08] tracking-[-0.035em] [overflow-wrap:anywhere] sm:text-[2.75rem] lg:text-[3.25rem]"
            >
              <bdi>{event.name}</bdi>
            </h1>
            {event.description && (
              <p className="mt-4 line-clamp-3 max-w-2xl text-sm leading-relaxed text-ink-200 sm:text-base">
                <bdi>{event.description}</bdi>
              </p>
            )}
            <dl className="mt-8 grid max-w-3xl grid-cols-2 gap-x-6 gap-y-5 border-t border-white/10 pt-6 lg:grid-cols-4">
              {([
                [isRtl ? "آغاز" : "Starts", formatLocalizedDate(event.starts_at, locale)],
                [isRtl ? "پایان" : "Ends", formatLocalizedDate(event.ends_at, locale)],
                [isRtl ? "محل برگزاری" : "Venue", event.location],
              ] as const).map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="text-[0.6875rem] font-semibold text-ink-400">{label}</dt>
                  <dd className="mt-1 break-words text-sm text-white">
                    <bdi>{value}</bdi>
                  </dd>
                </div>
              ))}
              <div className="min-w-0">
                <dt className="text-[0.6875rem] font-semibold text-ink-400">{isRtl ? "نشانی عمومی" : "Public URL"}</dt>
                <dd className="mt-1 break-all font-mono text-[0.8125rem] text-aiteb-orchid">
                  <bdi dir="ltr">/e/{event.slug}</bdi>
                </dd>
              </div>
            </dl>
            <div className="mt-8 flex flex-wrap gap-2.5">
              <Button onClick={openEditEventModal} variant="light" size="md">
                <Icon name="note" size={18} />
                <span>{t.editEventAction || (isRtl ? "ویرایش همایش" : "Edit Event")}</span>
              </Button>
              <a
                href={`/e/${encodeURIComponent(event.slug)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[44px] items-center gap-2 rounded-[10px] px-4 text-sm font-semibold text-white ring-1 ring-white/20 transition-colors hover:bg-white/[0.08]"
              >
                {t.openPublicPageAction}
                <Icon name="arrow-up-right" size={18} />
              </a>
            </div>
          </div>
        </section>
      )}

      {activeTab === "tiers" && (
        <SectionHeader index={2} eyebrow={<bdi>{event.name}</bdi>} title={t.tiersHeading} description={t.tiersDesc} action={sectionAction(t.createTierButton, () => setIsTierModalOpen(true))} />
      )}
      {activeTab === "points" && (
        <SectionHeader index={3} eyebrow={<bdi>{event.name}</bdi>} title={t.pointsHeading} description={t.pointsDesc} action={sectionAction(t.createPointButton, () => setIsPointModalOpen(true))} />
      )}
      {activeTab === "booths" && (
        <SectionHeader index={4} eyebrow={<bdi>{event.name}</bdi>} title={t.boothsHeading} description={t.boothsDesc} action={sectionAction(t.createBoothButton, () => setIsBoothModalOpen(true))} />
      )}
      {activeTab === "operators" && (
        <SectionHeader
          index={5}
          eyebrow={<bdi>{event.name}</bdi>}
          title={t.operatorsHeading}
          description={t.operatorsDesc}
          action={sectionAction(t.addOperatorButton, () => {
            setOperatorFormError(null);
            setIsOperatorModalOpen(true);
          })}
        />
      )}

      {notice && (
        <Notice tone={notice.tone} onDismiss={() => setNotice(null)} dismissLabel={isRtl ? "بستن پیام" : "Dismiss message"}>
          {notice.text}
        </Notice>
      )}

      {/* TAB A: Overview */}
      {activeTab === "overview" && (
        <div className="space-y-8">
          <div className="grid grid-cols-2 overflow-hidden rounded-2xl border border-border-default bg-surface-panel shadow-soft lg:grid-cols-4">
            {([
              ["/tiers", t.tabTiers, tiers.length, isRtl ? "رده بلیط" : "Ticket tiers", "ticket", 2],
              ["/check-in", t.tabPoints, points.length, isRtl ? "ایستگاه اسکن بارکد" : "Scanner stations", "gate", 3],
              ["/booths", t.tabBooths, booths.length, isRtl ? "غرفه ثبت‌شده" : "Registered booths", "booth", 4],
              ["/operators", t.tabOperators, activeOperators, isRtl ? "اپراتور فعال" : "Active operators", "users", 5],
            ] as const).map(([path, label, count, caption, icon, index], i) => (
              <Link
                key={path}
                to={eventWorkspacePath(event.id, path)}
                className={`group relative flex min-w-0 flex-col gap-4 border-border-default p-4 transition-colors hover:bg-aiteb-lavender/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring sm:p-6 ${
                  i % 2 === 1 ? "border-s" : ""
                } ${i >= 2 ? "border-t lg:border-t-0" : ""} ${i === 2 ? "lg:border-s" : ""}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <SectionIndex n={index} />
                    <span className="text-xs font-semibold leading-snug text-text-muted">{label}</span>
                  </span>
                  <Icon name={icon} size={18} className="shrink-0 text-aiteb-indigo/60" />
                </span>
                <span className="org-kpi-value text-[2.25rem] text-text-primary sm:text-[2.75rem]">{fmt(count)}</span>
                <span className="flex items-center justify-between gap-2 text-xs text-text-secondary">
                  <span className="leading-snug">{caption}</span>
                  <Icon
                    name="arrow-right"
                    size={16}
                    className="shrink-0 text-aiteb-indigo opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                  />
                </span>
              </Link>
            ))}
          </div>

          {tiers.length === 0 ? (
            <section
              aria-labelledby="capacity-title"
              className="flex flex-col gap-4 rounded-2xl border border-dashed border-border-strong bg-surface-panel p-5 sm:flex-row sm:items-center sm:justify-between sm:p-7"
            >
              <div className="flex items-start gap-4">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-status-warning-bg text-status-warning-text">
                  <Icon name="ticket" size={22} />
                </span>
                <div className="space-y-1">
                  <h2 id="capacity-title" className="text-base font-bold text-text-primary">
                    {isRtl ? "ظرفیت و رزرو بلیط" : "Ticket capacity & reservations"}
                  </h2>
                  <p className="text-sm leading-relaxed text-text-secondary">
                    {isRtl
                      ? "هنوز رده بلیطی تعریف نشده است؛ بدون رده بلیط، شرکت‌کنندگان نمی‌توانند ثبت‌نام کنند."
                      : "No ticket tier is defined yet; attendees cannot reserve a pass until you add one."}
                  </p>
                </div>
              </div>
              <LinkButton to={eventWorkspacePath(event.id, "/tiers")} variant="secondary" size="sm" className="shrink-0 self-start sm:self-center">
                {t.tabTiers}
                <Icon name="arrow-right" size={16} />
              </LinkButton>
            </section>
          ) : (
            <section
              aria-labelledby="capacity-title"
              className="grid overflow-clip rounded-2xl border border-border-default bg-surface-panel shadow-soft lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"
            >
              <div className="flex flex-col gap-6 border-b border-border-subtle bg-meridian p-5 sm:p-7 lg:border-b-0 lg:border-e">
                <div className="flex items-center justify-between gap-3">
                  <h2 id="capacity-title" className="text-base font-bold tracking-tight text-text-primary">
                    {isRtl ? "ظرفیت و رزرو بلیط" : "Ticket capacity & reservations"}
                  </h2>
                  <Icon name="ticket" size={20} className="text-aiteb-indigo/60" />
                </div>
                <p className="text-sm text-text-secondary">
                  <span className="block">
                    <span className="org-kpi-value text-[3.25rem] text-text-primary sm:text-[4rem]">{fmt(totalReserved)}</span>
                    <span className="org-kpi-value text-2xl text-text-muted sm:text-[1.75rem]">
                      {" / "}
                      {fmt(totalQuota)}
                    </span>
                  </span>
                  <span className="mt-2.5 block">{isRtl ? "بلیط رزروشده از کل ظرفیت" : "passes reserved of total quota"}</span>
                </p>
                <div className="mt-auto space-y-2.5">
                  <Meter value={capacityPct} label={isRtl ? "ظرفیت کل" : "Total capacity"} size="lg" tone={capacityPct >= 100 ? "full" : "default"} />
                  <div className="flex items-center justify-between gap-3 text-xs text-text-muted">
                    <span className="tabular">
                      {fmt(capacityPct)}% {isRtl ? "تکمیل" : "filled"}
                    </span>
                    <span className="tabular">
                      {fmt(Math.max(0, totalQuota - totalReserved))} {isRtl ? "جای خالی" : "seats open"}
                    </span>
                  </div>
                </div>
                <LinkButton to={eventWorkspacePath(event.id, "/tiers")} variant="secondary" size="sm" className="self-start">
                  {t.tabTiers}
                  <Icon name="arrow-right" size={16} />
                </LinkButton>
              </div>
              <ul className="divide-y divide-border-subtle px-5 py-2 sm:px-7 sm:py-3">
                {tiers.map((tier) => {
                  const pct = tierPct(tier);
                  return (
                    <li key={tier.id} className="space-y-2.5 py-4">
                      <div className="flex items-start justify-between gap-3 text-sm">
                        <span className="min-w-0 break-words font-semibold text-text-primary">
                          <bdi>{tier.name}</bdi>
                        </span>
                        <span className="flex shrink-0 items-center gap-2.5 text-xs text-text-secondary">
                          <Badge variant={tier.is_open ? "success" : "neutral"} size="sm">
                            {tier.is_open ? (isRtl ? "باز" : "Open") : isRtl ? "بسته" : "Closed"}
                          </Badge>
                          <bdi dir="ltr" className="tabular font-semibold text-text-primary">
                            {tier.reserved_count} / {tier.quota}
                          </bdi>
                        </span>
                      </div>
                      <Meter value={pct} label={tier.name} tone={pct >= 100 ? "full" : tier.is_open ? "default" : "muted"} />
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            {([
              ["chart", t.openAnalyticsAction, t.analyticsStationDesc, "/analytics", isRtl ? "مشاهده" : "View"],
              [
                "id-card",
                t.openDeskAction,
                isRtl
                  ? "میز پذیرش دسترسی جداگانه اپراتور دارد؛ با کلید مدیر هم می‌توان در حالت مدیر وارد شد."
                  : "Reception has its own operator access; you can also enter it in Organizer mode.",
                "/desk",
                isRtl ? "ورود" : "Open",
              ],
            ] as const).map(([icon, title, desc, path, cta]) => (
              <div key={path} className="flex items-start gap-4 shape-arc border border-border-default bg-surface-panel p-5 shadow-soft sm:p-6">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-aiteb-lavender text-aiteb-indigo">
                  <Icon name={icon} size={22} />
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <h3 className="text-sm font-bold text-text-primary">{title}</h3>
                  <p className="text-xs leading-relaxed text-text-secondary">{desc}</p>
                </div>
                <LinkButton to={eventWorkspacePath(event.id, path)} variant="secondary" size="sm" className="shrink-0">
                  {cta}
                  <Icon name="arrow-right" size={16} />
                </LinkButton>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB B: Ticket Tiers */}
      {activeTab === "tiers" &&
        (tiers.length === 0 ? (
          <EmptyState icon="ticket" title={t.noTiersTitle} />
        ) : (
          <div className="space-y-5">
            <dl className="grid grid-cols-3 divide-x divide-border-default overflow-hidden rounded-2xl border border-border-default bg-surface-panel shadow-soft">
              {([
                [t.tierQuotaTotal, totalQuota],
                [isRtl ? "رزروشده" : "Reserved", totalReserved],
                [isRtl ? "باقی‌مانده" : "Remaining", Math.max(0, totalQuota - totalReserved)],
              ] as const).map(([label, value]) => (
                <div key={label} className="min-w-0 px-4 py-4 sm:px-6">
                  <dt className="truncate text-xs font-semibold text-text-muted">{label}</dt>
                  <dd className="org-kpi-value mt-2 text-2xl text-text-primary sm:text-[2rem]">{fmt(value)}</dd>
                </div>
              ))}
            </dl>
            <div className="overflow-clip rounded-2xl border border-border-default bg-surface-panel shadow-soft">
              <table className="org-table org-table--stack">
                <caption className="sr-only">{t.tiersHeading}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t.tierNameLabel}</th>
                    <th scope="col">{isRtl ? "وضعیت" : "Status"}</th>
                    <th scope="col" className="w-[36%]">
                      {isRtl ? "ظرفیت" : "Capacity"}
                    </th>
                    <th scope="col">
                      <span className="sr-only">{isRtl ? "عملیات" : "Actions"}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tiers.map((tier, i) => {
                    const reserved = tier.reserved_count ?? 0;
                    const pct = tierPct(tier);
                    const soldOut = reserved >= tier.quota;
                    return (
                      <tr key={tier.id}>
                        <td>
                          <div className="flex items-start gap-3">
                            <SectionIndex n={i + 1} className="mt-1 text-text-muted" />
                            <div className="min-w-0">
                              <p className="break-words font-semibold text-text-primary">
                                <bdi>{tier.name}</bdi>
                              </p>
                              <p className="mt-0.5 text-xs leading-relaxed text-text-secondary">
                                <bdi>{tier.description || (isRtl ? "دسترسی عمومی به سالن‌های همایش." : "General congress admission.")}</bdi>
                              </p>
                              <p className="mt-1 font-mono text-[0.6875rem] text-text-muted">
                                <bdi dir="ltr">ID: {tier.id.slice(0, 8)}</bdi>
                              </p>
                            </div>
                          </div>
                        </td>
                        <td data-label={isRtl ? "وضعیت" : "Status"}>
                          {soldOut ? (
                            <Badge variant="warning" size="sm">
                              {t.tierStatusSoldOut || (isRtl ? "تکمیل ظرفیت" : "Sold Out")}
                            </Badge>
                          ) : !tier.is_open ? (
                            <Badge variant="neutral" size="sm">
                              {t.tierStatusClosed}
                            </Badge>
                          ) : (
                            <Badge variant="success" size="sm" dot>
                              {t.tierStatusOpen}
                            </Badge>
                          )}
                        </td>
                        <td data-label={isRtl ? "ظرفیت" : "Capacity"} className="org-cell-wide">
                          <div className="space-y-2">
                            <div className="flex items-baseline justify-between gap-3 text-xs text-text-muted">
                              <span>
                                {isRtl ? "ثبت‌نام‌شده:" : "Registered:"} <strong className="tabular text-sm text-text-primary">{fmt(reserved)}</strong> /{" "}
                                {fmt(tier.quota)}
                              </span>
                              <span className="tabular">{fmt(pct)}%</span>
                            </div>
                            <Meter value={pct} label={tier.name} tone={pct >= 100 ? "full" : tier.is_open ? "default" : "muted"} />
                          </div>
                        </td>
                        <td className="text-end">
                          <Button type="button" variant="secondary" size="sm" onClick={() => openEditTierModal(tier)}>
                            <Icon name="note" size={16} />
                            <span>{t.editTierAction || (isRtl ? "ویرایش" : "Edit")}</span>
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}

      {/* TAB C: Check-In Points */}
      {activeTab === "points" &&
        (points.length === 0 ? (
          <EmptyState icon="gate" title={t.noPointsTitle} />
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {points.map((pt, i) => {
              const policy = policyMeta[pt.policy_type] ?? { label: pt.policy_type, desc: "", icon: "gate" as IconName };
              const allowed = (pt.allowed_tier_ids ?? []).map((id) => tierNames.get(id) ?? id.slice(0, 8));
              return (
                <article
                  key={pt.id}
                  aria-labelledby={`point-title-${pt.id}`}
                  className="flex flex-col overflow-hidden rounded-2xl border border-border-default bg-surface-panel shadow-soft"
                >
                  <div className="flex-1 space-y-4 p-5 sm:p-6">
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 font-mono text-[0.6875rem] text-text-muted">
                        <Icon name="gate" size={16} className="text-aiteb-indigo" />
                        <span aria-hidden="true">G-{String(i + 1).padStart(2, "0")}</span>
                      </span>
                      <Badge variant="brand" size="sm" icon={<Icon name={policy.icon} size={12} />}>
                        {policy.label}
                      </Badge>
                    </div>
                    <div className="space-y-1.5">
                      <h3 id={`point-title-${pt.id}`} className="break-words text-lg font-bold tracking-tight text-text-primary">
                        <bdi>{pt.name}</bdi>
                      </h3>
                      <p className="flex items-center gap-1.5 text-sm text-text-secondary">
                        <Icon name="pin" size={15} className="shrink-0 text-text-muted" />
                        <bdi className="min-w-0 break-words">{pt.location || (isRtl ? "درب اصلی ورودی" : "Main Gate Area")}</bdi>
                      </p>
                    </div>
                    {policy.desc && <p className="text-xs leading-relaxed text-text-muted">{policy.desc}</p>}
                    {(pt.policy_type === "TIER_RESTRICTED" || (pt.policy_type === "CAPACITY_CAPPED" && pt.max_capacity)) && (
                      <dl className="space-y-2 rounded-xl bg-surface-panel-subtle px-4 py-3 text-xs">
                        {pt.policy_type === "TIER_RESTRICTED" && (
                          <div>
                            <dt className="font-semibold text-text-muted">{t.allowedTiersLabel}</dt>
                            <dd className="mt-1.5 flex flex-wrap gap-1.5">
                              {allowed.length === 0 ? (
                                <span className="text-text-muted">—</span>
                              ) : (
                                allowed.map((nm) => (
                                  <Badge key={nm} variant="neutral" size="sm">
                                    {nm}
                                  </Badge>
                                ))
                              )}
                            </dd>
                          </div>
                        )}
                        {pt.policy_type === "CAPACITY_CAPPED" && pt.max_capacity ? (
                          <div className="flex items-center justify-between gap-3">
                            <dt className="font-semibold text-text-muted">{isRtl ? "سقف ظرفیت" : "Capacity limit"}</dt>
                            <dd className="org-kpi-value text-base text-text-primary">{fmt(pt.max_capacity)}</dd>
                          </div>
                        ) : null}
                      </dl>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle bg-surface-panel-subtle/60 px-5 py-3.5 sm:px-6">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to={`/scan/${pt.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-surface-ink px-3 text-[13px] font-semibold text-white transition-colors hover:bg-ink-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                      >
                        <Icon name="scan" size={16} />
                        <span>{t.openScannerAction}</span>
                        <Icon name="arrow-up-right" size={14} className="opacity-70" />
                      </Link>
                      <Button type="button" variant="secondary" size="sm" onClick={() => setPairingPoint(pt)}>
                        <Icon name="smartphone" size={16} />
                        <span>{isRtl ? "اتصال دستگاه" : "Pair device"}</span>
                      </Button>
                      <Button type="button" variant="secondary" size="sm" onClick={() => openEditPointModal(pt)}>
                        <Icon name="note" size={16} />
                        <span>{t.editPointAction || (isRtl ? "ویرایش" : "Edit")}</span>
                      </Button>
                    </div>
                    <span className="font-mono text-[0.6875rem] text-text-muted">
                      <bdi dir="ltr">Point: {pt.id.slice(0, 8)}</bdi>
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        ))}

      {/* TAB D: Exhibition Booths */}
      {activeTab === "booths" &&
        (booths.length === 0 ? (
          <EmptyState icon="booth" title={t.noBoothsTitle} />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {booths.map((b) => (
              <div key={b.id} className="flex flex-col overflow-hidden rounded-2xl border border-border-default bg-surface-panel shadow-soft">
                <div className="flex flex-1 gap-4 p-5 sm:p-6">
                  <div aria-hidden="true" className="org-plate size-[4.5rem] shrink-0 rounded-lg p-1.5 ring-1 ring-border-default">
                    <QRCode value={b.id} size={64} level="M" viewBox="0 0 256 256" fgColor="#0F172A" bgColor="#FFFFFF" className="h-full w-full" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="neutral" size="sm" icon={<Icon name="pin" size={12} />}>
                        <bdi>{b.location || (isRtl ? "سالن نمایشگاه" : "Stand Area")}</bdi>
                      </Badge>
                    </div>
                    <h3 className="break-words text-base font-bold leading-snug text-text-primary">
                      <bdi>{b.name}</bdi>
                    </h3>
                    <p className="font-mono text-[0.6875rem] text-text-muted">
                      <bdi dir="ltr">/booth/{b.id.slice(0, 8)}</bdi>
                    </p>
                    {b.description && (
                      <p className="line-clamp-2 pt-1 text-xs leading-relaxed text-text-secondary">
                        <bdi>{b.description}</bdi>
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle bg-surface-panel-subtle/60 px-5 py-3.5 sm:px-6">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setAssigningBooth(b);
                        setStaffMobile("");
                        setStaffName("");
                        setStaffFeedback(null);
                        setStaffError(null);
                      }}
                    >
                      <Icon name="user-plus" size={16} />
                      <span>{t.assignStaffButton}</span>
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedBoothQr(b)}>
                      <Icon name="qr" size={16} />
                      <span>{t.standeeQrButton}</span>
                    </Button>
                  </div>
                  <Link
                    to={`/e/${event.slug}/booths/${b.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[36px] items-center gap-1 rounded-lg px-1 text-[13px] font-semibold text-action-primary hover:underline"
                  >
                    {t.viewBoothAction}
                    <Icon name="arrow-up-right" size={14} />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        ))}

      {/* TAB E: Front Desk Operators */}
      {activeTab === "operators" &&
        (operators.length === 0 ? (
          <EmptyState icon="users" title={t.noOperatorsTitle} />
        ) : (
          <div className="overflow-clip rounded-2xl border border-border-default bg-surface-panel shadow-soft">
            <table className="org-table org-table--stack">
              <caption className="sr-only">{t.operatorsHeading}</caption>
              <thead>
                <tr>
                  <th scope="col">{t.operatorNameLabel}</th>
                  <th scope="col">{isRtl ? "وضعیت" : "Status"}</th>
                  <th scope="col">{isRtl ? "ثبت دسترسی" : "Assigned"}</th>
                  <th scope="col">
                    <span className="sr-only">{isRtl ? "عملیات" : "Actions"}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {operators.map((op) => (
                  <tr key={op.id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <span
                          aria-hidden="true"
                          className={`grid size-10 shrink-0 place-items-center rounded-full text-sm font-bold ${
                            op.is_revoked ? "bg-surface-panel-inset text-text-muted" : "bg-aiteb-lavender text-aiteb-indigo"
                          }`}
                        >
                          {op.operator_name.trim().charAt(0).toUpperCase() || "•"}
                        </span>
                        <div className="min-w-0">
                          <h3 className={`break-words text-sm font-semibold ${op.is_revoked ? "text-text-secondary" : "text-text-primary"}`}>
                            <bdi>{op.operator_name}</bdi>
                          </h3>
                          {op.mobile && (
                            <p className="break-all font-mono text-xs text-text-muted">
                              <bdi dir="ltr">{formatMobile(op.mobile, locale)}</bdi>
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td data-label={isRtl ? "وضعیت" : "Status"}>
                      <Badge variant={op.is_revoked ? "neutral" : "success"} size="sm" dot={!op.is_revoked}>
                        {op.is_revoked ? t.operatorStatusRevoked : t.operatorStatusActive}
                      </Badge>
                    </td>
                    <td data-label={isRtl ? "ثبت دسترسی" : "Assigned"} className="text-xs text-text-secondary">
                      <span>{formatLocalizedDate(op.created_at, locale)}</span>
                    </td>
                    <td className="text-end">
                      {!op.is_revoked ? (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={revokingOperatorId === op.id}
                          onClick={() => setRevokeTarget(op)}
                          className="!text-status-danger-text hover:!border-status-danger-border hover:!bg-status-danger-bg"
                        >
                          <Icon name="lock" size={16} />
                          <span>{revokingOperatorId === op.id ? "..." : t.revokeOperatorAction}</span>
                        </Button>
                      ) : (
                        <span className="text-xs font-medium text-text-muted">{isRtl ? "لغو شده" : "Revoked"}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      {activeTab === "operators" && (
        <p className="flex max-w-3xl items-start gap-2.5 text-xs leading-relaxed text-text-muted">
          <Icon name="shield" size={16} className="mt-0.5 shrink-0 text-aiteb-slate" />
          {isRtl
            ? "اپراتورها با شماره موبایل خود و کد پیامکی وارد میز پذیرش می‌شوند؛ رمز عبوری برای تحویل وجود ندارد. لغو دسترسی، نشست فعال آن‌ها را نیز بی‌اعتبار می‌کند."
            : "Operators sign in to the Front Desk with their mobile number and an SMS code; there is no password to hand over. Revoking access also ends any active session."}
        </p>
      )}

      {/* MODAL 1: Create Ticket Tier */}
      <Dialog
        isOpen={isTierModalOpen}
        onClose={() => {
          if (!submittingTier) {
            setIsTierModalOpen(false);
            setTierFormError(null);
          }
        }}
        title={t.createTierModalTitle}
        description={t.createTierModalDesc}
        size="md"
      >
        <form onSubmit={handleCreateTier} className="space-y-4">
          <Field label={t.tierNameLabel} required>
            <input
              type="text"
              required
              value={tierName}
              onChange={(e) => setTierName(e.target.value)}
              placeholder={isRtl ? "مثال: ثبت‌نام استاندارد هیئت علمی" : "e.g. Faculty Full Delegate"}
              className="ui-input"
            />
          </Field>

          <Field label={t.tierQuotaLabel} required>
            <input type="number" required min={1} value={tierQuota} onChange={(e) => setTierQuota(Number(e.target.value))} className="ui-input font-mono tabular" />
          </Field>

          <Field label={t.tierDescriptionLabel}>
            <textarea
              rows={2}
              value={tierDescription}
              onChange={(e) => setTierDescription(e.target.value)}
              placeholder={isRtl ? "شامل دسترسی به تمامی سخنرانی‌ها و نمایشگاه..." : "Includes access to all keynote sessions..."}
              className="ui-textarea"
            />
          </Field>

          <label
            htmlFor="tierIsOpenInput"
            className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl border border-border-default bg-surface-panel-subtle px-3.5 py-2.5 text-sm font-medium text-text-primary"
          >
            <input
              type="checkbox"
              id="tierIsOpenInput"
              checked={tierIsOpen}
              onChange={(e) => setTierIsOpen(e.target.checked)}
              className="size-4 shrink-0 accent-aiteb-indigo"
            />
            {t.tierIsOpenLabel}
          </label>

          {tierFormError && <FormAlert>{tierFormError}</FormAlert>}

          <DialogActions>
            <Button type="button" variant="ghost" size="md" onClick={() => setIsTierModalOpen(false)}>
              {cancelLabel}
            </Button>
            <Button type="submit" variant="primary" size="md" disabled={submittingTier}>
              {submittingTier ? "..." : t.saveTierAction}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* MODAL 2: Create Check-In Point */}
      <Dialog
        isOpen={isPointModalOpen}
        onClose={() => {
          if (!submittingPoint) {
            setIsPointModalOpen(false);
            setPointFormError(null);
          }
        }}
        title={t.createPointModalTitle}
        description={t.createPointModalDesc}
        size="md"
      >
        <form onSubmit={handleCreatePoint} className="space-y-4">
          <Field label={t.pointNameLabel} required>
            <input
              type="text"
              required
              value={pointName}
              onChange={(e) => setPointName(e.target.value)}
              placeholder={isRtl ? "مثال: گیت ورودی شمالی سالن ۱" : "e.g. North Gate Entrance"}
              className="ui-input"
            />
          </Field>

          <Field label={t.pointLocationLabel}>
            <input
              type="text"
              value={pointLocation}
              onChange={(e) => setPointLocation(e.target.value)}
              placeholder={isRtl ? "مثال: طبقه همکف، درب B" : "e.g. Ground Floor, Gate B"}
              className="ui-input"
            />
          </Field>

          <Field label={t.policyTypeLabel} required hint={policyMeta[policyType]?.desc}>
            <select value={policyType} onChange={(e) => setPolicyType(e.target.value as PolicyType)} className="ui-select">
              <option value="MULTI_ENTRY">{t.policyMultiEntry}</option>
              <option value="SINGLE_USE">{t.policySingleUse}</option>
              <option value="TIER_RESTRICTED">{t.policyTierRestricted}</option>
              <option value="CAPACITY_CAPPED">{t.policyCapacityCapped}</option>
            </select>
          </Field>

          {policyType === "CAPACITY_CAPPED" && (
            <Field label={t.maxCapacityLabel}>
              <input
                type="number"
                min={1}
                value={maxCapacity || ""}
                onChange={(e) => setMaxCapacity(e.target.value ? Number(e.target.value) : undefined)}
                placeholder="e.g. 250"
                className="ui-input font-mono tabular"
              />
            </Field>
          )}

          {pointFormError && <FormAlert>{pointFormError}</FormAlert>}

          <DialogActions>
            <Button type="button" variant="ghost" size="md" onClick={() => setIsPointModalOpen(false)}>
              {cancelLabel}
            </Button>
            <Button type="submit" variant="primary" size="md" disabled={submittingPoint}>
              {submittingPoint ? "..." : t.savePointAction}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* MODAL 3: Create Exhibition Booth */}
      <Dialog
        isOpen={isBoothModalOpen}
        onClose={() => {
          if (!submittingBooth) {
            setIsBoothModalOpen(false);
            setBoothFormError(null);
          }
        }}
        title={t.createBoothModalTitle}
        description={t.createBoothModalDesc}
        size="md"
      >
        <form onSubmit={handleCreateBooth} className="space-y-4">
          <Field label={t.boothNameLabel} required>
            <input
              type="text"
              required
              value={boothName}
              onChange={(e) => {
                setBoothName(e.target.value);
                if (!boothSlug) {
                  setBoothSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"));
                }
              }}
              placeholder={isRtl ? "مثال: شرکت پیشگامان زیست‌فناوری" : "e.g. Biotech Systems Global"}
              className="ui-input"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t.boothSlugLabel} required>
              <input
                type="text"
                required
                dir="ltr"
                value={boothSlug}
                onChange={(e) => setBoothSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                placeholder="biotech-systems"
                className="ui-input font-mono"
              />
            </Field>

            <Field label={t.boothLocationLabel}>
              <input
                type="text"
                value={boothLocation}
                onChange={(e) => setBoothLocation(e.target.value)}
                placeholder={isRtl ? "مثال: سالن B، استند شماره ۱۰۴" : "e.g. Hall B, Stand 104"}
                className="ui-input"
              />
            </Field>
          </div>

          <Field label={t.websiteUrlLabel}>
            <input
              type="url"
              dir="ltr"
              value={boothWebsite}
              onChange={(e) => setBoothWebsite(e.target.value)}
              placeholder="https://company.example.com"
              className="ui-input font-mono"
            />
          </Field>

          <Field label={t.brochureUrlLabel}>
            <input
              type="url"
              dir="ltr"
              value={boothBrochure}
              onChange={(e) => setBoothBrochure(e.target.value)}
              placeholder="https://company.example.com/brochure.pdf"
              className="ui-input font-mono"
            />
          </Field>

          <Field label={t.boothDescriptionLabel}>
            <textarea
              rows={2}
              value={boothDescription}
              onChange={(e) => setBoothDescription(e.target.value)}
              placeholder={isRtl ? "توضیح مختصر محصولات و فعالیت‌های غرفه..." : "Overview of company products..."}
              className="ui-textarea"
            />
          </Field>

          {boothFormError && <FormAlert>{boothFormError}</FormAlert>}

          <DialogActions>
            <Button type="button" variant="ghost" size="md" onClick={() => setIsBoothModalOpen(false)}>
              {cancelLabel}
            </Button>
            <Button type="submit" variant="primary" size="md" disabled={submittingBooth}>
              {submittingBooth ? "..." : t.saveBoothAction}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* MODAL 4: Assign Staff to Booth */}
      <Dialog
        isOpen={Boolean(assigningBooth)}
        onClose={() => {
          if (!assigningStaff) setAssigningBooth(null);
        }}
        title={t.assignStaffModalTitle}
        description={assigningBooth ? `${t.assignStaffModalDesc} (${assigningBooth.name})` : undefined}
        size="sm"
      >
        <form onSubmit={handleAssignStaff} className="space-y-4">
          <Field label={isRtl ? "نام نماینده" : "Representative name"}>
            <input
              type="text"
              autoComplete="off"
              maxLength={200}
              value={staffName}
              onChange={(e) => setStaffName(e.target.value)}
              placeholder={isRtl ? "مثال: سارا کریمی" : "e.g. Sara Karimi"}
              className="ui-input"
            />
          </Field>
          <Field
            label={t.staffMobileLabel}
            required
            hint={
              isRtl
                ? "صاحب این شماره با کد پیامکی وارد پورتال لیدهای غرفه می‌شود. اگر از قبل حساب داشته باشد، همان حساب استفاده می‌شود."
                : "The holder of this number signs in to the booth's lead portal with an SMS code. An existing account keeps its own name."
            }
          >
            <input
              type="tel"
              required
              dir="ltr"
              inputMode="tel"
              autoComplete="off"
              value={staffMobile}
              onChange={(e) => setStaffMobile(e.target.value)}
              placeholder="09xx xxx xxxx"
              className="ui-input font-mono"
            />
          </Field>

          {staffFeedback && (
            <div
              role="status"
              className="flex items-start gap-2.5 rounded-xl border border-status-success-border bg-status-success-bg px-3.5 py-3 text-sm text-status-success-text"
            >
              <Icon name="check-circle" size={18} className="mt-0.5 shrink-0" />
              <span>{staffFeedback}</span>
            </div>
          )}

          {staffError && <FormAlert>{staffError}</FormAlert>}

          <DialogActions>
            <Button type="button" variant="ghost" size="md" onClick={() => setAssigningBooth(null)}>
              {cancelLabel}
            </Button>
            <Button type="submit" variant="primary" size="md" disabled={assigningStaff}>
              {assigningStaff ? "..." : t.assignStaffAction}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* MODAL 5: Standee QR Preview */}
      <Dialog
        isOpen={Boolean(selectedBoothQr)}
        onClose={() => setSelectedBoothQr(null)}
        title={t.standeeQrModalTitle}
        description={selectedBoothQr ? `${t.standeeQrModalDesc} (${selectedBoothQr.name})` : undefined}
        size="sm"
      >
        {selectedBoothQr && (
          <div className="space-y-5 py-1">
            <div className="mx-auto max-w-[18rem] overflow-hidden shape-arc border border-border-default bg-white text-center shadow-lift">
              <div aria-hidden="true" className="h-1.5 bg-[image:var(--grad-aiteb)]" />
              <div className="space-y-4 px-6 pb-6 pt-5">
                <p className="truncate text-[0.6875rem] font-semibold text-text-muted">
                  <bdi>{event.name}</bdi>
                </p>
                <div className="org-plate mx-auto inline-block rounded-xl p-4 ring-1 ring-border-default">
                  <QRCode
                    value={selectedBoothQr.id}
                    size={180}
                    level="M"
                    viewBox="0 0 256 256"
                    fgColor="#0F172A"
                    bgColor="#FFFFFF"
                    className="h-48 w-48 select-none"
                  />
                </div>
                <div className="space-y-1">
                  <h3 className="break-words text-lg font-bold leading-snug text-text-primary">
                    <bdi>{selectedBoothQr.name}</bdi>
                  </h3>
                  <p className="text-xs text-text-secondary">{selectedBoothQr.location || "Exhibition Floor"}</p>
                </div>
                <p className="border-t border-border-subtle pt-3 font-mono text-[0.625rem] text-text-muted">
                  <bdi dir="ltr">Booth ID: {selectedBoothQr.id}</bdi>
                </p>
              </div>
            </div>
            <Button type="button" variant="ink" size="md" isFullWidth onClick={() => window.print()}>
              <Icon name="print" size={18} />
              {isRtl ? "چاپ کیوآرکد استند" : "Print Standee QR"}
            </Button>
          </div>
        )}
      </Dialog>

      {/* EDIT EVENT MODAL */}
      <Dialog
        isOpen={isEditEventModalOpen}
        onClose={() => {
          if (!submittingEventEdit) {
            setIsEditEventModalOpen(false);
            setEventEditError(null);
          }
        }}
        title={t.editEventTitle || (isRtl ? "ویرایش مشخصات همایش" : "Edit Event")}
        description={t.editEventDesc || (isRtl ? "ویرایش عنوان، محل برگزاری، توضیحات و زمان‌بندی همایش." : "Update event details.")}
        size="lg"
      >
        {event && (
          <form onSubmit={handleUpdateEvent} className="space-y-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={t.eventNameLabel} required className="sm:col-span-2">
                <input type="text" required value={editEventName} onChange={(e) => setEditEventName(e.target.value)} className="ui-input" />
              </Field>

              <Field
                label={t.eventSlugLabel}
                className="sm:col-span-2"
                hint={
                  isRtl
                    ? "شناسه اختصاصی اینترنتی (اسلاگ) جهت حفظ پیوند کارت‌ها و آدرس‌های عمومی ثابت می‌ماند."
                    : "The public URL slug is preserved to protect published links and attendee passes."
                }
              >
                <input type="text" disabled dir="ltr" value={event.slug} className="ui-input font-mono" />
              </Field>

              <Field label={t.startsAtLabel} required>
                <input type="datetime-local" required value={editEventStartsAt} onChange={(e) => setEditEventStartsAt(e.target.value)} className="ui-input font-mono" />
              </Field>

              <Field label={t.endsAtLabel} required>
                <input type="datetime-local" required value={editEventEndsAt} onChange={(e) => setEditEventEndsAt(e.target.value)} className="ui-input font-mono" />
              </Field>

              <Field label={t.locationLabel} required className="sm:col-span-2">
                <input type="text" required value={editEventLocation} onChange={(e) => setEditEventLocation(e.target.value)} className="ui-input" />
              </Field>

              <Field label={t.descriptionLabel} className="sm:col-span-2">
                <textarea rows={3} value={editEventDescription} onChange={(e) => setEditEventDescription(e.target.value)} className="ui-textarea" />
              </Field>
            </div>

            {eventEditError && <FormAlert>{eventEditError}</FormAlert>}

            <DialogActions>
              <Button type="button" variant="ghost" size="md" disabled={submittingEventEdit} onClick={() => setIsEditEventModalOpen(false)}>
                {t.cancelAction || cancelLabel}
              </Button>
              <Button type="submit" variant="primary" size="md" disabled={submittingEventEdit}>
                {submittingEventEdit ? t.savingAction || "..." : t.saveChangesAction || (isRtl ? "ذخیره تغییرات" : "Save Changes")}
              </Button>
            </DialogActions>
          </form>
        )}
      </Dialog>

      {/* EDIT TIER MODAL */}
      <Dialog
        isOpen={editingTier !== null}
        onClose={() => {
          if (!submittingTierEdit) {
            setEditingTier(null);
            setTierEditError(null);
          }
        }}
        title={t.editTierTitle || (isRtl ? "ویرایش رده بلیت و سهمیه" : "Edit Ticket Tier")}
        description={t.editTierDesc || (isRtl ? "ویرایش نام، توضیحات، سهمیه و وضعیت ثبت‌نام رده." : "Update tier details.")}
        size="md"
      >
        {editingTier && (
          <form onSubmit={handleUpdateTier} className="space-y-4">
            <Field label={t.tierNameLabel} required>
              <input type="text" required value={editTierName} onChange={(e) => setEditTierName(e.target.value)} className="ui-input" />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label={t.tierQuotaLabel}
                required
                hint={isRtl ? "سهمیه نمی‌تواند کمتر از بلیت‌های صادرشده باشد." : "Quota cannot fall below confirmed registrations."}
              >
                <input
                  type="number"
                  required
                  min={1}
                  value={editTierQuota}
                  onChange={(e) => setEditTierQuota(parseInt(e.target.value) || 0)}
                  className="ui-input font-mono tabular"
                />
              </Field>

              <Field label={t.tierStatusLabel || (isRtl ? "وضعیت ثبت‌نام" : "Registration Status")}>
                <select value={editTierIsOpen ? "open" : "closed"} onChange={(e) => setEditTierIsOpen(e.target.value === "open")} className="ui-select">
                  <option value="open">{t.tierOpenOption || (isRtl ? "باز جهت ثبت‌نام و صدور بلیت" : "Open for Registration")}</option>
                  <option value="closed">{t.tierClosedOption || (isRtl ? "بسته شده (عدم پذیرش ثبت‌نام)" : "Closed")}</option>
                </select>
              </Field>
            </div>

            <Field label={t.tierDescriptionLabel || (isRtl ? "توضیحات و مزایای رده" : "Tier Description")}>
              <textarea rows={2} value={editTierDescription} onChange={(e) => setEditTierDescription(e.target.value)} className="ui-textarea" />
            </Field>

            {tierEditError && <FormAlert>{tierEditError}</FormAlert>}

            <DialogActions>
              <Button type="button" variant="ghost" size="md" disabled={submittingTierEdit} onClick={() => setEditingTier(null)}>
                {t.cancelAction || cancelLabel}
              </Button>
              <Button type="submit" variant="primary" size="md" disabled={submittingTierEdit}>
                {submittingTierEdit ? t.savingAction || "..." : t.saveChangesAction || (isRtl ? "ذخیره تغییرات" : "Save Changes")}
              </Button>
            </DialogActions>
          </form>
        )}
      </Dialog>

      {/* EDIT POINT MODAL */}
      <Dialog
        isOpen={editingPoint !== null}
        onClose={() => {
          if (!submittingPointEdit) {
            setEditingPoint(null);
            setPointEditError(null);
          }
        }}
        title={t.editPointTitle || (isRtl ? "ویرایش گیت پذیرش" : "Edit Check-In Point")}
        description={t.editPointDesc || (isRtl ? "ویرایش نام، محل استقرار و ظرفیت گیت." : "Update gate details.")}
        size="md"
      >
        {editingPoint && (
          <form onSubmit={handleUpdatePoint} className="space-y-4">
            <Field label={t.pointNameLabel} required>
              <input type="text" required value={editPointName} onChange={(e) => setEditPointName(e.target.value)} className="ui-input" />
            </Field>

            <Field label={t.pointLocationLabel}>
              <input
                type="text"
                value={editPointLocation}
                onChange={(e) => setEditPointLocation(e.target.value)}
                placeholder={isRtl ? "مثال: ورودی سالن اصلی، طبقه ۱" : "e.g. Main Hall North, Floor 1"}
                className="ui-input"
              />
            </Field>

            <Field
              label={t.policyTypeLabel}
              hint={t.policyLockedNotice || (isRtl ? "سیاست پذیرش پس از ثبت اسکن جهت حفظ یکپارچگی مانیفست قفل می‌شود." : "Policy locked once scans are recorded.")}
            >
              <select value={editPointPolicy} onChange={(e) => setEditPointPolicy(e.target.value as PolicyType)} className="ui-select">
                <option value="MULTI_ENTRY">{t.policyMultiEntry}</option>
                <option value="SINGLE_USE">{t.policySingleUse}</option>
                <option value="TIER_RESTRICTED">{t.policyTierRestricted}</option>
                <option value="CAPACITY_CAPPED">{t.policyCapacityCapped}</option>
              </select>
            </Field>

            {editPointPolicy === "TIER_RESTRICTED" && (
              <fieldset className="space-y-2 rounded-xl border border-border-default bg-surface-panel-subtle p-3.5">
                <legend className="sr-only">{t.allowedTiersLabel}</legend>
                <span aria-hidden="true" className="ui-label">
                  {t.allowedTiersLabel}
                  <span className="ms-1 text-status-danger-solid">*</span>
                </span>
                <div className="max-h-40 space-y-1 overflow-y-auto">
                  {tiers.map((tr) => (
                    <label
                      key={tr.id}
                      className="flex min-h-[40px] cursor-pointer items-center gap-3 rounded-lg px-2 text-sm text-text-secondary transition-colors hover:bg-surface-panel"
                    >
                      <input
                        type="checkbox"
                        checked={editPointAllowedTiers.includes(tr.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setEditPointAllowedTiers((prev) => [...prev, tr.id]);
                          } else {
                            setEditPointAllowedTiers((prev) => prev.filter((id) => id !== tr.id));
                          }
                        }}
                        className="size-4 shrink-0 accent-aiteb-indigo"
                      />
                      <span>{tr.name}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            {editPointPolicy === "CAPACITY_CAPPED" && (
              <Field label={t.maxCapacityLabel}>
                <input
                  type="number"
                  min={1}
                  value={editPointMaxCapacity ?? ""}
                  onChange={(e) => setEditPointMaxCapacity(e.target.value ? parseInt(e.target.value) : undefined)}
                  placeholder="200"
                  className="ui-input font-mono tabular"
                />
              </Field>
            )}

            {pointEditError && <FormAlert>{pointEditError}</FormAlert>}

            <DialogActions>
              <Button type="button" variant="ghost" size="md" disabled={submittingPointEdit} onClick={() => setEditingPoint(null)}>
                {t.cancelAction || cancelLabel}
              </Button>
              <Button type="submit" variant="primary" size="md" disabled={submittingPointEdit}>
                {submittingPointEdit ? t.savingAction || "..." : t.saveChangesAction || (isRtl ? "ذخیره تغییرات" : "Save Changes")}
              </Button>
            </DialogActions>
          </form>
        )}
      </Dialog>

      {/* MODAL: Add Desk Operator */}
      <Dialog
        isOpen={isOperatorModalOpen}
        onClose={() => {
          if (!submittingOperator) {
            setIsOperatorModalOpen(false);
            setOperatorFormError(null);
          }
        }}
        title={t.addOperatorModalTitle}
        description={t.addOperatorModalDesc}
        size="md"
      >
          <form onSubmit={handleCreateOperator} className="space-y-4">
            <Field label={t.operatorNameLabel} required>
              <input
                type="text"
                required
                value={newOperatorName}
                onChange={(e) => setNewOperatorName(e.target.value)}
                placeholder={isRtl ? "مثال: مریم باقری (مسئول گیت پذیرش)" : "e.g. Maryam Bagheri"}
                className="ui-input"
              />
            </Field>

            <Field
              label={t.operatorMobileLabel}
              required
              hint={isRtl ? "اپراتور با کد پیامکی به همین شماره وارد میز پذیرش می‌شود." : "The operator signs in to the Front Desk with an SMS code sent to this number."}
            >
              <input
                type="tel"
                required
                dir="ltr"
                inputMode="tel"
                autoComplete="off"
                value={newOperatorMobile}
                onChange={(e) => setNewOperatorMobile(e.target.value)}
                placeholder="09xx xxx xxxx"
                className="ui-input font-mono"
              />
            </Field>

            {operatorFormError && <FormAlert>{operatorFormError}</FormAlert>}

            <DialogActions>
              <Button type="button" variant="ghost" size="md" disabled={submittingOperator} onClick={() => setIsOperatorModalOpen(false)}>
                {cancelLabel}
              </Button>
              <Button type="submit" variant="primary" size="md" disabled={submittingOperator}>
                {submittingOperator ? "..." : isRtl ? "صدور دسترسی اپراتور" : "Authorize Operator"}
              </Button>
            </DialogActions>
          </form>
      </Dialog>

      {/* MODAL: Pair Scanner Device */}
      {apiKey && (
        <ScannerPairingDialog
          point={pairingPoint}
          apiKey={apiKey}
          locale={locale}
          isRtl={isRtl}
          onKeyRejected={onKeyRejected}
          onClose={() => setPairingPoint(null)}
        />
      )}

      {/* Confirmations render last so they always stack above any open form dialog. */}
      <ConfirmDialog
        isOpen={revokeTarget !== null}
        tone="danger"
        title={isRtl ? "لغو دسترسی اپراتور؟" : "Revoke operator access?"}
        description={
          revokeTarget
            ? isRtl
              ? `${revokeTarget.operator_name} دیگر نمی‌تواند وارد میز پذیرش شود و نشست‌های فعال او بی‌اعتبار می‌شود.`
              : `${revokeTarget.operator_name} will no longer be able to use the reception desk and any active session stops working.`
            : ""
        }
        confirmLabel={t.revokeOperatorAction}
        cancelLabel={cancelLabel}
        onCancel={() => setRevokeTarget(null)}
        onConfirm={() => {
          const target = revokeTarget;
          setRevokeTarget(null);
          if (target) void handleRevokeOperator(target.id);
        }}
      />

      <ConfirmDialog
        isOpen={confirmCloseTier}
        title={isRtl ? "بستن این رده بلیط؟" : "Close this ticket tier?"}
        description={
          isRtl
            ? "پس از بستن، شرکت‌کنندگان جدید نمی‌توانند این رده را رزرو کنند. رزروهای موجود حفظ می‌شود."
            : "New attendees will no longer be able to reserve this tier. Existing reservations are kept."
        }
        confirmLabel={isRtl ? "بستن رده" : "Close tier"}
        cancelLabel={cancelLabel}
        onCancel={() => setConfirmCloseTier(false)}
        onConfirm={() => {
          closeTierConfirmed.current = true;
          setConfirmCloseTier(false);
          void handleUpdateTier();
        }}
      />
    </div>
  );
}
