# 🏗️ Technical Specifications: Consensus Mesh Engineering

This document details the architectural decisions, mathematical models, and security trade-offs implemented in the **Consensus Mesh** ecosystem. It serves as a deep-dive for engineers, recruiters, and security researchers.

---

## 🛠️ 1. Architecture Philosophy: Why "Consensus Mesh"?

In designing this system, we moved away from **Centralized Authority** (GPS/QR) toward **Environmental Consensus**. 

### **The "Why" Behind our Stack:**
* **Why WiFi Fingerprinting?** GPS is accurate to ~10 meters but fails indoors and is easily spoofed by software-level "Mock Location" providers. WiFi RSSI (Received Signal Strength Indication) is hardware-dependent and attenuates rapidly through physical matter (walls/furniture), making it a superior indoor "proof of presence."
* **Why Node.js & MongoDB?** Attendance systems are high-write, low-read environments. MongoDB’s document-based schema allows us to store complex "Session Evidence" (WiFi arrays and sensor logs) without the overhead of rigid relational joins.
* **Why Flutter?** We needed low-level access to hardware sensors (WifiScan, Accelerometer) with a single codebase to ensure uniform "Pulse-Sync" timing across different devices.

---

## 📐 2. The Mathematics of Presence

We utilize a dual-mathematical approach to define the "Mesh Bubble."

### **A. N-Dimensional Cosine Similarity (Pattern Matching)**
We treat the WiFi environment as a vector in $n$ dimensions.
$$Similarity = \frac{\sum (S_v \cdot T_v)}{\sqrt{\sum S_v^2} \cdot \sqrt{\sum T_v^2}}$$
**The Logic:** Unlike simple "SSID matching," Cosine Similarity looks at the *ratio* and *pattern* of signals. If a student tries to "boost" their signal with an external antenna, the pattern remains the same—Cosine Similarity ignores the magnitude and focuses on the pattern.

### **B. Euclidean Displacement (Spherical Shielding)**
To calculate physical distance within the room, we use the Root Mean Square (RMS) of the signal gap:
$$d = \sqrt{\frac{\sum_{i=1}^{n} (T_i - S_i)^2}{n}}$$
**The Logic:** This provides a "Displacement Unit." If the displacement $d$ exceeds the Teacher's calibrated **Radial Limit**, the student is flagged as being outside the room, even if the SSID pattern is similar.



---

## 🛡️ 3. Security Feature Deep-Dive

### **A. The "Pulse-Sync" Heartbeat**
**The Problem:** Students sending heartbeats at different times allows a proxy-user to handle multiple devices sequentially.
**The Solution:** **Clock-Synced Pulses**. 
* Apps calculate `msUntilNextPulse = 10000 - (currentTime % 10000)`.
* Every device in the room fires its telemetry at exactly `:00`, `:10`, `:20`... of the global clock.
* The server only validates "Liveness Proofs" that arrive within a synchronized 5-second window.

### **B. Cognitive Liveness Challenge**
**The Feature:** A full-screen overlay requiring the student to tap the **Smallest Number** among 4 random choices.
**Why?** A fixed code can be yelled across the room. A cognitive task requires the student to look at their own unique screen, scan the numbers, and react. Doing this for 5 phones simultaneously is a cognitive impossibility.

### **C. Anti-Cluster Peer-Audit (The Double-Filter Funnel)**
The server performs a cross-comparison between all active heartbeat telemetry to detect "Identity Collisions."

1. **Stage 1: Kinetic Synchronization (Accelerometer Audit):** If Student A, B, and C report identical **Accelerometer Variance** ($<0.01$ or identical motion spikes), they are flagged as a **"Potential Kinetic Cluster."** It is physically impossible for different humans to have identical micro-tremors simultaneously.
2. **Stage 2: Peer-to-Peer Euclidean Displacement:** The server calculates the relative distance between devices in the cluster. If $d_{p2p} \approx 0$, it confirms the devices are physically touching (e.g., in one person's bag).
3. **Result:** These devices are flagged in the teacher terminal with specific roll numbers (e.g., *"Proxy Cluster Detected: 101, 105, 110"*).



### **D. Wall-Guard™ Attenuation Filter**
**The Logic:** Signal gap > 22dB.
**Why?** 22dB is the average attenuation of a 4-inch concrete wall. If the server sees a signal drop of this magnitude between the teacher and student, it knows a physical barrier exists, even if the student is technically "close" in distance.

---

## 🛠️ 4. The Manual Override (Human-in-the-Loop)

We recognize that "Zero-Trust" math can occasionally flag legitimate students (e.g., sitting extremely close). To handle this, we implemented a **Teacher Review Interface**.

* **Review Dialog:** Post-session, the Teacher sees a list of only the "Flagged" or "Partial" students with specific evidence (e.g., "Wall-Guard Obstruction").
* **Manual Override:** The Teacher can use a status dropdown to move a student from `PARTIAL` to `PRESENT` or `ABSENT` based on physical verification.
* **Accountability:** The system acts as a **Decision-Support Tool**, providing the evidence while leaving the final judgment to the human instructor.

---

## 🔄 5. System Handshake Sequence



1.  **Anchor:** Teacher initializes a JWT-secured session with calibration settings.
2.  **Telemetry:** Client streams `accelVariance` and `WiFi JSON` to the Node.js backend every 10s on the Synced Pulse.
3.  **The Challenge:** Server flips `quizActive: true`. Apps catch the flag and trigger the "Smallest Number" UI.
4.  **Finalization:** Server performs a recursive audit of history and flags clusters before the teacher finalizes the report.

---

## 📊 6. Technical Stack Details
* **Frontend:** Flutter (Sensors_Plus, Wifi_Scan).
* **Backend:** Node.js (Express), `jsonwebtoken` (Auth), `bcryptjs` (Identity).
* **Database:** MongoDB Atlas with IST offset logic `(+5.5)` for scheduling.
