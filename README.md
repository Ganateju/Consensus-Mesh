# Consensus Mesh 📡 
### **Zero-Trust Hybrid Proximity & Identity Verification**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Flutter](https://img.shields.io/badge/Platform-Flutter-02569B?logo=flutter)](https://flutter.dev)
[![Node.js](https://img.shields.io/badge/Backend-Node.js-339933?logo=node.js)](https://nodejs.org)
[![MongoDB](https://img.shields.io/badge/Database-MongoDB-47A248?logo=mongodb)](https://www.mongodb.com/)

**Consensus Mesh** is a high-security attendance and identity verification ecosystem designed to eliminate "Proxy Attendance." It creates a mathematical consensus of the ambient RF (Radio Frequency) environment between a Teacher and a Student. If you aren't breathing the same air and seeing the same signals, you aren't in the mesh.



---

## 🌟 Core Innovation: The "Triple-Lock" Security

Unlike traditional systems, Consensus Mesh requires three simultaneous proofs of presence:

1. **Spatial Consensus (WiFi Fingerprinting):**
   The server compares the WiFi "landscape" (SSIDs and RSSI) of the student and teacher using **Cosine Similarity math**. Unlike GPS, WiFi signals cannot be easily "mocked" via software.
   
2. **Temporal Logic (IST Scheduler):**
   Synchronized to **Indian Standard Time (IST)**. Teachers can only "Anchor" a room if they have a pre-registered schedule for that specific time window.

3. **Human Liveness (Sensor Fusion):**
   - **Accelerometer Variance:** Detects micro-tremors to ensure a human is holding the device (blocks emulators/static bots).
   - **Cryptographic Challenges:** Random math hurdles pushed to the UI that must be solved in 15 seconds to prove active presence.



---

## 🛡️ Security Analysis (Defense Mechanisms)

| Attack Vector | Consensus Mesh Defense |
| :--- | :--- |
| **QR Code Spoofing** | No static codes used; requires real-time environmental RF matching. |
| **GPS Mocking** | GPS is ignored; uses physical RSSI levels which are hardware-dependent. |
| **Proxy (Remote Check-in)** | Student must be within the same RF 'bubble'. Fingerprints expire every 10s. |
| **Bag-Drop / Ghosting** | Accelerometer analysis ensures the phone is held, not sitting static. |
| **Emulator / Bot** | Backend detects perfectly stable signal entries, flagging artificial injection. |

---

## 🔄 System Workflow

1. **Scheduling:** Admin pushes class schedule to MongoDB Atlas.
2. **Anchoring:** Teacher initializes the session; Server verifies the schedule (IST) and captures the "Seed" WiFi fingerprint.
3. **Discovery:** Student app scans ambient WiFi and requests a match from the Mesh.
4. **Validation:** Server performs Cosine Similarity math on the signal vectors.
5. **Continuous Auth:** Student must pass periodic "Liveness Challenges" to maintain status.
6. **Audit:** Admin monitors the "Live Mesh" and reviews manual teacher overrides via the dashboard.



---

## 🛠️ Tech Stack

- **Mobile App:** Flutter (Provider, Sensors_Plus, Wifi_Scan)
- **Backend:** Node.js, Express.js (Hosted on Render)
- **Database:** MongoDB Atlas (NoSQL)
- **Authentication:** JWT (HMAC-SHA256) & Bcrypt Password Hashing

---

## 🖥️ Admin Dashboard

Includes a web-based **Control Center**:
- **Live Mesh Monitor:** Real-time view of active classes and connected students.
- **Sensitivity Slider:** Real-time adjustment of the RSSI matching threshold (0-100%).
- **Audit Trail:** Detailed logs of every manual status modification for accountability.



---

## 📈 Mathematics of Proximity

The system calculates similarity using the **Cosine Similarity** formula:

$$Similarity = \frac{\sum (S_v \cdot T_v)}{\sqrt{\sum S_v^2} \cdot \sqrt{\sum T_v^2}}$$

Where $S_v$ represents the Student's normalized signal vector and $T_v$ represents the Teacher's anchor vector.

---

## 🚀 Getting Started

1. **Download APK:** Get the latest build from the [Releases](https://github.com/Ganateju/Consensus-Mesh/releases/tag/v1.0.0) section.
2. **Permissions:** Grant Location permissions (required for WiFi scanning on Android).
3. **Credentials:** Use the unique ID and Password assigned by your administrator.

---

**Developed with ❤️ by Ganateju** *Securing identity through environmental consensus.*
