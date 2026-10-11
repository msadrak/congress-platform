import { PublicLayout } from "../layouts/PublicLayout";
import { LinkButton } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";

export default function Home() {
  return (
    <PublicLayout>
      {/* 1. Hero Section */}
      <section className="relative overflow-hidden pt-12 pb-16 sm:pt-20 sm:pb-24 border-b border-border-default bg-surface-panel">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto text-center space-y-6">
            {/* Category / Identity Badge */}
            <div className="inline-flex items-center">
              <Badge variant="brand" size="md">
                Independent Congress Operations
              </Badge>
            </div>

            {/* Main Headline (H1) */}
            <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-text-primary leading-[1.12]">
              The Operating System for Academic & Industry Congresses
            </h1>

            {/* Subtitle / Plain-Language Value Proposition */}
            <p className="text-base sm:text-xl text-text-secondary leading-relaxed max-w-2xl mx-auto">
              Fast walk-in registration, reliable badge check-in, exhibition lead capture, and attendee networking — engineered for the physical reality of busy conference venues.
            </p>

            {/* Primary Action Buttons */}
            <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3">
              <LinkButton to="/organizer" variant="primary" size="lg">
                Organizer Console
                <span aria-hidden="true">→</span>
              </LinkButton>
              <LinkButton to="/my-tickets" variant="secondary" size="lg">
                Attendee Pass Portal
              </LinkButton>
            </div>

            {/* Key Value Signals */}
            <div className="pt-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-text-muted">
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-action-primary" aria-hidden="true" />
                <span>Multi-Tenant Event Workspace</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-action-primary" aria-hidden="true" />
                <span>High-Contrast Badge Scanning</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-action-primary" aria-hidden="true" />
                <span>Isolated Exhibitor Leads</span>
              </div>
            </div>
          </div>

          {/* Hero Visual Preview: Dual Perspective (Attendee Pass & Organizer Station) */}
          <div className="mt-12 sm:mt-16 max-w-4xl mx-auto p-3 sm:p-5 rounded-2xl bg-surface-page border border-border-default shadow-xs">
            <div className="text-center pb-3 text-[11px] font-medium text-text-muted uppercase tracking-wider">
              Demonstration Showcase • Illustrative Mockups & Sample Data
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
              {/* Perspective A: Attendee Digital Pass Card */}
              <div className="rounded-xl bg-surface-panel p-5 border border-border-default shadow-xs flex flex-col justify-between space-y-4">
                <div className="flex items-center justify-between border-b border-border-subtle pb-3">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-action-primary" aria-hidden="true" />
                    <span className="text-xs font-semibold text-text-primary tracking-tight">
                      Attendee Pass (Sample)
                    </span>
                  </div>
                  <Badge variant="success" size="sm">Sample Admitted</Badge>
                </div>

                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="text-[11px] font-medium uppercase tracking-wider text-action-primary">
                      Global Congress 2026
                    </div>
                    <div className="text-base sm:text-lg font-bold text-text-primary">
                      Dr. Sarah Jenkins
                    </div>
                    <div className="text-xs text-text-secondary">
                      Biomedical Research Fellow
                    </div>
                    <div className="text-[11px] text-text-muted pt-1">
                      Tier: Full Delegate Pass
                    </div>
                  </div>

                  {/* Scannable SVG QR Code Representation */}
                  <div className="shrink-0 p-2 bg-white rounded-lg border border-border-default shadow-xs flex flex-col items-center">
                    <svg className="w-16 h-16 sm:w-20 sm:h-20 text-slate-900" viewBox="0 0 100 100" fill="currentColor" aria-hidden="true">
                      {/* Corner Position Detection Patterns */}
                      <rect x="0" y="0" width="30" height="30" rx="3" />
                      <rect x="5" y="5" width="20" height="20" rx="2" fill="white" />
                      <rect x="9" y="9" width="12" height="12" rx="1" />
                      <rect x="70" y="0" width="30" height="30" rx="3" />
                      <rect x="75" y="5" width="20" height="20" rx="2" fill="white" />
                      <rect x="79" y="9" width="12" height="12" rx="1" />
                      <rect x="0" y="70" width="30" height="30" rx="3" />
                      <rect x="5" y="75" width="20" height="20" rx="2" fill="white" />
                      <rect x="9" y="79" width="12" height="12" rx="1" />
                      {/* Synthetic QR Data Modules */}
                      <rect x="36" y="8" width="6" height="6" />
                      <rect x="46" y="16" width="6" height="6" />
                      <rect x="56" y="8" width="6" height="6" />
                      <rect x="38" y="38" width="8" height="8" />
                      <rect x="52" y="44" width="8" height="8" />
                      <rect x="42" y="56" width="6" height="6" />
                      <rect x="72" y="38" width="6" height="6" />
                      <rect x="84" y="48" width="8" height="8" />
                      <rect x="74" y="64" width="6" height="6" />
                      <rect x="36" y="76" width="6" height="6" />
                      <rect x="52" y="82" width="6" height="6" />
                      <rect x="78" y="78" width="8" height="8" />
                    </svg>
                    <span className="text-[9px] text-text-muted mt-1 uppercase tracking-tight">Demo QR</span>
                  </div>
                </div>
                <div className="pt-3 border-t border-border-subtle flex items-center justify-between text-xs text-text-muted">
                  <span>Pass ID: #8492-BC</span>
                  <div className="flex items-center gap-2 text-[11px] font-medium text-action-primary">
                    <span>4 Booths Saved</span>
                    <span>•</span>
                    <span>7 Contacts</span>
                  </div>
                </div>
              </div>

              {/* Perspective B: On-Site Operations Station */}
              <div className="rounded-xl bg-surface-panel p-5 border border-border-default shadow-xs flex flex-col justify-between space-y-4">
                <div className="flex items-center justify-between border-b border-border-subtle pb-3">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" aria-hidden="true" />
                    <span className="text-xs font-semibold text-text-primary tracking-tight">
                      Gate Station (Simulated)
                    </span>
                  </div>
                  <Badge variant="neutral" size="sm">Sample Point</Badge>
                </div>
                <div className="space-y-2">
                  <div className="p-2.5 rounded-lg bg-surface-panel-subtle border border-border-subtle flex items-center justify-between text-xs">
                    <div>
                      <span className="font-semibold text-text-primary">Dr. Sarah Jenkins</span>
                      <span className="text-text-muted ms-1.5">• Full Delegate</span>
                    </div>
                    <span className="font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded text-[11px]">
                      Admitted
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-surface-panel-subtle border border-border-subtle flex items-center justify-between text-xs">
                    <div>
                      <span className="font-semibold text-text-primary">Marcus Vance</span>
                      <span className="text-text-muted ms-1.5">• Exhibitor Rep</span>
                    </div>
                    <span className="font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded text-[11px]">
                      Admitted
                    </span>
                  </div>
                </div>

                {/* Live Throughput Metrics */}
                <div className="pt-3 border-t border-border-subtle grid grid-cols-3 gap-2 text-center">
                  <div className="p-1.5 rounded-md bg-surface-page">
                    <div className="text-xs sm:text-sm font-bold text-text-primary">1,420</div>
                    <div className="text-[10px] text-text-muted">Total Checked In</div>
                  </div>
                  <div className="p-1.5 rounded-md bg-surface-page">
                    <div className="text-xs sm:text-sm font-bold text-text-primary">98.4%</div>
                    <div className="text-[10px] text-text-muted">Gate Throughput</div>
                  </div>
                  <div className="p-1.5 rounded-md bg-surface-page">
                    <div className="text-xs sm:text-sm font-bold text-action-primary">Single-Use</div>
                    <div className="text-[10px] text-text-muted">Policy Rule</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. How the Platform Runs Your Event (Chronological Lifecycle, not generic card grid) */}
      <section id="capabilities" className="py-16 sm:py-24 bg-surface-panel border-b border-border-default">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl mb-12 sm:mb-16">
            <Badge variant="neutral" size="sm" className="mb-3">
              Event Lifecycle
            </Badge>
            <h2 className="text-2xl sm:text-4xl font-bold tracking-tight text-text-primary">
              Built to Support Every Phase of Your Congress
            </h2>
            <p className="mt-3 text-base text-text-secondary leading-relaxed">
              From initial tier configuration to on-site gate throughput and exhibitor lead capture, the platform connects each phase in a clean, unified workflow.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Step 1: Pre-Event Setup */}
            <div className="space-y-4 p-6 rounded-2xl bg-surface-page border border-border-default flex flex-col justify-between">
              <div className="space-y-3">
                <span className="text-xs font-bold font-mono text-action-primary px-2.5 py-1 rounded-md bg-action-subtle border border-action-subtle-border inline-block">
                  01 / PRE-EVENT
                </span>
                <h3 className="text-lg font-bold text-text-primary tracking-tight">
                  Setup & Direct Registration
                </h3>
                <p className="text-sm text-text-secondary leading-relaxed">
                  Organizers configure ticket tiers with strict quota caps, admission policies (single-use, multi-entry, capped capacity), and exhibition booth rosters.
                </p>
              </div>
              <ul className="space-y-2 text-xs text-text-muted border-t border-border-subtle pt-4">
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-action-primary" aria-hidden="true" />
                  <span>Private direct links for attendee registration</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-action-primary" aria-hidden="true" />
                  <span>Instant SVG QR pass generation</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-action-primary" aria-hidden="true" />
                  <span>Exhibition booth profile & brochure setup</span>
                </li>
              </ul>
            </div>

            {/* Step 2: On-Site Check-In */}
            <div className="space-y-4 p-6 rounded-2xl bg-surface-page border border-border-default flex flex-col justify-between">
              <div className="space-y-3">
                <span className="text-xs font-bold font-mono text-action-primary px-2.5 py-1 rounded-md bg-action-subtle border border-action-subtle-border inline-block">
                  02 / AT THE DOORS
                </span>
                <h3 className="text-lg font-bold text-text-primary tracking-tight">
                  Gate Scanning & Front Desk
                </h3>
                <p className="text-sm text-text-secondary leading-relaxed">
                  Fast attendance verification at entrance gates using cameras or handheld USB barcode scanners. Front-desk staff mint walk-in badges in seconds.
                </p>
              </div>
              <ul className="space-y-2 text-xs text-text-muted border-t border-border-subtle pt-4">
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-action-primary" aria-hidden="true" />
                  <span>Local scan buffering for venue network stability</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-action-primary" aria-hidden="true" />
                  <span>Rapid walk-in search with badge print layout</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-action-primary" aria-hidden="true" />
                  <span>Live 10-second polling analytics & CSV exports</span>
                </li>
              </ul>
            </div>

            {/* Step 3: Exhibition Floor & Networking */}
            <div className="space-y-4 p-6 rounded-2xl bg-surface-page border border-border-default flex flex-col justify-between">
              <div className="space-y-3">
                <span className="text-xs font-bold font-mono text-action-primary px-2.5 py-1 rounded-md bg-action-subtle border border-action-subtle-border inline-block">
                  03 / ON THE FLOOR
                </span>
                <h3 className="text-lg font-bold text-text-primary tracking-tight">
                  Leads & Peer Networking
                </h3>
                <p className="text-sm text-text-secondary leading-relaxed">
                  Exhibitors qualify visitor leads with ratings and private notes. Attendees exchange contacts directly via badge codes and export standard vCards.
                </p>
              </div>
              <ul className="space-y-2 text-xs text-text-muted border-t border-border-subtle pt-4">
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-action-primary" aria-hidden="true" />
                  <span>Isolated exhibitor portals with direct CSV export</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-action-primary" aria-hidden="true" />
                  <span>Hot, Warm, and Cold lead qualification tagging</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-action-primary" aria-hidden="true" />
                  <span>Private notes & standard vCard (.vcf) download</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* 3. Role Workspaces (Asymmetric, purposeful layout) */}
      <section id="roles" className="py-16 sm:py-24 bg-surface-page border-b border-border-default">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl mb-12 sm:mb-16">
            <Badge variant="neutral" size="sm" className="mb-3">
              Role Workspaces
            </Badge>
            <h2 className="text-2xl sm:text-4xl font-bold tracking-tight text-text-primary">
              Focused Interfaces Tailored to Each Participant
            </h2>
            <p className="mt-3 text-base text-text-secondary leading-relaxed">
              Every role operates within an interface calibrated for its specific task density, device requirements, and trust boundary.
            </p>
          </div>

          <div className="space-y-6">
            {/* Featured Box: Organizer & Operations */}
            <div className="p-6 sm:p-8 rounded-2xl bg-surface-panel border border-border-default shadow-xs flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
              <div className="max-w-2xl space-y-3">
                <div className="flex items-center gap-2">
                  <Badge variant="brand" size="sm">Organizer Workspace</Badge>
                  <span className="text-xs font-mono text-text-muted">/organizer</span>
                </div>
                <h3 className="text-xl font-bold text-text-primary tracking-tight">
                  Comprehensive Event Control & Operations Desk
                </h3>
                <p className="text-sm text-text-secondary leading-relaxed">
                  Access your organization’s management console using your API key. Configure multi-day events, ticket tiers, and admission policies. Monitor real-time throughput metrics and operate the walk-in front desk station.
                </p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted pt-1">
                  <span>• API Key Authenticated</span>
                  <span>• Walk-In Pass Minting</span>
                  <span>• Gate & Catering Throughput</span>
                </div>
              </div>
              <div className="shrink-0 w-full sm:w-auto">
                <LinkButton to="/organizer" variant="primary" size="md" isFullWidth>
                  Open Organizer Console →
                </LinkButton>
              </div>
            </div>

            {/* Two-Column Split: Attendees & Exhibitors */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Attendee Portal */}
              <div className="p-6 sm:p-8 rounded-2xl bg-surface-panel border border-border-default shadow-xs flex flex-col justify-between space-y-6">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Badge variant="neutral" size="sm">Attendee Access</Badge>
                    <span className="text-xs font-mono text-text-muted">/my-tickets</span>
                  </div>
                  <h3 className="text-lg sm:text-xl font-bold text-text-primary tracking-tight">
                    Personal Passes & Networking
                  </h3>
                  <p className="text-sm text-text-secondary leading-relaxed">
                    View your high-contrast digital QR pass on any mobile device. Keep passes accessible offline during venue entry, browse saved company booths, and exchange contacts with fellow attendees.
                  </p>
                </div>
                <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                  <LinkButton to="/my-tickets" variant="secondary" size="md">
                    My Tickets & Passes
                  </LinkButton>
                  <LinkButton to="/my-network" variant="outline" size="md">
                    Networking Hub
                  </LinkButton>
                </div>
              </div>

              {/* Exhibitor Portal */}
              <div className="p-6 sm:p-8 rounded-2xl bg-surface-panel border border-border-default shadow-xs flex flex-col justify-between space-y-6">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Badge variant="neutral" size="sm">Exhibitor Teams</Badge>
                    <span className="text-xs font-mono text-text-muted">/booth/:id</span>
                  </div>
                  <h3 className="text-lg sm:text-xl font-bold text-text-primary tracking-tight">
                    Booth Lead Management
                  </h3>
                  <p className="text-sm text-text-secondary leading-relaxed">
                    Assigned booth representatives access dedicated lead portals to scan attendee badges, qualify visitor interest with Hot/Warm/Cold ratings, add private team notes, and export CSV files.
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-surface-panel-subtle border border-border-subtle text-xs text-text-muted leading-relaxed">
                  Booth staff receive private access links directly from the event organizer upon staff assignment.
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Venue-Grade Engineering Principles (Plain Language, Qualified Claims) */}
      <section id="architecture" className="py-16 sm:py-24 bg-surface-panel border-b border-border-default">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl mb-12 sm:mb-16">
            <Badge variant="neutral" size="sm" className="mb-3">
              Venue Engineering
            </Badge>
            <h2 className="text-2xl sm:text-4xl font-bold tracking-tight text-text-primary">
              Engineered for the Physical Reality of Conferences
            </h2>
            <p className="mt-3 text-base text-text-secondary leading-relaxed">
              Conference venues present unique technical challenges: spotty wireless connectivity, harsh overhead lighting, and strict competitor boundaries.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8">
            <div className="p-6 rounded-xl border border-border-default bg-surface-page space-y-3">
              <div className="w-8 h-8 rounded-lg bg-action-primary text-text-inverse flex items-center justify-center font-bold text-xs">
                1
              </div>
              <h3 className="text-base font-semibold text-text-primary">
                High-Contrast Visual Legibility
              </h3>
              <p className="text-xs sm:text-sm text-text-secondary leading-relaxed">
                Attendee passes render on opaque white plates with verified quiet zones, ensuring reliable barcode scanning even under intense overhead convention lighting or dimmed mobile screens.
              </p>
            </div>

            <div className="p-6 rounded-xl border border-border-default bg-surface-page space-y-3">
              <div className="w-8 h-8 rounded-lg bg-action-primary text-text-inverse flex items-center justify-center font-bold text-xs">
                2
              </div>
              <h3 className="text-base font-semibold text-text-primary">
                Network-Aware Scan Buffering
              </h3>
              <p className="text-xs sm:text-sm text-text-secondary leading-relaxed">
                Gate check-in evaluates attendee manifests locally and buffers scans, allowing entry lines to keep moving smoothly through temporary venue network dropouts.
              </p>
            </div>

            <div className="p-6 rounded-xl border border-border-default bg-surface-page space-y-3">
              <div className="w-8 h-8 rounded-lg bg-action-primary text-text-inverse flex items-center justify-center font-bold text-xs">
                3
              </div>
              <h3 className="text-base font-semibold text-text-primary">
                Strict Multi-Tenant Separation
              </h3>
              <p className="text-xs sm:text-sm text-text-secondary leading-relaxed">
                Organizers are partitioned by secure API credentials, and competing exhibition booth teams are strictly isolated so companies only access their own captured leads.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 5. Direct Registration Guidance & Conversion Banner */}
      <section className="py-16 bg-surface-page">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
          {/* Direct Link Notice */}
          <div className="p-5 sm:p-6 rounded-2xl bg-action-subtle border border-action-subtle-border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-xs font-semibold text-action-primary uppercase tracking-wider">
                Looking to Register for a Specific Event?
              </div>
              <p className="text-xs sm:text-sm text-text-secondary leading-relaxed">
                Registration is private to each congress. Open the unique link provided by your event organizer (e.g. <code className="text-xs font-mono font-medium text-action-primary bg-white px-1.5 py-0.5 rounded border border-action-subtle-border">/e/:slug</code>) to reserve free passes.
              </p>
            </div>
            <div className="shrink-0">
              <LinkButton to="/my-tickets" variant="outline" size="sm">
                View My Passes →
              </LinkButton>
            </div>
          </div>

          {/* Bottom Conversion Card */}
          <div className="p-6 sm:p-10 rounded-2xl bg-surface-panel border border-border-default shadow-xs flex flex-col sm:flex-row items-center justify-between gap-6">
            <div className="space-y-1.5 text-center sm:text-start max-w-xl">
              <h3 className="text-lg sm:text-2xl font-bold text-text-primary tracking-tight">
                Ready to manage your congress or symposium?
              </h3>
              <p className="text-xs sm:text-sm text-text-secondary leading-relaxed">
                Access the organizer console to set up your event, configure ticket quotas, and monitor live gate attendance.
              </p>
            </div>
            <div className="shrink-0 flex items-center gap-3">
              <LinkButton to="/organizer" variant="primary" size="lg">
                Open Organizer Console →
              </LinkButton>
            </div>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
