/**
 * index.js - The Consensus Mesh Core Server (Production Edition)
 * * This server acts as the central brain for the RF Environmental Mesh.
 * It manages:
 * 1. Multi-dimensional Signal Fingerprints (Cosine Similarity)
 * 2. Spherical Displacement Bubbles (Euclidean Physics)
 * 3. Wall-Guard Attenuation Detection (Anti-Proxy)
 * 4. Master Scheduling & Live Mesh Monitoring
 */

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken'); 
const fs = require('fs');
const path = require('path');
const { validateBubbleBoundary } = require('./physicsEngine');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const CLOUD_DB_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET || "MESH_SECURE_TOKEN_2024";

// --- GLOBAL ENGINE STATE ---
let GLOBAL_SETTINGS = { 
    threshold: 10, // Default pattern matching sensitivity
    physicsEnabled: process.env.PHYSICS_ENABLED === 'true'
};
let ACTIVE_SESSIONS = {}; // Real-time classroom environments held in volatile memory

// 1. DATABASE CONNECTION
mongoose.connect(CLOUD_DB_URI).then(() => console.log("✅ Secure Hybrid Mesh Server Online"));

// 2. DATA SCHEMAS
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
    attendance: [{ rollNo: String, rfStability: Number, status: String }]
}));

// 3. SECURITY: JWT GATEKEEPER
const verifyToken = (req, res, next) => {
    const token = req.headers['authorization'] || req.query.token; 
    if (!token) return res.status(403).json({ message: "Access Denied: Mesh Token Required" });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ message: "Invalid or Expired Session" });
    }
};

// 4. RF PATTERN MATCHING (Cosine Similarity)
// Calculates the "Shape" of the WiFi environment. If devices see the same 
// Access Points in the same ratios, they are physically together.
const calculateSimilarity = (s, t) => {
    if (!s || !t || Object.keys(s).length === 0 || Object.keys(t).length === 0) return 0;
    let dotProduct = 0, sNorm = 0, tNorm = 0;
    const allSSIDs = new Set([...Object.keys(s), ...Object.keys(t)]);
    
    allSSIDs.forEach(ssid => {
        // Shift -110dBm scale to positive 0-110 for vector math
        const sv = s[ssid] ? s[ssid] + 110 : 0;
        const tv = t[ssid] ? t[ssid] + 110 : 0;
        dotProduct += sv * tv; 
        sNorm += sv * sv; 
        tNorm += tv * tv;
    });
    
    const magnitude = Math.sqrt(sNorm) * Math.sqrt(tNorm);
    return magnitude === 0 ? 0 : (dotProduct / magnitude) * 100;
};

// --- CORE ROUTES ---

app.get('/', (req, res) => res.send("🚀 Consensus Mesh Server is Broadcasting..."));

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username: username.toLowerCase().trim() });
    if (user && await bcrypt.compare(password, user.password)) {
        const token = jwt.sign({ id: user._id, role: user.role, username: user.username }, JWT_SECRET, { expiresIn: '4h' });
        res.json({ status: "success", role: user.role, savedID: user.rollNo || user.username, token });
    } else { res.status(401).json({ status: "error" }); }
});

// --- ADMIN CONTROL CENTER ---

app.post('/admin/update-settings', verifyToken, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).send("Unauthorized");
    const { threshold, physicsEnabled, maxRadius } = req.body;
    
    if (threshold !== undefined) GLOBAL_SETTINGS.threshold = threshold;
    if (physicsEnabled !== undefined) GLOBAL_SETTINGS.physicsEnabled = physicsEnabled;
    if (maxRadius !== undefined) process.env.MAX_ROOM_RADIUS = maxRadius; // Real-time sync
    
    res.json({ status: "success", settings: GLOBAL_SETTINGS });
});

app.post('/admin/add-user', verifyToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).send("Admin Access Only");
    try {
        const { username, password, role, rollNo, department } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        await User.create({ 
            username: username.toLowerCase().trim(), 
            password: hashedPassword, 
            role, rollNo, 
            department: department ? department.toUpperCase().trim() : 'GEN' 
        });
        res.json({ status: "success" });
    } catch (e) { res.status(400).json({ message: "User Conflict" }); }
});

// --- TEACHER ENGINE: ANCHORING & CHALLENGES ---

app.post('/set-master', verifyToken, async (req, res) => {
    const { wifi } = req.body;
    const teacherID = req.user.username.toLowerCase().trim(); 
    
    // Check local time for IST sync
    const istDate = new Date(new Date().getTime() + (5.5 * 60 * 60 * 1000));
    const today = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][istDate.getUTCDay()];

    const sched = await Schedule.findOne({ teacherID, day: today });
    if (!sched && req.user.role !== 'admin') {
        return res.status(403).json({ message: "Class not scheduled for today." });
    }

    // Capture the signal origin for the Spherical Bubble
    ACTIVE_SESSIONS[teacherID] = { 
        masterWifi: wifi, 
        sessionEvidence: {}, 
        quizActive: false, 
        className: sched ? sched.className : "adhoc-class",
        startTime: istDate 
    };
    res.json({ status: "success", className: ACTIVE_SESSIONS[teacherID].className });
});

app.post('/trigger-quiz', verifyToken, (req, res) => {
    const teacherID = req.user.username.toLowerCase().trim();
    if(!ACTIVE_SESSIONS[teacherID]) return res.status(400).send("Session Offline");
    
    const a = Math.floor(Math.random() * 9) + 1;
    const b = Math.floor(Math.random() * 9) + 1;
    ACTIVE_SESSIONS[teacherID].quizActive = true;
    ACTIVE_SESSIONS[teacherID].quizAnswer = (a + b).toString();
    ACTIVE_SESSIONS[teacherID].quizQuestion = `QUICK: ${a} + ${b}?`;
    
    // Quiz window is open for 3 seconds
    setTimeout(() => { if(ACTIVE_SESSIONS[teacherID]) ACTIVE_SESSIONS[teacherID].quizActive = false; }, 3000); 
    res.json({ status: "triggered", question: ACTIVE_SESSIONS[teacherID].quizQuestion });
});

// --- STUDENT & MESH AUDITING ---

app.post('/discover-room', verifyToken, (req, res) => {
    const studentWifi = req.body.wifi;
    let bestMatch = null, highestScore = 0;
    
    for (const [tID, session] of Object.entries(ACTIVE_SESSIONS)) {
        const score = calculateSimilarity(studentWifi, session.masterWifi);
        if (score >= GLOBAL_SETTINGS.threshold && score > highestScore) { 
            highestScore = score; 
            bestMatch = tID; 
        }
    }
    if (bestMatch) res.json({ status: "found", teacherID: bestMatch });
    else res.status(404).json({ status: "out_of_mesh" });
});

app.post('/submit-evidence', verifyToken, (req, res) => {
    const { rollNo, wifi, teacherID } = req.body;
    const session = ACTIVE_SESSIONS[teacherID.toLowerCase().trim()];
    if (!session) return res.status(400).json({ status: "no_active_session" });
    
    const sID = req.user.id; 
    if (!session.sessionEvidence[sID]) session.sessionEvidence[sID] = { rollNo, wifiHistory: [], liveness: false };
    session.sessionEvidence[sID].wifiHistory.push({ wifi });
    
    res.json({ status: "ok", quizActive: session.quizActive, quizQuestion: session.quizQuestion });
});

// --- THE ANALYTICS HUB: FINAL VALIDATION ---

app.post('/finalize-session', verifyToken, async (req, res) => {
    const teacherID = req.user.username.toLowerCase().trim();
    const session = ACTIVE_SESSIONS[teacherID];
    if (!session) return res.status(400).send("Session not found");

    const enrolledStudents = await User.find({ role: 'student', department: session.className });

    const fullReport = enrolledStudents.map(student => {
        const evidence = Object.values(session.sessionEvidence).find(e => e.rollNo === student.rollNo);
        let status = "ABSENT", score = 0, dist = 0;

        if (evidence) {
            const latestWifi = evidence.wifiHistory[evidence.wifiHistory.length - 1].wifi;
            score = calculateSimilarity(latestWifi, session.masterWifi);

            // 🔮 PHYSICS VALIDATION: Spherical Bubble & Wall Check
            const bubbleCheck = validateBubbleBoundary(latestWifi, session.masterWifi);
            dist = bubbleCheck.bubbleDistance;

            if (score > GLOBAL_SETTINGS.threshold && evidence.liveness) {
                // If physics check fails (Out of Bubble or Behind Wall)
                if (GLOBAL_SETTINGS.physicsEnabled && !bubbleCheck.valid) {
                    status = `ABSENT (Shield: ${bubbleCheck.status})`;
                } else {
                    status = "PRESENT";
                }
            } else if (score > (GLOBAL_SETTINGS.threshold / 2)) {
                status = "PARTIAL";
            }
        }

        return { 
            rollNo: student.rollNo, 
            rfStability: score.toFixed(0), 
            status: status,
            displacementUnits: dist 
        };
    });

    res.json({ status: "success", reviewList: fullReport, className: session.className });
});

app.post('/save-final-attendance', verifyToken, async (req, res) => {
    const teacherID = req.user.username.toLowerCase().trim();
    const { finalAttendance, className } = req.body;
    await History.create({ teacherID, className, attendance: finalAttendance });
    delete ACTIVE_SESSIONS[teacherID];
    res.json({ status: "success" });
});

// --- DYNAMIC WEB CONSOLE ---

app.get('/dashboard', verifyToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).send("Forbidden");
    const users = await User.find({});
    const token = req.query.token;

    const liveMeshRows = Object.keys(ACTIVE_SESSIONS).map(tID => {
        const s = ACTIVE_SESSIONS[tID];
        return `<div class="mesh-box"><b>${s.className}</b>: ${tID} (${Object.keys(s.sessionEvidence).length} Mesh Links)</div>`;
    }).join('') || '<p>No Active Classroom Meshes.</p>';

    const userRows = users.map(u => `
        <tr>
            <td>${u.username}</td><td>${u.rollNo || '--'}</td><td>${u.department || '--'}</td>
            <td><span class="badge ${u.role}">${u.role}</span></td>
            <td><button class="btn-del" onclick="deleteUser('${u._id}')">Delete</button></td>
        </tr>`).join('');

    const html = fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8');
    
    // Inject server state into HTML template
    const finalHtml = html
        .replace(/{{LIVE_MESH}}/g, liveMeshRows)
        .replace(/{{USER_LIST}}/g, userRows)
        .replace(/{{TOKEN}}/g, token)
        .replace(/{{THRESHOLD}}/g, GLOBAL_SETTINGS.threshold)
        .replace(/{{RADIUS}}/g, process.env.MAX_ROOM_RADIUS || 12)
        .replace(/{{PHYSICS_CHECKED}}/g, GLOBAL_SETTINGS.physicsEnabled ? 'checked' : '');

    res.send(finalHtml);
});

app.listen(PORT, () => console.log(`🚀 Mesh Server Broadcasting on Port ${PORT}`));