# Iran Platform Rails: Payment, Messaging, Law, Sanctions, Identity — Ground-Truth Research

**Date:** 2026-10-05
**Scope:** Primary-source research on the payment, SMS/email, legal, sanctions, and identity rails available to a conference management platform built for an Iranian client. Every non-trivial claim carries a numbered source; see "## Sources" at the end.

---

## TL;DR

- **Payments:** All Iranian online card payments flow over the domestic **Shetab** network and the Central Bank–operated **Shaparak** e-payment network, via PSPs (Sadad, Mellat/Behpardakht, Saman Kish/SEP, Pasargad/PEP, Asan Pardakht, Parsian, …) or aggregators (**Zarinpal**, PayPing, Vandar, Sepal). Integration is a near-universal 3-step redirect pattern: server-side **request (token/authority)** → **redirect to PSP hosted page** → **callback + mandatory server-side verify call** (Zarinpal `request.json`→`StartPay`→`verify.json` with `code 100/101`; Mellat `bpPayRequest`→`startpay.mellat`→`bpVerifyRequest`, auto-reversal if unverified after 15 minutes) [1][4][8].
- **PCI-DSS scope:** A merchant that fully redirects to the PSP hosted page and never touches card data on its own systems qualifies for **SAQ A** (the lightest PCI self-assessment, ~30 requirements), not SAQ D; the redirect webpage itself is in scope for basic requirements (2, 6, 8, 11) [5]. No Iranian PSP publishes a PCI DSS Attestation of Compliance, so strict SAQ A eligibility ("PCI DSS validated TPSP") cannot be fully documented — treat PCI as a design constraint (never touch PANs), not a certification path.
- **SMS (OTP rail):** Kavenegar/Melipayamak/SMS.ir offer REST APIs with **OTP-specific services** (Kavenegar Lookup/verification with delivery-in-under-a-minute guarantee, voice-call fallback, 148-country coverage [6][9]; Melipayamak `SendOtp` [7]). Pricing is prepaid-rial credit per SMS (~120–700+ IRR per message depending on route, volume, and service/service-tier), with dedicated 1000/2000/3000/9000-prefix lines purchasable and **webhook callbacks for delivery status** ("Status Callback" and "Receive Callback") [6][8]. Email in Iran is a weak primary channel; SMS is the reliable rail.
- **Law:** Iran has **no comprehensive data protection law in force** — the 2018-era Personal Data Protection draft bill is still unenacted (introduced to Majlis 1400/2021, pending as of 2025–2026) [10][11]. The operative rules are the **E-Commerce Law 2003 (Arts. 58–61, criminalized by Arts. 71–73)** — consent, purpose limitation, accuracy, subject access/deletion, with 1–3 years' imprisonment for violations [3] — plus the **Computer Crimes Law 2009** (unauthorized access/interception as criminal offences, ISP data-retention duties of 6 months for traffic data) [12].
- **Sanctions & identity:** US sanctions make Western SaaS (Eventbrite, Stripe, AWS, Google) contractually and practically unavailable to an Iran-based platform — each of their terms **explicitly prohibits Iran/users located in Iran** [13][14][15][16]. The domestic stack is: Iranian datacenters/ISPs (Asiatech, Pars Online, AFRANET, Shatel…, listed in DataCenterMap's 14 Tehran facilities) [17] and **ArvanCloud** for CDN/cloud — itself **OFAC-designated (June 2023)** as an SDN for its role in the National Information Network [18]. Identity is easy to harden: **National ID (کد ملی)** collection is standard practice at Iranian congress/registration sites, and **Shahkar** (CRA) matches mobile number↔national code, commonly enforced at signup (e.g., mandatory for SMS panel lines) [19]. National ID numbers embed a checksum and are routinely validated client-side/server-side [20].

---

## 1. Iranian online payment: Shaparak, PSPs, and the integration pattern

### 1.1 The network layer

- **Shetab** is Iran's national interbank card payment switch, launched ~2001–2003 to integrate all bank card systems; card payments (online, POS, ATM) clear over it [2]. Iranian debit cards are domestic-only (BINs such as 603799/621986 etc. are on Shetab, not international schemes) [21].
- **Shaparak** (شاپرک, "Electronic Payment Network") is the Central Bank of Iran's company operating the retail e-payment infrastructure; it licenses and supervises the **PSPs** and the newer **Pardakht-yar** (payment facilitators/aggregators — Sepal, PayPing, etc. are "پرداخت‌یار رسمی شبکه شاپرک") [22][4]. Shaparak publishes quarterly market-share statistics by PSP (market share, transaction counts/values, error rates) [23]. CBI describes Shaparak as the low-value/critical-infrastructure card payment network [24].

### 1.2 The PSPs

PSPs (شرکت‌های پرداخت‌یار/پذیرندگی) with bank ownership (typical mapping: **Sadad ← Bank Melli Iran**, **Behpardakht ← Bank Mellat**, **SEP/Saman Kish ← Saman Bank**, **PEP ← Pasargad**, **Asan Pardakht**, **Parsian e-commerce**, **Novin-e-Pardazesh (fanava/…) etc.**):

- **Bank Mellat / Behpardakht (bpPayRequest family):** The official user manual documents the full SOAP web-service protocol: `bpPayRequest` (returns `resCode, encrypted-ref-hash`) → POST the ref hash to `https://pgws.bpm.bankmellat.ir/pgwchannel/startpay.mellat` → the cardholder pays on the PSP page → PSP posts back `RefId, ResCode, SaleOrderId, SaleReferenceId, CardHolderInfo(one-way-encrypted PAN)` to the merchant `callBackUrl` → merchant **must** call `bpVerifyRequest` (and optionally `bpSettleRequest`) [1]. Key operational rules from the manual: **if the merchant does not verify within 15 minutes, the transaction is auto-reversed and the money returns to the cardholder**; reversal is only possible up to 2 hours after payment; refunds per Shetab rules can only go to **Mellat-issued cards**; merchants must pre-register their server IPs with the bank (port 443/80 open) [1].
- **Saman Kish / SEP:** SEP's developer site publishes "راهنما و مستندات فنی" (setup guides + sample code downloads for the internet payment gateway) [25]; modern SEP integrations use a token-based REST flow equivalent to the pattern below.
- **Sadad:** Iran's Sadad (پرداخت الکترونیک سداد, sadadpsp.ir — *not* the Bahrain/Qatar/Kuwait SADAD companies that dominate search results) is Bank Melli's PSP, offering POS, internet payment gateway, and mobile payments [26]. Merchant onboarding happens through `mmp.sadadpsp.ir` (سامانه جامع پذیرندگان) [27]. Public developer documentation for the Iranian Sadad IPG is behind merchant login; third-party packages document the same request-token→redirect→callback(RefNum)→verify pattern used by all Shaparak PSPs [8][28].
- **Pasargad (PEP):** offers an IPG (pep.co.ir/ipg) with published API packages and both SOAP and RESTful token-based endpoints [29].
- **Asan Pardakht:** operates a merchant portal (asanpardakht.ir/portals) and its gateway flow is documented in community SDKs (e.g., mhndev/ap: "after pay request the bank calls your callback page with parameters, then you do a verify request") [30][31].
- **Bank Melli "Digi-Pay?"** — no Bank-Melli product named "Digi-Pay" exists; the similarly-named Iranian **"دیجی‌پی" (Digipay, mydigipay.com)** is an unrelated licensed fintech (BNPL/credit payments company), not a bank PSP [32].

### 1.3 Aggregators ("Pardakht-yar", payment facilitators)

**Zarinpal** is the best-documented rail and a good default for an MVP [8]:

1. **Request:** `POST https://api.zarinpal.com/pg/v4/payment/request.json` with `merchant_id` (36-char UUID), `amount` (IRR), `callback_url`, `description`, optional `metadata.mobile/email` and `card_pan` (lock payment to a pre-verified card). Response returns `code` + `authority` [8].
2. **Redirect:** send the user to `https://www.zarinpal.com/pg/StartPay/{authority}` (GET) [8].
3. **Callback:** Zarinpal returns the user to `callback_url` with `Status=OK|NOK` and `Authority` as query string; verify **only when Status=OK** [8].
4. **Verify:** `POST https://api.zarinpal.com/pg/v4/payment/verify.json` with `merchant_id, amount, authority`. `code 100` = success (returns `ref_id` transaction number, `card_pan` masked, `card_hash` SHA-256); **`code 101` = already verified** (idempotent duplicate verify — design your handler for it); sandbox exists [8].
   - Zarinpal enforces **domain-match of the callback URL** as a security requirement for gateway activation (mismatch can suspend the gateway) [33].
   - Zarinpal charges a fee (payer selectable — merchant or cardholder, `fee_type`/`fee` in verify response) [8].

**Sepal** (a Shaparak-licensed Pardakht-yar) shows the same 4-phase shape: `POST sepal.ir/api/request.json` (`apiKey`, `amount` IRR, `callbackUrl`, `invoiceNumber`, payer info) → returns `paymentNumber` → redirect `GET sepal.ir/payment/{paymentNumber}` → callback POSTs `status=1`, `paymentNumber`, `invoiceNumber` → `POST sepal.ir/api/verify.json` returns masked `cardNumber`; sandbox with `apiKey=test` at `/api/sandbox/…` [4]. PayPing and Vandar follow the same REST+token pattern [34][35].

### 1.4 PCI-DSS: SAQ A vs SAQ D for a redirect merchant

PCI SSC's **SAQ A v4.0** (Self-Assessment Questionnaire A) is explicitly for merchants whose "account data functions are completely outsourced to PCI DSS validated and compliant third parties, where the merchant retains only paper reports or receipts with account data," including **e-commerce merchants that redirect** customers to a TPSP's payment page, provided that "all elements of the payment page(s)/form(s) delivered to the customer's browser originate only and directly from a PCI DSS compliant TPSP/payment processor" [5]. For e-commerce merchants that redirect, the SAQ A note confirms: requirements protecting computer systems (2, 6, 8) "apply to e-commerce merchants that redirect customers from their website to a third party for payment processing, and specifically to the merchant web server upon which the redirection mechanism is located" [5]. SAQ D (the full standard) applies when the merchant stores/processes/transmits PANs or hosts payment pages itself [5].

**Applied to Iran:** a congress platform that (a) never touches card numbers, (b) fully redirects to the PSP/aggregator hosted page (Zarinpal StartPay / Mellat startpay.mellat / Sepal payment page), and (c) stores only transaction references (`RefNum`/`ref_id`/`SaleReferenceId`, masked PAN or card hash) fits the **SAQ A profile** — same shape as Shopify/WooCommerce merchants. Caveats to record in the design doc:

- Card networks' PCI reach into Iran is theoretical: no Iranian PSP publishes a PCI DSS AOC, so the "PCI DSS validated TPSP" precondition cannot be evidenced; there is no Iranian acquirer enforcing SAQ submission. PCI compliance is therefore a **scoping/architecture discipline** (keep PAN out of your systems, never log PANs, keep the redirect server hardened per SAQ A reqs 2/6/8/11) rather than a formal certification exercise in this market.
- If you ever accept card data directly (e.g., manual phone registration taking card numbers), you jump to SAQ D scope and the E-Commerce Law criminal regime (Art. 71) risk — don't.
- Mellat's `CardHolderInfo` return field is a **one-way-encrypted PAN** [1]; Zarinpal returns only a masked `card_pan` and a SHA-256 `card_hash` [8] — both safe to store.

### 1.5 Currency and settlement

Transactions are in **rials (IRR)**; Zarinpal request/verify take `amount` in rials [8], Sepal takes `amount` in rials [4]. Settlement to the merchant's Iranian bank account is in rials (Mellat settle flow [1]). Toman (۱ toman = 10 rials) quoting is a UI concern; always send IRR.

---

## 2. SMS and email in Iran

### 2.1 Kavenegar (kavenegar.com) — the developer-grade rail

- **API shape:** REST (and legacy SOAP) at `https://api.kavenegar.com/v1/{API-KEY}/scope/method.json|xml`; auth via per-account API key; both GET/POST with JSON/XML responses; SSL supported; signup grants 50,000 IRR free credit [6].
- **Send:** `sms/send.json` with `receptor` (comma-separated, up to 200 per call), `message`, optional `sender`, `date` (UnixTime), `type`, `localid` (idempotency/duplicate prevention), `hide`, `tag`, `policy`. Response per message: `messageid`, `status/statustext` ("در صف ارسال" = queued), `cost` in rials [6].
- **Delivery status:** two mechanisms — pull via the `status` method (up to 500 messageids per call) and **webhook push: "Status Callback URL"** which updates delivery status in your system in real time; there is also a **"Receive Callback"** webhook forwarding inbound SMS to your URL [6][36].
- **OTP service (اعتبارسنجی/verification):** template-based — you pre-define a message template in the panel, then call the **`Lookup`** method with the template name, receptor, and the code; Kavenegar routes it over the best available prefix line, guarantees delivery **in under 1 minute**, falls back to **voice call (TTS)** if SMS routes are down or the recipient blocked marketing SMS, covers **148 countries** for non-Iranian numbers, and can deliver codes to **landlines via voice**. It also handles the ~70% of Iranian mobile users who have blocked promotional SMS (send via خدماتی/service lines) [9][37].
- **Persian SMS mechanics:** standard SMS is 140 bytes = 70 Persian (UCS-2) chars; concatenated parts are 67 chars (Persian) / 153 (Latin); max message length 4000 chars (internal messenger lines) or 1800 (others); batch limit 200 recipients/call, status-query limit 500 [6].
- **Pricing model:** prepaid rial credit per SMS; per-message cost is returned in every send response (`cost`); **filtered/cancelled/undelivered messages are refunded** automatically [6]. Panel plans: Standard free, Advanced 6,000,000 IRR/yr, Super-advanced 12,000,000 IRR/yr, VIP negotiated; **OTP/verification service only on Advanced+** [6]. Dedicated line prices (one-time, IRR): 14-digit 1000-prefix from 650,000; 10-digit from 6,500,000; 9-digit 19,500,000; 8-digit from 32,500,000 (non-custom) up to 84,500,000 (custom); 2000-prefix lines have a yearly 70% renewal fee [6]. Kavenegar's example responses show ~120 IRR per simple message (`"cost": 120`) — real per-SMS cost depends on route (promo vs service), operator, and volume; OTP/service messages cost more than bulk marketing SMS (sms.ir, for comparison, quotes 180–219 toman = 1,800–2,190 IRR per promotional SMS by panel tier [38]).

### 2.2 Melipayamak (ملی پیامک) — the volume/marketing rail

- SOAP + REST APIs at `api.payamak-panel.com` / `rest.payamak-panel.com` [7]. Dedicated **`SendOtp`** method: input `username, password, from, to, code` (OTP sent using a fixed template "کد تایید شما Code: 123456"); returns a `recId` per send, plus numeric error codes (e.g., 35 = number on the operator blacklist, 2 = insufficient credit, 3 = daily limit, 15 = >1 recipient without opt-out text) [7]. Melipayamak has migrated to **API-key auth and IP allow-listing** for its web service (errors 110/109/108 enforce this) [7]. Like Kavenegar, panel owners must complete **Shahkar identity verification** to activate lines [19].
- Blog/docs cover REST console, pattern-based service SMS (پیامک پترن) over shared service lines, and scheduled sends [39][40].

### 2.3 SMS.ir, Farapayamak

- **SMS.ir:** REST API with JSON responses (`sms.ir/rest-api`); pricing calculator quotes per-SMS by panel tier/volume: 219 toman (base/bronze), 199 (silver), 180 (gold) per message at 1,000–1,000,000 message volumes [38][41].
- **Farapayamak:** Iranian SMS panel provider (farapayamak.ir) with panels, dedicated lines, and a web service; community SDKs exist (e.g., Faraz SMS REST SDK) [42][43]. Docs are thinner than Kavenegar/Melipayamak; typically chosen for price, not API quality.

### 2.4 Email in Iran — weak as a primary channel

There is no primary-source "Iranian email deliverability standard," and evidence is indirect but consistent:

- International connectivity itself is unreliable (intermittent filtering/throttling of foreign services; Google has periodically restricted services in Iran, e.g., Gmail restrictions and blocked new signups reported 2024–2026) [44][45][46]. Iranian users largely rely on domestic mail (mail.ir, etc.) or Gmail via VPNs.
- Historic Iranian regulation briefly barred banks/institutions from corresponding with foreign email providers [47]; Iran has censored Gmail at the national level in the past (2012) [48].
- **.ir domains**: no evidence of a systematic global spamhaus-style block of the entire `.ir` TLD; Spamhaus DBL blocks individual spam/malware domains, not the TLD as a whole [49]. The practical risk for a congress platform is sender reputation + the recipient-side access problems above, not TLD blacklisting.
- **Design consequence:** treat **SMS (and the platform's in-app inbox) as the guaranteed channel** for registration confirmations, payment receipts, and ticket delivery; email as best-effort. This matches what Iranian congress systems actually do (SMS-centric notification).

---

## 3. Iran-specific data/privacy law — what is actually in force

### 3.1 E-Commerce Law (قانون تجارت الکترونیکی), adopted 1382/2003

The E-Commerce Law (ECL), 81 articles, adopted 17 Dey 1382 (Jan 2004), is the operative data-protection statute in Iran today [3]. Chapter 3 of Part 3 ("Protection of Personal Data Messages"):

- **Art. 58:** Storing, processing or distributing personal data messages revealing **ethnic origin, ideological/religious views, moral characteristics, or physical/mental/sexual condition** without the data subject's **explicit consent** is illegal in any case [3].
- **Art. 59:** Even with consent, processing of personal data messages must: (a) have **specified, clearly stated purposes**; (b) collect only what is **necessary and proportionate** to the stated purposes and use it only for those purposes (**purpose limitation/minimization**); (c) be **accurate and up to date**; (d) give the data subject **access to their files and the ability to correct or erase incomplete/inaccurate data**; (e) allow the data subject to **request full erasure** of their computerized personal-data file at any time [3].
- **Art. 60:** Medical/health data processing is governed by a separate bylaw (Art. 79 assigns it to the Ministry of Health) — relevant for a **medical congress/CME platform** holding attendees' health-professional data [3].
- **Art. 61:** Disclosure to third parties, exceptions, and oversight institutions are set by Part 4 + bylaws [3].
- **Penalties:** **Art. 71** — anyone violating Arts. 58/59 conditions is criminally liable, **1–3 years' imprisonment**; Art. 72 raises it to the maximum (3 years) when the offender is a certification-services provider or responsible institution; Art. 73 adds 3 months–1 year + fine for negligent offences by those bodies (fines periodically revalued by Cabinet decree, e.g., 2024) [3].
- Other directly relevant ECL provisions for an event platform: consumer distance-selling rules (Arts. 33–49: pre-contract information duties, **7-working-day withdrawal right** with refund, Art. 37/38 — a paid congress ticket sold online must honor this unless a bylaw exception applies), marketing/advertising rules (Arts. 50–57, incl. **Art. 55: recipients must be able to opt in/out of ads sent to their postal/email address**), computer forgery/fraud (Arts. 67–68), liability for system defects (Art. 78: institutions liable for damage from system defects/weaknesses unless caused by individuals' acts) [3].

### 3.2 Computer Crimes Law (قانون جرایم رایانه‌ای), adopted 1388/2009

- Art. 1: **unauthorized access** to data/computer or telecom systems protected by security measures — 91 days–1 year imprisonment or fine (now Arts. 729 ff. of the Islamic Penal Code after the 2013 codification) [12].
- Art. 2: **unauthorized interception** of non-public communications in transit — 6 months–2 years [12].
- Art. 3: espionage-class offences on secret data; Art. 4: breaching security measures to reach secret data [12].
- Arts. 6–7: **computer forgery** (altering/creating data or forging cards/chips) — 1–5 years; Art. 13: **computer fraud** (obtaining money/property by manipulating data/systems) — 1–5 years + restitution [12].
- Arts. 17–18: publishing private/family sounds, images, or **secrets of others without consent** (privacy offences) [12].
- **Data retention duties:** Art. 32 — ISPs/access providers must keep **traffic data ≥6 months** from creation and **user information ≥6 months after subscription ends** (definitions of "traffic data" and "user information" incl. identity, IP, phone number); Art. 33 — domestic hosting providers must keep user info 6 months post-subscription and **stored content/traffic data for changes ≥15 days** [12]. Art. 48: access to stored non-public content (e.g., **email, SMS**) equals interception and requires the same legal process [12].
- Corporate criminal liability (Art. 19) and personal criminal liability for managers — a platform company can itself be criminally liable [12].

### 3.3 Personal Data Protection bill — status in 2026: **still a draft**

- The **Personal Data Protection and Safeguarding Draft Act** (طرح حمایت و حفاظت از داده و اطلاعات شخصی) has been under development since 2018 (ICT Ministry + Majlis Research Center; an earlier 2015 bill withdrawn); it was **introduced in the Majlis on 1400/06/24 (Oct 2021)** and, per DLA Piper's Data Protection Laws of the World, "Iran has not enacted comprehensive data protection legislation" (their Iran page last reviewed 2019, listing the ECL 2004 and Cyber Crime Act as the operative provisions) [10][11][50]. Law-firm commentary updated as recently as **April 2025** states the draft is "awaiting review by the Iranian Parliament, with no clear timeline for its passage" [11]; DataGuidance likewise describes the Draft Law as awaiting parliamentary review [51]. **As of this research (Oct 2026) no enactment has been verified** — the earlier draft (2021 text, 56 articles) never completed the legislative process (the review note from the Majlis legal-drafting office flagged constitutional objections — Art. 75 budget, Art. 85 delegation — and the bill has not been reported out) [52].
- What the draft (if/when enacted) would require of a controller, per the 2021 Majlis text [52]:
  - **Consent-based processing** for non-public-status data, consent obtained **before** processing, informed, provable (Arts. 4–5); processing of public-status data allowed if not prohibited (Art. 5).
  - Data-subject rights: demand **stop/processing**, correction of wrong data, **right to be forgotten** (subject to third-party interests), **access**, anonymity (Arts. 6–9).
  - **Controller/processor distinction** (Art. 2): processing on documented instructions; processor becomes controller if acting beyond instructions (Art. 27).
  - **Transparency duties (Art. 33):** inform data subjects **within 1 month** of collection — processing purpose, type of processing, controller identity, sources, technical characteristics **including data localization (Art. 44)**, rights and how to exercise them.
  - **Security at three levels** — physical, information, human (Arts. 35–36); full **accountability** to data subjects (Art. 38); presumption the controller performed duties is rebuttable (Art. 39).
  - **Retention:** processing metadata — logs, traffic data, identity data, records of processing — kept **18 months post-processing** (Art. 40); corrupted data versions 6 months (Art. 41).
  - **Cross-border/localization (Arts. 43–44):** processing is "cross-border" if the controller/processor is foreign, **the processing systems are outside Iran's territory**, or the software processors are not registered in Iran; Iranian nationals' personal data **must be stored only in datacenters inside Iran** or in approved foreign datacenters, on certified hardware/software, moved over a "secure network," and cross-border processing must be registered. This is the statutory hook for the National Information Network data-localization policy.
  - **Sanctions:** criminal (penal-code degrees 5–6), punitive damages set with the Commission's input (Art. 49), corporate and administrative sanctions incl. activity bans, license revocation, exit bans (Arts. 53–54).
  - Governance: a **Data Protection Commission** chaired by the ICT Minister with Interior, Intelligence, Economy, Culture ministers, Attorney-General, NIN center head, etc. (Arts. 13–14) — i.e., governance embedded in the security establishment, a criticism raised by ARTICLE 19's legal analysis of the draft (surveillance exceptions; weak independence) [53][54].

**Practical compliance posture for the congress platform today:** follow ECL Arts. 58–61 (explicit, logged consent; purpose limitation; access/erasure rights; 1-month-style transparency is a good forward-fit for the draft's Art. 33), the Computer Crimes Law (access control, no interception of user content, retention planning), and **localize all attendee data in Iranian datacenters** — which the sanctions stack forces anyway (§4) and which the draft's Art. 44 will make mandatory.

---

## 4. Sanctions: foreign SaaS vs. the Iranian stack

### 4.1 What the foreign platforms' own terms say

- **Eventbrite (ToS, updated Aug 2025), §5 "Export Controls and Restricted Countries":** users represent they are not "located, organized, resident in, or the government of, any country or territory that is … the target of country- or territory-wide sanctions (**currently, Cuba, Iran**, North Korea, Syria, Crimea, …)" ("Restricted Areas") and must not use the Services "in connection with any direct or indirect activities or dealings with or involving any Restricted Area"; §4.2 lets Eventbrite terminate access when use would violate law [13].
- **Stripe (Prohibited and Restricted Businesses, updated 2026):** "Use of Stripe's services for any dealings … with the following are prohibited: **Persons located in, resident in, or a citizen of, or products or services originating from jurisdictions … including, Cuba, Iran**, North Korea, and Syria…" [14]. (Stripe also does not support Iran-issued cards or Iranian merchants — the platform is simply out of reach.)
- **AWS (Customer Agreement, §11.6 Trade Compliance):** each party must comply with "economic sanctions programs implemented by the Office of Foreign Assets Control," and the customer represents it is "not subject to sanctions or otherwise designated on any list of prohibited or restricted parties, including … the Specially Designated Nationals List" [15]. AWS is also not payable from Iran (no card network/rails), and AWS regions are outside Iran.
- **Google Fonts:** the Fonts API ToS binds users to the Google APIs ToS [16]; Google's publisher-policy sanctions page states Google "must comply with sanctions and export controls maintained by the … OFAC," which is why Google services are unavailable in Iran — in practice Google Fonts CSS/woff delivery from Iranian IPs has been intermittently blocked/unreliable (community-maintained "Tech Sanctions" lists document services inaccessible from Iran due to sanctions compliance) [55][56]. **Practical rule: self-host fonts (e.g., Vazirmatn/IRANSans as woff2) — do not link fonts.googleapis.com.**
- **What actually happens:** for an Iran-based operator these are ToS *and* OFAC 31 CFR 560 (ITSR) issues: services are geo-blocked at signup/payment (no Iranian billing), accounts serving Iranian users get suspended on sanctions screening, and payments rails (Stripe/card networks) refuse Iran. The direction OFAC has moved is *carve-outs for the Iranian people's internet access* — General License D-2 (2014, expanded 2023 by GL D-2 amendments and the 2023 "software/services" general license action) authorizes certain free/low-cost software and communication services to Iran — but paid SaaS hosting for a commercial Iranian platform is **not** covered by these GLs [57][58][59].

### 4.2 The Iranian alternatives

- **Datacenters/hosting:** an active commercial market — DataCenterMap lists **14 facilities in Tehran from 20 operators** (AFRANET, Pars Online, and others) [17]; Pars Online (founded 1999, ISP + datacenter + hosting) and Asiatech (est. 2004, ISP/telecom, AS43754) are two of the largest [60][61][62]; other known providers include Shatel, Pishgaman, Mobinnet, Sabanet [63]. Cloud VMs ("Cloud Server/VPS") are offered by ArvanCloud and others [64].
- **ArvanCloud (Arvan Cloud / ناویان ابر آرvan)**: Iran's largest cloud/CDN provider — CDN, Cloud DNS, security, cloud servers, object storage, VoD/live streaming, edge computing; founded 2015 under Fanap Holding [65][64]. **OFAC designated it an SDN on 2023-06-02** (with co-founders Pouya Pirhosseinloo and Farhad Fatemi and its Dubai affiliate ArvanCloud Global Technologies) under E.O. 13846 for its role in building the National Information Network and providing interception/blocking to Iranian authorities [18]. For an Iran-domestic platform this is irrelevant as a *US-law* matter (the platform has no US nexus), but it means: no US/EU vendor relationships, no foreign payments, and reputational/human-rights considerations for international partners. The sanctions designation does not affect availability *inside* Iran.
- **CDN:** ArvanCloud is effectively the only national-scale Iranian CDN (an alternative is to run multi-region origin in Iranian DCs + a foreign CDN only for foreign attendees, which the sanctions analysis above forbids for US CDNs).
- Also note Shaparak ordered all PSPs to cut service to cryptocurrency exchanges (2020) [66] — a compliance climate where payment rails are actively policed for permitted use-cases; a congress-ticketing platform is squarely a permitted use.

---

## 5. Identity & verification at registration

- **National ID (کد ملی)** is a 10-digit code with an embedded checksum (weighted-sum, mod-11); it is routinely validated in Iranian web forms and libraries exist for generation/validation [20][67]. Collecting it is a **standard, expected field on Iranian congress/event registration and payment forms** (it is required for issuing official CME certificates through the medical system, for tax/invoice purposes, and matches the general "real-name" KYC climate); no primary-source statute *mandates* collection for event registration per se — it is practice, driven by CME/تاییدیه issuance and the payment KYC ecosystem.
- **Mobile verification via OTP is the norm** for signup/login on Iranian services (see §2: Kavenegar's verification/OTP service exists precisely for "registration confirmation, password recovery, 2FA" [9]).
- **Shahkar (شبکۀ احراز هویت کاربران, "user identity verification network")** is the state system, under the **Communication Regulatory Authority (CRA/سازمان تنظیم مقررات)**, that **matches a mobile number to the national code of the SIM's registered owner** [19]. It is used wherever identity assurance matters: banking, SIM issuance, and commercial services — e.g., Melipayamak requires passing Shahkar matching (`کد ملی` ↔ registered SIM owner) before activating a dedicated SMS line/panel [19]. An event platform can implement the same check via its PSP/bank KYC APIs, telecom operator APIs, or by requiring attendees to register with a SIM in their own name (self-declared + OTP).
- **Registration flows in practice:** signup = mobile + OTP; profile completion = national ID (checksum-validated client-side), name as on national ID, sometimes medical council number (for CME); payment step requires the same legal identity for receipt/invoice (fiscal-number style matching is standard on Iranian gateways).
- For **foreign/international attendees**, Kavenegar's OTP service covers 148 countries [9] — design the OTP path so it works for +98 and non-Iranian numbers alike.

---

## Sources

1. Behpardakht Mellat — *Mellat Bank Payment Gateway User Guide (English) Rev 1.0*: https://sepidan.net/sites/default/files/content/gateways/Mellat_PGW_User_Manual_English_Ver%201.0.pdf
2. Shetab Banking System — Wikipedia: https://en.wikipedia.org/wiki/Shetab_Banking_System ; CBI Payment & Clearance Systems: https://cbi.ir/page/15746.aspx
3. قانون تجارت الکترونیکی مصوب ۱۳۸۲/۱۰/۱۷ (full text incl. Arts. 33–81) — Ekhtebar: https://www.ekhtebar.ir/قانون-تجارت-الکترونیکی/ (law index: https://rc.majlis.ir/fa/law/show/93997)
4. Sepal (پرداخت‌یار رسمی شاپرک) — technical docs, web service v1: https://3pal.ir/static/api-pay ; Sepal homepage: https://3pal.ir/
5. PCI Security Standards Council — *PCI DSS v4.0 Self-Assessment Questionnaire A and Attestation of Compliance* (April 2022): https://listings.pcisecuritystandards.org/documents/PCI-DSS-v4-0-SAQ-A.pdf
6. Kavenegar — REST API documentation: https://kavenegar.com/rest.html ; pricing/plans: https://kavenegar.com/pricing.html
7. Melipayamak — SendOtp web-service documentation: https://www.melipayamak.com/api/sendotp
8. Zarinpal — Payment gateway integration guide (v4 API): https://next.zarinpal.com/paymentGateway/guide ; card-pan feature: https://www.zarinpal.com/docs/paymentGateway/moreFeatures/card-pan
9. Kavenegar — OTP/verification service page: https://kavenegar.com/sms/verification
10. DLA Piper Data Protection Laws of the World — Iran: https://www.dlapiperdataprotection.com/?c=IR&t=law
11. Law Gratis — *Privacy Law at Iran* (10 Apr 2025): https://www.lawgratis.com/blog-detail/privacy-law-at-iran
12. قانون جرایم رایانه‌ای مصوب ۱۳۸۸/۳/۵ (Computer Crimes Law, full text) — law-ir.ir: https://law-ir.ir/law/cat/1644 (Majlis Research Center record: https://rc.majlis.ir/fa/law/show/135717)
13. Eventbrite — Terms of Service (last updated 2025-08-20), §5 Export Controls and Restricted Countries: https://www.eventbrite.com/help/en-us/articles/251210/eventbrite-terms-of-service
14. Stripe — Prohibited and Restricted Businesses (High-Risk Jurisdictions and Persons): https://stripe.com/legal/restricted-businesses
15. Amazon Web Services — Customer Agreement §11.6 Trade Compliance: https://aws.amazon.com/agreement/
16. Google — Fonts API Terms of Service: https://developers.google.com/fonts/terms
17. DataCenterMap — Tehran data centers (14 facilities, 20 operators): https://www.datacentermap.com/iran/tehran/
18. U.S. Department of the Treasury — *Treasury Sanctions Iranian Company Aiding in Internet Censorship* (ArvanCloud designation, 2023-06-02): https://home.treasury.gov/news/press-releases/jy1518
19. Melipayamak — *سامانه شاهکار چیست؟* (Shahkar identity-verification system): https://www.melipayamak.com/blog/posts/what-is-shahkar
20. PersianLabs UI — National ID (کد ملی) validation utility (checksum semantics): https://ui.persian-labs.ir/docs/utilities/national-id
21. BINS.ms — Iran BIN list: https://bins.ms/country/ir
22. Shaparak.ir (شاپرک) — homepage, PSP and Pardakht-yar lists: https://shaparak.ir/
23. Pardakhtkala — Shaparak quarterly PSP market report (Tir 1404): https://pardakhtkala.ir/report-140404
24. Central Bank of Iran — Shaparak page: https://cbi.ir/page/16092.aspx
25. Saman Kish Electronic Payment (SEP) — guides & technical docs: https://www.sep.ir/راهنما-و-مستندات-فنی (en: https://www.sep.ir/)
26. Sadad Electronic Payment Co. (پرداخت الکترونیک سداد, Iran) — company site: https://sadadpsp.ir/ ; profile: https://way2pay.ir/پرداخت-الکترونیک-سداد ; holding: http://sadad.co.ir/
27. Samanehha — سامانه جامع پذیرندگان سداد (mmp.sadadpsp.ir): https://www.samanehha.com/web/417/سامانه-جامع-پذیرندگان-سداد.html
28. github.com/mhndev/ap (Asan Pardakht client) — request/verify flow description: https://github.com/mhndev/ap
29. Pasargad Electronic Payment (PEP) — IPG page + API packages: https://pep.co.ir/ipg (en: https://pep.co.ir/en) ; API collection: https://git.xszz.org/pepco-api
30. Asan Pardakht — merchant portal: https://asanpardakht.ir/portals
31. SEP (Saman) — company profile (SEP/سامان کیش): https://hormuz.group/companies/saman-kish-electronic-payment-company
32. Digipay (دیجی‌پی, Iran fintech — BNPL, not Bank Melli): https://www.mydigipay.com/about
33. Zarinpal blog — domain-match requirement for payment callbacks: https://www.zarinpal.com/blog/الزامت-تطابق-دامنه-در-فرآیند-پرداخت
34. PayPing — API documentation: https://payping.io/api
35. Vandar — IPG service documentation: https://docs.vandar.io/ipg_service/ipg
36. Kavenegar — web-service overview (Status/Receive callbacks, line types): https://kavenegar.com/وب-سرویس-پیامک.html
37. Kavenegar — verification service description (Lookup method, 148 countries, TTS): https://kavenegar.com/sms/verification
38. SMS.ir — pricing calculator: https://sms.ir/sms-price-calculator (also https://sms.ir/pricing)
39. Melipayamak — REST/console & API-key sending: https://www.melipayamak.com/blog/posts/send-sms-by-api-key
40. Melipayamak — scheduled service-line send docs: https://www.melipayamak.com/api/addschedulesendbybasenumber2
41. SMS.ir — REST API docs: https://sms.ir/rest-api
42. Farapayamak — homepage/panels: https://farapayamak.ir/
43. Faraz SMS REST SDK (community): https://github.com/aspian-io/faraz-sms-sdk
44. BBC News — Google Search and Gmail censored in Iran (2012): https://www.bbc.com/news/technology-19700910
45. OSINT613 — Google Blocks New Gmail Signups in Iran: https://www.osint613.com/post/google-blocks-new-gmail-signups-iran-23802
46. Dark Reading — Google Confirms Gmail Problems in Iran (2026): https://www.darkreading.com/cyber-risk/google-confirms-gmail-problems-in-iran
47. TNW — Iran Forbids Local Institutions from Emailing Gmail, Yahoo Users (2012): https://thenextweb.com/news/iran-forbids-banks-and-other-firms-from-corresponding-with-users-of-gmail-and-other-foreign-email-services
48. Same BBC item as [44].
49. Spamhaus — Domain Blocklist (DBL) scope: https://www.spamhaus.org/blocklists/domain-blocklist/
50. DLA Piper — Iran transfer topic: https://www.dlapiperdataprotection.com/?c=IR&t=transfer
51. DataGuidance — Iran jurisdiction summary: https://www.dataguidance.com/jurisdictions/iran
52. Ekhtebar — طرح حمایت و حفاظت از داده و اطلاعات شخصی (2021 bill full text, Arts. 1–56): https://www.ekhtebar.ir/طرح-حمایت-و-حفاظت-از-داده-و-اطلاعات-شخصی/
53. ARTICLE 19 — *Iran: Personal Data Protection and Safeguarding Draft Act* (June 2019 legal analysis): https://www.article19.org/wp-content/uploads/2019/06/Legal-Analysis-of-Draft-Data-Protection-Act.pdf
54. ARTICLE 19 — *Iran's Draft Data Protection Act: Too little but not too late*: https://www.article19.org/resources/irans-draft-data-protection-act-too-little-but-not-too-late/
55. Google — Publisher Policies Help, Sanctions compliance: https://support.google.com/publisherpolicies/answer/11128499
56. "Tech Sanctions" — community list of services inaccessible in Iran due to sanctions compliance: https://docs.google.com/spreadsheets/d/1b9tetXkMg4PB_XyWcsC_UWGv45MX3pZmasnDBhyQxlY/edit
57. OFAC — Iran General License D-2 (services, software, hardware): https://ofac.treasury.gov/media/928096/download?inline
58. Federal Register 2023-07-20 — OFAC Iran GL publication (IT services expansion): https://www.govinfo.gov/content/pkg/FR-2023-07-20/html/2023-15368.htm
59. OFAC — Iran Sanctions program page (selected GLs): https://ofac.treasury.gov/sanctions-programs-and-country-information/iran-sanctions ; GL E (NGO services): https://ofac.treasury.gov/media/7996/download?inline
60. Pars Online — datacenter/company profile: https://www.datacenters.com/pars-online-tehran ; https://platform.tracxn.com/a/d/company/531a9160e4b0f7e1661225d0/parsonline
61. Asiatech — About us: https://asiatech.ir/en/page/about-usEN/
62. Hurricane Electric BGP — Iran networks (AS43754 Asiatech, AS49666 TIC, etc.): https://bgp.he.net/country/ir
63. Wikipedia — Category: Internet service providers of Iran: https://en.wikipedia.org/wiki/Category:Internet_service_providers_of_Iran
64. ArvanCloud — products (Cloud Server, CDN, Video, Object Storage, Edge): https://www.arvancloud.ir/en/products
65. Fanap — ArvanCloud description ("largest supplier of cloud computing solutions in Iran, established 2015"): https://fanap.ir/en
66. Mihan Blockchain — Shaparak notice cutting PSP service to crypto exchanges (2020): https://mihanblockchain.com/online-payment-of-iranian-cryptocurrency-exchanges-should-be-banned
67. Iranian National Code generator/validator (checksum demo): https://majidh1.github.io/iranianNationalCode
