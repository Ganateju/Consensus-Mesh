/**
 * index.js - The Consensus Mesh Core Server (Final Production Build)
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
    threshold: 10, 
    physicsEnabled: process.env.PHYSICS_ENABLED === 'true'
};
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
    attendance: [{ rollNo: String, rfStability: Number, status: String }]
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

// 4. RF SIMILARITY ENGINE (Cosine Pattern Matching)
const calculateSimilarity = (s, t) => {
    if (!s || !t || Object.keys(s).length === 0 || Object.keys(t).length === 0) return 0;
    let dotProduct = 0, sNorm = 0, tNorm = 0;
    const allSSIDs = new Set([...Object.keys(s), ...Object.keys(t)]);
    
    allSSIDs.forEach(ssid => {
        const sv = s[ssid] ? s[ssid] + 110 : 0;
        const tv = t[ssid] ? t[ssid] + 110 : 0;
        dotProduct += sv * tv; 
        sNorm += sv * sv; 
        tNorm += tv * tv;
    });
    
    const magnitude = Math.sqrt(sNorm) * Math.sqrt(tNorm);
    return magnitude === 0 ? 0 : (dotProduct / magnitude) * 100;
};

// --- AUTH & LOGIN ---
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username: username.toLowerCase().trim() });
    if (user && await bcrypt.compare(password, user.password)) {
        const token = jwt.sign({ id: user._id, role: user.role, username: user.username }, JWT_SECRET, { expiresIn: '4h' });
        res.json({ status: "success", role: user.role, savedID: user.rollNo || user.username, token });
    } else { res.status(401).json({ status: "error" }); }
});

// --- ADMIN ROUTES (Fixed for Database Persistence) ---

app.post('/admin/add-schedule', verifyToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).send("Unauthorized");
    try {
        const { teacherID, day, startTime, endTime, className } = req.body;
        // This line ensures schedules are actually saved to MongoDB
        await Schedule.create({ 
            teacherID: teacherID.toLowerCase().trim(), 
            day: day.trim(), 
            startTime, endTime, 
            className: className.toUpperCase().trim() 
        });
        res.json({ status: "success" });
    } catch (e) { res.status(400).json({ message: "Save Failed" }); }
});
app.post('/admin/delete-user', verifyToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).send("Admin only");
    try {
        await User.findByIdAndDelete(req.body.id);
        res.json({ status: "success" });
    } catch (e) { res.status(500).send("Delete Failed"); }
});
app.post('/admin/update-settings', verifyToken, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).send("Unauthorized");
    const { threshold, physicsEnabled, maxRadius } = req.body;
    if (threshold !== undefined) GLOBAL_SETTINGS.threshold = threshold;
    if (physicsEnabled !== undefined) GLOBAL_SETTINGS.physicsEnabled = physicsEnabled;
    if (maxRadius !== undefined) process.env.MAX_ROOM_RADIUS = maxRadius;
    res.json({ status: "success", settings: GLOBAL_SETTINGS });
});

// --- TEACHER ENGINE ---



app.post('/set-master', verifyToken, async (req, res) => {
    const { wifi } = req.body;
    const teacherID = req.user.username.toLowerCase().trim(); 
    
    const istDate = new Date(new Date().getTime() + (5.5 * 60 * 60 * 1000));
    const today = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][istDate.getUTCDay()];

    const sched = await Schedule.findOne({ teacherID, day: today });
    
    // Fallback: If no schedule found, we allow "Manual-Session" but only for the demo
    const activeClassName = sched ? sched.className : "Manual-Session";

    if (ACTIVE_SESSIONS[teacherID]) delete ACTIVE_SESSIONS[teacherID];

    ACTIVE_SESSIONS[teacherID] = { 
        masterWifi: wifi, 
        sessionEvidence: {}, 
        quizActive: false, 
        className: activeClassName,
        startTime: istDate 
    };
    res.json({ status: "success", className: activeClassName });
});

app.post('/finalize-session', verifyToken, async (req, res) => {
    const teacherID = req.user.username.toLowerCase().trim();
    const session = ACTIVE_SESSIONS[teacherID];
    if (!session) return res.status(400).send("No active session");

    const enrolledStudents = await User.find({ role: 'student', department: session.className });

    const fullReport = enrolledStudents.map(student => {
        const evidence = Object.values(session.sessionEvidence).find(e => e.rollNo === student.rollNo);
        let status = "ABSENT", score = 0, dist = 0;

        if (evidence) {
            const latestWifi = evidence.wifiHistory[evidence.wifiHistory.length - 1].wifi;
            score = calculateSimilarity(latestWifi, session.masterWifi);
            const bubbleCheck = validateBubbleBoundary(latestWifi, session.masterWifi);
            dist = bubbleCheck.bubbleDistance;

            if (score > GLOBAL_SETTINGS.threshold && evidence.liveness) {
                if (GLOBAL_SETTINGS.physicsEnabled && !bubbleCheck.valid) {
                    status = `ABSENT (Shield: ${bubbleCheck.status})`;
                } else { status = "PRESENT"; }
            } else if (score > (GLOBAL_SETTINGS.threshold / 2)) { status = "PARTIAL"; }
        }
        return { rollNo: student.rollNo, rfStability: score.toFixed(0), status: status, displacementUnits: dist };
    });

    res.json({ status: "success", reviewList: fullReport, className: session.className });
});

app.post('/save-final-attendance', verifyToken, async (req, res) => {
    const teacherID = req.user.username.toLowerCase().trim();
    const { finalAttendance, className } = req.body;
    // Persists the final report to the MongoDB History collection
    await History.create({ teacherID, className, attendance: finalAttendance });
    delete ACTIVE_SESSIONS[teacherID];
    res.json({ status: "success" });
});

// --- DASHBOARD ---
app.get('/dashboard', verifyToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).send("Forbidden");
    const users = await User.find({});
    const token = req.query.token;

    const liveMeshRows = Object.keys(ACTIVE_SESSIONS).map(tID => {
        const s = ACTIVE_SESSIONS[tID];
        return `<div class="mesh-box"><b>${s.className}</b>: ${tID} (${Object.keys(s.sessionEvidence).length} Links)</div>`;
    }).join('') || '<p>No live meshes.</p>';

    const userRows = users.map(u => `
        <tr><td>${u.username}</td><td>${u.rollNo || '--'}</td><td>${u.department || '--'}</td>
        <td><span class="badge ${u.role}">${u.role}</span></td>
        <td><button class="btn-del" onclick="deleteUser('${u._id}')">Delete</button></td></tr>`).join('');

    const html = fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8');
    res.send(html
        .replace(/{{LIVE_MESH}}/g, liveMeshRows).replace(/{{USER_LIST}}/g, userRows)
        .replace(/{{TOKEN}}/g, token).replace(/{{THRESHOLD}}/g, GLOBAL_SETTINGS.threshold)
        .replace(/{{RADIUS}}/g, process.env.MAX_ROOM_RADIUS || 12)
        .replace(/{{PHYSICS_CHECKED}}/g, GLOBAL_SETTINGS.physicsEnabled ? 'checked' : ''));
});

app.listen(PORT, () => console.log(`🚀 Mesh Server Broadcasting on Port ${PORT}`));