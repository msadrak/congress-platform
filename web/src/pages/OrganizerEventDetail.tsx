import React, { useEffect, useState } from "react";
import QRCode from "react-qr-code";
import { Link, useOutletContext, useParams } from "react-router-dom";
import {
  createApiClient,
  formatApiError,
  type BoothOut,
  type CheckInPointOut,
  type DeskOperatorCreated,
  type DeskOperatorOut,
  type EventOut,
  type TicketTierOut,
} from "../api/client";
import { formatLocalizedDate, formatLocalizedNumber } from "../lib/i18n";
import type { OrganizerOutletContext } from "./OrganizerLayout";
import { Badge } from "../components/ui/Badge";
import { Button, LinkButton } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Dialog } from "../components/ui/Dialog";

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
  const { apiKey, onKeyRejected, locale, t, isRtl } = useOutletContext<OrganizerOutletContext>();

  const [event, setEvent] = useState<EventOut | null>(null);
  const [tiers, setTiers] = useState<TicketTierOut[]>([]);
  const [points, setPoints] = useState<CheckInPointOut[]>([]);
  const [booths, setBooths] = useState<BoothOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Active section tab
  const [activeTab, setActiveTab] = useState<"overview" | "tiers" | "points" | "booths" | "operators">("overview");

  // Front desk operators state
  const [operators, setOperators] = useState<DeskOperatorOut[]>([]);
  const [isOperatorModalOpen, setIsOperatorModalOpen] = useState(false);
  const [newOperatorName, setNewOperatorName] = useState("");
  const [newOperatorEmail, setNewOperatorEmail] = useState("");
  const [submittingOperator, setSubmittingOperator] = useState(false);
  const [operatorFormError, setOperatorFormError] = useState<string | null>(null);
  const [createdOperatorResult, setCreatedOperatorResult] = useState<DeskOperatorCreated | null>(null);
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
  const [staffEmail, setStaffEmail] = useState("");
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
    }
  };

  const handleAssignStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventId || !assigningBooth || !staffEmail.trim()) return;

    if (!apiKey) return;
    setAssigningStaff(true);
    setStaffError(null);
    setStaffFeedback(null);
    const client = createApiClient({ kind: "organizer", token: apiKey });

    const { data, error: err, response } = await client.POST(
      "/api/events/{event_id}/booths/{booth_id}/staff",
      {
        params: { path: { event_id: eventId, booth_id: assigningBooth.id } },
        body: { email: staffEmail.trim() },
      }
    );

    if (response.status === 401) onKeyRejected(apiKey);
    setAssigningStaff(false);
    if (err) {
      setStaffError(formatApiError(err));
    } else if (data) {
      setStaffFeedback(isRtl ? "نماینده با موفقیت به غرفه تخصیص یافت." : "Representative assigned successfully.");
      setStaffEmail("");
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
    if (!newOperatorName.trim() || !newOperatorEmail.trim()) {
      setOperatorFormError(isRtl ? "لطفاً نام و ایمیل اپراتور را وارد نمایید." : "Please enter operator name and email.");
      return;
    }
    if (!apiKey) return;
    setSubmittingOperator(true);
    const client = createApiClient({ kind: "organizer", token: apiKey });
    const { data, error: err, response } = await client.POST("/api/events/{event_id}/desk/operators", {
      params: { path: { event_id: eventId } },
      body: {
        operator_name: newOperatorName.trim(),
        email: newOperatorEmail.trim().toLowerCase(),
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
      setNewOperatorEmail("");
      if (data.temporary_password) {
        setCreatedOperatorResult(data);
      } else {
        setIsOperatorModalOpen(false);
      }
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
      // ignore
    } else if (data) {
      setOperators((prev) => prev.map((o) => (o.id === data.id ? data : o)));
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

  const handleUpdateTier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTier || !eventId) return;
    setTierEditError(null);
    if (!editTierName.trim() || editTierQuota < 1) {
      setTierEditError(isRtl ? "لطفاً نام رده و ظرفیت معتبر وارد نمایید." : "Please enter a valid tier name and quota.");
      return;
    }
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
    }
  };
  if (loading && !event) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="w-64 h-8 bg-surface-panel-subtle rounded-xl" />
        <div className="h-64 bg-surface-panel rounded-2xl border border-border-default" />
      </div>
    );
  }

  if (error || !event) {
    return (
      <Card className="p-8 sm:p-12 text-center space-y-4 border-border-default">
        <div className="text-3xl">⚠️</div>
        <h1 className="text-xl font-bold text-text-primary">
          {isRtl ? "خطا در بارگذاری همایش" : "Failed to Load Event"}
        </h1>
        <p className="text-sm text-text-secondary">{error}</p>
        <LinkButton to="/organizer" variant="secondary" size="md">
          {t.breadcrumbEvents}
        </LinkButton>
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      {/* 1. Event Master Header & Context */}
      <div className="p-6 sm:p-8 rounded-3xl bg-surface-panel border border-border-default shadow-xs space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
          <div className="space-y-2.5 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="brand" size="sm">
                {t.breadcrumbEventConfig}
              </Badge>
              <span className="text-xs text-text-muted">•</span>
              <span className="text-xs font-mono text-text-muted">
                <bdi dir="ltr">/e/{event.slug}</bdi>
              </span>
            </div>

            <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-text-primary">
              {event.name}
            </h1>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-secondary font-medium pt-1">
              <span>📍 {event.location}</span>
              <span>
                📅 {formatLocalizedDate(event.starts_at, locale)} – {formatLocalizedDate(event.ends_at, locale)}
              </span>
            </div>
          </div>

          {/* Quick Real Links to Operational Stations */}
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <LinkButton
              to={`/organizer/events/${event.id}/desk`}
              variant="primary"
              size="sm"
              className="gap-1.5"
            >
              <span>🖨️</span>
              <span>{t.openDeskAction}</span>
            </LinkButton>

            <LinkButton
              to={`/organizer/events/${event.id}/analytics`}
              variant="secondary"
              size="sm"
              className="gap-1.5"
            >
              <span>📊</span>
              <span>{t.openAnalyticsAction}</span>
            </LinkButton>

            <Button
              onClick={openEditEventModal}
              variant="secondary"
              size="sm"
              className="gap-1.5"
            >
              <span>✏️</span>
              <span>{t.editEventAction || (isRtl ? "ویرایش همایش" : "Edit Event")}</span>
            </Button>

            <a
              href={`/e/${event.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-action-primary hover:bg-action-subtle transition-colors focus-visible:outline-2 focus-visible:outline-focus-ring"
            >
              <span>{t.openPublicPageAction}</span>
              <span aria-hidden="true">↗</span>
            </a>
          </div>
        </div>

        {/* Task-Oriented Navigation Tabs */}
        <div
          role="tablist"
          aria-label={t.breadcrumbEventConfig}
          className="flex border-b border-border-subtle pt-2 overflow-x-auto gap-2"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "overview"}
            onClick={() => setActiveTab("overview")}
            className={`pb-3 px-3 text-xs sm:text-sm font-bold border-b-2 transition-colors shrink-0 cursor-pointer ${
              activeTab === "overview"
                ? "border-action-primary text-action-primary"
                : "border-transparent text-text-muted hover:text-text-primary"
            }`}
          >
            📋 {t.tabOverview}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "tiers"}
            onClick={() => setActiveTab("tiers")}
            className={`pb-3 px-3 text-xs sm:text-sm font-bold border-b-2 transition-colors shrink-0 cursor-pointer ${
              activeTab === "tiers"
                ? "border-action-primary text-action-primary"
                : "border-transparent text-text-muted hover:text-text-primary"
            }`}
          >
            🎫 {t.tabTiers} ({tiers.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "points"}
            onClick={() => setActiveTab("points")}
            className={`pb-3 px-3 text-xs sm:text-sm font-bold border-b-2 transition-colors shrink-0 cursor-pointer ${
              activeTab === "points"
                ? "border-action-primary text-action-primary"
                : "border-transparent text-text-muted hover:text-text-primary"
            }`}
          >
            🚪 {t.tabPoints} ({points.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "booths"}
            onClick={() => setActiveTab("booths")}
            className={`pb-3 px-3 text-xs sm:text-sm font-bold border-b-2 transition-colors shrink-0 cursor-pointer ${
              activeTab === "booths"
                ? "border-action-primary text-action-primary"
                : "border-transparent text-text-muted hover:text-text-primary"
            }`}
          >
            🏢 {t.tabBooths} ({booths.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "operators"}
            onClick={() => setActiveTab("operators")}
            className={`pb-3 px-3 text-xs sm:text-sm font-bold border-b-2 transition-colors shrink-0 cursor-pointer ${
              activeTab === "operators"
                ? "border-action-primary text-action-primary"
                : "border-transparent text-text-muted hover:text-text-primary"
            }`}
          >
            👥 {t.tabOperators} ({operators.filter((o) => !o.is_revoked).length})
          </button>
        </div>
      </div>

      {/* 2. Task Section Content */}

      {/* TAB A: Overview */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-5 rounded-2xl bg-surface-panel border border-border-default shadow-xs space-y-1">
              <span className="text-xs font-semibold text-text-muted block">{t.tabTiers}</span>
              <span className="text-2xl font-extrabold text-text-primary block">
                {formatLocalizedNumber(tiers.length, locale)}
              </span>
              <span className="text-[11px] text-text-secondary block">
                {isRtl ? "رده فعال پذیرش" : "Active ticket tiers"}
              </span>
            </div>

            <div className="p-5 rounded-2xl bg-surface-panel border border-border-default shadow-xs space-y-1">
              <span className="text-xs font-semibold text-text-muted block">{t.tabPoints}</span>
              <span className="text-2xl font-extrabold text-text-primary block">
                {formatLocalizedNumber(points.length, locale)}
              </span>
              <span className="text-[11px] text-text-secondary block">
                {isRtl ? "ایستگاه اسکن بارکد" : "Gate scanner stations"}
              </span>
            </div>

            <div className="p-5 rounded-2xl bg-surface-panel border border-border-default shadow-xs space-y-1">
              <span className="text-xs font-semibold text-text-muted block">{t.tabBooths}</span>
              <span className="text-2xl font-extrabold text-text-primary block">
                {formatLocalizedNumber(booths.length, locale)}
              </span>
              <span className="text-[11px] text-text-secondary block">
                {isRtl ? "غرفه تجاری ثبت‌شده" : "Exhibitor stands"}
              </span>
            </div>
          </div>

          {/* Operational Stations Card Grid */}
          <div className="space-y-3">
            <h2 className="text-base font-bold text-text-primary tracking-tight">
              {t.fastActionsHeading}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-5 rounded-2xl bg-surface-panel border border-border-default shadow-xs flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <h3 className="font-bold text-sm text-text-primary flex items-center gap-1.5">
                    <span>🖨️</span>
                    <span>{t.openDeskAction}</span>
                  </h3>
                  <p className="text-xs text-text-secondary leading-relaxed">
                    {t.deskStationDesc}
                  </p>
                </div>
                <LinkButton to={`/organizer/events/${event.id}/desk`} variant="secondary" size="sm">
                  {isRtl ? "ورود" : "Open"} →
                </LinkButton>
              </div>

              <div className="p-5 rounded-2xl bg-surface-panel border border-border-default shadow-xs flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <h3 className="font-bold text-sm text-text-primary flex items-center gap-1.5">
                    <span>📊</span>
                    <span>{t.openAnalyticsAction}</span>
                  </h3>
                  <p className="text-xs text-text-secondary leading-relaxed">
                    {t.analyticsStationDesc}
                  </p>
                </div>
                <LinkButton to={`/organizer/events/${event.id}/analytics`} variant="secondary" size="sm">
                  {isRtl ? "مشاهده" : "View"} →
                </LinkButton>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB B: Ticket Tiers */}
      {activeTab === "tiers" && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-lg sm:text-xl font-bold tracking-tight text-text-primary">
                {t.tiersHeading}
              </h2>
              <p className="text-xs sm:text-sm text-text-secondary">
                {t.tiersDesc}
              </p>
            </div>
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={() => setIsTierModalOpen(true)}
              className="gap-2 shrink-0 shadow-xs"
            >
              <span>+</span>
              <span>{t.createTierButton}</span>
            </Button>
          </div>

          {tiers.length === 0 ? (
            <Card className="p-8 text-center text-xs text-text-muted border-border-default">
              {t.noTiersTitle}
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {tiers.map((tier) => (
                <div
                  key={tier.id}
                  className="p-5 rounded-2xl bg-surface-panel border border-border-default shadow-xs space-y-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-bold text-base text-text-primary">
                      {tier.name}
                    </h3>
                    <div className="flex items-center gap-1.5">
                      {(tier.reserved_count ?? 0) >= tier.quota ? (
                        <Badge variant="neutral" size="sm" className="bg-amber-100 text-amber-900 border-amber-300">
                          {t.tierStatusSoldOut || (isRtl ? "تکمیل ظرفیت" : "Sold Out")}
                        </Badge>
                      ) : !tier.is_open ? (
                        <Badge variant="neutral" size="sm">
                          {t.tierStatusClosed}
                        </Badge>
                      ) : (
                        <Badge variant="success" size="sm">
                          {t.tierStatusOpen}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-text-secondary leading-relaxed">
                    {tier.description || (isRtl ? "دسترسی عمومی به سالن‌های همایش." : "General congress admission.")}
                  </p>
                  <div className="pt-2 border-t border-border-subtle flex items-center justify-between text-xs text-text-muted">
                    <span>
                      {isRtl ? "ثبت‌نام‌شده:" : "Registered:"}{" "}
                      <strong className="text-text-primary">{formatLocalizedNumber(tier.reserved_count ?? 0, locale)}</strong> /{" "}
                      {formatLocalizedNumber(tier.quota, locale)}
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => openEditTierModal(tier)}
                        className="gap-1 text-xs py-1 px-2.5"
                      >
                        <span>✏️</span>
                        <span>{t.editTierAction || (isRtl ? "ویرایش" : "Edit")}</span>
                      </Button>
                      <span className="text-[11px] font-mono text-text-muted">
                        <bdi dir="ltr">ID: {tier.id.slice(0, 8)}</bdi>
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB C: Check-In Points */}
      {activeTab === "points" && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-lg sm:text-xl font-bold tracking-tight text-text-primary">
                {t.pointsHeading}
              </h2>
              <p className="text-xs sm:text-sm text-text-secondary">
                {t.pointsDesc}
              </p>
            </div>
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={() => setIsPointModalOpen(true)}
              className="gap-2 shrink-0 shadow-xs"
            >
              <span>+</span>
              <span>{t.createPointButton}</span>
            </Button>
          </div>

          {points.length === 0 ? (
            <Card className="p-8 text-center text-xs text-text-muted border-border-default">
              {t.noPointsTitle}
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {points.map((pt) => {
                let policyLabel = pt.policy_type;
                let policyDesc = "";
                if (pt.policy_type === "SINGLE_USE") {
                  policyLabel = t.policySingleUse;
                  policyDesc = t.policySingleUseDesc;
                } else if (pt.policy_type === "MULTI_ENTRY") {
                  policyLabel = t.policyMultiEntry;
                  policyDesc = t.policyMultiEntryDesc;
                } else if (pt.policy_type === "TIER_RESTRICTED") {
                  policyLabel = t.policyTierRestricted;
                  policyDesc = t.policyTierRestrictedDesc;
                } else if (pt.policy_type === "CAPACITY_CAPPED") {
                  policyLabel = t.policyCapacityCapped;
                  policyDesc = t.policyCapacityCappedDesc;
                }

                return (
                  <div
                    key={pt.id}
                    className="p-5 rounded-2xl bg-surface-panel border border-border-default shadow-xs space-y-3.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-bold text-base text-text-primary">
                        {pt.name}
                      </h3>
                      <Badge variant="brand" size="sm">
                        {policyLabel}
                      </Badge>
                    </div>

                    <div className="text-xs text-text-secondary space-y-1">
                      <p>📍 {pt.location || (isRtl ? "درب اصلی ورودی" : "Main Gate Area")}</p>
                      <p className="text-[11px] text-text-muted leading-relaxed">
                        {policyDesc}
                      </p>
                    </div>

                    <div className="pt-2 border-t border-border-subtle flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <Link
                          to={`/scan/${pt.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-semibold text-action-primary hover:underline focus-visible:outline-focus-ring flex items-center gap-1"
                        >
                          <span>{t.openScannerAction}</span>
                          <span aria-hidden="true">↗</span>
                        </Link>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => openEditPointModal(pt)}
                          className="gap-1 text-xs py-1 px-2.5"
                        >
                          <span>✏️</span>
                          <span>{t.editPointAction || (isRtl ? "ویرایش" : "Edit")}</span>
                        </Button>
                      </div>
                      <span className="text-[11px] font-mono text-text-muted">
                        <bdi dir="ltr">Point: {pt.id.slice(0, 8)}</bdi>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB D: Exhibition Booths */}
      {activeTab === "booths" && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-lg sm:text-xl font-bold tracking-tight text-text-primary">
                {t.boothsHeading}
              </h2>
              <p className="text-xs sm:text-sm text-text-secondary">
                {t.boothsDesc}
              </p>
            </div>
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={() => setIsBoothModalOpen(true)}
              className="gap-2 shrink-0 shadow-xs"
            >
              <span>+</span>
              <span>{t.createBoothButton}</span>
            </Button>
          </div>

          {booths.length === 0 ? (
            <Card className="p-8 text-center text-xs text-text-muted border-border-default">
              {t.noBoothsTitle}
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {booths.map((b) => (
                <div
                  key={b.id}
                  className="p-5 rounded-2xl bg-surface-panel border border-border-default shadow-xs space-y-4"
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant="neutral" size="sm">
                        {b.location || (isRtl ? "سالن نمایشگاه" : "Stand Area")}
                      </Badge>
                      <span className="text-[11px] font-mono text-text-muted">
                        <bdi dir="ltr">/booth/{b.id.slice(0, 8)}</bdi>
                      </span>
                    </div>
                    <h3 className="font-bold text-base text-text-primary">
                      {b.name}
                    </h3>
                    {b.description && (
                      <p className="text-xs text-text-secondary line-clamp-2 leading-relaxed">
                        {b.description}
                      </p>
                    )}
                  </div>

                  <div className="pt-2 border-t border-border-subtle flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setAssigningBooth(b);
                          setStaffEmail("");
                          setStaffFeedback(null);
                          setStaffError(null);
                        }}
                      >
                        👥 {t.assignStaffButton}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedBoothQr(b)}
                      >
                        📱 {t.standeeQrButton}
                      </Button>
                    </div>

                    <Link
                      to={`/e/${event.slug}/booths/${b.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-semibold text-action-primary hover:underline"
                    >
                      {t.viewBoothAction} ↗
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB E: Front Desk Operators */}
      {activeTab === "operators" && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-lg sm:text-xl font-bold tracking-tight text-text-primary">
                {t.operatorsHeading}
              </h2>
              <p className="text-xs sm:text-sm text-text-secondary">
                {t.operatorsDesc}
              </p>
            </div>
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={() => {
                setCreatedOperatorResult(null);
                setOperatorFormError(null);
                setIsOperatorModalOpen(true);
              }}
              className="gap-2 shrink-0 shadow-xs"
            >
              <span>+</span>
              <span>{t.addOperatorButton}</span>
            </Button>
          </div>

          {operators.length === 0 ? (
            <Card className="p-8 text-center text-xs text-text-muted border-border-default">
              {t.noOperatorsTitle}
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {operators.map((op) => (
                <div
                  key={op.id}
                  className={`p-5 rounded-2xl bg-surface-panel border shadow-xs space-y-3.5 transition-all ${
                    op.is_revoked
                      ? "border-border-subtle bg-neutral-50/60 opacity-80"
                      : "border-border-default"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">👤</span>
                      <div>
                        <h3 className="font-bold text-base text-text-primary">
                          {op.operator_name}
                        </h3>
                        <span className="text-xs font-mono text-text-muted">
                          {op.email}
                        </span>
                      </div>
                    </div>
                    <Badge variant={op.is_revoked ? "neutral" : "success"} size="sm">
                      {op.is_revoked ? t.operatorStatusRevoked : t.operatorStatusActive}
                    </Badge>
                  </div>

                  <div className="pt-2 border-t border-border-subtle flex items-center justify-between text-xs text-text-muted">
                    <span>
                      {isRtl ? "ثبت دسترسی:" : "Assigned:"} {formatLocalizedDate(op.created_at, locale)}
                    </span>
                    {!op.is_revoked ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={revokingOperatorId === op.id}
                        onClick={() => handleRevokeOperator(op.id)}
                        className="text-xs py-1 px-2.5 text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                      >
                        {revokingOperatorId === op.id ? "..." : t.revokeOperatorAction}
                      </Button>
                    ) : (
                      <span className="text-[11px] text-red-600 font-medium">
                        {isRtl ? "لغو شده" : "Revoked"}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
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
          <div>
            <label className="block text-xs font-semibold text-text-primary mb-1">
              {t.tierNameLabel} <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={tierName}
              onChange={(e) => setTierName(e.target.value)}
              placeholder={isRtl ? "مثال: ثبت‌نام استاندارد هیئت علمی" : "e.g. Faculty Full Delegate"}
              className="w-full px-3.5 py-2.5 bg-white border border-border-default rounded-xl text-sm text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-primary mb-1">
              {t.tierQuotaLabel} <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              required
              min={1}
              value={tierQuota}
              onChange={(e) => setTierQuota(Number(e.target.value))}
              className="w-full px-3.5 py-2.5 bg-white border border-border-default rounded-xl text-sm font-mono text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-primary mb-1">
              {t.tierDescriptionLabel}
            </label>
            <textarea
              rows={2}
              value={tierDescription}
              onChange={(e) => setTierDescription(e.target.value)}
              placeholder={isRtl ? "شامل دسترسی به تمامی سخنرانی‌ها و نمایشگاه..." : "Includes access to all keynote sessions..."}
              className="w-full p-3 bg-white border border-border-default rounded-xl text-sm text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="tierIsOpenInput"
              checked={tierIsOpen}
              onChange={(e) => setTierIsOpen(e.target.checked)}
              className="rounded text-action-primary focus:ring-action-primary"
            />
            <label htmlFor="tierIsOpenInput" className="text-xs font-medium text-text-primary cursor-pointer">
              {t.tierIsOpenLabel}
            </label>
          </div>

          {tierFormError && (
            <div role="alert" aria-live="assertive" className="p-3 rounded-xl bg-status-danger-bg text-status-danger-text border border-status-danger-border text-xs">
              {tierFormError}
            </div>
          )}

          <div className="pt-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="md" onClick={() => setIsTierModalOpen(false)}>
              {isRtl ? "انصراف" : "Cancel"}
            </Button>
            <Button type="submit" variant="primary" size="md" disabled={submittingTier}>
              {submittingTier ? "..." : t.saveTierAction}
            </Button>
          </div>
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
          <div>
            <label className="block text-xs font-semibold text-text-primary mb-1">
              {t.pointNameLabel} <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={pointName}
              onChange={(e) => setPointName(e.target.value)}
              placeholder={isRtl ? "مثال: گیت ورودی شمالی سالن ۱" : "e.g. North Gate Entrance"}
              className="w-full px-3.5 py-2.5 bg-white border border-border-default rounded-xl text-sm text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-primary mb-1">
              {t.pointLocationLabel}
            </label>
            <input
              type="text"
              value={pointLocation}
              onChange={(e) => setPointLocation(e.target.value)}
              placeholder={isRtl ? "مثال: طبقه همکف، درب B" : "e.g. Ground Floor, Gate B"}
              className="w-full px-3.5 py-2.5 bg-white border border-border-default rounded-xl text-sm text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-primary mb-1">
              {t.policyTypeLabel} <span className="text-red-500">*</span>
            </label>
            <select
              value={policyType}
              onChange={(e) => setPolicyType(e.target.value as PolicyType)}
              className="w-full px-3.5 py-2.5 bg-white border border-border-default rounded-xl text-sm text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
            >
              <option value="MULTI_ENTRY">{t.policyMultiEntry}</option>
              <option value="SINGLE_USE">{t.policySingleUse}</option>
              <option value="TIER_RESTRICTED">{t.policyTierRestricted}</option>
              <option value="CAPACITY_CAPPED">{t.policyCapacityCapped}</option>
            </select>
          </div>

          {policyType === "CAPACITY_CAPPED" && (
            <div>
              <label className="block text-xs font-semibold text-text-primary mb-1">
                {t.maxCapacityLabel}
              </label>
              <input
                type="number"
                min={1}
                value={maxCapacity || ""}
                onChange={(e) => setMaxCapacity(e.target.value ? Number(e.target.value) : undefined)}
                placeholder="e.g. 250"
                className="w-full px-3.5 py-2.5 bg-white border border-border-default rounded-xl text-sm font-mono text-text-primary"
              />
            </div>
          )}

          {pointFormError && (
            <div role="alert" aria-live="assertive" className="p-3 rounded-xl bg-status-danger-bg text-status-danger-text border border-status-danger-border text-xs">
              {pointFormError}
            </div>
          )}

          <div className="pt-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="md" onClick={() => setIsPointModalOpen(false)}>
              {isRtl ? "انصراف" : "Cancel"}
            </Button>
            <Button type="submit" variant="primary" size="md" disabled={submittingPoint}>
              {submittingPoint ? "..." : t.savePointAction}
            </Button>
          </div>
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
          <div>
            <label className="block text-xs font-semibold text-text-primary mb-1">
              {t.boothNameLabel} <span className="text-red-500">*</span>
            </label>
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
              className="w-full px-3.5 py-2.5 bg-white border border-border-default rounded-xl text-sm text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-primary mb-1">
              {t.boothSlugLabel} <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={boothSlug}
              onChange={(e) => setBoothSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              placeholder="biotech-systems"
              className="w-full px-3.5 py-2.5 bg-white border border-border-default rounded-xl text-sm font-mono text-text-primary"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-primary mb-1">
              {t.boothLocationLabel}
            </label>
            <input
              type="text"
              value={boothLocation}
              onChange={(e) => setBoothLocation(e.target.value)}
              placeholder={isRtl ? "مثال: سالن B، استند شماره ۱۰۴" : "e.g. Hall B, Stand 104"}
              className="w-full px-3.5 py-2.5 bg-white border border-border-default rounded-xl text-sm text-text-primary"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-primary mb-1">
              {t.websiteUrlLabel}
            </label>
            <input
              type="url"
              value={boothWebsite}
              onChange={(e) => setBoothWebsite(e.target.value)}
              placeholder="https://company.example.com"
              className="w-full px-3.5 py-2.5 bg-white border border-border-default rounded-xl text-sm font-mono text-text-primary"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-primary mb-1">
              {t.brochureUrlLabel}
            </label>
            <input
              type="url"
              value={boothBrochure}
              onChange={(e) => setBoothBrochure(e.target.value)}
              placeholder="https://company.example.com/brochure.pdf"
              className="w-full px-3.5 py-2.5 bg-white border border-border-default rounded-xl text-sm font-mono text-text-primary"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-primary mb-1">
              {t.boothDescriptionLabel}
            </label>
            <textarea
              rows={2}
              value={boothDescription}
              onChange={(e) => setBoothDescription(e.target.value)}
              placeholder={isRtl ? "توضیح مختصر محصولات و فعالیت‌های غرفه..." : "Overview of company products..."}
              className="w-full p-3 bg-white border border-border-default rounded-xl text-sm text-text-primary"
            />
          </div>

          {boothFormError && (
            <div role="alert" aria-live="assertive" className="p-3 rounded-xl bg-status-danger-bg text-status-danger-text border border-status-danger-border text-xs">
              {boothFormError}
            </div>
          )}

          <div className="pt-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="md" onClick={() => setIsBoothModalOpen(false)}>
              {isRtl ? "انصراف" : "Cancel"}
            </Button>
            <Button type="submit" variant="primary" size="md" disabled={submittingBooth}>
              {submittingBooth ? "..." : t.saveBoothAction}
            </Button>
          </div>
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
          <div>
            <label className="block text-xs font-semibold text-text-primary mb-1">
              {t.staffEmailLabel} <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              required
              value={staffEmail}
              onChange={(e) => setStaffEmail(e.target.value)}
              placeholder="representative@company.com"
              className="w-full px-3.5 py-2.5 bg-white border border-border-default rounded-xl text-sm font-mono text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
            />
            <span className="text-[11px] text-text-muted mt-1 block leading-relaxed">
              {isRtl
                ? "نماینده با این ایمیل به پورتال جمع‌آوری لیدهای تجاری غرفه دسترسی خواهد یافت."
                : "Authorizes this staff email to access the booth's lead qualification portal."}
            </span>
          </div>

          {staffFeedback && (
            <div role="status" className="p-3 rounded-xl bg-status-success-bg text-status-success-text border border-status-success-border text-xs">
              {staffFeedback}
            </div>
          )}

          {staffError && (
            <div role="alert" aria-live="assertive" className="p-3 rounded-xl bg-status-danger-bg text-status-danger-text border border-status-danger-border text-xs">
              {staffError}
            </div>
          )}

          <div className="pt-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="md" onClick={() => setAssigningBooth(null)}>
              {isRtl ? "انصراف" : "Cancel"}
            </Button>
            <Button type="submit" variant="primary" size="md" disabled={assigningStaff}>
              {assigningStaff ? "..." : t.assignStaffAction}
            </Button>
          </div>
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
          <div className="text-center space-y-4 py-2">
            <div className="p-6 bg-white rounded-2xl border-2 border-border-default shadow-xs inline-block">
              <QRCode
                value={selectedBoothQr.id}
                size={180}
                level="M"
                viewBox="0 0 256 256"
                fgColor="#0F172A"
                bgColor="#FFFFFF"
                className="w-44 h-44 select-none"
              />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-text-primary">{selectedBoothQr.name}</h3>
              <p className="text-xs text-text-secondary">{selectedBoothQr.location || "Exhibition Floor"}</p>
              <span className="text-[11px] font-mono text-text-muted block pt-1">
                <bdi dir="ltr">Booth ID: {selectedBoothQr.id}</bdi>
              </span>
            </div>
            <div className="pt-2">
              <Button type="button" variant="secondary" size="md" isFullWidth onClick={() => window.print()}>
                🖨️ {isRtl ? "چاپ کیوآرکد استند" : "Print Standee QR"}
              </Button>
            </div>
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
          <form onSubmit={handleUpdateEvent} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-text-primary mb-1">
                  {t.eventNameLabel} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={editEventName}
                  onChange={(e) => setEditEventName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-white border border-border-default rounded-xl text-sm text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-text-primary mb-1">
                  {t.eventSlugLabel}
                </label>
                <input
                  type="text"
                  disabled
                  value={event.slug}
                  className="w-full px-3.5 py-2.5 bg-neutral-100 border border-border-subtle rounded-xl text-sm font-mono text-text-muted cursor-not-allowed opacity-75"
                />
                <span className="text-[11px] text-text-muted mt-1 block">
                  {isRtl
                    ? "شناسه اختصاصی اینترنتی (اسلاگ) جهت حفظ پیوند کارت‌ها و آدرس‌های عمومی ثابت می‌ماند."
                    : "The public URL slug is preserved to protect published links and attendee passes."}
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-text-primary mb-1">
                  {t.startsAtLabel} <span className="text-red-500">*</span>
                </label>
                <input
                  type="datetime-local"
                  required
                  value={editEventStartsAt}
                  onChange={(e) => setEditEventStartsAt(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-white border border-border-default rounded-xl text-sm font-mono text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-text-primary mb-1">
                  {t.endsAtLabel} <span className="text-red-500">*</span>
                </label>
                <input
                  type="datetime-local"
                  required
                  value={editEventEndsAt}
                  onChange={(e) => setEditEventEndsAt(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-white border border-border-default rounded-xl text-sm font-mono text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-text-primary mb-1">
                  {t.locationLabel} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={editEventLocation}
                  onChange={(e) => setEditEventLocation(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-white border border-border-default rounded-xl text-sm text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-text-primary mb-1">
                  {t.descriptionLabel}
                </label>
                <textarea
                  rows={3}
                  value={editEventDescription}
                  onChange={(e) => setEditEventDescription(e.target.value)}
                  className="w-full p-3 bg-white border border-border-default rounded-xl text-sm text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
                />
              </div>
            </div>

            {eventEditError && (
              <div
                role="alert"
                aria-live="assertive"
                className="p-3.5 rounded-xl bg-status-danger-bg text-status-danger-text border border-status-danger-border text-xs leading-relaxed"
              >
                {eventEditError}
              </div>
            )}

            <div className="pt-2 flex justify-end gap-2.5">
              <Button
                type="button"
                variant="ghost"
                size="md"
                disabled={submittingEventEdit}
                onClick={() => setIsEditEventModalOpen(false)}
              >
                {t.cancelAction || (isRtl ? "انصراف" : "Cancel")}
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="md"
                disabled={submittingEventEdit}
              >
                {submittingEventEdit ? (t.savingAction || "...") : (t.saveChangesAction || (isRtl ? "ذخیره تغییرات" : "Save Changes"))}
              </Button>
            </div>
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
            <div>
              <label className="block text-xs font-semibold text-text-primary mb-1">
                {t.tierNameLabel} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={editTierName}
                onChange={(e) => setEditTierName(e.target.value)}
                className="w-full px-3.5 py-2 bg-white border border-border-default rounded-xl text-sm text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-text-primary mb-1">
                  {t.tierQuotaLabel} <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  required
                  min={1}
                  value={editTierQuota}
                  onChange={(e) => setEditTierQuota(parseInt(e.target.value) || 0)}
                  className="w-full px-3.5 py-2 bg-white border border-border-default rounded-xl text-sm font-mono text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
                />
                <span className="text-[11px] text-text-muted mt-1 block">
                  {isRtl ? "سهمیه نمی‌تواند کمتر از بلیت‌های صادرشده باشد." : "Quota cannot fall below confirmed registrations."}
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-text-primary mb-1">
                  {t.tierStatusLabel || (isRtl ? "وضعیت ثبت‌نام" : "Registration Status")}
                </label>
                <select
                  value={editTierIsOpen ? "open" : "closed"}
                  onChange={(e) => setEditTierIsOpen(e.target.value === "open")}
                  className="w-full px-3.5 py-2 bg-white border border-border-default rounded-xl text-sm text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
                >
                  <option value="open">{t.tierOpenOption || (isRtl ? "باز جهت ثبت‌نام و صدور بلیت" : "Open for Registration")}</option>
                  <option value="closed">{t.tierClosedOption || (isRtl ? "بسته شده (عدم پذیرش ثبت‌نام)" : "Closed")}</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-primary mb-1">
                {t.tierDescriptionLabel || (isRtl ? "توضیحات و مزایای رده" : "Tier Description")}
              </label>
              <textarea
                rows={2}
                value={editTierDescription}
                onChange={(e) => setEditTierDescription(e.target.value)}
                className="w-full p-2.5 bg-white border border-border-default rounded-xl text-sm text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
              />
            </div>

            {tierEditError && (
              <div
                role="alert"
                aria-live="assertive"
                className="p-3 rounded-xl bg-status-danger-bg text-status-danger-text border border-status-danger-border text-xs leading-relaxed"
              >
                {tierEditError}
              </div>
            )}

            <div className="pt-2 flex justify-end gap-2.5">
              <Button
                type="button"
                variant="ghost"
                size="md"
                disabled={submittingTierEdit}
                onClick={() => setEditingTier(null)}
              >
                {t.cancelAction || (isRtl ? "انصراف" : "Cancel")}
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="md"
                disabled={submittingTierEdit}
              >
                {submittingTierEdit ? (t.savingAction || "...") : (t.saveChangesAction || (isRtl ? "ذخیره تغییرات" : "Save Changes"))}
              </Button>
            </div>
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
            <div>
              <label className="block text-xs font-semibold text-text-primary mb-1">
                {t.pointNameLabel} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={editPointName}
                onChange={(e) => setEditPointName(e.target.value)}
                className="w-full px-3.5 py-2 bg-white border border-border-default rounded-xl text-sm text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-primary mb-1">
                {t.pointLocationLabel}
              </label>
              <input
                type="text"
                value={editPointLocation}
                onChange={(e) => setEditPointLocation(e.target.value)}
                placeholder={isRtl ? "مثال: ورودی سالن اصلی، طبقه ۱" : "e.g. Main Hall North, Floor 1"}
                className="w-full px-3.5 py-2 bg-white border border-border-default rounded-xl text-sm text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-primary mb-1">
                {t.policyTypeLabel}
              </label>
              <select
                value={editPointPolicy}
                onChange={(e) => setEditPointPolicy(e.target.value as PolicyType)}
                className="w-full px-3.5 py-2 bg-white border border-border-default rounded-xl text-sm text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
              >
                <option value="MULTI_ENTRY">{t.policyMultiEntry}</option>
                <option value="SINGLE_USE">{t.policySingleUse}</option>
                <option value="TIER_RESTRICTED">{t.policyTierRestricted}</option>
                <option value="CAPACITY_CAPPED">{t.policyCapacityCapped}</option>
              </select>
              <span className="text-[11px] text-text-muted mt-1 block leading-relaxed">
                {t.policyLockedNotice || (isRtl ? "سیاست پذیرش پس از ثبت اسکن جهت حفظ یکپارچگی مانیفست قفل می‌شود." : "Policy locked once scans are recorded.")}
              </span>
            </div>

            {editPointPolicy === "TIER_RESTRICTED" && (
              <div className="space-y-2 p-3 bg-surface-panel-subtle rounded-xl border border-border-subtle">
                <span className="text-xs font-semibold text-text-primary block">
                  {t.allowedTiersLabel} <span className="text-red-500">*</span>
                </span>
                <div className="space-y-1.5 max-h-36 overflow-y-auto">
                  {tiers.map((tr) => (
                    <label key={tr.id} className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
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
                        className="rounded border-border-default text-action-primary focus:ring-action-primary"
                      />
                      <span>{tr.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {editPointPolicy === "CAPACITY_CAPPED" && (
              <div>
                <label className="block text-xs font-semibold text-text-primary mb-1">
                  {t.maxCapacityLabel}
                </label>
                <input
                  type="number"
                  min={1}
                  value={editPointMaxCapacity ?? ""}
                  onChange={(e) => setEditPointMaxCapacity(e.target.value ? parseInt(e.target.value) : undefined)}
                  placeholder="200"
                  className="w-full px-3.5 py-2 bg-white border border-border-default rounded-xl text-sm font-mono text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
                />
              </div>
            )}

            {pointEditError && (
              <div
                role="alert"
                aria-live="assertive"
                className="p-3 rounded-xl bg-status-danger-bg text-status-danger-text border border-status-danger-border text-xs leading-relaxed"
              >
                {pointEditError}
              </div>
            )}

            <div className="pt-2 flex justify-end gap-2.5">
              <Button
                type="button"
                variant="ghost"
                size="md"
                disabled={submittingPointEdit}
                onClick={() => setEditingPoint(null)}
              >
                {t.cancelAction || (isRtl ? "انصراف" : "Cancel")}
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="md"
                disabled={submittingPointEdit}
              >
                {submittingPointEdit ? (t.savingAction || "...") : (t.saveChangesAction || (isRtl ? "ذخیره تغییرات" : "Save Changes"))}
              </Button>
            </div>
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
            setCreatedOperatorResult(null);
          }
        }}
        title={t.addOperatorModalTitle}
        description={t.addOperatorModalDesc}
        size="md"
      >
        {createdOperatorResult?.temporary_password ? (
          <div className="space-y-4 py-2">
            <div className="p-4 rounded-xl bg-status-success-bg border border-status-success-border text-status-success-text space-y-2">
              <p className="font-bold text-sm">
                ✓ {isRtl ? "اپراتور با موفقیت ایجاد گردید." : "Operator created successfully."}
              </p>
              <p className="text-xs leading-relaxed">
                {t.operatorTempPasswordNotice}
              </p>
              <div className="p-3 bg-white rounded-lg border border-status-success-border font-mono font-bold text-sm sm:text-base text-text-primary text-center select-all">
                {createdOperatorResult.temporary_password}
              </div>
              <p className="text-[11px] text-text-muted">
                {isRtl
                  ? "اپراتور می‌تواند با این ایمیل و کلمه عبور وارد میز پذیرش شود."
                  : "The operator can use this email and temporary password to log into the Front Desk."}
              </p>
            </div>
            <div className="flex justify-end pt-2">
              <Button
                type="button"
                variant="primary"
                size="md"
                onClick={() => {
                  setCreatedOperatorResult(null);
                  setIsOperatorModalOpen(false);
                }}
              >
                {isRtl ? "متوجه شدم و بستن" : "Done"}
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleCreateOperator} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-text-primary mb-1">
                {t.operatorNameLabel} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={newOperatorName}
                onChange={(e) => setNewOperatorName(e.target.value)}
                placeholder={isRtl ? "مثال: مریم باقری (مسئول گیت پذیرش)" : "e.g. Maryam Bagheri"}
                className="w-full px-3.5 py-2.5 bg-white border border-border-default rounded-xl text-sm text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-primary mb-1">
                {t.operatorEmailLabel} <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                required
                value={newOperatorEmail}
                onChange={(e) => setNewOperatorEmail(e.target.value)}
                placeholder="operator@example.com"
                className="w-full px-3.5 py-2.5 bg-white border border-border-default rounded-xl text-sm font-mono text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
              />
            </div>

            {operatorFormError && (
              <div
                role="alert"
                aria-live="assertive"
                className="p-3.5 rounded-xl bg-status-danger-bg text-status-danger-text border border-status-danger-border text-xs leading-relaxed"
              >
                {operatorFormError}
              </div>
            )}

            <div className="pt-2 flex justify-end gap-2.5">
              <Button
                type="button"
                variant="ghost"
                size="md"
                disabled={submittingOperator}
                onClick={() => setIsOperatorModalOpen(false)}
              >
                {isRtl ? "انصراف" : "Cancel"}
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="md"
                disabled={submittingOperator}
              >
                {submittingOperator ? "..." : (isRtl ? "صدور دسترسی اپراتور" : "Authorize Operator")}
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </div>
  );
}
