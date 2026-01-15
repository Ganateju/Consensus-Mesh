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

// 1. DATABASE CONNECTION
mongoose.connect(CLOUD_DB_URI).then(() => console.log("✅ Secure Hybrid Mesh Server Online"));

// 2. DATA MODELS
const User = mongoose.model('User', new mongoose.Schema({
    username: { type: String, unique: true },
    password: { type: String },
    role: { type: String, enum: ['student', 'teacher', 'admin'] },
    rollNo: String 
}));

const Schedule = mongoose.model('Schedule', new mongoose.Schema({
    teacherID: String,
    day: String,
    startTime: String,
    endTime: String
}));

const History = mongoose.model('History', new mongoose.Schema({
    roomID: String,
    teacherID: String,
    timestamp: { type: Date, default: Date.now },
    roomIntegrity: Number,
    attendance: [{ rollNo: String, rfStability: Number, status: String }]
}));

const CorrectionLog = mongoose.model('CorrectionLog', new mongoose.Schema({
    teacherID: String,
    studentID: String,
    oldStatus: String,
    newStatus: String,
    timestamp: { type: Date, default: Date.now }
}));

// 3. ENGINE STATE (RAM)
let ACTIVE_SESSIONS = {}; 

// 4. SECURITY MIDDLEWARE
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

// 5. MATH ENGINE
const calculateSimilarity = (s, t) => {
    if (!s || !t || Object.keys(s).length === 0 || Object.keys(t).length === 0) return 0;
    let dotProduct = 0, sNorm = 0, tNorm = 0;
    const commonSSIDs = Object.keys(s).filter(ssid => t[ssid]);
    if (commonSSIDs.length < 1) return 0;
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
    if (!username || !password) return res.status(400).json({ status: "error", message: "Missing fields" });
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
        const { username, password, role, rollNo } = req.body;
        const cleanName = username.toLowerCase().trim();
        
        const existing = await User.findOne({ username: cleanName });
        if(existing) return res.status(400).json({ message: "User already exists" });

        const hashedPassword = await bcrypt.hash(password, 10);
        await User.create({ username: cleanName, password: hashedPassword, role, rollNo });
        res.json({ status: "success" });
    } catch (e) { res.status(500).json({ message: "Server error creating user" }); }
});

app.post('/admin/add-schedule', verifyToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).send("Admin only");
    const { teacherID, day, startTime, endTime } = req.body;
    await Schedule.create({ 
        teacherID: teacherID.toLowerCase().trim(), 
        day: day.trim(), 
        startTime: startTime.trim(), 
        endTime: endTime.trim() 
    });
    res.json({ status: "success" });
});

app.post('/admin/clear-schedules', verifyToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).send("Admin only");
    const teacherID = req.body.teacherID.toLowerCase().trim();
    const result = await Schedule.deleteMany({ teacherID });
    res.json({ status: "success", count: result.deletedCount });
});

app.post('/admin/delete-user', verifyToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).send("Admin only");
    await User.findByIdAndDelete(req.body.id);
    res.json({ status: "success" });
});

app.post('/admin/update-settings', verifyToken, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).send("Admin only");
    GLOBAL_SETTINGS.threshold = parseInt(req.body.threshold);
    res.json({ status: "success" });
});

// --- TEACHER ENGINE ---

app.post('/set-master', verifyToken, async (req, res) => {
    const { wifi } = req.body;
    const teacherID = req.user.username.toLowerCase().trim(); 
    
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000; 
    const istDate = new Date(now.getTime() + istOffset);
    const h = istDate.getUTCHours();
    const m = istDate.getUTCMinutes();
    const currentTotalMinutes = (h * 60) + m;
    const today = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][istDate.getUTCDay()];

    const schedules = await Schedule.find({ teacherID: teacherID, day: today });
    let isAllowed = req.user.role === 'admin'; 

    for (let s of schedules) {
        const [sH, sM] = s.startTime.split(':').map(Number);
        const [eH, eM] = s.endTime.split(':').map(Number);
        const startTotal = (sH * 60) + sM;
        const endTotal = (eH * 60) + eM;

        if (currentTotalMinutes >= (startTotal - 10) && currentTotalMinutes <= (endTotal + 10)) {
            isAllowed = true;
            break;
        }
    }

    if (!isAllowed) {
        return res.status(403).json({ 
            message: `OUT OF SCHEDULE: Found ${schedules.length} slots for ${today}. Server Time: ${h}:${m}` 
        });
    }

    if (ACTIVE_SESSIONS[teacherID]) delete ACTIVE_SESSIONS[teacherID];

    ACTIVE_SESSIONS[teacherID] = { masterWifi: wifi, sessionEvidence: {}, quizActive: false, startTime: istDate };
    res.json({ status: "success" });
});

app.post('/trigger-quiz', verifyToken, (req, res) => {
    const teacherID = req.user.username.toLowerCase().trim();
    if(!ACTIVE_SESSIONS[teacherID]) return res.status(400).send("No Session");
    const a = Math.floor(Math.random() * 9) + 1;
    const b = Math.floor(Math.random() * 9) + 1;
    ACTIVE_SESSIONS[teacherID].quizActive = true;
    ACTIVE_SESSIONS[teacherID].quizAnswer = (a + b).toString();
    ACTIVE_SESSIONS[teacherID].quizQuestion = `What is ${a} + ${b}?`;
    setTimeout(() => { if(ACTIVE_SESSIONS[teacherID]) ACTIVE_SESSIONS[teacherID].quizActive = false; }, 15000); 
    res.json({ status: "triggered", question: ACTIVE_SESSIONS[teacherID].quizQuestion });
});

// --- STUDENT LOGIC ---

app.post('/discover-room', verifyToken, (req, res) => {
    const studentWifi = req.body.wifi;
    let bestMatch = null;
    let highestScore = 0;
    for (const [tID, session] of Object.entries(ACTIVE_SESSIONS)) {
        const score = calculateSimilarity(studentWifi, session.masterWifi);
        if (score >= GLOBAL_SETTINGS.threshold && score > highestScore) { highestScore = score; bestMatch = tID; }
    }
    if (bestMatch) res.json({ status: "found", teacherID: bestMatch });
    else res.status(404).json({ status: "not_found" });
});

app.post('/submit-evidence', verifyToken, (req, res) => {
    const { rollNo, wifi, teacherID } = req.body;
    const cleanTID = teacherID.toLowerCase().trim();
    const session = ACTIVE_SESSIONS[cleanTID];
    if (!session) return res.status(400).json({ status: "no_session" });
    const studentHash = req.user.id; 
    if (!session.sessionEvidence[studentHash]) session.sessionEvidence[studentHash] = { rollNo, wifiHistory: [], liveness: false };
    session.sessionEvidence[studentHash].wifiHistory.push({ wifi });
    res.json({ status: "ok", quizActive: session.quizActive, quizQuestion: session.quizQuestion });
});

app.post('/submit-liveness', verifyToken, (req, res) => {
    const { teacherID, answer } = req.body;
    const cleanTID = teacherID.toLowerCase().trim();
    const session = ACTIVE_SESSIONS[cleanTID];
    const studentHash = req.user.id;
    if (session?.quizActive && answer === session.quizAnswer) {
        if(session.sessionEvidence[studentHash]) session.sessionEvidence[studentHash].liveness = true;
        return res.json({ status: "verified" });
    }
    res.status(400).send("Invalid Answer");
});

// --- FINALIZATION ---

app.post('/finalize-session', verifyToken, async (req, res) => {
    const teacherID = req.user.username.toLowerCase().trim();
    const session = ACTIVE_SESSIONS[teacherID];
    if (!session) return res.status(400).send("No active session");
    const hashes = Object.keys(session.sessionEvidence);
    const fullAttendance = hashes.map(hash => {
        const data = session.sessionEvidence[hash];
        const latestWifi = data.wifiHistory[data.wifiHistory.length - 1].wifi;
        const score = calculateSimilarity(latestWifi, session.masterWifi);
        let status = "ABSENT";
        if (score > GLOBAL_SETTINGS.threshold && data.liveness) status = "PRESENT";
        else if (score > (GLOBAL_SETTINGS.threshold / 2)) status = "PARTIAL";
        return { rollNo: data.rollNo || "Unknown", rfStability: score.toFixed(0), status: status };
    });
    res.json({ status: "success", reviewList: fullAttendance.filter(s => s.status !== "PRESENT") });
});

app.post('/save-final-attendance', verifyToken, async (req, res) => {
    const teacherID = req.user.username.toLowerCase().trim();
    const { finalAttendance, corrections } = req.body;
    await History.create({ teacherID, roomID: "Class_Main", roomIntegrity: 100, attendance: finalAttendance });
    if (corrections && corrections.length > 0) {
        await CorrectionLog.insertMany(corrections.map(c => ({
            teacherID, studentID: c.rollNo, oldStatus: c.oldStatus, newStatus: c.newStatus
        })));
    }
    delete ACTIVE_SESSIONS[teacherID];
    res.json({ status: "success" });
});

// --- DASHBOARD ROUTE ---

app.get('/dashboard', verifyToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).send("Admins Only");
    
    const logLimit = parseInt(req.query.limit) || 10;
    const users = await User.find({});
    const logs = await CorrectionLog.find({}).sort({timestamp: -1}).limit(logLimit);
    const token = req.query.token;

    const liveMeshRows = Object.keys(ACTIVE_SESSIONS).map(tID => {
        const session = ACTIVE_SESSIONS[tID];
        const students = Object.values(session.sessionEvidence).map(s => s.rollNo).join(', ');
        const count = Object.keys(session.sessionEvidence).length;
        return `
            <div style="padding:15px; border-left:5px solid #34a853; background:#f0fff4; margin-bottom:15px; border-radius:8px;">
                <b style="color:#2e7d32;">Teacher: ${tID.toUpperCase()}</b><br>
                <span class="badge student">${count} Students Connected</span>
                <p style="margin-top:8px; font-size:0.8rem; color:#555;"><b>Live Roll Nos:</b> ${students || 'Waiting...'}</p>
            </div>
        `;
    }).join('') || '<p style="color:#999; padding:10px;">No active sessions.</p>';

    const userRows = users.map(u => `
        <tr>
            <td><b>${u.username}</b></td>
            <td>${u.rollNo || '--'}</td>
            <td><span class="badge ${u.role}">${u.role}</span></td>
            <td>
                <button class="btn-del" onclick="deleteUser('${u._id}')">Delete</button>
                ${u.role === 'teacher' ? `<button class="btn-clear" onclick="clearSchedules('${u.username}')">Clear</button>` : ''}
            </td>
        </tr>
    `).join('');

    const logRows = logs.map(l => `
        <tr>
            <td>${l.teacherID}</td>
            <td>${l.studentID}</td>
            <td>${l.oldStatus} ➡️ <b>${l.newStatus}</b></td>
            <td>${new Date(l.timestamp).toLocaleString()}</td>
        </tr>
    `).join('');

    const templatePath = path.join(__dirname, 'dashboard.html');
    let htmlTemplate = fs.readFileSync(templatePath, 'utf8');
    
    const finalHtml = htmlTemplate
        .replace('{{LIVE_MESH}}', liveMeshRows)
        .replace('{{USER_LIST}}', userRows)
        .replace('{{CORRECTION_LOGS}}', logRows)
        .replace('{{CURRENT_LIMIT}}', logLimit)
        .replace(/{{THRESHOLD}}/g, GLOBAL_SETTINGS.threshold)
        .replace(/{{TOKEN}}/g, token);
    
    res.send(finalHtml);
});

app.listen(PORT, () => console.log(`🚀 Server Online on port ${PORT}`));