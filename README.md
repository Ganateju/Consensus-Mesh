# Consensus Mesh 📡

### Zero-Trust Environmental Consensus Architecture

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Flutter](https://img.shields.io/badge/Platform-Flutter-02569B?logo=flutter)](https://flutter.dev)
[![Node.js](https://img.shields.io/badge/Backend-Node.js-339933?logo=node.js)](https://nodejs.org)
[![MongoDB](https://img.shields.io/badge/Database-MongoDB-47A248?logo=mongodb)](https://www.mongodb.com/)

**Consensus Mesh** is a high-security attendance and identity verification ecosystem designed to eliminate "Proxy Attendance." Consensus Mesh establishes trust through environmental consensus.Instead of verifying credentials, it verifies shared physical reality by combining RF fingerprinting, indoor triangulation, temporal synchronization and human liveness validation. If you aren't breathing the same air and seeing the same signals at the exact same millisecond, you aren't in the mesh.
---
## 📖 Documentation
* [🚀 Project Overview](./PROJECT_OVERVIEW.md) - *The "Why" and "What"*
* [🏗️ Technical Specifications](./TECHNICAL_SPECIFICATIONS.md) - *The "How" and "Math"*


---
## Status

Current State : Functional MVP

Deployment : APK Released

Validation Phase : Campus Pilot Deployment

Current Focus

• Environmental Consensus
• Dynamic Indoor Triangulation
• Cluster Detection
• Proxy Resistance Validation
• Real-world Deployment Analysis

Roadmap

□ Campus Scale Validation
□ Multi-Classroom Calibration
□ Adaptive Similarity Models
□ Large-Scale Consensus Analytics
---
## 🌟 Core Innovation: Environmental Consensus Mesh:

Consensus Mesh derives trust from four independent dimensions of evidence:

• Spatial Consensus
• Temporal Consensus
• Human Liveness
• Distributed Peer Verification

Together these create a robust environmental proof of presence that is significantly harder to spoof than credential-based attendance systems.
---

## 🛡️ Security Analysis (Defense Mechanisms)

| Attack Vector | Consensus Mesh Defense |
| :--- | :--- |
| **Remote Proxy** | **Environment Mismatch:** Fails if the student's signal "Set Difference" > 70% from Teacher. |
| **Bag-Drop / Ghosting** | **Motion Audit:** Accelerometer analysis flags devices with static variance (<0.01). |
| **The "Piano" Attack** | **Pulse-Sync:** One person cannot solve 5 cognitive challenges appearing simultaneously on 5 screens. |
| **Wall-Guard™ Bypass** | **Spherical Shield:** Uses Euclidean Displacement ($d$) to detect signals leaking through walls. |

---

## 🔄 System Workflow

1. **Scheduling:** Admin pushes class schedule to MongoDB via the Admin Terminal.
2. **Anchoring:** Teacher initializes the session, setting the **Radial Displacement Limit** for that specific room.
3. **Synchronized Pulse:** Student apps align their heartbeats to the server's global clock mark (:00, :10, :20...).
4. **Validation:** Server performs Cosine Similarity and **Euclidean Displacement Math** on the signal vectors.
5. **Simultaneous Challenge:** Teacher pushes a liveness flag; every student must pass the "Smallest Number" scan instantly.
6. **Audit & Finalize:** Teacher reviews flagged "Proxy Clusters" before exporting the cryptographically signed CSV.

---

## 📈 Mathematics of Proximity

The system utilizes two primary mathematical models to define the "Presence Bubble":

**1. Cosine Similarity (Pattern Matching):**
$$Similarity = \frac{\sum (S_v \cdot T_v)}{\sqrt{\sum S_v^2} \cdot \sqrt{\sum T_v^2}}$$

**2. Euclidean Displacement (Radial Shielding):**
$$d = \sqrt{\frac{\sum_{i=1}^{n} (T_i - S_i)^2}{n}}$$

---

## 🖥️ Admin Dashboard

Includes a **Reactive Control Center**:
- **Live Mesh Monitor:** Real-time visualization of active classes and student "Links."
- **Master Scheduler:** Integrated IST-synced management for weekly time-slots.
- **Class-Specific Audit Logs:** Advanced search and filtering for historical attendance reports.
- **Reactive UI:** Instant loading states (spinners) for all database interactions to ensure consistency.

---

## 🛠️ Tech Stack

- **Mobile App:** Flutter (Provider, Sensors_Plus, Wifi_Scan)
- **Backend:** Node.js, Express.js (Hosted on Render)
- **Database:** MongoDB Atlas (NoSQL)
- **Authentication:** JWT (HMAC-SHA256) & Bcrypt Password Hashing

---
## Engineering Domains

- Systems Engineering
- Signal Processing
- Distributed Verification
- Sensor Fusion
- Indoor Localization
- Security Engineering
- Mobile Systems
- Backend Architecture
---

**Developed with ❤️ by Ganateju** *Securing identity through environmental consensus.*
