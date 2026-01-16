require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken'); 
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const CLOUD_DB_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET || "SUPER_SECRET_KEY_123";

let GLOBAL_SETTINGS = { threshold: 10 };
let ACTIVE_SESSIONS = {}; 

// 1. DATABASE CONNECTION
mongoose.connect(CLOUD_DB_URI).then(() => console.log("✅ Secure Hybrid Mesh Server Online"));

// 2. DATA MODELS
const User = mongoose.model('User', new mongoose.Schema({
    username: { type: String, unique: true },
    password: { type: String },
    role: { type: String, enum: ['student', 'teacher', 'admin'] },
    rollNo: String,
    department: String // NEW: e.g., 'ECE-A', 'CSE-B'
}));

const Schedule = mongoose.model('Schedule', new mongoose.Schema({
    teacherID: String,
    day: String,
    startTime: String,
    endTime: String,
    className: String // NEW: Links to Student Department/Section
}));

const History = mongoose.model('History', new mongoose.Schema({
    className: String,
    teacherID: String,
    timestamp: { type: Date, default: Date.now },
    attendance: [{ rollNo: String, rfStability: Number, status: String }]
}));

const CorrectionLog = mongoose.model('CorrectionLog', new mongoose.Schema({
    teacherID: String,
    studentID: String,
    oldStatus: String,
    newStatus: String,
    timestamp: { type: Date, default: Date.now }
}));

// 3. SECURITY MIDDLEWARE
const verifyToken = (req, res, next) => {
    const token = req.headers['authorization'] || req.query.token; 
    if (!token) return res.status(403).json({ message: "Login required" });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ message: "Invalid session" });
    }
};

// 4. MATH ENGINE (Cosine Similarity)
const calculateSimilarity = (s, t) => {
    if (!s || !t || Object.keys(s).length === 0 || Object.keys(t).length === 0) return 0;
    let dotProduct = 0, sNorm = 0, tNorm = 0;
    const allSSIDs = new Set([...Object.keys(s), ...Object.keys(t)]);
    allSSIDs.forEach(ssid => {
        const sv = s[ssid] ? s[ssid] + 110 : 0;
        const tv = t[ssid] ? t[ssid] + 110 : 0;
        dotProduct += sv * tv; sNorm += sv * sv; tNorm += tv * tv;
    });
    return (dotProduct / (Math.sqrt(sNorm) * Math.sqrt(tNorm))) * 100;
};

// --- ROUTES ---

app.get('/', (req, res) => res.send("🚀 Secure Mesh Server Live"));

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const cleanUser = username.toLowerCase().trim();
    const user = await User.findOne({ username: cleanUser });
    if (user && await bcrypt.compare(password, user.password)) {
        const token = jwt.sign({ id: user._id, role: user.role, username: user.username }, JWT_SECRET, { expiresIn: '4h' });
        res.json({ status: "success", role: user.role, savedID: user.rollNo || user.username, token });
    } else { res.status(401).json({ status: "error" }); }
});

// --- ADMIN MANAGEMENT ---

app.post('/admin/add-user', verifyToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).send("Admin only");
    try {
        const { username, password, role, rollNo, department } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        await User.create({ 
            username: username.toLowerCase().trim(), 
            password: hashedPassword, 
            role, 
            rollNo, 
            department: department ? department.toUpperCase().trim() : 'GEN' 
        });
        res.json({ status: "success" });
    } catch (e) { res.status(400).json({ message: "Error: User exists" }); }
});

app.post('/admin/add-schedule', verifyToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).send("Admin only");
    const { teacherID, day, startTime, endTime, className } = req.body;
    await Schedule.create({ 
        teacherID: teacherID.toLowerCase().trim(), 
        day, startTime, endTime, 
        className: className.toUpperCase().trim() 
    });
    res.json({ status: "success" });
});

app.post('/admin/delete-user', verifyToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).send("Admin only");
    await User.findByIdAndDelete(req.body.id);
    res.json({ status: "success" });
});

app.get('/admin/export-attendance', verifyToken, async (req, res) => {
    const history = await History.find({}).sort({ timestamp: -1 });
    let csv = "Timestamp,Class,Teacher,RollNo,Similarity,Status\n";
    history.forEach(session => {
        session.attendance.forEach(record => {
            csv += `${session.timestamp.toISOString()},${session.className},${session.teacherID},${record.rollNo},${record.rfStability}%,${record.status}\n`;
        });
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=Mesh_Attendance.csv');
    res.send(csv);
});

// --- TEACHER ENGINE ---

app.post('/set-master', verifyToken, async (req, res) => {
    const { wifi } = req.body;
    const teacherID = req.user.username.toLowerCase().trim(); 
    
    const now = new Date();
    const istDate = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
    const h = istDate.getUTCHours();
    const m = istDate.getUTCMinutes();
    const currentMinutes = (h * 60) + m;
    const today = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][istDate.getUTCDay()];

    const sched = await Schedule.findOne({ 
        teacherID, 
        day: today 
    });

    if (!sched && req.user.role !== 'admin') {
        return res.status(403).json({ message: "No class scheduled for you right now." });
    }

    if (ACTIVE_SESSIONS[teacherID]) delete ACTIVE_SESSIONS[teacherID];

    ACTIVE_SESSIONS[teacherID] = { 
        masterWifi: wifi, 
        sessionEvidence: {}, 
        quizActive: false, 
        className: sched ? sched.className : "Manual-Session",
        startTime: istDate 
    };
    res.json({ status: "success", className: ACTIVE_SESSIONS[teacherID].className });
});

app.post('/trigger-quiz', verifyToken, (req, res) => {
    const teacherID = req.user.username.toLowerCase().trim();
    if(!ACTIVE_SESSIONS[teacherID]) return res.status(400).send("No Session");
    const a = Math.floor(Math.random() * 9) + 1;
    const b = Math.floor(Math.random() * 9) + 1;
    ACTIVE_SESSIONS[teacherID].quizActive = true;
    ACTIVE_SESSIONS[teacherID].quizAnswer = (a + b).toString();
    ACTIVE_SESSIONS[teacherID].quizQuestion = `QUICK: ${a} + ${b}?`;
    setTimeout(() => { if(ACTIVE_SESSIONS[teacherID]) ACTIVE_SESSIONS[teacherID].quizActive = false; }, 3000); 
    res.json({ status: "triggered", question: ACTIVE_SESSIONS[teacherID].quizQuestion });
});

// --- STUDENT & MESH LOGIC ---

app.post('/discover-room', verifyToken, (req, res) => {
    const studentWifi = req.body.wifi;
    let bestMatch = null;
    let highestScore = 0;
    for (const [tID, session] of Object.entries(ACTIVE_SESSIONS)) {
        const score = calculateSimilarity(studentWifi, session.masterWifi);
        if (score >= GLOBAL_SETTINGS.threshold && score > highestScore) { 
            highestScore = score; 
            bestMatch = tID; 
        }
    }
    if (bestMatch) res.json({ status: "found", teacherID: bestMatch });
    else res.status(404).json({ status: "not_found" });
});

app.post('/submit-evidence', verifyToken, (req, res) => {
    const { rollNo, wifi, teacherID } = req.body;
    const cleanTID = teacherID.toLowerCase().trim();
    const session = ACTIVE_SESSIONS[cleanTID];
    if (!session) return res.status(400).json({ status: "no_session" });
    const sID = req.user.id; 
    if (!session.sessionEvidence[sID]) session.sessionEvidence[sID] = { rollNo, wifiHistory: [], liveness: false };
    session.sessionEvidence[sID].wifiHistory.push({ wifi });
    res.json({ status: "ok", quizActive: session.quizActive, quizQuestion: session.quizQuestion });
});

app.post('/submit-liveness', verifyToken, (req, res) => {
    const { teacherID, answer } = req.body;
    const session = ACTIVE_SESSIONS[teacherID.toLowerCase().trim()];
    if (session?.quizActive && answer === session.quizAnswer) {
        if(session.sessionEvidence[req.user.id]) session.sessionEvidence[req.user.id].liveness = true;
        return res.json({ status: "verified" });
    }
    res.status(400).send("Timeout or Invalid");
});

app.post('/finalize-session', verifyToken, async (req, res) => {
    const teacherID = req.user.username.toLowerCase().trim();
    const session = ACTIVE_SESSIONS[teacherID];
    if (!session) return res.status(400).send("No active session");

    // ENROLLMENT CHECK: Find all students belonging to this class/department
    const enrolledStudents = await User.find({ role: 'student', department: session.className });

    const fullReport = enrolledStudents.map(student => {
        const evidence = Object.values(session.sessionEvidence).find(e => e.rollNo === student.rollNo);
        let status = "ABSENT", score = 0;

        if (evidence) {
            const latestWifi = evidence.wifiHistory[evidence.wifiHistory.length - 1].wifi;
            score = calculateSimilarity(latestWifi, session.masterWifi);
            if (score > GLOBAL_SETTINGS.threshold && evidence.liveness) status = "PRESENT";
            else if (score > (GLOBAL_SETTINGS.threshold / 2)) status = "PARTIAL";
        }

        return { rollNo: student.rollNo, rfStability: score.toFixed(0), status: status };
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

// --- DASHBOARD ---

app.get('/dashboard', verifyToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).send("Admins Only");
    const users = await User.find({});
    const token = req.query.token;

    const liveMeshRows = Object.keys(ACTIVE_SESSIONS).map(tID => {
        const s = ACTIVE_SESSIONS[tID];
        return `<div class="mesh-box"><b>${s.className}</b>: ${tID} (${Object.keys(s.sessionEvidence).length} Mesh Links)</div>`;
    }).join('') || '<p>No live classes.</p>';

    const userRows = users.map(u => `
        <tr>
            <td>${u.username}</td><td>${u.rollNo || '--'}</td><td>${u.department || '--'}</td>
            <td><span class="badge ${u.role}">${u.role}</span></td>
            <td><button class="btn-del" onclick="deleteUser('${u._id}')">Delete</button></td>
        </tr>`).join('');

    const templatePath = path.join(__dirname, 'dashboard.html');
    let html = fs.readFileSync(templatePath, 'utf8');
    res.send(html.replace('{{LIVE_MESH}}', liveMeshRows).replace('{{USER_LIST}}', userRows).replace(/{{TOKEN}}/g, token).replace(/{{THRESHOLD}}/g, GLOBAL_SETTINGS.threshold));
});

app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));