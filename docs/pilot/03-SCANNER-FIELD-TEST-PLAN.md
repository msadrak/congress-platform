# 03 — Scanner Station Hardware Field-Test Plan & Verification Matrix

**Evaluation Date:** 2026-10-11  
**Scope:** Physical Hardware Acceptance & Environmental Gate Stress Tests  
**Classification:** NOT VERIFIED ON PHYSICAL HARDWARE (Software Interfaces Ready / On-Site Test Required)  

---

## 1. Executive Summary

While the web scanner software layer, audio engine, and IndexedDB state machines have been verified through automated browser emulation, **software simulation cannot substitute for physical hardware certification**. Optical laser beam scatter, mobile camera lens flare, low-end tablet thermal throttling, and venue lighting conditions require manual, on-site physical verification.

This document establishes the mandatory **Hardware Field-Test Matrix** that venue operations staff must execute prior to opening registration gates.

---

## 2. Hardware Field-Test Matrix Template

| Test ID | Hardware Target | Device Make / Model | Operating System & Browser | Connection Seam | Operator | Date | Acceptance Threshold | Physical Test Status |
|:---|:---|:---|:---|:---|:---|:---|:---|:---|
| **HW-01** | 2D Optical Barcode Gun | Honeywell Voyager 1400g / Netum NT-1228BL | Windows 11 / Chrome 124+ | USB-A HID Keyboard Emulation | Venue Lead | TBD | Scans 128-bit QR in < 300ms without dropping characters | **NOT VERIFIED** |
| **HW-02** | Wireless Barcode Gun | Inateck BCST-70 2.4G | iPadOS 17 / Safari | Bluetooth HID Keyboard | Gate Staff | TBD | Emulates keystrokes into background listener | **NOT VERIFIED** |
| **HW-03** | Tablet Camera Scanner | Apple iPad 10th Gen (A14) | iPadOS 17.4+ / Safari | Native WebKit `BarcodeDetector` | Gate Staff | TBD | Decodes printed & smartphone screen QRs in < 500ms | **NOT VERIFIED** |
| **HW-04** | Android Tablet Camera | Lenovo Tab P11 Gen 2 | Android 13 / Chrome 124+ | Chromium `BarcodeDetector` / ZXing | Gate Staff | TBD | Autofocus latches under indoor venue illumination | **NOT VERIFIED** |
| **HW-05** | Thermal Badge Printer | Brother QL-820NWB / Dymo 450 | Windows 11 / Chrome Print API | USB / Ethernet Network Print | Desk Staff | TBD | Prints 300 DPI high-contrast badge in < 3s | **NOT VERIFIED** |
| **HW-06** | Wi-Fi Severance Drill | Gate Station Laptop | Chrome / Offline Cache | Intentional AP Disconnect | Venue Lead | TBD | Status flips to "Offline"; queue buffers in IndexedDB | **NOT VERIFIED** |
| **HW-07** | Wi-Fi Recovery Drill | Gate Station Laptop | Chrome / IndexedDB Queue | Wi-Fi Reconnection | Venue Lead | TBD | 50 buffered scans sync in < 5s without duplicate admission | **NOT VERIFIED** |
| **HW-08** | Device Sleep & Resume | Scanner Tablet | iPadOS / Sleep Mode (15 min) | Display Power Off/On | Gate Staff | TBD | Session, token, and manifest preserved upon wake | **NOT VERIFIED** |

---

## 3. Step-by-Step Field Execution Protocols

### Protocol A: Optical Barcode Gun Testing (HW-01 & HW-02)
1. Plug USB scanner into gate workstation; verify LED powers on.
2. Open `/scan/:pointId` in Chrome or Safari; do NOT click into any text box (rely on background HID listener).
3. Print a sample attendee badge with a 128-bit entity QR code (dimensions: 35×35mm).
4. Scan the badge from distances of 10cm, 20cm, and 30cm at angles between 0° and 45°.
5. **Pass Criteria:**
   - Scan evaluates in $< 300\text{ms}$.
   - Distinct audio chime sounds (`playSuccessChime` or `playErrorBuzz`).
   - Recent scan card appears in Zone E feed with attendee name and timestamp.

### Protocol B: Thermal Badge Printer Testing (HW-05)
1. Load continuous or die-cut label stock into the printer (standard badge size: 62mm × 100mm).
2. Open `/organizer/events/:id/desk` on the front desk workstation.
3. Enter walk-in attendee information and click *"صدور و چاپ کارت ورود"* (Mint Badge).
4. When the badge dialog opens, click *"چاپ کارت ورود"* (Print Pass).
5. In the browser print dialog, select the thermal printer and ensure *"Headers and footers"* is unchecked.
6. **Pass Criteria:**
   - Print job executes within 3 seconds.
   - Text is crisp, aligned, and legible.
   - QR code quiet zone (white margin) measures $\ge 4\text{mm}$.
   - Printed QR code scans successfully on the first attempt using the gate scanner.

### Protocol C: Environmental Lighting Stress Test
1. Test scanning badges under three real venue conditions:
   - Direct bright overhead LED spotlights.
   - Dim auditorium ambient lighting.
   - Smartphone screens displaying QR at 50% and 100% brightness.
2. **Pass Criteria:** Barcode decodes reliably without requiring repeated angling or manual credential entry.
