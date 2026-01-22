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
const { validateBubbleBoundary } = require('./physicsEngine');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const CLOUD_DB_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET || "MESH_SECURE_TOKEN_2024";

// --- GLOBAL ENGINE STATE ---
let ACTIVE_SESSIONS = {}; 

// 1. DATABASE CONNECTION
mongoose.connect(CLOUD_DB_URI).then(() => console.log("✅ Secure Hybrid Mesh Server Online"));

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
    // Expanded Schema to store Liveness proof for transparency
    attendance: [{ 
        rollNo: String, 
        rfStability: Number, 
        liveness: String, 
        status: String, 
        flags: [String] 
    }]
}));

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

// 4. CORE LOGIC: SIMILARITY & CONSENSUS
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

// --- AUTH & ADMIN ROUTES ---

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username: username.toLowerCase().trim() });
    if (user && await bcrypt.compare(password, user.password)) {
        const token = jwt.sign({ id: user._id, role: user.role, username: user.username }, JWT_SECRET, { expiresIn: '4h' });
        res.json({ status: "success", role: user.role, savedID: user.rollNo || user.username, token });
    } else { res.status(401).json({ status: "error" }); }
});

app.post('/admin/add-user', verifyToken, async (req, res) => {
    try {
        const { username, password, role, rollNo, department } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        await User.create({ username: username.toLowerCase().trim(), password: hashedPassword, role, rollNo, department: department?.toUpperCase() });
        res.json({ status: "success" });
    } catch (e) { res.status(400).send("User Conflict"); }
});

app.post('/admin/add-schedule', verifyToken, async (req, res) => {
    try {
        const { teacherID, day, startTime, endTime, className } = req.body;
        await Schedule.create({ teacherID: teacherID.toLowerCase().trim(), day, startTime, endTime, className: className.toUpperCase() });
        res.json({ status: "success" });
    } catch (e) { res.status(400).send("Schedule Conflict"); }
});

app.post('/admin/delete-user', verifyToken, async (req, res) => {
    try { await User.findByIdAndDelete(req.body.id); res.json({ status: "success" }); } 
    catch (e) { res.status(500).send("Delete Failed"); }
});

app.get('/admin/export-attendance', verifyToken, async (req, res) => {
    const history = await History.find({}).sort({ timestamp: -1 });
    // Added Liveness column to CSV export
    let csv = "Timestamp,Class,Teacher,RollNo,Similarity,Liveness,Status,Flags\n";
    history.forEach(s => s.attendance.forEach(r => {
        csv += `${s.timestamp.toISOString()},${s.className},${s.teacherID},${r.rollNo},${r.rfStability}%,${r.liveness || 'N/A'},${r.status},${r.flags.join('|')}\n`;
    }));
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=Mesh_Full_Report.csv');
    res.send(csv);
});

// --- TEACHER ENGINE ---

app.post('/set-master', verifyToken, async (req, res) => {
    const { wifi, threshold, maxRadius, physicsEnabled } = req.body;
    const teacherID = req.user.username.toLowerCase().trim(); 
    
    const istDate = new Date(new Date().getTime() + (5.5 * 60 * 60 * 1000));
    const today = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][istDate.getUTCDay()];
    const sched = await Schedule.findOne({ teacherID, day: today });

    if (!sched && req.user.role !== 'admin') return res.status(403).json({ message: "No schedule today." });

    ACTIVE_SESSIONS[teacherID] = { 
        masterWifi: wifi, 
        sessionEvidence: {}, 
        quizActive: false, 
        className: sched ? sched.className : "Manual-Session",
        startTime: istDate,
        settings: {
            threshold: threshold || 10,
            maxRadius: maxRadius || 12,
            physicsEnabled: physicsEnabled ?? true
        }
    };
    res.json({ status: "success", className: ACTIVE_SESSIONS[teacherID].className });
});

app.post('/trigger-quiz', verifyToken, (req, res) => {
    const teacherID = req.user.username.toLowerCase().trim();
    if(!ACTIVE_SESSIONS[teacherID]) return res.status(400).send("Offline");
    ACTIVE_SESSIONS[teacherID].quizActive = true;
    ACTIVE_SESSIONS[teacherID].quizWindowEnd = Date.now() + 6000; 
    setTimeout(() => { if(ACTIVE_SESSIONS[teacherID]) ACTIVE_SESSIONS[teacherID].quizActive = false; }, 6000); 
    res.json({ status: "triggered" });
});

// --- STUDENT ENGINE ---

app.post('/discover-room', verifyToken, (req, res) => {
    const studentWifi = req.body.wifi;
    let bestMatch = null, highestScore = 0;
    for (const [tID, session] of Object.entries(ACTIVE_SESSIONS)) {
        const score = calculateSimilarity(studentWifi, session.masterWifi);
        if (score >= session.settings.threshold && score > highestScore) { 
            highestScore = score; 
            bestMatch = tID; 
        }
    }
    if (bestMatch) res.json({ status: "found", teacherID: bestMatch });
    else res.status(404).json({ status: "not_found" });
});

app.post('/submit-evidence', verifyToken, (req, res) => {
    const { rollNo, wifi, teacherID, accelVariance } = req.body;
    const session = ACTIVE_SESSIONS[teacherID.toLowerCase().trim()];
    if (!session) return res.status(400).json({ status: "no_session" });
    
    const isInsideWindow = session.quizActive && (Date.now() < session.quizWindowEnd);

    const sID = req.user.id; 
    if (!session.sessionEvidence[sID]) {
        session.sessionEvidence[sID] = { rollNo, wifiHistory: [], movementHistory: [], liveness: false };
    }
    session.sessionEvidence[sID].wifiHistory.push(wifi);
    session.sessionEvidence[sID].movementHistory.push(accelVariance || 0);
    
    res.json({ status: "ok", quizActive: isInsideWindow });
});

app.post('/submit-liveness', verifyToken, (req, res) => {
    const { teacherID } = req.body;
    const session = ACTIVE_SESSIONS[teacherID.toLowerCase().trim()];
    if (session?.quizActive) {
        if (session.sessionEvidence[req.user.id]) session.sessionEvidence[req.user.id].liveness = true;
        return res.json({ status: "verified" });
    }
    res.status(400).send("Window Closed");
});

// --- ANALYTICS HUB (TRANSPARENCY UPGRADE) ---

app.post('/finalize-session', verifyToken, async (req, res) => {
    const teacherID = req.user.username.toLowerCase().trim();
    const session = ACTIVE_SESSIONS[teacherID];
    if (!session) return res.status(400).send("No active session");

    const enrolledStudents = await User.find({ role: 'student', department: session.className });
    const studentsArray = Object.values(session.sessionEvidence);

    const fullReport = enrolledStudents.map(student => {
        const evidence = studentsArray.find(e => e.rollNo === student.rollNo);
        let status = "ABSENT", score = 0, dist = 0, flags = [], livenessStatus = "❌";

        if (evidence) {
            const latestWifi = evidence.wifiHistory[evidence.wifiHistory.length - 1];
            score = calculateSimilarity(latestWifi, session.masterWifi);
            const bubble = validateBubbleBoundary(latestWifi, session.masterWifi, session.settings);
            dist = bubble.bubbleDistance;
            livenessStatus = evidence.liveness ? "✅" : "❌";

            // 1. Consensus check
            const studentSSIDs = Object.keys(latestWifi);
            const teacherSSIDs = Object.keys(session.masterWifi);
            const overlap = studentSSIDs.filter(x => teacherSSIDs.includes(x));
            if (overlap.length / teacherSSIDs.length < 0.3) flags.push("Environment Mismatch");

            // 2. Anti-cluster
            const sameFingerprint = studentsArray.filter(other => 
                other.rollNo !== student.rollNo && 
                calculateSimilarity(latestWifi, other.wifiHistory[other.wifiHistory.length - 1]) > 98
            );
            const avgMovement = evidence.movementHistory.reduce((a, b) => a + b, 0) / evidence.movementHistory.length;
            
            if (sameFingerprint.length > 0 && avgMovement < 0.01) {
                const peers = sameFingerprint.map(p => p.rollNo).join(', ');
                flags.push(`Proxy Cluster Detected (Peers: ${peers})`);
            }

            // 🛡️ UPDATED DECISION LOGIC
            if (score >= session.settings.threshold && evidence.liveness) {
                if (session.settings.physicsEnabled && !bubble.valid) {
                    status = `ABSENT (Shield: ${bubble.status})`;
                } else if (flags.some(f => f.includes("Proxy"))) {
                    status = "PARTIAL (Cluster Flag)";
                } else { status = "PRESENT"; }
            } else if (score > 2) {
                status = "PARTIAL";
            }
        }
        
        // Final object now includes liveness for the Review Dialog
        return { 
            rollNo: student.rollNo, 
            rfStability: score.toFixed(0), 
            liveness: livenessStatus,
            status, 
            displacementUnits: dist, 
            flags 
        };
    });

    res.json({ status: "success", reviewList: fullReport, className: session.className });
});

app.post('/save-final-attendance', verifyToken, async (req, res) => {
    const { finalAttendance, className } = req.body;
    await History.create({ teacherID: req.user.username.toLowerCase(), className, attendance: finalAttendance });
    delete ACTIVE_SESSIONS[req.user.username.toLowerCase()];
    res.json({ status: "success" });
});

// --- DASHBOARD ---
app.get('/dashboard', verifyToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).send("Forbidden");
    const users = await User.find({});
    const logs = await History.find({}).sort({ timestamp: -1 });
    const token = req.query.token;

    const userRows = users.map(u => `<tr><td>${u.username}</td><td>${u.rollNo || '--'}</td><td>${u.department || '--'}</td><td><span class="badge ${u.role}">${u.role}</span></td><td><button class="btn btn-danger" onclick="deleteUser('${u._id}')">Delete</button></td></tr>`).join('');
    const logRows = logs.map(l => `<tr class="log-row" data-class="${l.className}"><td>${new Date(l.timestamp).toLocaleString()}</td><td><b>${l.className}</b></td><td>${l.teacherID}</td><td><button class="btn btn-primary" onclick="window.location.href='/admin/export-attendance?token=${token}'">Report</button></td></tr>`).join('');
    const liveMeshRows = Object.keys(ACTIVE_SESSIONS).map(tID => `<div class="mesh-box"><b>${ACTIVE_SESSIONS[tID].className}</b>: ${tID} (${Object.keys(ACTIVE_SESSIONS[tID].sessionEvidence).length} Links)</div>`).join('') || '<p>Idle</p>';

    const html = fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8');
    res.send(html.replace(/{{LIVE_MESH}}/g, liveMeshRows).replace(/{{USER_LIST}}/g, userRows).replace(/{{LOG_LIST}}/g, logRows).replace(/{{TOKEN}}/g, token));
});

app.listen(PORT, () => console.log(`🚀 Mesh Server Broadcasting on Port ${PORT}`));