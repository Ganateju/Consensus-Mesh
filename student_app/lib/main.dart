import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'dart:async';
import 'package:wifi_scan/wifi_scan.dart';
import 'package:crypto/crypto.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sensors_plus/sensors_plus.dart';
import 'package:url_launcher/url_launcher.dart';

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
  final TextEditingController _startTimeController = TextEditingController();
  final TextEditingController _endTimeController = TextEditingController();
  final TextEditingController _quizAnswerController = TextEditingController();

  String? userRole, savedID, jwtToken;
  String status = "Ready";
  String currentQuestion = "Waiting for challenge...";
  Timer? _timer;
  bool _quizVisible = false;
  List<double> _motion = [0, 0, 0];
  
  final String serverUrl = "https://server-2whc.onrender.com";

  @override
  void initState() {
    super.initState();
    _checkLogin();
    userAccelerometerEvents.listen((UserAccelerometerEvent event) {
      if (mounted) setState(() => _motion = [event.x, event.y, event.z]);
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
      // Normalization: Clean input before sending to server
      String cleanUser = _userController.text.toLowerCase().trim();
      
      final res = await http.post(Uri.parse('$serverUrl/login'),
          headers: {"Content-Type": "application/json"},
          body: jsonEncode({"username": cleanUser, "password": _passController.text}));
      
      if (res.statusCode == 200) {
        var d = jsonDecode(res.body);
        SharedPreferences prefs = await SharedPreferences.getInstance();
        await prefs.setString('role', d['role']);
        await prefs.setString('saved_id', d['savedID']);
        await prefs.setString('jwt_token', d['token']);
        _checkLogin();
      } else {
        setState(() => status = "Login Failed");
      }
    } catch (e) {
      setState(() => status = "Server Error");
    }
  }

  Future<Map<String, int>> _getWifi() async {
    await WiFiScan.instance.startScan();
    final results = await WiFiScan.instance.getScannedResults();
    return {for (var r in results) if (r.ssid.isNotEmpty) r.ssid: r.level};
  }

  Future<void> autoDiscoverAndJoin() async {
    setState(() => status = "Scanning Room...");
    final wifi = await _getWifi();
    if (wifi.isEmpty) {
      setState(() => status = "ERROR: No WiFi detected. Check Permissions.");
      return;
    }
    try {
      final res = await http.post(Uri.parse('$serverUrl/discover-room'),
        headers: {"Content-Type": "application/json", "Authorization": jwtToken!},
        body: jsonEncode({"wifi": wifi}));
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        _roomController.text = data['teacherID'];
        startHybridContinuity(data['teacherID']);
      } else {
        setState(() => status = "No active class found.");
      }
    } catch (e) { setState(() => status = "Network Error"); }
  }

  void startHybridContinuity(String targetTeacher) {
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 10), (t) async {
      if (userRole != 'student' || jwtToken == null) { t.cancel(); return; }
      final wifi = await _getWifi();
      final res = await http.post(Uri.parse('$serverUrl/submit-evidence'),
          headers: {"Content-Type": "application/json", "Authorization": jwtToken!},
          body: jsonEncode({
            "rollNo": savedID,
            "wifi": wifi,
            "teacherID": targetTeacher.toLowerCase().trim() // Normalize for Mesh tracking
          }));
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        setState(() => status = "Verified in Mesh ✅");
        if (data['quizActive'] == true && !_quizVisible) {
          setState(() { currentQuestion = data['quizQuestion']; _quizVisible = true; });
        }
      } else {
        setState(() => status = "Reconnecting to Mesh...");
      }
    });
  }

  void _showReviewDialog(List problemStudents) {
    List corrections = [];
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text("Review Class Attendance"),
          content: SizedBox(
            width: double.maxFinite,
            height: 350,
            child: problemStudents.isEmpty 
              ? const Center(child: Text("Perfect Mesh Score: All students present!"))
              : ListView.builder(
                itemCount: problemStudents.length,
                itemBuilder: (context, i) {
                  return Card(
                    child: ListTile(
                      title: Text("Roll: ${problemStudents[i]['rollNo']}"),
                      subtitle: Text("Similarity: ${problemStudents[i]['rfStability']}%"),
                      trailing: DropdownButton<String>(
                        value: problemStudents[i]['status'],
                        items: ["PRESENT", "ABSENT", "PARTIAL"].map((s) => DropdownMenuItem(value: s, child: Text(s))).toList(),
                        onChanged: (newVal) {
                          setDialogState(() {
                            corrections.add({
                              "rollNo": problemStudents[i]['rollNo'],
                              "oldStatus": problemStudents[i]['status'],
                              "newStatus": newVal
                            });
                            problemStudents[i]['status'] = newVal;
                          });
                        },
                      ),
                    ),
                  );
                },
              ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context), child: const Text("BACK")),
            ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: Colors.green),
              onPressed: () async {
                await http.post(Uri.parse('$serverUrl/save-final-attendance'),
                  headers: {"Content-Type": "application/json", "Authorization": jwtToken!},
                  body: jsonEncode({ "finalAttendance": problemStudents, "corrections": corrections }));
                Navigator.pop(context);
                setState(() => status = "Attendance Finalized ✅");
              },
              child: const Text("SUBMIT FINAL REPORT", style: TextStyle(color: Colors.white)),
            ),
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
            title: Text("${userRole!.toUpperCase()} DASHBOARD"),
            centerTitle: true,
            backgroundColor: userRole == 'student' ? Colors.indigo : Colors.deepOrange,
            actions: [ IconButton(icon: const Icon(Icons.power_settings_new), onPressed: () async {
              SharedPreferences prefs = await SharedPreferences.getInstance();
              await prefs.clear();
              setState(() { userRole = null; _timer?.cancel(); });
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
      return Padding(padding: const EdgeInsets.all(25), child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
        _actionButton(Icons.settings_input_antenna, "1. START ROOM MESH", Colors.blue, () async {
          setState(() => status = "Generating Anchor...");
          final w = await _getWifi();
          final res = await http.post(Uri.parse('$serverUrl/set-master'), 
              headers: {"Content-Type": "application/json", "Authorization": jwtToken!}, 
              body: jsonEncode({"wifi": w}));
          if (res.statusCode == 200) {
            setState(() => status = "Mesh Active: Seeded ✅");
          } else {
            var error = jsonDecode(res.body);
            setState(() => status = error['message'] ?? "Access Denied");
          }
        }),
        const SizedBox(height: 20),
        _actionButton(Icons.psychology, "2. TRIGGER LIVENESS", Colors.red, () => http.post(Uri.parse('$serverUrl/trigger-quiz'), headers: {"Authorization": jwtToken!})),
        const SizedBox(height: 20),
        _actionButton(Icons.assignment_turned_in, "3. REVIEW & SYNC", Colors.green, () async {
          final res = await http.post(Uri.parse('$serverUrl/finalize-session'), headers: {"Authorization": jwtToken!});
          if (res.statusCode == 200) {
            _showReviewDialog(jsonDecode(res.body)['reviewList']);
          }
        }),
        const SizedBox(height: 40),
        Text(status, textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
      ]));
    } else if (userRole == 'admin') {
      return SingleChildScrollView(padding: const EdgeInsets.all(25), child: Column(children: [
        _adminField(_roomController, "Target Teacher ID"),
        _adminField(_passController, "Scheduled Day (e.g. Thursday)"),
        Row(children: [
          Expanded(child: _adminField(_startTimeController, "Start (HH:mm)")),
          const SizedBox(width: 10),
          Expanded(child: _adminField(_endTimeController, "End (HH:mm)")),
        ]),
        const SizedBox(height: 10),
        ElevatedButton(onPressed: () async {
          await http.post(Uri.parse('$serverUrl/admin/add-schedule'), headers: {"Content-Type": "application/json", "Authorization": jwtToken!}, 
          body: jsonEncode({
            "teacherID": _roomController.text.toLowerCase().trim(), 
            "day": _passController.text.trim(), 
            "startTime": _startTimeController.text.trim(), 
            "endTime": _endTimeController.text.trim()
          }));
          setState(() => status = "Schedule Database Updated!");
        }, style: ElevatedButton.styleFrom(minimumSize: const Size(double.infinity, 60), backgroundColor: Colors.deepOrange), child: const Text("COMMIT SCHEDULE", style: TextStyle(color: Colors.white))),
        const SizedBox(height: 30),
        _actionButton(Icons.open_in_new, "LAUNCH WEB CONSOLE", Colors.blueGrey, () => launchUrl(Uri.parse('$serverUrl/dashboard?token=$jwtToken'), mode: LaunchMode.externalApplication)),
      ]));
    } else {
      return Center(child: Padding(padding: const EdgeInsets.all(30), child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
        const Icon(Icons.waves, size: 100, color: Colors.indigo),
        const SizedBox(height: 40),
        ElevatedButton.icon(icon: const Icon(Icons.radar), label: const Text("AUTO-JOIN NEAREST MESH"), onPressed: autoDiscoverAndJoin, style: ElevatedButton.styleFrom(minimumSize: const Size(double.infinity, 80), backgroundColor: Colors.indigo, foregroundColor: Colors.white, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(15)))),
        const SizedBox(height: 30),
        Text(status, textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18, color: Colors.indigo)),
      ])));
    }
  }

  Widget _actionButton(IconData icon, String label, Color color, VoidCallback action) {
    return ElevatedButton.icon(icon: Icon(icon), label: Text(label), onPressed: action, style: ElevatedButton.styleFrom(minimumSize: const Size(double.infinity, 75), backgroundColor: color, foregroundColor: Colors.white, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))));
  }

  Widget _adminField(TextEditingController ctrl, String label) {
    return Padding(padding: const EdgeInsets.only(bottom: 15), child: TextField(controller: ctrl, decoration: InputDecoration(labelText: label, border: const OutlineInputBorder())));
  }

  Widget _buildLoginUI() {
    return Scaffold(body: Center(child: SingleChildScrollView(padding: const EdgeInsets.all(40), child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
      const Icon(Icons.security, size: 100, color: Colors.indigo),
      const SizedBox(height: 20),
      const Text("Consensus Mesh", style: TextStyle(fontSize: 26, fontWeight: FontWeight.bold)),
      const Text("Hybrid Proximity Auth", style: TextStyle(color: Colors.grey)),
      const SizedBox(height: 50),
      TextField(controller: _userController, decoration: const InputDecoration(labelText: "Username", border: OutlineInputBorder(), prefixIcon: Icon(Icons.person))),
      const SizedBox(height: 15),
      TextField(controller: _passController, obscureText: true, decoration: const InputDecoration(labelText: "Password", border: OutlineInputBorder(), prefixIcon: Icon(Icons.lock))),
      const SizedBox(height: 30),
      ElevatedButton(onPressed: login, style: ElevatedButton.styleFrom(minimumSize: const Size(double.infinity, 65), backgroundColor: Colors.indigo, foregroundColor: Colors.white, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10))), child: const Text("AUTHENTICATE")),
      const SizedBox(height: 25),
      Text(status, style: const TextStyle(color: Colors.red, fontWeight: FontWeight.w500))
    ]))));
  }

  Widget _buildLivenessOverlay() {
    return Positioned.fill(child: Container(color: Colors.red.withOpacity(0.95), child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
      const Icon(Icons.warning_amber_rounded, size: 80, color: Colors.white),
      const SizedBox(height: 20),
      const Text("LIVENESS VERIFICATION", style: TextStyle(color: Colors.white, fontSize: 16, decoration: TextDecoration.none)),
      const SizedBox(height: 10),
      Text(currentQuestion, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 36, fontWeight: FontWeight.bold, decoration: TextDecoration.none)),
      const SizedBox(height: 50),
      Padding(padding: const EdgeInsets.symmetric(horizontal: 60), child: Material(borderRadius: BorderRadius.circular(10), child: TextField(controller: _quizAnswerController, textAlign: TextAlign.center, keyboardType: TextInputType.number, style: const TextStyle(fontSize: 28), decoration: const InputDecoration(hintText: "???", border: InputBorder.none)))),
      const SizedBox(height: 50),
      ElevatedButton(onPressed: () {
        http.post(Uri.parse('$serverUrl/submit-liveness'), headers: {"Content-Type": "application/json", "Authorization": jwtToken!}, body: jsonEncode({"answer": _quizAnswerController.text, "teacherID": _roomController.text.toLowerCase().trim()}));
        setState(() => _quizVisible = false);
        _quizAnswerController.clear();
      }, style: ElevatedButton.styleFrom(backgroundColor: Colors.white, foregroundColor: Colors.red, padding: const EdgeInsets.symmetric(horizontal: 50, vertical: 20), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(30))), child: const Text("SUBMIT PROOF", style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)))
    ])));
  }
}