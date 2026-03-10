import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'dart:async';
import 'dart:math';
import 'package:wifi_scan/wifi_scan.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:sensors_plus/sensors_plus.dart';

void main() => runApp(const MaterialApp(
      home: AttendanceApp(),
      debugShowCheckedModeBanner: false,
    ));

class AttendanceApp extends StatefulWidget {
  const AttendanceApp({super.key});
  @override
  State<AttendanceApp> createState() => _AttendanceAppState();
}

class _AttendanceAppState extends State<AttendanceApp> {
  final TextEditingController _userController = TextEditingController();
  final TextEditingController _passController = TextEditingController();
  final TextEditingController _roomController = TextEditingController(); 
  final TextEditingController _schClassController = TextEditingController(); 
  final TextEditingController _quizAnswerController = TextEditingController();

  // State
  String? userRole, savedID, jwtToken;
  String status = "Ready";
  List<int> quizNumbers = [];
  Timer? _timer;
  bool _quizVisible = false;
  
  double _accelVariance = 0.0;
  StreamSubscription? _accelSub;
  double _currentThreshold = 10.0;
  double _currentRadius = 12.0;

  final String serverUrl = "https://server-2whc.onrender.com";

  @override
  void initState() {
    super.initState();
    _checkLogin();
    _initHumanAudit();
  }

  @override
  void dispose() {
    _accelSub?.cancel();
    _timer?.cancel();
    super.dispose();
  }

  // --- 🛠️ HELPER: CONFIRMATION MESSAGES ---
  void _showStatus(String msg, {bool isError = false}) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(msg),
        backgroundColor: isError ? Colors.red : Colors.green,
        behavior: SnackBarBehavior.floating,
        duration: const Duration(seconds: 2),
      ),
    );
  }

  void _initHumanAudit() {
    _accelSub = accelerometerEvents.listen((AccelerometerEvent event) {
      if (mounted) {
        setState(() {
          _accelVariance = (event.x.abs() + event.y.abs() + event.z.abs()) / 3;
        });
      }
    });
  }

  _checkLogin() async {
    SharedPreferences prefs = await SharedPreferences.getInstance();
    setState(() {
      userRole = prefs.getString('role');
      savedID = prefs.getString('saved_id');
      jwtToken = prefs.getString('jwt_token');
    });
  }

  Future<void> login() async {
    setState(() => status = "Authorizing...");
    try {
      final res = await http.post(Uri.parse('$serverUrl/login'),
          headers: {"Content-Type": "application/json"},
          body: jsonEncode({
            "username": _userController.text.toLowerCase().trim(), 
            "password": _passController.text
          }));
      
      if (res.statusCode == 200) {
        var d = jsonDecode(res.body);
        SharedPreferences prefs = await SharedPreferences.getInstance();
        await prefs.setString('role', d['role']);
        await prefs.setString('saved_id', d['savedID']);
        await prefs.setString('jwt_token', d['token']);
        _checkLogin();
        _showStatus("Logged in as ${d['role']}");
      } else { 
        setState(() => status = "Login Failed"); 
        _showStatus("Invalid Credentials", isError: true);
      }
    } catch (e) { 
      setState(() => status = "Server Offline"); 
      _showStatus("Connection Error", isError: true);
    }
  }

  Future<Map<String, int>> _getWifi() async {
    final canScan = await WiFiScan.instance.canStartScan();
    if (canScan != CanStartScan.yes) {
      setState(() => status = "Enable GPS & Location");
      return {};
    }
    await WiFiScan.instance.startScan();
    final results = await WiFiScan.instance.getScannedResults();
    return {for (var r in results) if (r.ssid.isNotEmpty) r.ssid: r.level};
  }

  void _startSyncedHeartbeat(String teacher) {
    _timer?.cancel();
    int msUntilNextPulse = 10000 - (DateTime.now().millisecondsSinceEpoch % 10000);
    
    Future.delayed(Duration(milliseconds: msUntilNextPulse), () {
      _timer = Timer.periodic(const Duration(seconds: 10), (t) async {
        if (userRole != 'student') { t.cancel(); return; }
        final wifi = await _getWifi();
        
        final res = await http.post(Uri.parse('$serverUrl/submit-evidence'),
            headers: {"Content-Type": "application/json", "Authorization": jwtToken!},
            body: jsonEncode({
              "rollNo": savedID,
              "wifi": wifi,
              "teacherID": teacher.toLowerCase().trim(),
              "accelVariance": _accelVariance 
            }));
            
        if (res.statusCode == 200) {
          final data = jsonDecode(res.body);
          setState(() => status = "Mesh Verified ✅");
          if (data['quizActive'] == true && !_quizVisible) {
            _triggerLivenessChallenge();
          }
        }
      });
    });
  }

  void _triggerLivenessChallenge() {
    setState(() {
      quizNumbers = List.generate(4, (_) => Random().nextInt(90) + 10);
      _quizVisible = true;
    });
    Future.delayed(const Duration(seconds: 5), () {
      if (mounted) setState(() => _quizVisible = false);
    });
  }

  // --- 🛡️ TEACHER: TRANSPARENT AUDIT ---
  void _showReviewDialog(List exceptions, List fullList, String className) {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: Text("Shield Audit: $className"),
          content: SizedBox(
            width: double.maxFinite,
            height: 400,
            child: ListView.builder(
              itemCount: exceptions.length,
              itemBuilder: (context, i) {
                var s = exceptions[i];
                bool isFlagged = s['flags'] != null && s['flags'].isNotEmpty;
                return Card(
                  color: isFlagged ? Colors.red.shade50 : Colors.white,
                  child: ListTile(
                    title: Text("Roll: ${s['rollNo']} | Score: ${s['rfStability']}%"),
                    subtitle: Text("Liveness: ${s['liveness']}\n${s['flags']?.join(', ') ?? 'No Flags'}"),
                    trailing: DropdownButton<String>(
                      value: ["PRESENT", "ABSENT", "PARTIAL"].contains(s['status']) ? s['status'] : "ABSENT",
                      items: ["PRESENT", "ABSENT", "PARTIAL"].map((val) => DropdownMenuItem(value: val, child: Text(val))).toList(),
                      onChanged: (newVal) {
                        setDialogState(() {
                          s['status'] = newVal;
                          int idx = fullList.indexWhere((item) => item['rollNo'] == s['rollNo']);
                          if (idx != -1) fullList[idx]['status'] = newVal;
                        });
                      },
                    ),
                  ),
                );
              },
            ),
          ),
          actions: [
            ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: Colors.green),
              onPressed: () async {
                final res = await http.post(Uri.parse('$serverUrl/save-final-attendance'),
                  headers: {"Content-Type": "application/json", "Authorization": jwtToken!},
                  body: jsonEncode({ "finalAttendance": fullList, "className": className }));
                
                if (res.statusCode == 200) {
                  Navigator.pop(context);
                  _showStatus("Attendance Saved Locally & Cloud");
                  
                  // TARGETED DOWNLOAD: Filter by specific class and teacher
                  final String downloadUrl = '$serverUrl/admin/export-attendance'
                      '?token=$jwtToken'
                      '&className=$className'
                      '&teacherID=$savedID';
                  
                  launchUrl(Uri.parse(downloadUrl), mode: LaunchMode.externalApplication);
                }
              }, 
              child: const Text("FINALIZE & DOWNLOAD CSV", style: TextStyle(color: Colors.white))
            )
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (userRole == null) return _buildLoginUI();
    return Stack(
      children: [
        Scaffold(
          appBar: AppBar(
            title: Text("${userRole!.toUpperCase()} TERMINAL"),
            backgroundColor: userRole == 'student' ? Colors.indigo : Colors.deepOrange,
            actions: [ IconButton(icon: const Icon(Icons.logout), onPressed: () async {
              (await SharedPreferences.getInstance()).clear();
              setState(() { userRole = null; _timer?.cancel(); });
              _showStatus("Logged Out");
            })],
          ),
          body: _buildRoleDashboard(),
        ),
        if (_quizVisible) _buildLivenessOverlay(),
      ],
    );
  }

  Widget _buildRoleDashboard() {
    if (userRole == 'teacher') {
      return SingleChildScrollView(padding: const EdgeInsets.all(25), child: Column(children: [
        Text("Bubble Radius: ${_currentRadius.toInt()} Units", style: const TextStyle(fontWeight: FontWeight.bold)),
        Slider(value: _currentRadius, min: 5, max: 40, onChanged: (v) => setState(() => _currentRadius = v)),
        Text("Sensitivity: ${_currentThreshold.toInt()}%", style: const TextStyle(fontWeight: FontWeight.bold)),
        Slider(value: _currentThreshold, min: 1, max: 50, onChanged: (v) => setState(() => _currentThreshold = v)),
        const SizedBox(height: 20),
        _actionButton(Icons.anchor, "ANCHOR ROOM MESH", Colors.blue, () async {
          setState(() => status = "Capturing Signal Origin...");
          final w = await _getWifi();
          final res = await http.post(Uri.parse('$serverUrl/set-master'), 
              headers: {"Content-Type": "application/json", "Authorization": jwtToken!}, 
              body: jsonEncode({
                "wifi": w,
                "threshold": _currentThreshold,
                "maxRadius": _currentRadius,
                "physicsEnabled": true
              }));
          if (res.statusCode == 200) {
            setState(() => status = "Mesh Active ✅");
            _showStatus("Mesh Anchor Established");
          }
        }),
        const SizedBox(height: 15),
        _actionButton(Icons.bolt, "PUSH LIVENESS CHALLENGE", Colors.red, () async {
          final res = await http.post(Uri.parse('$serverUrl/trigger-quiz'), headers: {"Authorization": jwtToken!});
          if (res.statusCode == 200) _showStatus("Liveness Challenge Pushed to Students");
        }),
        const SizedBox(height: 15),
        _actionButton(Icons.analytics, "AUDIT & FINALIZE", Colors.green, () async {
          final res = await http.post(Uri.parse('$serverUrl/finalize-session'), headers: {"Authorization": jwtToken!});
          if (res.statusCode == 200) {
            var data = jsonDecode(res.body);
            _showReviewDialog(data['reviewList'].where((s) => s['status'] != "PRESENT").toList(), data['reviewList'], data['className']);
          }
        }),
        const SizedBox(height: 20),
        Text(status, style: const TextStyle(fontWeight: FontWeight.bold)),
      ]));
    } else {
      // Student Dashboard
      return Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
        const Icon(Icons.wifi_tethering, size: 100, color: Colors.indigo),
        const SizedBox(height: 20),
        ElevatedButton(
          style: ElevatedButton.styleFrom(minimumSize: const Size(200, 60)),
          onPressed: () async {
          setState(() => status = "Searching...");
          final wifi = await _getWifi();
          final res = await http.post(Uri.parse('$serverUrl/discover-room'),
            headers: {"Content-Type": "application/json", "Authorization": jwtToken!},
            body: jsonEncode({"wifi": wifi}));
          if (res.statusCode == 200) {
            final data = jsonDecode(res.body);
            _roomController.text = data['teacherID'];
            _startSyncedHeartbeat(data['teacherID']);
            _showStatus("Connected to ${data['teacherID']}'s Mesh");
          } else {
            _showStatus("No active mesh found", isError: true);
          }
        }, child: const Text("JOIN CLASS MESH")),
        const SizedBox(height: 20),
        Text(status, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18, color: Colors.indigo)),
      ]));
    }
  }

  Widget _buildLivenessOverlay() => Positioned.fill(
      child: Container(
        color: Colors.black.withOpacity(0.95), 
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center, 
          children: [
            const Text("LIVENESS AUDIT", style: TextStyle(color: Colors.white, fontSize: 16, letterSpacing: 2, decoration: TextDecoration.none)),
            const SizedBox(height: 10),
            const Text("Tap the SMALLEST number", style: TextStyle(color: Colors.white70, fontSize: 14, decoration: TextDecoration.none)),
            const SizedBox(height: 40),
            Wrap(
              spacing: 20, runSpacing: 20,
              children: quizNumbers.map((n) => GestureDetector(
                onTap: () async {
                  final res = await http.post(Uri.parse('$serverUrl/submit-liveness'), 
                    headers: {"Content-Type": "application/json", "Authorization": jwtToken!}, 
                    body: jsonEncode({"teacherID": _roomController.text.toLowerCase().trim()}));
                  
                  if (res.statusCode == 200) {
                    _showStatus("Liveness Verified ✅");
                  } else {
                    _showStatus("Submission Error", isError: true);
                  }
                  setState(() => _quizVisible = false);
                },
                child: Container(
                  width: 100, height: 100,
                  decoration: BoxDecoration(color: Colors.white10, borderRadius: BorderRadius.circular(15), border: Border.all(color: Colors.white24)),
                  child: Center(child: Text("$n", style: const TextStyle(color: Colors.white, fontSize: 28, fontWeight: FontWeight.bold, decoration: TextDecoration.none))),
                ),
              )).toList(),
            ),
          ]
        )
      )
    );

  Widget _actionButton(IconData i, String l, Color c, VoidCallback a) => ElevatedButton.icon(icon: Icon(i), label: Text(l), onPressed: a, style: ElevatedButton.styleFrom(minimumSize: const Size(double.infinity, 70), backgroundColor: c, foregroundColor: Colors.white, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(15))));
  Widget _buildLoginUI() => Scaffold(body: Padding(padding: const EdgeInsets.all(40), child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
    const Icon(Icons.fingerprint, size: 80, color: Colors.indigo),
    const SizedBox(height: 20),
    const Text("CONSENSUS MESH", style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
    const SizedBox(height: 40),
    TextField(controller: _userController, decoration: const InputDecoration(labelText: "Username", border: OutlineInputBorder())),
    const SizedBox(height: 15),
    TextField(controller: _passController, obscureText: true, decoration: const InputDecoration(labelText: "Password", border: OutlineInputBorder())),
    const SizedBox(height: 30),
    ElevatedButton(onPressed: login, style: ElevatedButton.styleFrom(minimumSize: const Size(double.infinity, 60), backgroundColor: Colors.indigo, foregroundColor: Colors.white), child: const Text("LOGIN")),
  ])));
}