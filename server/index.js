/**
 * index.js - The Consensus Mesh Core Server (Elite Zero-Trust Edition)
 */

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken'); 
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { validateBubbleBoundary } = require('./physicsEngine');

const app = WebApp = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const CLOUD_DB_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET || "MESH_SECURE_TOKEN_2024";

// --- GLOBAL ENGINE STATE ---
let ACTIVE_SESSIONS = {}; 
let ACTIVE_EVENTS = {};

// 1. DATABASE CONNECTION
mongoose.connect(CLOUD_DB_URI).then(() => {
    console.log("✅ Secure Hybrid Mesh Server Online");
    seedDatabase();
});

// 2. DATA MODELS
const User = mongoose.model('User', new mongoose.Schema({
    username: { type: String, unique: true },
    password: { type: String },
    role: { type: String, enum: ['student', 'teacher', 'admin'] },
    rollNo: String,
    department: String
}));

const Schedule = mongoose.model('Schedule', new mongoose.Schema({
    teacherID: String,
    day: String,
    startTime: String,
    endTime: String,
    className: String
}));

const History = mongoose.model('History', new mongoose.Schema({
    className: String,
    teacherID: String,
    timestamp: { type: Date, default: Date.now },
    attendance: [{ 
        rollNo: String, 
        rfStability: Number, 
        liveness: String, 
        status: String, 
        flags: [String] 
    }]
}));

// Enrollment Schema
const Enrollment = mongoose.model('Enrollment', new mongoose.Schema({
    courseId: { type: String, required: true },
    sectionId: { type: String, required: true },
    enrolledStudents: [{ type: String }] // Array of String studentIDs
}));

// AttendanceReport Schema
const AttendanceReport = mongoose.model('AttendanceReport', new mongoose.Schema({
    sessionId: { type: mongoose.Schema.Types.ObjectId, required: true },
    courseId: { type: String, required: true },
    sectionId: { type: String, required: true },
    date: { type: Date, default: Date.now },
    finalizedBy: { type: String, required: true },
    records: [{
        studentId: { type: String, required: true },
        status: { type: String, enum: ['Present', 'Partial', 'Absent'], required: true },
        isOverridden: { type: Boolean, default: false },
        originalStatus: { type: String, enum: ['Present', 'Partial', 'Absent'], required: true }
    }]
}));

// EventReport Schema (Multidisciplinary)
const EventReport = mongoose.model('EventReport', new mongoose.Schema({
    eventId: { type: String, required: true },
    title: { type: String, required: true },
    coordinatorId: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    verifiedPresent: [{ type: String }],
    flaggedProxies: [{ type: String }],
    verificationMethod: { type: String, default: "Algorithmic_Mesh" } // or "Manual_Override"
}));

// --- ZERO-TRUST DYNAMIC DATABASE SEEDING ---
const seedDatabase = async () => {
    try {
        const userCount = await User.countDocuments();
        if (userCount === 0) {
            console.log("🌱 Database is empty. Initiating Zero-Trust dynamic seeding...");

            let adminUser = process.env.ADMIN_INIT_USER;
            let adminPass = process.env.ADMIN_INIT_PASS;
            let teacherUser = process.env.TEACHER_INIT_USER;
            let teacherPass = process.env.TEACHER_INIT_PASS;
            let studentUser = process.env.STUDENT_INIT_USER;
            let studentPass = process.env.STUDENT_INIT_PASS;

            let missingVars = [];
            if (!adminUser || !adminPass) missingVars.push("ADMIN_INIT");
            if (!teacherUser || !teacherPass) missingVars.push("TEACHER_INIT");
            if (!studentUser || !studentPass) missingVars.push("STUDENT_INIT");

            if (missingVars.length > 0) {
                console.error(`⚠️ CRITICAL CONFIGURATION WARNING: Missing environment variables for: ${missingVars.join(', ')}.`);
                
                // Fallback to secure randomized credentials
                if (!adminUser) adminUser = "admin";
                if (!adminPass) {
                    adminPass = crypto.randomUUID();
                    console.warn(`🔑 SECURE SYSTEM BACKUP [ADMIN PASSWORD]: ${adminPass}`);
                }
                
                if (!teacherUser) teacherUser = "teacher1";
                if (!teacherPass) {
                    teacherPass = crypto.randomUUID();
                    console.warn(`🔑 SECURE SYSTEM BACKUP [TEACHER PASSWORD]: ${teacherPass}`);
                }
                
                if (!studentUser) studentUser = "student1";
                if (!studentPass) {
                    studentPass = crypto.randomUUID();
                    console.warn(`🔑 SECURE SYSTEM BACKUP [STUDENT PASSWORD]: ${studentPass}`);
                }
            }

            const salt = 10;
            const hashedAdminPass = await bcrypt.hash(adminPass, salt);
            const hashedTeacherPass = await bcrypt.hash(teacherPass, salt);
            const hashedStudentPass = await bcrypt.hash(studentPass, salt);

            await User.create([
                { username: adminUser.toLowerCase().trim(), password: hashedAdminPass, role: "admin" },
                { username: teacherUser.toLowerCase().trim(), password: hashedTeacherPass, role: "teacher" },
                { username: studentUser.toLowerCase().trim(), password: hashedStudentPass, role: "student", rollNo: "2024CS01", department: "CS-A" }
            ]);

            console.log("✅ Zero-Trust Seeding Completed Successfully.");

            // Seed a schedule for the seeded teacher
            const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
            const schedules = days.map(day => ({
                teacherID: teacherUser.toLowerCase().trim(),
                day: day,
                startTime: "00:00",
                endTime: "23:59",
                className: "CS-A"
            }));
            await Schedule.create(schedules);
            console.log(`✅ Seeded 24/7 Schedules for teacher '${teacherUser}' across all days of the week.`);

            // Seed mock enrollment for courses
            await Enrollment.create({
                courseId: "CS101",
                sectionId: "A",
                enrolledStudents: ["2024cs01", "student1"]
            });
            console.log("✅ Seeded dynamic mock enrollments for course CS101 Section A.");
        }
    } catch (err) {
        console.error("❌ Error during dynamic database seeding:", err);
    }
};

// 3. SECURITY MIDDLEWARE
const verifyToken = (req, res, next) => {
    const token = req.headers['authorization'] || req.query.token; 
    if (!token) return res.status(403).json({ message: "Access Denied" });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ message: "Invalid Session" });
    }
};

// 4. CORE LOGIC: SIMILARITY & SIGNAL FILTERING
const filterScanVector = (wifi) => {
    if (!wifi) return {};
    const filtered = {};
    const hotspotPatterns = [
        /hotspot/i, /iphone/i, /galaxy/i, /pixel/i, /android/i, 
        /oppo/i, /vivo/i, /redmi/i, /realme/i, /oneplus/i, /portable/i, /mobile/i
    ];
    for (const [ssid, rssi] of Object.entries(wifi)) {
        // 1. Strip transient/empty/hidden SSIDs
        if (!ssid || ssid.trim() === "" || ssid.toLowerCase().includes("hidden") || ssid.toLowerCase().includes("unknown")) {
            continue;
        }
        // 2. Strip weak or unstable RSSI profiles (weaker than -85 dBm)
        if (rssi < -85) {
            continue;
        }
        // 3. Strip obvious mobile hotspots
        const isHotspot = hotspotPatterns.some(pattern => pattern.test(ssid));
        if (isHotspot) {
            continue;
        }
        filtered[ssid] = rssi;
    }
    return filtered;
};

const calculateSimilarity = (s, t) => {
    if (!s || !t || Object.keys(s).length === 0 || Object.keys(t).length === 0) return 0;
    let dotProduct = 0, sNorm = 0, tNorm = 0;
    const allSSIDs = new Set([...Object.keys(s), ...Object.keys(t)]);
    allSSIDs.forEach(ssid => {
        const sv = s[ssid] ? s[ssid] + 110 : 0;
        const tv = t[ssid] ? t[ssid] + 110 : 0;
        dotProduct += sv * tv; sNorm += sv * sv; tNorm += tv * tv;
    });
    const magnitude = Math.sqrt(sNorm) * Math.sqrt(tNorm);
    return magnitude === 0 ? 0 : (dotProduct / magnitude) * 100;
};

// --- SILENT MULTI-ANCHOR DYNAMIC CLUSTERING (TRIANGULATION) ---

const updateTriangulationNodes = (session) => {
    try {
        const elapsed = Date.now() - session.startTime;
        if (elapsed > 180000) return; // Background capture restricted to the first 3 minutes

        const candidates = [];
        const studentsArray = Object.values(session.sessionEvidence);
        
        // Pinpoint strongest teacher anchor SSID
        let strongestSSID = null;
        let maxRSSI = -999;
        for (const [ssid, rssi] of Object.entries(session.masterWifi)) {
            if (rssi > maxRSSI) {
                maxRSSI = rssi;
                strongestSSID = ssid;
            }
        }

        if (!strongestSSID) return;

        studentsArray.forEach(evidence => {
            if (evidence.wifiHistory.length < 2) return;
            
            const latestWifi = evidence.wifiHistory[evidence.wifiHistory.length - 1];
            const similarity = calculateSimilarity(latestWifi, session.masterWifi);
            if (similarity <= 90) return; // Cosine similarity must be > 90%

            // Calculate variance of the primary SSID across history
            const rssiValues = evidence.wifiHistory
                .map(w => w[strongestSSID])
                .filter(val => val !== undefined);
            
            if (rssiValues.length < 2) return;
            const avgRssi = rssiValues.reduce((a, b) => a + b, 0) / rssiValues.length;
            const variance = rssiValues.reduce((a, b) => a + Math.pow(b - avgRssi, 2), 0) / rssiValues.length;

            if (variance < 2.0) { // RSSI variance must be stable (< 2.0)
                candidates.push({
                    studentId: evidence.rollNo,
                    similarity: similarity,
                    variance: variance
                });
            }
        });

        // Rank by highest similarity and lowest signal variance
        candidates.sort((a, b) => b.similarity - a.similarity || a.variance - b.variance);

        // Capture top 3 dynamic triangulation nodes
        session.sessionCluster = candidates.slice(0, 3).map(c => c.studentId);
    } catch (err) {
        console.error("Triangulation dynamic mapping error:", err);
    }
};

const checkAndHotSwapNodes = (session) => {
    try {
        if (!session.sessionCluster || session.sessionCluster.length === 0) return;

        const updatedCluster = [];
        const studentsArray = Object.values(session.sessionEvidence);
        
        let strongestSSID = null;
        let maxRSSI = -999;
        for (const [ssid, rssi] of Object.entries(session.masterWifi)) {
            if (rssi > maxRSSI) {
                maxRSSI = rssi;
                strongestSSID = ssid;
            }
        }

        if (!strongestSSID) return;

        // Monitor if any anchor device missed 2 consecutive tracking windows (25 seconds with network buffer)
        for (const studentId of session.sessionCluster) {
            const evidence = studentsArray.find(e => e.rollNo === studentId);
            const missed = !evidence || (Date.now() - (evidence.lastSeen || session.startTime) > 25000);
            
            if (missed) {
                console.log(`📡 [Anchor Drop] Triangulation Node ${studentId} missed 2 windows. Hot-swapping node...`);
            } else {
                updatedCluster.push(studentId);
            }
        }

        // Fill dropped slots with next best candidates
        if (updatedCluster.length < 3) {
            const candidates = [];
            studentsArray.forEach(evidence => {
                if (updatedCluster.includes(evidence.rollNo)) return;
                if (evidence.wifiHistory.length < 2) return;
                
                const latestWifi = evidence.wifiHistory[evidence.wifiHistory.length - 1];
                const similarity = calculateSimilarity(latestWifi, session.masterWifi);
                if (similarity <= 90) return;

                const rssiValues = evidence.wifiHistory
                    .map(w => w[strongestSSID])
                    .filter(val => val !== undefined);
                
                if (rssiValues.length < 2) return;
                const avgRssi = rssiValues.reduce((a, b) => a + b, 0) / rssiValues.length;
                const variance = rssiValues.reduce((a, b) => a + Math.pow(b - avgRssi, 2), 0) / rssiValues.length;

                const missedCandidate = (Date.now() - (evidence.lastSeen || session.startTime) > 25000);

                if (variance < 2.0 && !missedCandidate) {
                    candidates.push({
                        studentId: evidence.rollNo,
                        similarity: similarity,
                        variance: variance
                    });
                }
            });

            candidates.sort((a, b) => b.similarity - a.similarity || a.variance - b.variance);

            for (const cand of candidates) {
                if (updatedCluster.length >= 3) break;
                updatedCluster.push(cand.studentId);
                console.log(`📡 [Anchor Promotion] Promoted ${cand.studentId} to active Triangulation Node.`);
            }
        }

        session.sessionCluster = updatedCluster;
    } catch (err) {
        console.error("Hot-swap anchor monitoring error:", err);
    }
};

const getTriangulatedProximityScore = (studentWifi, session) => {
    const cosSimTeacher = calculateSimilarity(studentWifi, session.masterWifi);
    
    if (!session.sessionCluster || session.sessionCluster.length === 0) {
        return cosSimTeacher; // Fallback to direct anchor proximity
    }

    let sumClusterSim = 0;
    let count = 0;
    
    for (const nodeId of session.sessionCluster) {
        const nodeEvidence = Object.values(session.sessionEvidence).find(e => e.rollNo === nodeId);
        if (nodeEvidence && nodeEvidence.wifiHistory.length > 0) {
            const nodeLatestWifi = nodeEvidence.wifiHistory[nodeEvidence.wifiHistory.length - 1];
            const nodeSimilarity = calculateSimilarity(studentWifi, nodeLatestWifi);
            sumClusterSim += nodeSimilarity;
            count++;
        }
    }

    const avgClusterSim = count > 0 ? (sumClusterSim / count) : cosSimTeacher;
    // Dual-Vector Matrix Math: 60% Teacher closeness + 40% Cluster closeness
    const combinedScore = (0.6 * cosSimTeacher) + (0.4 * avgClusterSim);
    return combinedScore;
};

// --- AUTH & ADMIN ROUTES ---

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ status: "error", message: "Missing credentials" });
    
    const user = await User.findOne({ username: username.toLowerCase().trim() });
    if (user && await bcrypt.compare(password, user.password)) {
        const token = jwt.sign({ id: user._id, role: user.role, username: user.username }, JWT_SECRET, { expiresIn: '4h' });
        res.json({ status: "success", role: user.role, savedID: user.rollNo || user.username, token });
    } else { res.status(401).json({ status: "error" }); }
});

// --- ADMIN MANAGEMENT ROUTES ---

app.post('/admin/add-user', verifyToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ message: "Forbidden" });
    try {
        const { username, rollNo, department, role, password } = req.body;
        if (!username || !password || !role) {
            return res.status(400).json({ message: "Username, password and role are required" });
        }
        
        const existing = await User.findOne({ username: username.toLowerCase().trim() });
        if (existing) {
            return res.status(400).json({ message: "Username already exists" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = await User.create({
            username: username.toLowerCase().trim(),
            rollNo: rollNo ? rollNo.trim() : undefined,
            department: department ? department.trim() : undefined,
            role,
            password: hashedPassword
        });
        res.json({ status: "success", user: { id: newUser._id, username: newUser.username, role: newUser.role } });
    } catch (err) {
        res.status(500).json({ message: "Error creating user", error: err.message });
    }
});

app.post('/admin/add-schedule', verifyToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ message: "Forbidden" });
    try {
        const { teacherID, className, day, startTime, endTime } = req.body;
        if (!teacherID || !className || !day || !startTime || !endTime) {
            return res.status(400).json({ message: "Missing schedule details" });
        }
        const newSched = await Schedule.create({
            teacherID: teacherID.toLowerCase().trim(),
            className: className.toUpperCase().trim(),
            day,
            startTime,
            endTime
        });
        res.json({ status: "success", schedule: newSched });
    } catch (err) {
        res.status(500).json({ message: "Error adding schedule", error: err.message });
    }
});

app.post('/admin/delete-user', verifyToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ message: "Forbidden" });
    try {
        const { id } = req.body;
        if (!id) return res.status(400).json({ message: "Missing user ID" });
        const deleted = await User.findByIdAndDelete(id);
        if (!deleted) {
            return res.status(404).json({ message: "User not found" });
        }
        res.json({ status: "success", message: "User deleted" });
    } catch (err) {
        res.status(500).json({ message: "Error deleting user", error: err.message });
    }
});

// --- FILTERED EXPORT ROUTE ---
app.get('/admin/export-attendance', verifyToken, async (req, res) => {
    const { className, teacherID } = req.query;
    let filter = {};
    if (className) filter.className = className;
    if (teacherID) filter.teacherID = teacherID.toLowerCase().trim();

    const history = await History.find(filter).sort({ timestamp: -1 });
    
    let csv = "Timestamp,Class,Teacher,RollNo,Similarity,Liveness,Status,Flags\n";
    history.forEach(s => s.attendance.forEach(r => {
        csv += `${s.timestamp.toISOString()},${s.className},${s.teacherID},${r.rollNo},${r.rfStability}%,${r.liveness || '❌'},${r.status},${r.flags.join('|')}\n`;
    }));

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=Mesh_Report_${className || 'Full'}.csv`);
    res.send(csv);
});

// --- TEACHER ENGINE ---

app.post('/set-master', verifyToken, async (req, res) => {
    const { wifi, threshold, maxRadius, physicsEnabled, expectedStudents, courseId, sectionId } = req.body;
    const teacherID = req.user.username.toLowerCase().trim(); 
    
    const istDate = new Date(new Date().getTime() + (5.5 * 60 * 60 * 1000));
    const today = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][istDate.getUTCDay()];
    
    // Dynamic Overlapping Schedule Matching with 15-minute preparation buffer
    const schedules = await Schedule.find({ teacherID, day: today });
    const currentTimeMinutes = istDate.getUTCHours() * 60 + istDate.getUTCMinutes();
    
    const toMinutes = (timeStr) => {
        const [h, m] = timeStr.split(':').map(Number);
        return h * 60 + m;
    };

    let sched = null;
    if (schedules.length > 0) {
        sched = schedules.find(s => {
            const start = toMinutes(s.startTime) - 15; // 15 mins prep buffer
            const end = toMinutes(s.endTime);
            return currentTimeMinutes >= start && currentTimeMinutes <= end;
        });
    }

    if (!sched && req.user.role !== 'admin') {
        return res.status(403).json({ message: "No active schedule matches this time." });
    }

    const filteredWifi = filterScanVector(wifi);
    
    // Mongoose SessionId Generation
    const sessionId = new mongoose.Types.ObjectId();

    // Dynamic Threshold Calibration: Logarithmic crowd attenuation model
    const baseThreshold = 0.85; 
    const alpha = 0.05; 
    const floor = 0.70;
    let dynamicThreshold = baseThreshold - (alpha * Math.log(expectedStudents || 1));
    dynamicThreshold = Math.max(dynamicThreshold, floor);

    ACTIVE_SESSIONS[teacherID] = { 
        sessionId: sessionId,
        masterWifi: filteredWifi, 
        sessionEvidence: {}, 
        quizActive: false, 
        quizNumbers: [],
        quizAnswer: null,
        sessionCluster: [], // Volatile array for triangulation anchors
        className: sched ? sched.className : "Manual-Session",
        courseId: courseId || (sched ? sched.className : "CS101"),
        sectionId: sectionId || "A",
        startTime: Date.now(), // Milliseconds for tracking window offsets
        expectedStudents: expectedStudents || 1,
        dynamicThreshold: dynamicThreshold,
        settings: {
            threshold: (dynamicThreshold * 100).toFixed(0), 
            maxRadius: maxRadius || 18,
            physicsEnabled: physicsEnabled ?? true
        }
    };
    
    res.json({ 
        status: "success", 
        className: ACTIVE_SESSIONS[teacherID].className,
        sessionId: sessionId.toString(),
        dynamicThreshold: dynamicThreshold.toFixed(4)
    });
});

app.post('/trigger-quiz', verifyToken, (req, res) => {
    const teacherID = req.user.username.toLowerCase().trim();
    const session = ACTIVE_SESSIONS[teacherID];
    if(!session) return res.status(400).send("Offline");
    
    // Server-Side Challenge Generation: 4 unique numbers between 10 and 99
    const numbers = [];
    while (numbers.length < 4) {
        const num = Math.floor(Math.random() * 90) + 10;
        if (!numbers.includes(num)) numbers.push(num);
    }
    const correctAnswer = Math.min(...numbers);

    session.quizActive = true;
    session.quizNumbers = numbers;
    session.quizAnswer = correctAnswer;
    session.quizWindowEnd = Date.now() + 10000; 
    
    setTimeout(() => { 
        if (ACTIVE_SESSIONS[teacherID]) {
            ACTIVE_SESSIONS[teacherID].quizActive = false; 
        }
    }, 10000); 

    res.json({ status: "triggered", quizNumbers: numbers });
});

// --- STUDENT ENGINE ---

app.post('/discover-room', verifyToken, (req, res) => {
    const { wifi } = req.body;
    if (!wifi || Object.keys(wifi).length === 0) {
        return res.status(400).json({ status: "error", message: "Empty signal footprint" });
    }

    const filteredStudentWifi = filterScanVector(wifi);
    let bestTeacherID = null;
    let highestSimilarity = 0;

    for (const tID in ACTIVE_SESSIONS) {
        const session = ACTIVE_SESSIONS[tID];
        const similarity = calculateSimilarity(filteredStudentWifi, session.masterWifi);
        if (similarity > highestSimilarity && similarity >= (session.settings.threshold || 10)) {
            highestSimilarity = similarity;
            bestTeacherID = tID;
        }
    }

    if (bestTeacherID) {
        res.json({ status: "success", teacherID: bestTeacherID });
    } else {
        res.status(404).json({ status: "error", message: "No active mesh found matching signals" });
    }
});

app.post('/submit-liveness', verifyToken, (req, res) => {
    const { teacherID, answer } = req.body;
    if (!teacherID) return res.status(400).json({ status: "error", message: "Missing teacher ID" });
    
    const session = ACTIVE_SESSIONS[teacherID.toLowerCase().trim()];
    if (!session) return res.status(400).json({ status: "error", message: "No active session" });
    
    if (!session.quizActive || Date.now() > session.quizWindowEnd) {
        return res.status(400).json({ status: "error", message: "Liveness window closed" });
    }
    
    // Server-Side Answer Evaluation
    if (parseInt(answer) === session.quizAnswer) {
        if (session.sessionEvidence[req.user.id]) {
            session.sessionEvidence[req.user.id].liveness = true;
            return res.json({ status: "verified", message: "Proof accepted" });
        } else {
            return res.status(400).json({ status: "error", message: "Submit evidence first" });
        }
    } else {
        return res.status(400).json({ status: "error", message: "Incorrect liveness answer" });
    }
});

app.post('/submit-evidence', verifyToken, (req, res) => {
    const { rollNo, wifi, teacherID, accelVariance } = req.body;
    const session = ACTIVE_SESSIONS[teacherID.toLowerCase().trim()];
    if (!session) return res.status(400).json({ status: "no_session" });
    
    const isInsideWindow = session.quizActive && (Date.now() < session.quizWindowEnd);
    const filteredWifi = filterScanVector(wifi);

    const sID = req.user.id; 
    if (!session.sessionEvidence[sID]) {
        session.sessionEvidence[sID] = { rollNo, wifiHistory: [], movementHistory: [], liveness: false };
    }
    session.sessionEvidence[sID].wifiHistory.push(filteredWifi);
    session.sessionEvidence[sID].movementHistory.push(accelVariance || 0);
    session.sessionEvidence[sID].lastSeen = Date.now(); // Track lastSeen for triangulation node drops

    // Dynamic Multi-Anchor triangulation nodes recalculation
    updateTriangulationNodes(session);
    checkAndHotSwapNodes(session);

    res.json({ 
        status: "ok", 
        quizActive: isInsideWindow,
        quizNumbers: isInsideWindow ? session.quizNumbers : []
    });
});

// --- ANALYTICS HUB & DYNAMIC CLASS FINALIZER ---

app.post('/finalize-session', verifyToken, async (req, res) => {
    try {
        const { sessionId, courseId, sectionId } = req.body;
        if (!sessionId || !courseId || !sectionId) {
            return res.status(400).json({ message: "Missing sessionId, courseId, or sectionId" });
        }

        // Find active session matching sessionId
        let session = null;
        for (const tID in ACTIVE_SESSIONS) {
            if (ACTIVE_SESSIONS[tID].sessionId.toString() === sessionId) {
                session = ACTIVE_SESSIONS[tID];
                break;
            }
        }

        if (!session) return res.status(404).json({ message: "Active session not found" });

        // Query Enrollment for Master Set
        const enrollment = await Enrollment.findOne({ courseId, sectionId });
        const enrolledStudents = enrollment ? enrollment.enrolledStudents : [];

        const studentsArray = Object.values(session.sessionEvidence);
        const standardTrackingCycles = Math.max(1, Math.floor((Date.now() - session.startTime) / 10000));

        // Perform Set Difference against telemetry data
        const reports = enrolledStudents.map(studentId => {
            const formattedStudentID = studentId.toLowerCase().trim();
            const evidence = studentsArray.find(e => 
                (e.rollNo && e.rollNo.toLowerCase().trim() === formattedStudentID) || 
                (e.studentId && e.studentId.toLowerCase().trim() === formattedStudentID)
            );
            
            let status = "Absent";
            let telemetryCount = 0;
            let score = 0;
            let dist = 0;
            let flags = [];
            let livenessIcon = "❌";

            if (evidence) {
                telemetryCount = evidence.wifiHistory.length;
                if (telemetryCount > 0) {
                    const latestWifi = evidence.wifiHistory[evidence.wifiHistory.length - 1];
                    
                    // Silent Multi-Anchor Triangulated Score Math
                    score = getTriangulatedProximityScore(latestWifi, session);
                    
                    const bubble = validateBubbleBoundary(latestWifi, session.masterWifi, session.settings);
                    dist = bubble.bubbleDistance;
                    livenessIcon = evidence.liveness ? "✅" : "❌";

                    const studentSSIDs = Object.keys(latestWifi);
                    const teacherSSIDs = Object.keys(session.masterWifi);
                    const overlap = studentSSIDs.filter(x => teacherSSIDs.includes(x));
                    if (teacherSSIDs.length > 0 && overlap.length / teacherSSIDs.length < 0.3) {
                        flags.push("Environment Mismatch");
                    }

                    // Categorize based on standard tracking cycles
                    if (telemetryCount < 0.40 * standardTrackingCycles) {
                        status = "Partial";
                    } else if (score >= session.settings.threshold && evidence.liveness) {
                        if (session.settings.physicsEnabled && !bubble.valid) {
                            status = "Absent";
                            flags.push(`Shield Restriction: ${bubble.status}`);
                        } else {
                            status = "Present";
                        }
                    } else {
                        status = "Partial";
                    }
                }
            }

            return {
                studentId,
                rollNo: studentId,
                rfStability: score.toFixed(0),
                liveness: livenessIcon,
                status,
                displacementUnits: dist,
                telemetryCount,
                flags
            };
        });

        res.json({ 
            status: "success", 
            reviewList: reports, 
            className: session.className,
            sessionId: session.sessionId.toString(),
            courseId,
            sectionId
        });
    } catch (err) {
        res.status(500).json({ message: "Error finalizing session", error: err.message });
    }
});

// --- POST-CLASS RECONCILIATION & AUDIT LOGS ---

app.post('/submit-final-report', verifyToken, async (req, res) => {
    try {
        const { sessionId, courseId, sectionId, records } = req.body;
        if (!sessionId || !courseId || !sectionId || !records) {
            return res.status(400).json({ message: "Missing required fields" });
        }

        // Find the active volatile session to gather reference telemetry
        let session = null;
        let teacherID = null;
        for (const tID in ACTIVE_SESSIONS) {
            if (ACTIVE_SESSIONS[tID].sessionId.toString() === sessionId) {
                session = ACTIVE_SESSIONS[tID];
                teacherID = tID;
                break;
            }
        }

        if (!session) {
            return res.status(400).json({ message: "Active session not found or already finalized" });
        }

        const enrollment = await Enrollment.findOne({ courseId, sectionId });
        const enrolledStudents = enrollment ? enrollment.enrolledStudents : [];

        const studentsArray = Object.values(session.sessionEvidence);
        const standardTrackingCycles = Math.max(1, Math.floor((Date.now() - session.startTime) / 10000));

        // Recompute standard status on-the-fly to check for overrides
        const serverStatusMap = {};
        enrolledStudents.forEach(studentId => {
            const formattedStudentID = studentId.toLowerCase().trim();
            const evidence = studentsArray.find(e => 
                (e.rollNo && e.rollNo.toLowerCase().trim() === formattedStudentID) || 
                (e.studentId && e.studentId.toLowerCase().trim() === formattedStudentID)
            );
            let status = "Absent";
            if (evidence) {
                const telemetryCount = evidence.wifiHistory.length;
                if (telemetryCount === 0) {
                    status = "Absent";
                } else if (telemetryCount < 0.40 * standardTrackingCycles) {
                    status = "Partial";
                } else {
                    status = "Present";
                }
            }
            serverStatusMap[studentId] = status;
        });

        // Map and identify teacher overrides
        const finalizedRecords = records.map(rec => {
            const sStatus = serverStatusMap[rec.studentId] || "Absent";
            const isOverridden = rec.status !== sStatus;
            return {
                studentId: rec.studentId,
                status: rec.status, 
                isOverridden: isOverridden,
                originalStatus: sStatus
            };
        });

        const report = await AttendanceReport.create({
            sessionId: new mongoose.Types.ObjectId(sessionId),
            courseId,
            sectionId,
            date: new Date(),
            finalizedBy: req.user.username,
            records: finalizedRecords
        });

        // Clean up the active session
        if (teacherID) {
            delete ACTIVE_SESSIONS[teacherID];
        }

        res.json({ status: "success", report });
    } catch (err) {
        res.status(500).json({ message: "Error submitting final report", error: err.message });
    }
});

app.get('/admin/audit-logs', verifyToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ message: "Forbidden" });
    try {
        const attendanceReports = await AttendanceReport.find({
            "records.isOverridden": true
        });

        const eventReports = await EventReport.find({
            verificationMethod: "Manual_Override"
        });

        const aggregatedLogs = [];

        // Parse AttendanceReport overrides
        attendanceReports.forEach(report => {
            report.records.forEach(rec => {
                if (rec.isOverridden) {
                    aggregatedLogs.push({
                        coordinatorId: report.finalizedBy,
                        targetId: report.courseId, 
                        studentId: rec.studentId,
                        originalStatus: rec.originalStatus,
                        currentStatus: rec.status,
                        timestamp: report.date,
                        type: "Classroom_Override"
                    });
                }
            });
        });

        // Parse EventReport overrides
        eventReports.forEach(report => {
            report.verifiedPresent.forEach(studentId => {
                aggregatedLogs.push({
                    coordinatorId: report.coordinatorId,
                    targetId: report.eventId, 
                    studentId: studentId,
                    originalStatus: "Flagged_Proxy", 
                    currentStatus: "Present",
                    timestamp: report.timestamp,
                    type: "Event_Override"
                });
            });
        });

        // Sort aggregated logs by timestamp descending
        aggregatedLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        res.json({ status: "success", logs: aggregatedLogs });
    } catch (err) {
        res.status(500).json({ message: "Error retrieving audit logs", error: err.message });
    }
});

// --- AD-HOC EVENT (MULTIDISCIPLINARY) ENDPOINTS ---

app.post('/create-event', verifyToken, (req, res) => {
    try {
        const { eventName, wifi } = req.body;
        const coordinatorID = req.user.username.toLowerCase().trim();
        
        let eventPin;
        do {
            eventPin = Math.floor(100000 + Math.random() * 900000).toString();
        } while (ACTIVE_EVENTS[eventPin]);

        ACTIVE_EVENTS[eventPin] = {
            eventPin,
            eventName: eventName || "Ad-Hoc Event/Seminar",
            coordinatorID,
            coordinatorWifi: filterScanVector(wifi),
            pinSubmissions: [],
            verifiedAttendees: [],
            createdAt: Date.now()
        };

        res.json({ status: "success", eventPin, eventName: ACTIVE_EVENTS[eventPin].eventName });
    } catch (err) {
        res.status(500).json({ message: "Error creating ad-hoc event", error: err.message });
    }
});

app.post('/join-event', verifyToken, async (req, res) => {
    try {
        const { eventPin, wifi } = req.body;
        if (!eventPin || !wifi) {
            return res.status(400).json({ message: "Missing eventPin or wifi scan data" });
        }

        const event = ACTIVE_EVENTS[eventPin];
        if (!event) {
            return res.status(404).json({ message: "Event not found or expired" });
        }

        const studentUser = await User.findById(req.user.id);
        const studentId = studentUser ? (studentUser.rollNo || studentUser.username) : req.user.username;

        // Register PIN entry click
        if (!event.pinSubmissions.includes(studentId)) {
            event.pinSubmissions.push(studentId);
        }

        const filteredStudentWifi = filterScanVector(wifi);
        
        // Proximity calculation: Cosine similarity against coordinator anchor
        const similarity = calculateSimilarity(filteredStudentWifi, event.coordinatorWifi);
        
        if (similarity >= 70) {
            if (!event.verifiedAttendees.includes(studentId)) {
                event.verifiedAttendees.push(studentId);
            }

            res.json({ 
                status: "success", 
                message: "Successfully joined event mesh", 
                eventName: event.eventName,
                similarity: similarity.toFixed(0)
            });
        } else {
            res.status(400).json({ 
                status: "error", 
                message: "Proximity validation failed. You are outside the event environment.",
                similarity: similarity.toFixed(0)
            });
        }
    } catch (err) {
        res.status(500).json({ message: "Error joining event mesh", error: err.message });
    }
});

app.get('/event-status', verifyToken, (req, res) => {
    try {
        const { eventPin } = req.query;
        if (!eventPin) return res.status(400).json({ message: "Missing eventPin" });
        const event = ACTIVE_EVENTS[eventPin];
        if (!event) return res.status(404).json({ message: "Event not found or expired" });
        res.json({ 
            status: "success", 
            attendeeCount: event.verifiedAttendees.length,
            attendees: event.verifiedAttendees,
            eventName: event.eventName
        });
    } catch (err) {
        res.status(500).json({ message: "Error retrieving event status", error: err.message });
    }
});

app.post('/close-event', verifyToken, async (req, res) => {
    try {
        const { eventPin } = req.body;
        if (!eventPin) {
            return res.status(400).json({ message: "Missing eventPin" });
        }

        const event = ACTIVE_EVENTS[eventPin];
        if (!event) {
            return res.status(404).json({ message: "Event not found or expired" });
        }

        // Proxy check math: submissions that did not pass spatial verification
        const flaggedProxies = event.pinSubmissions.filter(id => !event.verifiedAttendees.includes(id));

        // Fetch student details to group attendees by department
        const students = await User.find({
            $or: [
                { username: { $in: event.verifiedAttendees } },
                { rollNo: { $in: event.verifiedAttendees } }
            ]
        });

        const groupedByDepartment = {};
        event.verifiedAttendees.forEach(studentId => {
            const formatted = studentId.toLowerCase().trim();
            const userDoc = students.find(u => 
                (u.username && u.username.toLowerCase().trim() === formatted) || 
                (u.rollNo && u.rollNo.toLowerCase().trim() === formatted)
            );
            const dept = userDoc ? (userDoc.department || "General") : "General";
            if (!groupedByDepartment[dept]) {
                groupedByDepartment[dept] = [];
            }
            groupedByDepartment[dept].push(studentId);
        });

        // Save report to MongoDB
        const eventReport = await EventReport.create({
            eventId: event.eventPin,
            title: event.eventName,
            coordinatorId: event.coordinatorID,
            timestamp: new Date(),
            verifiedPresent: event.verifiedAttendees,
            flaggedProxies: flaggedProxies,
            verificationMethod: "Algorithmic_Mesh"
        });

        // Wiping active event
        delete ACTIVE_EVENTS[eventPin];

        res.json({
            status: "success",
            eventName: event.eventName,
            verifiedPresent: event.verifiedAttendees,
            flaggedProxies: flaggedProxies,
            groupedByDepartment: groupedByDepartment,
            report: eventReport
        });
    } catch (err) {
        res.status(500).json({ message: "Error closing event", error: err.message });
    }
});

app.post('/save-final-attendance', verifyToken, async (req, res) => {
    const { finalAttendance, className } = req.body;
    await History.create({ teacherID: req.user.username.toLowerCase(), className, attendance: finalAttendance });
    delete ACTIVE_SESSIONS[req.user.username.toLowerCase()];
    res.json({ status: "success" });
});

// --- DASHBOARD (REACTIVE) ---
app.get('/dashboard', verifyToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).send("Forbidden");
    const users = await User.find({});
    const logs = await History.find({}).sort({ timestamp: -1 });
    const token = req.query.token;

    const userRows = users.map(u => `<tr><td>${u.username}</td><td>${u.rollNo || '--'}</td><td>${u.department || '--'}</td><td><span class="badge ${u.role}">${u.role}</span></td><td><button class="btn btn-danger" onclick="deleteUser('${u._id}')">Delete</button></td></tr>`).join('');
    
    const logRows = logs.map(l => `<tr class="log-row" data-class="${l.className}"><td>${new Date(l.timestamp).toLocaleString()}</td><td><b>${l.className}</b></td><td>${l.teacherID}</td><td><button class="btn btn-primary" onclick="window.location.href='/admin/export-attendance?token=${token}&className=${l.className}&teacherID=${l.teacherID}'">Report</button></td></tr>`).join('');
    
    const liveMeshRows = Object.keys(ACTIVE_SESSIONS).map(tID => `<div class="mesh-box"><b>${ACTIVE_SESSIONS[tID].className}</b>: ${tID} (${Object.keys(ACTIVE_SESSIONS[tID].sessionEvidence).length} Links)</div>`).join('') || '<p>Idle</p>';

    const html = fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8');
    res.send(html.replace(/{{LIVE_MESH}}/g, liveMeshRows).replace(/{{USER_LIST}}/g, userRows).replace(/{{LOG_LIST}}/g, logRows).replace(/{{TOKEN}}/g, token));
});

app.listen(PORT, () => console.log(`🚀 Mesh Server Broadcasting on Port ${PORT}`));