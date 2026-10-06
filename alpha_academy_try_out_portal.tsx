import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  BookOpen, Clock, Trophy, AlertTriangle, CheckCircle, XCircle, 
  ChevronLeft, ChevronRight, Flag, MonitorPlay, LogOut, LayoutDashboard 
} from 'lucide-react';

// Firebase imports
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, signOut } from 'firebase/auth';
import { getFirestore, doc, setDoc, collection, onSnapshot, addDoc, getDocs } from 'firebase/firestore';

const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {
  // Fallback dummy config if environment variables are not injected
  apiKey: "dummy-key",
  authDomain: "dummy.firebaseapp.com",
  projectId: "dummy-project",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'alpha-academy-v1';

const DUMMY_EXAMS = [
  { 
    id: 'osn-geo-1', 
    title: 'OSN Geografi: Geomorfologi & Meteorologi', 
    durationMinutes: 5, // Set to 5 mins for testing purposes
    passingGrade: 75, 
    maxAttempts: 3,
    subject: 'Geografi',
    level: 'SMA'
  },
  { 
    id: 'osn-eko-1', 
    title: 'OSN Ekonomi: Pengantar Makro', 
    durationMinutes: 10, 
    passingGrade: 70, 
    maxAttempts: 2,
    subject: 'Ekonomi',
    level: 'SMA'
  }
];

const DUMMY_QUESTIONS = {
  'osn-geo-1': [
    {
      id: 'q1',
      text: 'Bentuk lahan yang dihasilkan oleh aktivitas aliran sungai, seperti dataran banjir dan meander, diklasifikasikan sebagai bentuk lahan...',
      options: ['Struktural', 'Fluvial', 'Karst', 'Aeolin', 'Marin'],
      correctIndex: 1 // 'Fluvial'
    },
    {
      id: 'q2',
      text: 'Lapisan atmosfer tempat terjadinya fenomena cuaca seperti hujan, angin, dan petir adalah...',
      options: ['Stratosfer', 'Mesosfer', 'Termosfer', 'Troposfer', 'Eksosfer'],
      correctIndex: 3 // 'Troposfer'
    },
    {
      id: 'q3',
      text: 'Peta yang menggambarkan bentuk relief permukaan bumi beserta ketinggiannya disebut...',
      options: ['Peta Korografi', 'Peta Topografi', 'Peta Tematik', 'Peta Geologi', 'Peta Kadaster'],
      correctIndex: 1 // 'Peta Topografi'
    },
    {
      id: 'q4',
      text: 'Magma yang menerobos lapisan litosfer namun tidak mencapai permukaan bumi disebut...',
      options: ['Ekstrusi magma', 'Intrusi magma', 'Erupsi efusif', 'Erupsi eksplosif', 'Lava'],
      correctIndex: 1 // 'Intrusi magma'
    }
  ],
  'osn-eko-1': [
    {
      id: 'e1',
      text: 'Hukum permintaan menyatakan bahwa...',
      options: [
        'Jika harga naik, permintaan akan naik',
        'Jika harga turun, permintaan akan turun',
        'Jika harga naik, permintaan akan turun',
        'Harga tidak mempengaruhi permintaan',
        'Permintaan hanya dipengaruhi selera'
      ],
      correctIndex: 2
    }
  ]
};

export default function App() {
  // App States
  const [user, setUser] = useState(null);
  const [view, setView] = useState('login'); // login, dashboard, pre-exam, exam, result
  const [loading, setLoading] = useState(true);
  
  // Data States
  const [sessions, setSessions] = useState([]); // User's attempts
  const [leaderboard, setLeaderboard] = useState([]); // Public leaderboard
  
  // Exam Engine States
  const [selectedExam, setSelectedExam] = useState(null);
  const [examState, setExamState] = useState(null); 
  const [showModal, setShowModal] = useState({ show: false, title: '', message: '', onConfirm: null, hideCancel: false });

  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Auth error:", err);
      }
    };
    
    initAuth();
    
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        setView(v => v === 'login' ? 'dashboard' : v);
      } else {
        setView('login');
      }
      setLoading(false);
    });
    
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    // Fetch user's private sessions
    const sessionsRef = collection(db, 'artifacts', appId, 'users', user.uid, 'sessions');
    const unsubSessions = onSnapshot(sessionsRef, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setSessions(data);
    }, (error) => console.error("Sessions fetch error:", error));

    // Fetch public leaderboard
    const lbRef = collection(db, 'artifacts', appId, 'public', 'data', 'leaderboard');
    const unsubLb = onSnapshot(lbRef, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setLeaderboard(data);
    }, (error) => console.error("Leaderboard fetch error:", error));

    return () => {
      unsubSessions();
      unsubLb();
    };
  }, [user]);

  const handleStartExam = (exam) => {
    // Check max attempts
    const examAttempts = sessions.filter(s => s.examId === exam.id).length;
    if (examAttempts >= exam.maxAttempts) return;

    const questions = DUMMY_QUESTIONS[exam.id];
    if (!questions) return;

    setExamState({
      exam,
      questions,
      answers: {},
      flagged: {},
      currentIndex: 0,
      startTime: Date.now(),
      timeLeft: exam.durationMinutes * 60,
      warnings: 0,
      attemptNumber: examAttempts + 1
    });
    setView('exam');
  };

  const submitExam = async (isAutoSubmit = false, currentExamState = examState) => {
    if (!user || !currentExamState) return;
    
    const { exam, questions, answers, startTime, attemptNumber } = currentExamState;
    const timeTakenSeconds = Math.floor((Date.now() - startTime) / 1000);
    
    // Calculate score
    let correctCount = 0;
    questions.forEach((q, idx) => {
      if (answers[idx] === q.correctIndex) correctCount++;
    });
    
    const score = Math.round((correctCount / questions.length) * 100);
    
    // Create session record
    const sessionData = {
      examId: exam.id,
      examTitle: exam.title,
      score,
      attemptNumber,
      timeTakenSeconds,
      completedAt: new Date().toISOString(),
      isPass: score >= exam.passingGrade,
      answers
    };

    try {
      // 1. Save to private user sessions
      const sessionRef = collection(db, 'artifacts', appId, 'users', user.uid, 'sessions');
      await addDoc(sessionRef, sessionData);

      // 2. Save to public leaderboard if it's attempt #1 (PRD Rule)
      if (attemptNumber === 1) {
        const lbRef = collection(db, 'artifacts', appId, 'public', 'data', 'leaderboard');
        await addDoc(lbRef, {
          userId: user.uid,
          userName: user.isAnonymous ? 'Siswa Anonim' : user.displayName || 'Siswa Alpha',
          examId: exam.id,
          score,
          timeTakenSeconds,
          completedAt: sessionData.completedAt
        });
      }
      
      setExamState(prev => ({ ...prev, result: sessionData }));
      setView('result');
      setShowModal({ show: false }); // Hide any open modals
    } catch (err) {
      console.error("Error submitting exam:", err);
    }
  };

  const Modal = () => {
    if (!showModal.show) return null;
    return (
      <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
        <div className="bg-white rounded-2xl p-6 shadow-2xl max-w-sm w-full animate-in zoom-in-95 duration-200">
          <div className="flex items-center gap-3 mb-4">
            {showModal.title.includes('Peringatan') ? (
              <AlertTriangle className="text-amber-500 w-8 h-8" />
            ) : (
              <CheckCircle className="text-blue-600 w-8 h-8" />
            )}
            <h3 className="text-xl font-bold text-slate-800">{showModal.title}</h3>
          </div>
          <p className="text-slate-600 mb-8 leading-relaxed">{showModal.message}</p>
          <div className="flex gap-3 justify-end">
            {!showModal.hideCancel && (
              <button 
                onClick={() => setShowModal({ show: false })}
                className="py-2.5 px-5 rounded-xl font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors"
              >
                Batal
              </button>
            )}
            <button 
              onClick={() => {
                if (showModal.onConfirm) showModal.onConfirm();
                setShowModal({ show: false });
              }}
              className="py-2.5 px-6 rounded-xl font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors shadow-sm"
            >
              Mengerti
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderLogin = () => (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-3xl shadow-xl border border-slate-100 p-8 text-center relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-blue-500 to-indigo-500"></div>
        <div className="w-20 h-20 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm border border-blue-100">
          <BookOpen size={40} strokeWidth={1.5} />
        </div>
        <h1 className="text-3xl font-bold text-slate-900 mb-2 tracking-tight">Alpha Academy</h1>
        <p className="text-slate-500 mb-10">Portal Try Out & Simulasi OSN Terpadu</p>
        
        <button 
          disabled={loading}
          onClick={() => {
            // Re-trigger auth if somehow failed, usually auto-handled by useEffect
            if (!user) signInAnonymously(auth);
          }}
          className="w-full flex items-center justify-center gap-3 border border-slate-300 rounded-xl py-3.5 px-4 bg-white hover:bg-slate-50 hover:shadow-sm transition-all text-slate-700 font-medium"
        >
          {loading ? (
            <div className="w-5 h-5 border-2 border-slate-300 border-t-blue-600 rounded-full animate-spin"></div>
          ) : (
            <>
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="#EA4335" d="M12.545,10.239v3.821h5.445c-0.712,2.315-2.647,3.972-5.445,3.972c-3.332,0-6.033-2.701-6.033-6.032s2.701-6.032,6.033-6.032c1.498,0,2.866,0.549,3.921,1.453l2.814-2.814C17.503,2.988,15.139,2,12.545,2C7.021,2,2.543,6.477,2.543,12s4.478,10,10.002,10c8.396,0,10.249-7.85,9.426-11.748L12.545,10.239z"/>
                <path fill="#4285F4" d="M23.011,10.239c0,0-10.466,0-10.466,0v3.821h5.445c-0.198,0.644-0.542,1.218-0.999,1.69l3.35,2.698C22.091,16.73,23.513,13.785,23.011,10.239z"/>
                <path fill="#FBBC05" d="M8.513,14.072c-0.27-0.803-0.419-1.66-0.419-2.54s0.149-1.737,0.419-2.54L5.474,6.486C4.84,7.842,4.543,9.362,4.543,11.532s0.297,3.69,0.931,5.046L8.513,14.072z"/>
                <path fill="#34A853" d="M12.545,22c2.594,0,4.958-0.988,6.726-2.59l-3.35-2.698c-0.942,0.631-2.146,1.017-3.376,1.017c-2.798,0-4.733-1.657-5.445-3.972l-3.039,2.506C5.83,19.343,9.023,22,12.545,22z"/>
              </svg>
              Lanjutkan dengan Google SSO
            </>
          )}
        </button>
        <p className="text-xs text-slate-400 mt-6">Dengan masuk, Anda menyetujui Ketentuan Layanan ujian.</p>
      </div>
    </div>
  );

  const renderDashboard = () => {
    // Process leaderboard: get top 5 unique users per exam (simplified to global top 5 for MVP)
    const sortedLeaderboard = [...leaderboard]
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.timeTakenSeconds - b.timeTakenSeconds; // Tie breaker
      })
      .slice(0, 5);

    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        {/* Header */}
        <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
          <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
            <div className="flex items-center gap-2 text-blue-600 font-bold text-xl tracking-tight">
              <BookOpen size={24} /> Alpha Academy
            </div>
            <div className="flex items-center gap-4">
              <div className="hidden sm:block text-sm text-slate-600 font-medium">
                {user?.isAnonymous ? 'Siswa ID: ' + user.uid.slice(0,6) : 'Siswa Aktif'}
              </div>
              <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold border border-blue-200">
                S
              </div>
            </div>
          </div>
        </header>

        <main className="flex-grow max-w-6xl w-full mx-auto p-4 py-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Exam List (Left/Main column) */}
          <div className="lg:col-span-2 space-y-6">
            <div className="flex items-center gap-2 mb-2">
              <MonitorPlay className="text-slate-700" size={24} />
              <h2 className="text-2xl font-bold text-slate-800 tracking-tight">Daftar Try Out</h2>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {DUMMY_EXAMS.map(exam => {
                const attempts = sessions.filter(s => s.examId === exam.id).length;
                const isLocked = attempts >= exam.maxAttempts;
                const highestScore = sessions
                  .filter(s => s.examId === exam.id)
                  .sort((a, b) => b.score - a.score)[0]?.score;

                return (
                  <div key={exam.id} className={`bg-white rounded-2xl p-6 border transition-all ${isLocked ? 'border-slate-200 opacity-80' : 'border-slate-200 shadow-sm hover:shadow-md hover:border-blue-200'}`}>
                    <div className="flex justify-between items-start mb-4">
                      <span className="text-xs font-bold px-2.5 py-1 rounded-md bg-blue-50 text-blue-700 uppercase tracking-wider">
                        {exam.subject}
                      </span>
                      {highestScore !== undefined && (
                        <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded-md">
                          Skor Tertinggi: {highestScore}
                        </span>
                      )}
                    </div>
                    <h3 className="font-bold text-lg text-slate-900 leading-tight mb-2">{exam.title}</h3>
                    
                    <div className="flex items-center gap-4 text-sm text-slate-500 mb-6">
                      <div className="flex items-center gap-1.5"><Clock size={16}/> {exam.durationMinutes} Menit</div>
                      <div className="flex items-center gap-1.5"><LayoutDashboard size={16}/> {DUMMY_QUESTIONS[exam.id].length} Soal</div>
                    </div>
                    
                    <div className="flex items-center justify-between mt-auto">
                      <div className="text-sm font-medium">
                        <span className="text-slate-500">Percobaan: </span>
                        <span className={isLocked ? 'text-rose-500 font-bold' : 'text-slate-800'}>
                          {attempts} / {exam.maxAttempts}
                        </span>
                      </div>
                      <button 
                        onClick={() => { setSelectedExam(exam); setView('pre-exam'); }}
                        disabled={isLocked}
                        className={`py-2 px-5 rounded-xl font-medium text-sm transition-all ${
                          isLocked 
                            ? 'bg-slate-100 text-slate-400 cursor-not-allowed' 
                            : 'bg-slate-900 text-white hover:bg-slate-800 shadow-sm hover:shadow'
                        }`}
                      >
                        {isLocked ? 'Selesai' : (attempts > 0 ? 'Coba Lagi' : 'Mulai Ujian')}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Leaderboard (Right Sidebar) */}
          <div className="space-y-6">
             <div className="flex items-center gap-2 mb-2">
              <Trophy className="text-amber-500" size={24} />
              <h2 className="text-2xl font-bold text-slate-800 tracking-tight">Leaderboard</h2>
            </div>
            
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
              <div className="bg-slate-50 border-b border-slate-200 p-4">
                <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Top 5 Nasional (Skor Pertama)</p>
              </div>
              <div className="divide-y divide-slate-100">
                {sortedLeaderboard.length === 0 ? (
                  <div className="p-6 text-center text-slate-500 text-sm">Belum ada data tersedia.</div>
                ) : (
                  sortedLeaderboard.map((entry, idx) => (
                    <div key={idx} className="p-4 flex items-center justify-between hover:bg-slate-50/50 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                          idx === 0 ? 'bg-amber-100 text-amber-600' :
                          idx === 1 ? 'bg-slate-200 text-slate-600' :
                          idx === 2 ? 'bg-orange-100 text-orange-700' : 'bg-slate-50 text-slate-400'
                        }`}>
                          {idx + 1}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-800 line-clamp-1">{entry.userName}</p>
                          <p className="text-xs text-slate-500">{(entry.timeTakenSeconds / 60).toFixed(1)} menit</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-blue-600">{entry.score}</p>
                        <p className="text-[10px] text-slate-400 font-medium">PTS</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  };

  const renderPreExam = () => {
    if (!selectedExam) return null;
    const attempts = sessions.filter(s => s.examId === selectedExam.id).length;

    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <div className="bg-white w-full max-w-2xl rounded-3xl shadow-lg border border-slate-200 p-8">
          <button onClick={() => setView('dashboard')} className="flex items-center text-sm font-medium text-slate-500 hover:text-slate-800 mb-6 transition-colors">
            <ChevronLeft size={16} className="mr-1" /> Kembali ke Dashboard
          </button>
          
          <div className="mb-8">
            <span className="text-xs font-bold px-3 py-1 rounded-full bg-blue-50 text-blue-700 uppercase tracking-wider mb-3 inline-block">
              Persiapan Ujian
            </span>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight leading-tight mb-2">{selectedExam.title}</h1>
            <p className="text-slate-500">Harap baca instruksi dengan seksama sebelum memulai.</p>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-8">
            <div className="bg-slate-50 rounded-2xl p-5 border border-slate-100">
              <div className="text-slate-500 text-sm font-medium mb-1 flex items-center gap-2"><Clock size={16}/> Durasi Ujian</div>
              <div className="text-2xl font-bold text-slate-800">{selectedExam.durationMinutes} Menit</div>
            </div>
            <div className="bg-slate-50 rounded-2xl p-5 border border-slate-100">
              <div className="text-slate-500 text-sm font-medium mb-1 flex items-center gap-2"><LayoutDashboard size={16}/> Sisa Percobaan</div>
              <div className="text-2xl font-bold text-slate-800">{selectedExam.maxAttempts - attempts} Kali</div>
            </div>
          </div>

          <div className="bg-amber-50 rounded-2xl p-5 border border-amber-100 mb-8">
            <h3 className="font-bold text-amber-800 flex items-center gap-2 mb-2">
              <AlertTriangle size={18} /> Peraturan Anti-Kecurangan
            </h3>
            <ul className="list-disc list-inside text-sm text-amber-700 space-y-1">
              <li>Sistem memantau aktivitas layar Anda secara real-time.</li>
              <li>Berpindah tab atau menutup jendela akan memicu peringatan.</li>
              <li>Ujian akan otomatis dikumpulkan jika peringatan melebihi batas.</li>
              <li>Waktu berjalan di server, me-refresh halaman tidak mengulang waktu.</li>
            </ul>
          </div>

          <div className="flex gap-4">
            <button 
              onClick={() => handleStartExam(selectedExam)}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3.5 rounded-xl shadow-sm transition-colors text-lg"
            >
              Mulai Ujian Sekarang
            </button>
          </div>
        </div>
      </div>
    );
  };

  const TimerComponent = ({ timeLeft, onTimeUp }) => {
    const [time, setTime] = useState(timeLeft);
    
    useEffect(() => {
      if (time <= 0) {
        onTimeUp();
        return;
      }
      const timerId = setInterval(() => setTime(t => t - 1), 1000);
      return () => clearInterval(timerId);
    }, [time, onTimeUp]);

    const mins = Math.floor(time / 60);
    const secs = time % 60;
    const isWarning = time < 60; // Less than 1 min red warning

    return (
      <div className={`flex items-center gap-2 font-mono font-bold px-4 py-2 rounded-lg border ${
        isWarning ? 'bg-rose-50 text-rose-600 border-rose-200 animate-pulse' : 'bg-slate-100 text-slate-700 border-slate-200'
      }`}>
        <Clock size={18} />
        {mins.toString().padStart(2, '0')}:{secs.toString().padStart(2, '0')}
      </div>
    );
  };

  const renderExam = () => {
    if (!examState) return null;
    const { questions, answers, flagged, currentIndex, warnings } = examState;
    const currentQ = questions[currentIndex];
    
    // Page Visibility API Anti-Cheating
    // Using a ref to hold current state avoids stale closure issues in event listener
    const examStateRef = useRef(examState);
    useEffect(() => {
      examStateRef.current = examState;
    }, [examState]);

    useEffect(() => {
      const handleVisibilityChange = () => {
        if (document.hidden && view === 'exam') {
          const currentState = examStateRef.current;
          const newWarnings = currentState.warnings + 1;
          
          setExamState(prev => ({ ...prev, warnings: newWarnings }));
          
          if (newWarnings >= 3) {
             // Force auto submit on 3rd warning
             submitExam(true, { ...currentState, warnings: newWarnings });
             setShowModal({
               show: true,
               title: 'Pelanggaran Berat!',
               message: 'Anda terdeteksi meninggalkan layar ujian berulang kali. Ujian Anda telah dikumpulkan secara otomatis oleh sistem.',
               hideCancel: true
             });
          } else {
            setShowModal({
              show: true,
              title: 'Peringatan Anti-Kecurangan',
              message: `Anda terdeteksi berpindah tab/aplikasi. Peringatan ke-${newWarnings} dari 3. Jika mencapai 3, ujian akan otomatis dikumpulkan.`,
              hideCancel: true
            });
          }
        }
      };

      document.addEventListener('visibilitychange', handleVisibilityChange);
      return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [view]); // Dependencies handled via ref

    const handleAnswer = (optIndex) => {
      setExamState(prev => ({
        ...prev,
        answers: { ...prev.answers, [currentIndex]: optIndex }
      }));
    };

    const toggleFlag = () => {
      setExamState(prev => ({
        ...prev,
        flagged: { ...prev.flagged, [currentIndex]: !prev.flagged[currentIndex] }
      }));
    };

    const confirmSubmit = () => {
      const answeredCount = Object.keys(answers).length;
      const total = questions.length;
      const unans = total - answeredCount;
      
      setShowModal({
        show: true,
        title: 'Konfirmasi Kumpul',
        message: unans > 0 
          ? `Masih ada ${unans} soal yang belum dijawab. Apakah Anda yakin ingin mengumpulkan ujian ini?` 
          : `Anda telah menjawab semua soal. Apakah Anda yakin ingin menyelesaikan ujian?`,
        onConfirm: () => submitExam(false, examState)
      });
    };

    return (
      <div className="h-screen flex flex-col bg-slate-50 overflow-hidden">
        {/* Exam Header */}
        <header className="bg-white border-b border-slate-200 h-16 shrink-0 flex items-center justify-between px-4 lg:px-6 z-20 shadow-sm">
          <div className="font-bold text-slate-800 line-clamp-1 mr-4">{examState.exam.title}</div>
          <div className="flex items-center gap-4">
            {warnings > 0 && (
              <div className="hidden sm:flex items-center gap-1.5 text-xs font-bold text-rose-600 bg-rose-50 px-3 py-1.5 rounded-full border border-rose-200">
                <AlertTriangle size={14} /> Peringatan: {warnings}/3
              </div>
            )}
            <TimerComponent timeLeft={examState.timeLeft} onTimeUp={() => submitExam(true, examState)} />
            <button 
              onClick={confirmSubmit}
              className="bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-bold py-2 px-4 rounded-lg transition-colors shadow-sm"
            >
              Kumpulkan
            </button>
          </div>
        </header>

        {/* Main Content Layout */}
        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden relative">
          
          {/* Main Question Area */}
          <main className="flex-1 overflow-y-auto p-4 lg:p-8 pb-32 lg:pb-8">
            <div className="max-w-3xl mx-auto">
              <div className="mb-6 flex justify-between items-center">
                <h2 className="text-lg font-bold text-slate-500 uppercase tracking-wider">Soal Nomor {currentIndex + 1}</h2>
                <button 
                  onClick={toggleFlag}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                    flagged[currentIndex] 
                      ? 'bg-amber-50 text-amber-600 border-amber-200' 
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <Flag size={16} className={flagged[currentIndex] ? 'fill-amber-600' : ''} /> 
                  {flagged[currentIndex] ? 'Ditandai Ragu' : 'Ragu-ragu'}
                </button>
              </div>

              {/* Question Text */}
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 mb-6 text-slate-800 text-lg leading-relaxed">
                {currentQ.text}
              </div>

              {/* Options */}
              <div className="space-y-3">
                {currentQ.options.map((opt, idx) => {
                  const isSelected = answers[currentIndex] === idx;
                  const letter = String.fromCharCode(65 + idx); // A, B, C...
                  return (
                    <div 
                      key={idx} 
                      onClick={() => handleAnswer(idx)}
                      className={`cursor-pointer group flex items-start p-4 rounded-xl border transition-all ${
                        isSelected 
                          ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' 
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm mr-4 transition-colors ${
                        isSelected ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500 group-hover:bg-slate-200'
                      }`}>
                        {letter}
                      </div>
                      <div className={`mt-1 font-medium ${isSelected ? 'text-blue-900' : 'text-slate-700'}`}>
                        {opt}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </main>

          {/* Sidebar / Bottom Nav Panel (Question Grid) */}
          <aside className="lg:w-80 bg-white border-t lg:border-t-0 lg:border-l border-slate-200 p-4 lg:p-6 shrink-0 flex flex-col z-10 absolute bottom-0 w-full lg:relative lg:h-full transition-transform">
            <h3 className="font-bold text-slate-800 mb-4 hidden lg:block">Navigasi Soal</h3>
            <div className="grid grid-cols-5 lg:grid-cols-5 gap-2 overflow-y-auto pb-16 lg:pb-0">
              {questions.map((_, idx) => {
                const isAnswered = answers[idx] !== undefined;
                const isFlagged = flagged[idx];
                const isActive = currentIndex === idx;
                
                let baseStyle = "h-10 w-full rounded-lg font-bold text-sm flex justify-center items-center relative transition-all border ";
                
                if (isActive) baseStyle += "ring-2 ring-blue-500 ring-offset-1 ";
                
                if (isFlagged) {
                  baseStyle += "bg-amber-100 border-amber-300 text-amber-800";
                } else if (isAnswered) {
                  baseStyle += "bg-blue-600 border-blue-600 text-white";
                } else {
                  baseStyle += "bg-white border-slate-300 text-slate-600 hover:bg-slate-50";
                }

                return (
                  <button 
                    key={idx} 
                    onClick={() => setExamState(prev => ({...prev, currentIndex: idx}))}
                    className={baseStyle}
                  >
                    {idx + 1}
                    {isFlagged && <div className="absolute -top-1 -right-1 w-3 h-3 bg-amber-500 rounded-full border-2 border-white"></div>}
                  </button>
                );
              })}
            </div>
            
            {/* Prev/Next Buttons for Mobile (Fixed bottom) */}
            <div className="absolute bottom-0 left-0 w-full bg-white border-t border-slate-200 p-3 flex justify-between lg:static lg:border-none lg:p-0 lg:mt-6 lg:bg-transparent shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] lg:shadow-none">
               <button 
                disabled={currentIndex === 0}
                onClick={() => setExamState(prev => ({...prev, currentIndex: prev.currentIndex - 1}))}
                className="flex items-center justify-center gap-1 px-4 py-2 bg-slate-100 text-slate-700 rounded-lg font-medium hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed flex-1 mr-2"
              >
                <ChevronLeft size={18} /> Prev
              </button>
              <button 
                disabled={currentIndex === questions.length - 1}
                onClick={() => setExamState(prev => ({...prev, currentIndex: prev.currentIndex + 1}))}
                className="flex items-center justify-center gap-1 px-4 py-2 bg-blue-50 text-blue-700 rounded-lg font-medium hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed flex-1 ml-2"
              >
                Next <ChevronRight size={18} />
              </button>
            </div>
          </aside>
        </div>
      </div>
    );
  };

  const renderResult = () => {
    if (!examState || !examState.result) return null;
    const res = examState.result;

    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white w-full max-w-lg rounded-3xl shadow-xl border border-slate-200 p-8 text-center relative overflow-hidden">
           {/* Decorative Header */}
           <div className={`absolute top-0 left-0 w-full h-3 ${res.isPass ? 'bg-emerald-500' : 'bg-rose-500'}`}></div>
           
           <div className={`w-24 h-24 rounded-full mx-auto flex items-center justify-center mb-6 shadow-md border-4 border-white z-10 relative ${
             res.isPass ? 'bg-emerald-100 text-emerald-500' : 'bg-rose-100 text-rose-500'
           }`}>
             {res.isPass ? <CheckCircle size={48} /> : <XCircle size={48} />}
           </div>

           <h2 className="text-3xl font-bold text-slate-800 mb-2">Ujian Selesai!</h2>
           <p className="text-slate-500 mb-8">{res.examTitle}</p>

           <div className="bg-slate-50 border border-slate-100 rounded-2xl p-6 mb-8 relative">
              <p className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-1">Skor Akhir</p>
              <p className={`text-7xl font-black tracking-tighter mb-4 ${res.isPass ? 'text-emerald-500' : 'text-rose-500'}`}>
                {res.score}
              </p>
              
              <div className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-bold border ${
                res.isPass ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-rose-50 border-rose-200 text-rose-700'
              }`}>
                {res.isPass ? 'LULUS PASSING GRADE' : 'TIDAK LULUS'}
              </div>
           </div>

           <div className="grid grid-cols-2 gap-4 mb-8 text-left">
              <div className="p-4 border border-slate-100 rounded-xl bg-white">
                <p className="text-xs text-slate-500 font-medium mb-1 flex items-center gap-1"><Clock size={14}/> Waktu</p>
                <p className="font-bold text-slate-800">{Math.floor(res.timeTakenSeconds / 60)}m {res.timeTakenSeconds % 60}s</p>
              </div>
              <div className="p-4 border border-slate-100 rounded-xl bg-white">
                <p className="text-xs text-slate-500 font-medium mb-1 flex items-center gap-1"><LayoutDashboard size={14}/> Percobaan</p>
                <p className="font-bold text-slate-800">Ke-{res.attemptNumber}</p>
              </div>
           </div>

           <button 
            onClick={() => { setExamState(null); setView('dashboard'); }}
            className="w-full bg-slate-900 hover:bg-slate-800 text-white font-semibold py-3.5 rounded-xl transition-colors shadow-sm text-lg"
           >
             Kembali ke Dashboard
           </button>
        </div>
      </div>
    );
  };

  return (
    <>
      {view === 'login' && renderLogin()}
      {view === 'dashboard' && renderDashboard()}
      {view === 'pre-exam' && renderPreExam()}
      {view === 'exam' && renderExam()}
      {view === 'result' && renderResult()}
      <Modal />
    </>
  );
}