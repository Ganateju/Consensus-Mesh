# Consensus Mesh: Production Hardening Roster of Changes

This document provides a clean, comprehensive list of all structural security upgrades, API feature additions, mathematical logic implementations, and mobile client hardening modifications applied across the **Consensus Mesh** workspace.

---

## 📡 1. Express Server Component (`server/index.js`)

We refactored and expanded the Node.js backend from a basic prototype to an enterprise-grade, zero-trust coordination server.

### A. Database Models & Schema Extensions
* **[NEW] `Enrollment` Schema:** Stores course section rosters maps:
  - `courseId` (String)
  - `sectionId` (String)
  - `enrolledStudents` (Array of String studentIDs / rollNos)
* **[NEW] `AttendanceReport` Schema:** Stores finalized classroom reports containing:
  - `sessionId` (Mongoose ObjectId)
  - `courseId` (String)
  - `sectionId` (String)
  - `date` (Date)
  - `finalizedBy` (String)
  - `records` (Array of Objects containing `studentId`, `status`, `isOverridden`, and `originalStatus`)
* **[NEW] `EventReport` Schema:** Stores dynamic multidisciplinary seminar/club reports containing:
  - `eventId` (String Pin)
  - `title` (String)
  - `coordinatorId` (String)
  - `timestamp` (Date)
  - `verifiedPresent` (Array of studentIDs)
  - `flaggedProxies` (Array of studentIDs)
  - `verificationMethod` (String: `"Algorithmic_Mesh"` | `"Manual_Override"`)

### B. Core Security Hardening
* **Zero-Trust Environment Seeding (`seedDatabase`):** Banned hardcoded credentials. The database seeds dynamically from environment variables (`ADMIN_INIT_USER`, `ADMIN_INIT_PASS`, etc.). If variables are missing, it throws a critical warning, generates secure passwords using `crypto.randomUUID()`, hashes them, and prints them to the secure console logs for testing.
* **Server-Side Liveness Challenge Authority:** The client app is no longer allowed to evaluate its own liveness challenge. When `POST /trigger-quiz` is called, the server:
  - Generates 4 unique numbers between 10 and 99.
  - Determines the correct smallest number.
  - Caches the option array and correct answer in volatile memory for 10 seconds.
  - Students fetch challenge options via `/submit-evidence` and post answers to a secure `/submit-liveness` endpoint for backend evaluation.

### C. Advanced Proximity & Calibration Math
* **Dynamic Logarithmic Crowd Calibration:** Update `POST /set-master` to ingest `expectedStudents` and compute dynamic Cosine Similarity thresholds to offset high-density attenuation:
  $$T_{dynamic} = \max\left(0.85 - 0.05 \cdot \ln(\text{expectedStudents}), 0.70\right)$$
  Saved directly in active settings, scaled out of 100.
* **Triangulation Multi-Anchor Dynamic Clustering:**
  - **Volatile Array:** Added `sessionCluster` to the active session.
  - **Dynamic Capture:** Automatically monitors incoming client telemetry for the first 3 minutes of a class. Designates the top 3 devices exhibiting similarity $> 90\%$ and historical RSSI variance $< 2.0$ as active triangulation nodes.
  - **Hot-Swapping Node Monitor:** If an active node misses 2 consecutive tracking windows (25s), it is dropped, and the next best stable device is promoted.
  - **Dual-Vector Matrix Math:** Evaluates student proximity silently on the backend:
    $$\text{Score}_{\text{combined}} = 0.60 \cdot \text{CosineSimilarity}(S, T) + 0.40 \cdot \text{Average}(\text{CosineSimilarity}(S, \text{ClusterNodes}))$$
* **Roster Set-Difference Absentees Engine:** Update `/finalize-session` to run a Set Difference calculation against dynamic enrollments. Students with `0` telemetry entries are instantly marked `Absent`, and sparse tracking records (less than 40% check-ins) are flagged `Partial`.
* **Proximity Scan Filter (`filterScanVector`):** Strips obvious mobile hotspots (using regexp patterns like `/iphone/i`, `/android/i`, `/portable/i`), hidden or unidentifiable SSIDs, and weak signals ($< -85\text{ dBm}$) before similarity calculations.
* **Dynamic Time-Window Overlap Selector:** Refactored `/set-master` to look for scheduled teacher slots that overlap with the server's current Indian Standard Time (IST) window, adding a **15-minute preparation buffer**.

### D. New API Route Endpoints
* **`POST /admin/add-user`:** Register identities, hashing passwords with `bcryptjs`.
* **`POST /admin/add-schedule`:** Dynamically add teacher scheduled slots.
* **`POST /admin/delete-user`:** Delete identity documents by Mongoose ID.
* **`POST /discover-room`:** Automatically matches and connects client scan footprints against the best active teacher mesh coordinates.
* **`POST /submit-final-report`:** Commits finalized override records to database ledger.
* **`GET /admin/audit-logs`:** Centralized React Admin overrides query aggregator.
* **`POST /create-event` & `POST /join-event` & `POST /close-event`:** Ad-hoc club/seminar routes with isolated state tracking.
* **`GET /event-status`:** Polls active attendee rosters.

---

## 📱 2. Flutter Client Component (`student_app/lib/main.dart`)

We refactored the client from a minimal layout to a highly visual, secure dashboard with independent class/event lifecycle pipelines.

### A. State Additions & Touch Safeguards
* **`_isInflight` Interaction Blocker:** Disables all widgets during active API network calls to prevent double-tap submissions.
* **Segmented Dashboard Tracks:** Added state variables `_isEventMode`, `_eventPin`, and `_eventPollTimer` to run standard classes and ad-hoc seminars independently.

### B. Core UI & Reconciliation Overrides
* **Expected Students Field:** Added numeric input to Standard Class layout to calibrate crowd attenuation.
* **Sliding Bottom Modal Sheet (`ReconciliationSheetContent`):** Presents dual-tabbed post-class results:
  - **Tab 1 (Verified):** Green cards for automatically Present students.
  - **Tab 2 (Absentees / Review Queue):** Coral cards for Partial or Absent students.
  - **Switch Safety Overrides:** Interactive toggle switch next to review items. Tapping overrides the status to Present and flags `isOverridden = true` dynamically.
  - **Ledger Commit Button:** Sends reconciled overrides back to `/submit-final-report` and cleans local session flags.

### C. Ad-Hoc Seminar Views & Student Entry
* **Coordinator PIN Board:** Alternative dashboard displaying the active 6-digit PIN in copyable typography.
* **Live Attendee Polling Ticker:** Background loop calling `/event-status` every 3 seconds, bound to clean up on widget `dispose()` to prevent leakage.
* **Event Proxy Review Tab:** Group attendee metrics by student department, displaying `Flagged Proxy Attempts` with override switches.
* **Student PIN Check-In Card:** Interactive panel that requests location permissions, runs a high-efficiency single background WiFi vector scan, posts to `/join-event`, and renders a glassmorphic success card on success (`Registered to Event and Synced ✅`).

### D. Verification & Compilation Bugfixes
* **Heartbeat Trapping:** Sync loop catches non-200 responses and flags `Mesh Synced Error ❌`.
* **Dart Compilation Success:** Substituted all invalid references of `Colors.emerald` with standard **`Colors.teal`**, ensuring seamless client builds.
