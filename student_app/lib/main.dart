import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'dart:async';
import 'dart:math';
import 'package:wifi_scan/wifi_scan.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:sensors_plus/sensors_plus.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:flutter/services.dart';

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
  final TextEditingController _quizAnswerController = TextEditingController();

  // Core App State
  String? userRole, savedID, jwtToken;
  String status = "Ready";
  List<int> quizNumbers = [];
  Timer? _timer;
  bool _quizVisible = false;
  bool _quizSubmitting = false;
  
  double _accelVariance = 0.0;
  StreamSubscription? _accelSub;
  double _currentThreshold = 10.0;
  double _currentRadius = 18.0;

  final String serverUrl = "https://server-2whc.onrender.com";

  // --- NEW INTEGRATED STATE ---
  bool _isInflight = false;
  final TextEditingController _expectedStudentsController = TextEditingController(text: "1");
  String? _currentSessionId;
  String _currentCourseId = "CS101";
  String _currentSectionId = "A";

  // Event Mode (Clubs & Seminars)
  bool _isEventMode = false;
  String? _eventPin;
  int _eventAttendeeCount = 0;
  Timer? _eventPollTimer;
  final TextEditingController _eventPinController = TextEditingController();
  bool _isStudentRegisteredToEvent = false;
  String? _registeredEventName;

  @override
  void initState() {
    super.initState();
    _checkLogin();
    _initHumanAudit();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _checkAndRequestPermissions();
    });
  }

  @override
  void dispose() {
    _accelSub?.cancel();
    _timer?.cancel();
    _eventPollTimer?.cancel();
    _expectedStudentsController.dispose();
    _eventPinController.dispose();
    _userController.dispose();
    _passController.dispose();
    _roomController.dispose();
    _quizAnswerController.dispose();
    super.dispose();
  }

  // --- 🛠️ HELPER: CONFIRMATION MESSAGES ---
  void _showStatus(String msg, {bool isError = false}) {
    if (!mounted) return;
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

  Future<bool> _checkAndRequestPermissions() async {
    PermissionStatus locationStatus = await Permission.location.status;
    if (locationStatus.isGranted) return true;

    if (locationStatus.isDenied) {
      locationStatus = await Permission.location.request();
      if (locationStatus.isGranted) return true;
    }

    if (!locationStatus.isGranted && mounted) {
      showDialog(
        context: context,
        barrierDismissible: false,
        builder: (context) => AlertDialog(
          title: const Text("Location Permission Required"),
          content: const Text(
              "Consensus Mesh requires Location access to scan ambient WiFi signals for environmental identity verification. Please enable it in system settings."),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text("Cancel"),
            ),
            TextButton(
              onPressed: () {
                openAppSettings();
                Navigator.pop(context);
              },
              child: const Text("Settings"),
            ),
          ],
        ),
      );
    }
    return false;
  }

  Future<void> login() async {
    setState(() {
      status = "Authorizing...";
      _isInflight = true;
    });
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
    } finally {
      setState(() => _isInflight = false);
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
        
        final hasPermission = await _checkAndRequestPermissions();
        if (!hasPermission) {
          setState(() => status = "Location Permission Denied ❌");
          t.cancel();
          return;
        }

        try {
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
              final List<dynamic> serverNums = data['quizNumbers'] ?? [];
              _triggerLivenessChallenge(serverNums.cast<int>());
            }
          } else {
            setState(() => status = "Mesh Synced Error ❌");
          }
        } catch (e) {
          setState(() => status = "Mesh Synced Error ❌");
        }
      });
    });
  }

  void _triggerLivenessChallenge(List<int> serverNums) {
    setState(() {
      quizNumbers = serverNums;
      _quizVisible = true;
      _quizSubmitting = false;
    });
    
    Future.delayed(const Duration(seconds: 10), () {
      if (mounted && _quizVisible && !_quizSubmitting) {
        setState(() {
          _quizVisible = false;
          status = "Liveness Timeout ❌";
          _timer?.cancel(); 
        });
      }
    });
  }

  // --- AD-HOC EVENT FUNCTIONS ---
  Future<void> _startEventMode() async {
    setState(() {
      _isInflight = true;
      status = "Starting Event...";
    });
    try {
      final hasPermission = await _checkAndRequestPermissions();
      if (!hasPermission) {
        setState(() {
          status = "Location Permission Denied ❌";
          _isEventMode = false;
        });
        _showStatus("Location Permission Required", isError: true);
        return;
      }
      
      final w = await _getWifi();
      final res = await http.post(Uri.parse('$serverUrl/create-event'),
          headers: {"Content-Type": "application/json", "Authorization": jwtToken!},
          body: jsonEncode({
            "eventName": "Ad-Hoc Seminar",
            "wifi": w
          }));
          
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        setState(() {
          _eventPin = data['eventPin'];
          _eventAttendeeCount = 0;
          status = "Event Active ✅";
        });
        _showStatus("Event Created Successfully");
        _startEventPolling();
      } else {
        setState(() {
          status = "Failed to Create Event ❌";
          _isEventMode = false;
        });
        _showStatus("Error starting event", isError: true);
      }
    } catch (e) {
      setState(() {
        status = "Error starting event";
        _isEventMode = false;
      });
      _showStatus("Connection Error", isError: true);
    } finally {
      setState(() => _isInflight = false);
    }
  }

  void _startEventPolling() {
    _eventPollTimer?.cancel();
    _eventPollTimer = Timer.periodic(const Duration(seconds: 3), (timer) async {
      if (_eventPin == null || !mounted) {
        timer.cancel();
        return;
      }
      try {
        final res = await http.get(
          Uri.parse('$serverUrl/event-status?eventPin=$_eventPin'),
          headers: {"Authorization": jwtToken!},
        );
        if (res.statusCode == 200) {
          final data = jsonDecode(res.body);
          if (mounted) {
            setState(() {
              _eventAttendeeCount = data['attendeeCount'] ?? 0;
            });
          }
        }
      } catch (e) {
        // Silent catch for background polling
      }
    });
  }

  void _stopEventMode() {
    _eventPollTimer?.cancel();
    setState(() {
      _isEventMode = false;
      _eventPin = null;
      _eventAttendeeCount = 0;
      status = "Ready";
    });
    _showStatus("Event Mode Closed");
  }

  Future<void> _joinEvent() async {
    final pin = _eventPinController.text.trim();
    if (pin.length != 6 || int.tryParse(pin) == null) {
      _showStatus("Please enter a valid 6-digit PIN", isError: true);
      return;
    }
    
    setState(() {
      _isInflight = true;
      status = "Joining Event...";
    });
    
    try {
      final hasPermission = await _checkAndRequestPermissions();
      if (!hasPermission) {
        setState(() => status = "Location Permission Denied ❌");
        _showStatus("Location Permission Required", isError: true);
        return;
      }
      
      setState(() => status = "Scanning Wi-Fi Ambient Signature...");
      final wifi = await _getWifi();
      
      final res = await http.post(
        Uri.parse('$serverUrl/join-event'),
        headers: {"Content-Type": "application/json", "Authorization": jwtToken!},
        body: jsonEncode({
          "eventPin": pin,
          "wifi": wifi
        })
      );
      
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        setState(() {
          _isStudentRegisteredToEvent = true;
          _registeredEventName = data['eventName'] ?? "Event";
          status = "Registered to Event and Synced ✅";
        });
        _showStatus("Successfully Joined Event!");
      } else {
        final data = jsonDecode(res.body);
        final errMsg = data['message'] ?? "Failed to join event";
        _showStatus(errMsg, isError: true);
        setState(() => status = errMsg);
      }
    } catch (e) {
      setState(() => status = "Connection Error");
      _showStatus("Connection Error", isError: true);
    } finally {
      setState(() => _isInflight = false);
    }
  }

  // --- RECONCILIATION MODAL SHEET ---
  void _showReconciliationSheet(
    List<dynamic> initialReviewList,
    String className,
    String sessionId,
    String courseId,
    String sectionId,
  ) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) => DraggableScrollableSheet(
        initialChildSize: 0.85,
        minChildSize: 0.5,
        maxChildSize: 0.95,
        builder: (context, scrollController) => ReconciliationSheetContent(
          initialReviewList: initialReviewList,
          className: className,
          sessionId: sessionId,
          courseId: courseId,
          sectionId: sectionId,
          serverUrl: serverUrl,
          jwtToken: jwtToken!,
          scrollController: scrollController,
          onComplete: () {
            setState(() {
              _currentSessionId = null;
              status = "Ready";
            });
            _showStatus("Reconciliation successfully committed to Ledger!");
          },
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (userRole == null) return _buildLoginUI();
    return Stack(
      children: [
        AbsorbPointer(
          absorbing: _isInflight,
          child: Scaffold(
            appBar: AppBar(
              title: Text("${userRole!.toUpperCase()} TERMINAL"),
              backgroundColor: userRole == 'student' ? Colors.indigo : Colors.deepOrange,
              actions: [
                IconButton(
                  icon: const Icon(Icons.logout),
                  onPressed: () async {
                    (await SharedPreferences.getInstance()).clear();
                    setState(() {
                      userRole = null;
                      _timer?.cancel();
                      _eventPollTimer?.cancel();
                    });
                    _showStatus("Logged Out");
                  },
                )
              ],
            ),
            body: _buildRoleDashboard(),
          ),
        ),
        if (_quizVisible) _buildLivenessOverlay(),
        _buildInflightOverlay(),
      ],
    );
  }

  Widget _buildInflightOverlay() {
    if (!_isInflight) return const SizedBox.shrink();
    final Color activeColor = userRole == 'student' ? Colors.indigo : Colors.deepOrange;
    return Positioned.fill(
      child: Container(
        color: Colors.black.withOpacity(0.25),
        child: Center(
          child: Card(
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
            elevation: 6,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 20),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  CircularProgressIndicator(color: activeColor),
                  const SizedBox(width: 16),
                  Text(
                    "Please wait...",
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      color: Colors.grey.shade800,
                      fontSize: 14,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildRoleDashboard() {
    if (userRole == 'teacher') {
      return Column(
        children: [
          // MODE SWITCHER SEGMENTED CONTROL
          Padding(
            padding: const EdgeInsets.only(left: 25, right: 25, top: 20, bottom: 10),
            child: Container(
              padding: const EdgeInsets.all(4),
              decoration: BoxDecoration(
                color: Colors.grey.shade200,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: GestureDetector(
                      onTap: () {
                        if (_eventPin != null) {
                          _showStatus("Please close the active event first", isError: true);
                          return;
                        }
                        setState(() => _isEventMode = false);
                      },
                      child: Container(
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        decoration: BoxDecoration(
                          color: !_isEventMode ? Colors.white : Colors.transparent,
                          borderRadius: BorderRadius.circular(8),
                          boxShadow: !_isEventMode
                              ? [BoxShadow(color: Colors.black.withOpacity(0.05), blurRadius: 4)]
                              : [],
                        ),
                        child: Center(
                          child: Text(
                            "Standard Class",
                            style: TextStyle(
                              fontWeight: FontWeight.bold,
                              color: !_isEventMode ? Colors.deepOrange : Colors.grey.shade600,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                  Expanded(
                    child: GestureDetector(
                      onTap: () {
                        if (_currentSessionId != null) {
                          _showStatus("Please finalize the active class session first", isError: true);
                          return;
                        }
                        setState(() => _isEventMode = true);
                      },
                      child: Container(
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        decoration: BoxDecoration(
                          color: _isEventMode ? Colors.white : Colors.transparent,
                          borderRadius: BorderRadius.circular(8),
                          boxShadow: _isEventMode
                              ? [BoxShadow(color: Colors.black.withOpacity(0.05), blurRadius: 4)]
                              : [],
                        ),
                        child: Center(
                          child: Text(
                            "Dynamic Event",
                            style: TextStyle(
                              fontWeight: FontWeight.bold,
                              color: _isEventMode ? Colors.deepOrange : Colors.grey.shade600,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          
          Expanded(
            child: _isEventMode ? _buildTeacherEventDashboard() : _buildTeacherClassDashboard(),
          ),
        ],
      );
    } else {
      // Student Dashboard
      return Column(
        children: [
          // MODE SWITCHER
          Padding(
            padding: const EdgeInsets.only(left: 25, right: 25, top: 20, bottom: 10),
            child: Container(
              padding: const EdgeInsets.all(4),
              decoration: BoxDecoration(
                color: Colors.grey.shade200,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: GestureDetector(
                      onTap: () {
                        if (_isStudentRegisteredToEvent) {
                          _showStatus("Please leave the active event first", isError: true);
                          return;
                        }
                        setState(() => _isEventMode = false);
                      },
                      child: Container(
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        decoration: BoxDecoration(
                          color: !_isEventMode ? Colors.white : Colors.transparent,
                          borderRadius: BorderRadius.circular(8),
                          boxShadow: !_isEventMode
                              ? [BoxShadow(color: Colors.black.withOpacity(0.05), blurRadius: 4)]
                              : [],
                        ),
                        child: Center(
                          child: Text(
                            "Join Classroom",
                            style: TextStyle(
                              fontWeight: FontWeight.bold,
                              color: !_isEventMode ? Colors.indigo : Colors.grey.shade600,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                  Expanded(
                    child: GestureDetector(
                      onTap: () {
                        if (_timer?.isActive ?? false) {
                          _showStatus("Please disconnect from standard class first", isError: true);
                          return;
                        }
                        setState(() => _isEventMode = true);
                      },
                      child: Container(
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        decoration: BoxDecoration(
                          color: _isEventMode ? Colors.white : Colors.transparent,
                          borderRadius: BorderRadius.circular(8),
                          boxShadow: _isEventMode
                              ? [BoxShadow(color: Colors.black.withOpacity(0.05), blurRadius: 4)]
                              : [],
                        ),
                        child: Center(
                          child: Text(
                            "Join Event PIN",
                            style: TextStyle(
                              fontWeight: FontWeight.bold,
                              color: _isEventMode ? Colors.indigo : Colors.grey.shade600,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          
          Expanded(
            child: _isEventMode ? _buildStudentEventDashboardLayout() : _buildStudentClassDashboard(),
          ),
        ],
      );
    }
  }

  Widget _buildTeacherClassDashboard() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(25),
      child: Column(
        children: [
          Text("Bubble Radius: ${_currentRadius.toInt()} Units", style: const TextStyle(fontWeight: FontWeight.bold)),
          Slider(value: _currentRadius, min: 5, max: 40, activeColor: Colors.deepOrange, onChanged: (v) => setState(() => _currentRadius = v)),
          Text("Sensitivity: ${_currentThreshold.toInt()}%", style: const TextStyle(fontWeight: FontWeight.bold)),
          Slider(value: _currentThreshold, min: 1, max: 50, activeColor: Colors.deepOrange, onChanged: (v) => setState(() => _currentThreshold = v)),
          const SizedBox(height: 15),
          
          // Expected student count card
          Card(
            elevation: 0,
            color: Colors.grey.shade50,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
              side: BorderSide(color: Colors.grey.shade200),
            ),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              child: Row(
                children: [
                  const Icon(Icons.people_outline_rounded, color: Colors.deepOrange),
                  const SizedBox(width: 12),
                  const Expanded(
                    child: Text(
                      "Expected Student Count",
                      style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                    ),
                  ),
                  SizedBox(
                    width: 80,
                    height: 45,
                    child: TextField(
                      controller: _expectedStudentsController,
                      keyboardType: TextInputType.number,
                      textAlign: TextAlign.center,
                      decoration: InputDecoration(
                        contentPadding: EdgeInsets.zero,
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
                        focusedBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(8),
                          borderSide: const BorderSide(color: Colors.deepOrange, width: 2),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 20),
          
          _actionButton(Icons.anchor, "ANCHOR ROOM MESH", Colors.blue.shade600, () async {
            final intVal = int.tryParse(_expectedStudentsController.text);
            if (intVal == null || intVal <= 0) {
              _showStatus("Expected Student Count must be greater than 0", isError: true);
              return;
            }
            
            setState(() {
              _isInflight = true;
              status = "Checking Permissions...";
            });
            
            try {
              final hasPermission = await _checkAndRequestPermissions();
              if (!hasPermission) {
                setState(() => status = "Location Permission Denied ❌");
                _showStatus("Location Permission Required", isError: true);
                return;
              }
              
              setState(() => status = "Capturing Signal Origin...");
              final w = await _getWifi();
              
              final res = await http.post(
                Uri.parse('$serverUrl/set-master'), 
                headers: {"Content-Type": "application/json", "Authorization": jwtToken!}, 
                body: jsonEncode({
                  "wifi": w,
                  "threshold": _currentThreshold,
                  "maxRadius": _currentRadius,
                  "physicsEnabled": true,
                  "expectedStudents": intVal,
                  "courseId": _currentCourseId,
                  "sectionId": _currentSectionId
                })
              );
              
              if (res.statusCode == 200) {
                final data = jsonDecode(res.body);
                setState(() {
                  _currentSessionId = data['sessionId'];
                  if (data['className'] != null) {
                    _currentCourseId = data['className'];
                  }
                  status = "Mesh Active ✅";
                });
                _showStatus("Mesh Anchor Established");
              } else {
                setState(() => status = "Anchor Failed ❌");
                final errorData = jsonDecode(res.body);
                _showStatus(errorData['message'] ?? "No scheduled class active", isError: true);
              }
            } catch (e) {
              setState(() => status = "Server Connection Error");
              _showStatus("Connection Error", isError: true);
            } finally {
              setState(() => _isInflight = false);
            }
          }),
          const SizedBox(height: 15),
          
          _actionButton(Icons.bolt, "PUSH LIVENESS CHALLENGE", Colors.red, () async {
            if (_currentSessionId == null) {
              _showStatus("Please establish the Room Mesh anchor first", isError: true);
              return;
            }
            setState(() => _isInflight = true);
            try {
              final res = await http.post(Uri.parse('$serverUrl/trigger-quiz'), headers: {"Authorization": jwtToken!});
              if (res.statusCode == 200) {
                _showStatus("Liveness Challenge Pushed to Students");
              }
            } catch (e) {
              _showStatus("Failed to push liveness quiz", isError: true);
            } finally {
              setState(() => _isInflight = false);
            }
          }),
          const SizedBox(height: 15),
          
          _actionButton(Icons.analytics, "AUDIT & FINALIZE", Colors.green.shade600, () async {
            if (_currentSessionId == null) {
              _showStatus("No active session found. Please anchor the room mesh first.", isError: true);
              return;
            }
            setState(() {
              _isInflight = true;
              status = "Finalizing Session...";
            });
            try {
              final res = await http.post(
                Uri.parse('$serverUrl/finalize-session'),
                headers: {"Content-Type": "application/json", "Authorization": jwtToken!},
                body: jsonEncode({
                  "sessionId": _currentSessionId,
                  "courseId": _currentCourseId,
                  "sectionId": _currentSectionId
                })
              );
              if (res.statusCode == 200) {
                var data = jsonDecode(res.body);
                setState(() => status = "Session Finalized");
                _showReconciliationSheet(data['reviewList'], data['className'], data['sessionId'], data['courseId'], data['sectionId']);
              } else {
                final errorData = jsonDecode(res.body);
                _showStatus(errorData['message'] ?? "Error finalizing session", isError: true);
                setState(() => status = "Finalization Failed");
              }
            } catch (e) {
              setState(() => status = "Connection Error");
              _showStatus("Connection Error", isError: true);
            } finally {
              setState(() => _isInflight = false);
            }
          }),
          const SizedBox(height: 20),
          Text(status, style: const TextStyle(fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildTeacherEventDashboard() {
    if (_eventPin == null) {
      return Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(25),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.stars_rounded, size: 80, color: Colors.deepOrange.shade300),
              const SizedBox(height: 16),
              const Text(
                "Ad-Hoc Event Mode",
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 8),
              const Padding(
                padding: EdgeInsets.symmetric(horizontal: 20),
                child: Text(
                  "Broadcast instant dynamic meshes for seminars, club meets, and guest lectures without scheduling details.",
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.grey),
                ),
              ),
              const SizedBox(height: 32),
              _actionButton(Icons.play_circle_fill_rounded, "CREATE EVENT MESH", Colors.deepOrange, () {
                _startEventMode();
              }),
            ],
          ),
        ),
      );
    }

    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              padding: const EdgeInsets.all(24),
              decoration: BoxDecoration(
                color: Colors.deepOrange.withOpacity(0.08),
                borderRadius: BorderRadius.circular(24),
                border: Border.all(color: Colors.deepOrange.withOpacity(0.15), width: 1.5),
              ),
              child: Column(
                children: [
                  const Text(
                    "EVENT ENROLLMENT PIN",
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.bold,
                      letterSpacing: 2.0,
                      color: Colors.deepOrange,
                    ),
                  ),
                  const SizedBox(height: 12),
                  GestureDetector(
                    onTap: () {
                      Clipboard.setData(ClipboardData(text: _eventPin ?? ''));
                      _showStatus("Event PIN copied to Clipboard!");
                    },
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(
                          _eventPin ?? "------",
                          style: const TextStyle(
                            fontSize: 48,
                            fontWeight: FontWeight.bold,
                            letterSpacing: 6.0,
                            color: Colors.black87,
                          ),
                        ),
                        const SizedBox(width: 8),
                        Icon(Icons.copy_rounded, color: Colors.grey.shade600, size: 24),
                      ],
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    "Tap PIN to copy",
                    style: TextStyle(fontSize: 11, color: Colors.grey.shade500),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 40),
            
            // Live ticker
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: Colors.grey.shade50,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: Colors.grey.shade200),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(Icons.people_alt_rounded, color: Colors.deepOrange, size: 28),
                  const SizedBox(width: 12),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        "Registered Attendees",
                        style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Colors.black54),
                      ),
                      const SizedBox(height: 2),
                      AnimatedSwitcher(
                        duration: const Duration(milliseconds: 300),
                        transitionBuilder: (child, anim) => ScaleTransition(scale: anim, child: child),
                        child: Text(
                          "$_eventAttendeeCount",
                          key: ValueKey<int>(_eventAttendeeCount),
                          style: const TextStyle(
                            fontSize: 24,
                            fontWeight: FontWeight.bold,
                            color: Colors.deepOrange,
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 40),
            
            _actionButton(Icons.close_rounded, "CLOSE EVENT MESH", Colors.red.shade600, () {
              _stopEventMode();
            }),
          ],
        ),
      ),
    );
  }

  Widget _buildStudentClassDashboard() {
    return Center(
      child: SingleChildScrollView(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.wifi_tethering, size: 100, color: Colors.indigo),
            const SizedBox(height: 20),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                minimumSize: const Size(200, 60),
                backgroundColor: Colors.indigo,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
              ),
              onPressed: () async {
                setState(() {
                  status = "Checking Permissions...";
                  _isInflight = true;
                });
                
                final hasPermission = await _checkAndRequestPermissions();
                if (!hasPermission) {
                  setState(() {
                    status = "Location Permission Denied ❌";
                    _isInflight = false;
                  });
                  return;
                }
                
                setState(() => status = "Searching Class Mesh...");
                try {
                  final wifi = await _getWifi();
                  final res = await http.post(
                    Uri.parse('$serverUrl/discover-room'),
                    headers: {"Content-Type": "application/json", "Authorization": jwtToken!},
                    body: jsonEncode({"wifi": wifi})
                  );
                  
                  if (res.statusCode == 200) {
                    final data = jsonDecode(res.body);
                    _roomController.text = data['teacherID'];
                    _startSyncedHeartbeat(data['teacherID']);
                    _showStatus("Connected to ${data['teacherID']}'s Mesh");
                  } else {
                    _showStatus("No active classroom mesh found", isError: true);
                    setState(() => status = "Ready");
                  }
                } catch (e) {
                  _showStatus("Connection Error", isError: true);
                  setState(() => status = "Connection Error");
                } finally {
                  setState(() => _isInflight = false);
                }
              },
              child: const Text(
                "JOIN CLASS MESH",
                style: TextStyle(fontWeight: FontWeight.bold, letterSpacing: 1.0),
              ),
            ),
            const SizedBox(height: 20),
            Text(status, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18, color: Colors.indigo)),
          ],
        ),
      ),
    );
  }

  Widget _buildStudentEventDashboardLayout() {
    if (_isStudentRegisteredToEvent) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              // Lightweight simulated glassmorphism style (performance friendly)
              color: Colors.indigo.withOpacity(0.08),
              borderRadius: BorderRadius.circular(24),
              border: Border.all(color: Colors.indigo.withOpacity(0.15), width: 1.5),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: Colors.indigo.shade50,
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(Icons.verified_rounded, size: 60, color: Colors.indigo),
                ),
                const SizedBox(height: 20),
                const Text(
                  "Registered to Event and Synced ✅",
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.bold,
                    color: Colors.indigo,
                  ),
                ),
                const SizedBox(height: 10),
                Text(
                  "Event: ${_registeredEventName ?? 'Ad-Hoc Seminar'}",
                  style: TextStyle(
                    fontSize: 15,
                    color: Colors.grey.shade700,
                    fontWeight: FontWeight.w500,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  "PIN: ${_eventPinController.text}",
                  style: TextStyle(
                    fontSize: 13,
                    color: Colors.grey.shade500,
                    letterSpacing: 1.0,
                  ),
                ),
                const SizedBox(height: 32),
                ElevatedButton.icon(
                  icon: const Icon(Icons.exit_to_app_rounded),
                  label: const Text("LEAVE EVENT"),
                  onPressed: () {
                    setState(() {
                      _isStudentRegisteredToEvent = false;
                      _registeredEventName = null;
                      _eventPinController.clear();
                      status = "Ready";
                    });
                    _showStatus("Disconnected from Event");
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.red.shade600,
                    foregroundColor: Colors.white,
                    minimumSize: const Size(200, 50),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }

    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.stars_rounded, size: 80, color: Colors.indigo.shade300),
            const SizedBox(height: 16),
            const Text(
              "Join Event Mesh",
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 24),
            TextField(
              controller: _eventPinController,
              keyboardType: TextInputType.number,
              textAlign: TextAlign.center,
              maxLength: 6,
              style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold, letterSpacing: 6.0),
              decoration: const InputDecoration(
                labelText: "Enter 6-digit Event Pin",
                labelStyle: TextStyle(fontSize: 14, letterSpacing: 0),
                counterText: "",
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 24),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                minimumSize: const Size(double.infinity, 55),
                backgroundColor: Colors.indigo,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
              onPressed: _joinEvent,
              child: const Text(
                "JOIN EVENT MESH",
                style: TextStyle(fontWeight: FontWeight.bold, letterSpacing: 1.0),
              ),
            ),
          ],
        ),
      ),
    );
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
            if (_quizSubmitting)
              const CircularProgressIndicator(color: Colors.white)
            else
              Wrap(
                spacing: 20, runSpacing: 20,
                children: quizNumbers.map((n) => GestureDetector(
                  onTap: _quizSubmitting ? null : () async {
                    setState(() {
                      _quizSubmitting = true;
                    });
                    
                    try {
                      final res = await http.post(Uri.parse('$serverUrl/submit-liveness'), 
                        headers: {"Content-Type": "application/json", "Authorization": jwtToken!}, 
                        body: jsonEncode({
                          "teacherID": _roomController.text.toLowerCase().trim(),
                          "answer": n
                        }));
                      
                      if (res.statusCode == 200) {
                        _showStatus("Liveness Verified ✅");
                        setState(() {
                          status = "Liveness Verified ✅";
                          _quizVisible = false;
                        });
                      } else {
                        _showStatus("Incorrect answer! Liveness failed.", isError: true);
                        setState(() {
                          status = "Incorrect answer! Liveness failed.";
                          _quizVisible = false;
                          _timer?.cancel(); 
                        });
                      }
                    } catch (e) {
                      _showStatus("Submission Error", isError: true);
                      setState(() {
                        status = "Mesh Synced Error ❌";
                        _quizVisible = false;
                        _timer?.cancel(); 
                      });
                    } finally {
                      if (mounted) {
                        setState(() {
                          _quizSubmitting = false;
                        });
                      }
                    }
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

  Widget _actionButton(IconData i, String l, Color c, VoidCallback a) => ElevatedButton.icon(
        icon: Icon(i), 
        label: Text(l), 
        onPressed: a, 
        style: ElevatedButton.styleFrom(
          minimumSize: const Size(double.infinity, 70), 
          backgroundColor: c, 
          foregroundColor: Colors.white, 
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(15)),
          elevation: 2,
        ),
      );

  Widget _buildLoginUI() => Scaffold(
        body: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(40),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.fingerprint, size: 80, color: Colors.indigo),
                const SizedBox(height: 20),
                const Text("CONSENSUS MESH", style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
                const SizedBox(height: 40),
                TextField(controller: _userController, decoration: const InputDecoration(labelText: "Username", border: OutlineInputBorder())),
                const SizedBox(height: 15),
                TextField(controller: _passController, obscureText: true, decoration: const InputDecoration(labelText: "Password", border: OutlineInputBorder())),
                const SizedBox(height: 30),
                ElevatedButton(
                  onPressed: login, 
                  style: ElevatedButton.styleFrom(
                    minimumSize: const Size(double.infinity, 60), 
                    backgroundColor: Colors.indigo, 
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ), 
                  child: const Text("LOGIN", style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                ),
              ],
            ),
          ),
        ),
      );
}

class ReconciliationSheetContent extends StatefulWidget {
  final List<dynamic> initialReviewList;
  final String className;
  final String sessionId;
  final String courseId;
  final String sectionId;
  final String serverUrl;
  final String jwtToken;
  final ScrollController scrollController;
  final VoidCallback onComplete;

  const ReconciliationSheetContent({
    super.key,
    required this.initialReviewList,
    required this.className,
    required this.sessionId,
    required this.courseId,
    required this.sectionId,
    required this.serverUrl,
    required this.jwtToken,
    required this.scrollController,
    required this.onComplete,
  });

  @override
  State<ReconciliationSheetContent> createState() => _ReconciliationSheetContentState();
}

class _ReconciliationSheetContentState extends State<ReconciliationSheetContent> with SingleTickerProviderStateMixin {
  late List<Map<String, dynamic>> records;
  late TabController _tabController;
  bool _isSubmitting = false;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
    records = widget.initialReviewList.map<Map<String, dynamic>>((item) {
      return {
        'studentId': item['studentId'] ?? item['rollNo'] ?? '',
        'rollNo': item['rollNo'] ?? item['studentId'] ?? '',
        'rfStability': item['rfStability']?.toString() ?? '0',
        'liveness': item['liveness'] ?? '❌',
        'status': item['status'] ?? 'Absent',
        'originalStatus': item['status'] ?? 'Absent',
        'flags': List<String>.from(item['flags'] ?? []),
        'telemetryCount': item['telemetryCount'] ?? 0,
      };
    }).toList();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  List<Map<String, dynamic>> get presentList => records.where((r) => r['originalStatus'] == 'Present').toList();
  List<Map<String, dynamic>> get partialList => records.where((r) => r['originalStatus'] == 'Partial').toList();
  List<Map<String, dynamic>> get absentList => records.where((r) => r['originalStatus'] == 'Absent').toList();

  Future<void> _commitReport() async {
    setState(() => _isSubmitting = true);
    try {
      final recordsPayload = records.map((r) => {
        'studentId': r['studentId'],
        'status': r['status'],
      }).toList();

      final res = await http.post(
        Uri.parse('${widget.serverUrl}/submit-final-report'),
        headers: {
          "Content-Type": "application/json",
          "Authorization": widget.jwtToken
        },
        body: jsonEncode({
          "sessionId": widget.sessionId,
          "courseId": widget.courseId,
          "sectionId": widget.sectionId,
          "records": recordsPayload,
        }),
      );

      if (res.statusCode == 200) {
        Navigator.pop(context);
        widget.onComplete();
      } else {
        final err = jsonDecode(res.body);
        _showLocalStatus(err['message'] ?? "Error submitting final report", isError: true);
      }
    } catch (e) {
      _showLocalStatus("Connection Error during submission", isError: true);
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  void _showLocalStatus(String msg, {bool isError = false}) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(msg),
        backgroundColor: isError ? Colors.red : Colors.green,
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AbsorbPointer(
      absorbing: _isSubmitting,
      child: Container(
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.only(
            topLeft: Radius.circular(24),
            topRight: Radius.circular(24),
          ),
        ),
        child: Column(
          children: [
            // PULL BAR
            const SizedBox(height: 12),
            Container(
              width: 50,
              height: 5,
              decoration: BoxDecoration(
                color: Colors.grey.shade300,
                borderRadius: BorderRadius.circular(10),
              ),
            ),
            const SizedBox(height: 16),
            
            // HEADER INFO
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        "Reconciliation Sheet",
                        style: TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.bold,
                          color: Colors.grey.shade800,
                        ),
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                        decoration: BoxDecoration(
                          color: Colors.deepOrange.shade50,
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Text(
                          widget.className,
                          style: const TextStyle(
                            color: Colors.deepOrange,
                            fontWeight: FontWeight.bold,
                            fontSize: 14,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    "Session: ${widget.sessionId.substring(max(0, widget.sessionId.length - 8))}",
                    style: TextStyle(color: Colors.grey.shade500, fontSize: 12),
                  ),
                  const SizedBox(height: 16),
                ],
              ),
            ),

            // TABS
            TabBar(
              controller: _tabController,
              labelColor: Colors.deepOrange,
              unselectedLabelColor: Colors.grey.shade500,
              indicatorColor: Colors.deepOrange,
              indicatorWeight: 3,
              labelStyle: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
              tabs: [
                Tab(text: "Present (${presentList.length})"),
                Tab(text: "Partial (${partialList.length})"),
                Tab(text: "Absent (${absentList.length})"),
              ],
            ),

            // LIST VIEWS
            Expanded(
              child: TabBarView(
                controller: _tabController,
                children: [
                  _buildList(presentList, isOverrideAllowed: false),
                  _buildList(partialList, isOverrideAllowed: true),
                  _buildList(absentList, isOverrideAllowed: true),
                ],
              ),
            ),

            // FLOATING ACTION BUTTON
            Padding(
              padding: const EdgeInsets.only(left: 20, right: 20, bottom: 24, top: 12),
              child: SizedBox(
                width: double.infinity,
                height: 60,
                child: ElevatedButton.icon(
                  onPressed: _isSubmitting ? null : _commitReport,
                  icon: _isSubmitting
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2),
                        )
                      : const Icon(Icons.cloud_upload_rounded),
                  label: Text(
                    _isSubmitting ? "COMMITTING..." : "COMMIT FINAL ATTENDANCE TO LEDGER",
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.bold,
                      letterSpacing: 1.0,
                    ),
                  ),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.teal.shade600,
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                    elevation: 3,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildList(List<Map<String, dynamic>> items, {required bool isOverrideAllowed}) {
    if (items.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.people_outline, size: 60, color: Colors.grey.shade300),
            const SizedBox(height: 12),
            Text(
              "No students in this category",
              style: TextStyle(color: Colors.grey.shade400, fontWeight: FontWeight.w500),
            ),
          ],
        ),
      );
    }

    return ListView.builder(
      controller: widget.scrollController,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      itemCount: items.length,
      itemBuilder: (context, i) {
        final item = items[i];
        final bool hasFlags = item['flags'].isNotEmpty;
        final bool isOverridden = item['status'] == 'Present';

        return Card(
          elevation: 1,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
            side: BorderSide(
              color: isOverridden
                  ? Colors.teal.shade100
                  : hasFlags
                      ? Colors.red.shade100
                      : Colors.grey.shade100,
              width: 1,
            ),
          ),
          color: isOverridden
              ? Colors.teal.shade50.withOpacity(0.3)
              : hasFlags
                  ? Colors.red.shade50.withOpacity(0.2)
                  : Colors.white,
          margin: const EdgeInsets.only(bottom: 10),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Row(
                      children: [
                        CircleAvatar(
                          backgroundColor: isOverridden
                              ? Colors.teal.shade100
                              : Colors.grey.shade200,
                          child: Text(
                            item['rollNo'].toString().substring(max(0, item['rollNo'].toString().length - 2)).toUpperCase(),
                            style: TextStyle(
                              color: isOverridden ? Colors.teal.shade800 : Colors.grey.shade800,
                              fontWeight: FontWeight.bold,
                              fontSize: 13,
                            ),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              item['rollNo'].toString().toUpperCase(),
                              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              "${item['telemetryCount']} Scans Received",
                              style: TextStyle(color: Colors.grey.shade500, fontSize: 11),
                            ),
                          ],
                        ),
                      ],
                    ),
                    
                    if (isOverrideAllowed)
                      Row(
                        children: [
                          Text(
                            isOverridden ? "Present" : "Absent",
                            style: TextStyle(
                              color: isOverridden ? Colors.teal.shade700 : Colors.red.shade600,
                              fontWeight: FontWeight.bold,
                              fontSize: 12,
                            ),
                          ),
                          const SizedBox(width: 4),
                          Switch.adaptive(
                            value: isOverridden,
                            activeColor: Colors.teal,
                            onChanged: (val) {
                              setState(() {
                                if (val) {
                                  item['status'] = 'Present';
                                } else {
                                  item['status'] = item['originalStatus'];
                                }
                              });
                            },
                          ),
                        ],
                      )
                    else
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(
                          color: Colors.teal.shade50,
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: const Row(
                          children: [
                            Icon(Icons.check_circle, color: Colors.teal, size: 14),
                            SizedBox(width: 4),
                            Text(
                              "Verified",
                              style: TextStyle(color: Colors.teal, fontWeight: FontWeight.bold, fontSize: 11),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
                
                const SizedBox(height: 10),
                const Divider(height: 1),
                const SizedBox(height: 10),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      "RF Stability: ${item['rfStability']}%",
                      style: TextStyle(color: Colors.grey.shade600, fontSize: 12, fontWeight: FontWeight.w500),
                    ),
                    Text(
                      "Liveness Audit: ${item['liveness']}",
                      style: TextStyle(color: Colors.grey.shade600, fontSize: 12, fontWeight: FontWeight.w500),
                    ),
                  ],
                ),
                
                if (hasFlags) ...[
                  const SizedBox(height: 10),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: item['flags'].map<Widget>((flag) => Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: Colors.red.shade50,
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: Colors.red.shade100, width: 0.5),
                      ),
                      child: Text(
                        flag.toString(),
                        style: TextStyle(color: Colors.red.shade700, fontSize: 10, fontWeight: FontWeight.bold),
                      ),
                    )).toList(),
                  ),
                ],
              ],
            ),
          ),
        );
      },
    );
  }
}