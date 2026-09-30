import React, { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import QRCode from "qrcode";
import { Html5Qrcode } from "html5-qrcode";
import * as XLSX from "xlsx";
import { getMessaging, getToken, isSupported } from "firebase/messaging";
import { auth, db, app } from "./firebase";
import "./style.css";

const GROUPS = [
  { title: "Early Years", classes: ["Nursery", "LKG", "UKG"], icon: "🧸" },
  { title: "Primary School", classes: ["Class 1", "Class 2", "Class 3", "Class 4", "Class 5"], icon: "🎨" },
  { title: "Middle School", classes: ["Class 6", "Class 7", "Class 8"], icon: "🔬" },
  { title: "High School", classes: ["Class 9", "Class 10"], icon: "🚀" },
];

const CLASS_NAMES = GROUPS.flatMap((g) => g.classes);
const SECTIONS = ["A", "B", "C", "D"];
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const EMPTY_STUDENT = {
  name: "",
  className: "Class 1",
  section: "A",
  roll: "",
  parent: "",
  phone: "",
  address: "",
  photo: "",
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(value) {
  if (!value) return "";
  try {
    if (typeof value.toDate === "function") return value.toDate().toLocaleDateString("en-IN");
    return new Date(value).toLocaleDateString("en-IN");
  } catch {
    return "";
  }
}

function percent(value, total) {
  if (!total) return 0;
  return Math.round((Number(value || 0) / Number(total || 1)) * 100);
}

function makeStudentCode() {
  if (globalThis.crypto?.randomUUID) return `BVB-${crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
  return `BVB-${Math.random().toString(36).slice(2, 12).toUpperCase()}`;
}

async function commitOps(ops) {
  const chunkSize = 400;
  for (let i = 0; i < ops.length; i += chunkSize) {
    const batch = writeBatch(db);
    ops.slice(i, i + chunkSize).forEach((op) => {
      if (op.type === "delete") batch.delete(op.ref);
      else batch.set(op.ref, op.data, op.merge ? { merge: true } : undefined);
    });
    await batch.commit();
  }
}

function scoreTone(value) {
  if (value >= 75) return "good";
  if (value >= 40) return "warn";
  return "low";
}

export default function App() {
  const [tab, setTab] = useState("Home");
  const [teacherModule, setTeacherModule] = useState("Overview");
  const [group, setGroup] = useState(GROUPS[1]);

  const [authReady, setAuthReady] = useState(false);
  const [teacherLogged, setTeacherLogged] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");

  const [students, setStudents] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [marks, setMarks] = useState([]);
  const [homework, setHomework] = useState([]);
  const [notices, setNotices] = useState([]);
  const [timetable, setTimetable] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [loadingTeacherData, setLoadingTeacherData] = useState(false);

  const [classFilter, setClassFilter] = useState("All");
  const [sectionFilter, setSectionFilter] = useState("All");
  const [dateFilter, setDateFilter] = useState(todayISO());
  const [attendanceDraft, setAttendanceDraft] = useState({});

  const [form, setForm] = useState(EMPTY_STUDENT);
  const [saving, setSaving] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [selectedQR, setSelectedQR] = useState("");
  const [message, setMessage] = useState("");

  const [marksForm, setMarksForm] = useState({
    studentCode: "",
    exam: "Quarterly",
    subject: "English",
    obtained: "",
    total: "100",
    notifyParent: true,
  });

  const [homeworkForm, setHomeworkForm] = useState({
    title: "",
    subject: "English",
    description: "",
    dueDate: "",
    targetType: "class",
    targetClass: "Class 1",
    targetSection: "A",
    targetStudentCode: "",
  });

  const [noticeForm, setNoticeForm] = useState({
    title: "",
    message: "",
    targetType: "all",
    targetClass: "Class 1",
    targetSection: "A",
    targetStudentCode: "",
  });

  const [timetableForm, setTimetableForm] = useState({
    className: "Class 1",
    section: "A",
    day: "Monday",
    time: "09:00",
    subject: "English",
    room: "101",
    teacher: "Class Teacher",
  });

  const [reportClass, setReportClass] = useState("All");
  const [reportSection, setReportSection] = useState("All");

  const [cameraError, setCameraError] = useState("");
  const [studentCameraOpen, setStudentCameraOpen] = useState(false);
  const [studentCameraStream, setStudentCameraStream] = useState(null);
  const [parentCodeInput, setParentCodeInput] = useState("");
  const [parentStudent, setParentStudent] = useState(null);
  const [parentError, setParentError] = useState("");
  const [parentLoading, setParentLoading] = useState(false);
  const parentScannerRef = useRef(null);
  const parentGalleryRef = useRef(null);

  const [browserNotificationState, setBrowserNotificationState] = useState(
    typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  );

  const filteredStudents = useMemo(
    () => students.filter((s) =>
      (classFilter === "All" || s.className === classFilter) &&
      (sectionFilter === "All" || s.section === sectionFilter),
    ),
    [students, classFilter, sectionFilter],
  );

  const reportStudents = useMemo(
    () => students.filter((s) =>
      (reportClass === "All" || s.className === reportClass) &&
      (reportSection === "All" || s.section === reportSection),
    ),
    [students, reportClass, reportSection],
  );

  function studentAttendanceStats(studentCode) {
    const rows = attendance.filter((a) => a.studentCode === studentCode);
    const present = rows.filter((a) => a.status === "Present").length;
    const absent = rows.filter((a) => a.status === "Absent").length;
    const leave = rows.filter((a) => a.status === "Leave").length;
    return { total: rows.length, present, absent, leave, percentage: percent(present, rows.length) };
  }

  function studentMarksStats(studentCode) {
    const rows = marks.filter((m) => m.studentCode === studentCode);
    const obtained = rows.reduce((sum, m) => sum + Number(m.obtained || 0), 0);
    const total = rows.reduce((sum, m) => sum + Number(m.total || 0), 0);
    return { count: rows.length, obtained, total, percentage: percent(obtained, total) };
  }

  function filteredMarks() {
    return marks.filter((m) =>
      (classFilter === "All" || m.className === classFilter) &&
      (sectionFilter === "All" || m.section === sectionFilter),
    );
  }

  function overviewAttendancePercentage() {
    const rows = attendance.filter((a) =>
      (classFilter === "All" || a.className === classFilter) &&
      (sectionFilter === "All" || a.section === sectionFilter),
    );
    return percent(rows.filter((r) => r.status === "Present").length, rows.length);
  }

  async function loadRootCollection(name, maxRows = 2000) {
    const snapshot = await getDocs(query(collection(db, name), limit(maxRows)));
    return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  async function loadTeacherData() {
    setLoadingTeacherData(true);
    try {
      const [studentRows, attendanceRows, markRows, homeworkRows, noticeRows, timetableRows, notificationRows] = await Promise.all([
        loadRootCollection("students"),
        loadRootCollection("attendance"),
        loadRootCollection("marks"),
        loadRootCollection("homework"),
        loadRootCollection("notices"),
        loadRootCollection("timetable"),
        loadRootCollection("notifications"),
      ]);
      setStudents(studentRows.sort((a, b) => String(a.className).localeCompare(String(b.className)) || String(a.section).localeCompare(String(b.section)) || String(a.roll).localeCompare(String(b.roll), undefined, { numeric: true })));
      setAttendance(attendanceRows);
      setMarks(markRows);
      setHomework(homeworkRows);
      setNotices(noticeRows);
      setTimetable(timetableRows);
      setNotifications(notificationRows);
    } catch (error) {
      console.error(error);
      setMessage(`Could not load dashboard data: ${error.message || "Check Firestore rules."}`);
    } finally {
      setLoadingTeacherData(false);
    }
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setAuthReady(true);
      if (!user) {
        setTeacherLogged(false);
        return;
      }
      try {
        const staffSnap = await getDoc(doc(db, "staff", user.uid));
        const role = staffSnap.exists() ? staffSnap.data().role : "";
        if (["teacher", "admin"].includes(role)) {
          setTeacherLogged(true);
          await loadTeacherData();
        } else {
          await signOut(auth);
          setTeacherLogged(false);
          setLoginError("This account is not registered in the school staff collection.");
        }
      } catch (error) {
        console.error(error);
        setTeacherLogged(false);
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const queryCode = new URLSearchParams(window.location.search).get("student");
    if (queryCode) {
      setTab("Parent Portal");
      setParentCodeInput(queryCode);
      loadParentPortal(queryCode);
    }
  }, []);

  useEffect(() => () => {
    if (studentCameraStream) studentCameraStream.getTracks().forEach((track) => track.stop());
    if (parentScannerRef.current) parentScannerRef.current.stop().catch(() => {});
  }, [studentCameraStream]);

  function navigate(nextTab) {
    setTab(nextTab);
    setMessage("");
    if (nextTab !== "Parent Portal") stopParentScanner();
  }

  async function teacherLogin(event) {
    event.preventDefault();
    setLoginError("");
    try {
      const credential = await signInWithEmailAndPassword(auth, loginEmail.trim(), loginPassword);
      const staffSnap = await getDoc(doc(db, "staff", credential.user.uid));
      const role = staffSnap.exists() ? staffSnap.data().role : "";
      if (!["teacher", "admin"].includes(role)) {
        await signOut(auth);
        throw new Error("This login exists, but it is not configured as teacher/admin staff.");
      }
      setTeacherLogged(true);
      setTeacherModule("Overview");
      setLoginEmail("");
      setLoginPassword("");
      setTab("Teacher Login");
      await loadTeacherData();
    } catch (error) {
      setLoginError(error.message || "Teacher login failed.");
    }
  }

  async function teacherLogout() {
    await signOut(auth);
    setTeacherLogged(false);
    setTab("Home");
  }

  function field(event) {
    setForm((prev) => ({ ...prev, [event.target.name]: event.target.value }));
  }

  async function compressPhoto(dataUrl) {
    if (!dataUrl) return "";
    return new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        const maxWidth = 480;
        const maxHeight = 640;
        const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.62));
      };
      image.onerror = () => resolve("");
      image.src = dataUrl;
    });
  }

  async function addStudent(event) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      if (!form.name.trim() || !form.roll.trim() || !form.phone.trim()) {
        throw new Error("Student name, roll number and parent phone are required.");
      }
      const studentCode = makeStudentCode();
      const photo = form.photo ? await compressPhoto(form.photo) : "";
      const record = {
        studentCode,
        name: form.name.trim(),
        className: form.className,
        section: form.section,
        roll: form.roll.trim(),
        parent: form.parent.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
        photo,
        createdAt: serverTimestamp(),
        createdBy: auth.currentUser?.uid || "",
      };

      await setDoc(doc(db, "students", studentCode), record);
      setClassFilter(form.className);
      setSectionFilter(form.section);

      const localRecord = { ...record, id: studentCode, createdAt: new Date() };
      setStudents((prev) => [localRecord, ...prev]);
      setForm({ ...EMPTY_STUDENT, className: form.className, section: form.section });
      await generateQR(localRecord);
      setSelectedStudent(localRecord);
      setMessage(`Student created successfully. ${form.className} • Section ${form.section} is now selected.`);
      await loadTeacherData();
    } catch (error) {
      console.error(error);
      setMessage(`Could not create student: ${error.message || "Unknown error"}`);
    } finally {
      setSaving(false);
    }
  }

  async function generateQR(student) {
    const url = `${window.location.origin}${window.location.pathname}?student=${encodeURIComponent(student.studentCode)}`;
    const qrData = await QRCode.toDataURL(url, {
      width: 360,
      margin: 2,
      errorCorrectionLevel: "H",
      color: { dark: "#13356d", light: "#ffffff" },
    });
    setSelectedQR(qrData);
    return qrData;
  }

  function openMarksForStudent(student) {
    setClassFilter(student.className);
    setSectionFilter(student.section);
    setMarksForm((prev) => ({ ...prev, studentCode: student.studentCode }));
    setTeacherModule("Marks");
  }

  function openAttendanceForStudent(student) {
    setClassFilter(student.className);
    setSectionFilter(student.section);
    setTeacherModule("Attendance");
  }

  function setAllAttendance(status) {
    const next = {};
    filteredStudents.forEach((student) => {
      next[student.studentCode] = status;
    });
    setAttendanceDraft(next);
  }

  async function saveAttendance() {
    if (!filteredStudents.length) {
      setMessage("No students are available for the current Class / Section filter.");
      return;
    }

    const operations = [];
    filteredStudents.forEach((student) => {
      const status = attendanceDraft[student.studentCode] || "Present";
      const recordId = `${student.studentCode}_${dateFilter}`;
      const record = {
        studentCode: student.studentCode,
        studentName: student.name,
        className: student.className,
        section: student.section,
        attendanceDate: dateFilter,
        status,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      operations.push({ type: "set", ref: doc(db, "attendance", recordId), data: record, merge: true });
      operations.push({ type: "set", ref: doc(db, "students", student.studentCode, "attendance", recordId), data: record, merge: true });

      const notificationId = `absence_${student.studentCode}_${dateFilter}`;
      const rootNotificationRef = doc(db, "notifications", notificationId);
      const nestedNotificationRef = doc(db, "students", student.studentCode, "notifications", notificationId);

      if (status === "Absent") {
        const notification = {
          studentCode: student.studentCode,
          type: "absence",
          title: "Attendance Alert",
          body: `${student.name} was marked absent on ${dateFilter}.`,
          createdAt: serverTimestamp(),
          relatedId: recordId,
        };
        operations.push({ type: "set", ref: rootNotificationRef, data: notification, merge: true });
        operations.push({ type: "set", ref: nestedNotificationRef, data: notification, merge: true });
      } else {
        operations.push({ type: "delete", ref: rootNotificationRef });
        operations.push({ type: "delete", ref: nestedNotificationRef });
      }
    });

    try {
      await commitOps(operations);
      setMessage(`Attendance saved for ${filteredStudents.length} students. Parent alerts were updated for absent students.`);
      await loadTeacherData();
    } catch (error) {
      console.error(error);
      setMessage(`Attendance could not be saved: ${error.message}`);
    }
  }

  async function saveMark(event) {
    event.preventDefault();
    const student = students.find((s) => s.studentCode === marksForm.studentCode);
    const obtained = Number(marksForm.obtained);
    const total = Number(marksForm.total);
    if (!student || !marksForm.subject.trim() || Number.isNaN(obtained) || Number.isNaN(total) || total <= 0 || obtained < 0 || obtained > total) {
      setMessage("Choose a student and enter valid marks.");
      return;
    }

    const markRef = doc(collection(db, "marks"));
    const record = {
      studentCode: student.studentCode,
      studentName: student.name,
      className: student.className,
      section: student.section,
      exam: marksForm.exam,
      subject: marksForm.subject.trim(),
      obtained,
      total,
      percentage: Number(((obtained / total) * 100).toFixed(2)),
      createdAt: serverTimestamp(),
    };

    try {
      const operations = [
        { type: "set", ref: markRef, data: record },
        { type: "set", ref: doc(db, "students", student.studentCode, "marks", markRef.id), data: record },
      ];
      if (marksForm.notifyParent) {
        const notificationId = `mark_${markRef.id}`;
        const notification = {
          studentCode: student.studentCode,
          type: "marks",
          title: `${marksForm.subject} marks updated`,
          body: `${student.name} received ${obtained}/${total} in ${marksForm.exam}.`,
          createdAt: serverTimestamp(),
          relatedId: markRef.id,
        };
        operations.push({ type: "set", ref: doc(db, "notifications", notificationId), data: notification });
        operations.push({ type: "set", ref: doc(db, "students", student.studentCode, "notifications", notificationId), data: notification });
      }
      await commitOps(operations);
      setMarksForm((prev) => ({ ...prev, obtained: "" }));
      setMessage(`Marks saved for ${student.name}.`);
      await loadTeacherData();
    } catch (error) {
      console.error(error);
      setMessage(`Marks could not be saved: ${error.message}`);
    }
  }

  function targetStudents(type, cls, section, studentCode) {
    if (type === "all") return students;
    if (type === "student") return students.filter((student) => student.studentCode === studentCode);
    return students.filter((student) => student.className === cls && (section === "All" || student.section === section));
  }

  async function postHomework(event) {
    event.preventDefault();
    const targets = targetStudents(homeworkForm.targetType, homeworkForm.targetClass, homeworkForm.targetSection, homeworkForm.targetStudentCode);
    if (!homeworkForm.title.trim() || !targets.length) {
      setMessage("Enter a homework title and choose a valid target.");
      return;
    }

    const operations = [];
    const createdAt = serverTimestamp();
    targets.forEach((student) => {
      const rootRef = doc(collection(db, "homework"));
      const record = {
        title: homeworkForm.title.trim(),
        subject: homeworkForm.subject.trim(),
        description: homeworkForm.description.trim(),
        dueDate: homeworkForm.dueDate,
        targetType: homeworkForm.targetType,
        targetClass: homeworkForm.targetClass,
        targetSection: homeworkForm.targetSection,
        targetStudentCode: student.studentCode,
        studentName: student.name,
        studentCode: student.studentCode,
        createdAt,
      };
      operations.push({ type: "set", ref: rootRef, data: record });
      operations.push({ type: "set", ref: doc(db, "students", student.studentCode, "homework", rootRef.id), data: record });

      const notificationId = `homework_${rootRef.id}`;
      const notification = {
        studentCode: student.studentCode,
        type: "homework",
        title: `New ${homeworkForm.subject} homework`,
        body: homeworkForm.title.trim(),
        createdAt,
        relatedId: rootRef.id,
      };
      operations.push({ type: "set", ref: doc(db, "notifications", notificationId), data: notification });
      operations.push({ type: "set", ref: doc(db, "students", student.studentCode, "notifications", notificationId), data: notification });
    });

    try {
      await commitOps(operations);
      setHomeworkForm((prev) => ({ ...prev, title: "", description: "", dueDate: "" }));
      setMessage(`Homework posted to ${targets.length} student(s).`);
      await loadTeacherData();
    } catch (error) {
      console.error(error);
      setMessage(`Homework could not be posted: ${error.message}`);
    }
  }

  async function postNotice(event) {
    event.preventDefault();
    const targets = targetStudents(noticeForm.targetType, noticeForm.targetClass, noticeForm.targetSection, noticeForm.targetStudentCode);
    if (!noticeForm.title.trim() || !noticeForm.message.trim() || !targets.length) {
      setMessage("Enter the notice details and choose a valid target.");
      return;
    }

    const operations = [];
    const createdAt = serverTimestamp();
    targets.forEach((student) => {
      const rootRef = doc(collection(db, "notices"));
      const record = {
        title: noticeForm.title.trim(),
        message: noticeForm.message.trim(),
        targetType: noticeForm.targetType,
        targetClass: noticeForm.targetClass,
        targetSection: noticeForm.targetSection,
        targetStudentCode: student.studentCode,
        studentCode: student.studentCode,
        createdAt,
      };
      operations.push({ type: "set", ref: rootRef, data: record });
      operations.push({ type: "set", ref: doc(db, "students", student.studentCode, "notices", rootRef.id), data: record });

      const notificationId = `notice_${rootRef.id}`;
      const notification = {
        studentCode: student.studentCode,
        type: "notice",
        title: noticeForm.title.trim(),
        body: noticeForm.message.trim(),
        createdAt,
        relatedId: rootRef.id,
      };
      operations.push({ type: "set", ref: doc(db, "notifications", notificationId), data: notification });
      operations.push({ type: "set", ref: doc(db, "students", student.studentCode, "notifications", notificationId), data: notification });
    });

    try {
      await commitOps(operations);
      setNoticeForm((prev) => ({ ...prev, title: "", message: "" }));
      setMessage(`Notice published to ${targets.length} student(s).`);
      await loadTeacherData();
    } catch (error) {
      console.error(error);
      setMessage(`Notice could not be published: ${error.message}`);
    }
  }

  async function addTimetable(event) {
    event.preventDefault();
    const targets = students.filter((student) => student.className === timetableForm.className && student.section === timetableForm.section);
    if (!targets.length) {
      setMessage("No students exist in the selected class and section yet.");
      return;
    }
    const rootRef = doc(collection(db, "timetable"));
    const base = { ...timetableForm, createdAt: serverTimestamp() };
    const operations = [{ type: "set", ref: rootRef, data: base }];
    targets.forEach((student) => {
      operations.push({ type: "set", ref: doc(db, "students", student.studentCode, "timetable", rootRef.id), data: { ...base, studentCode: student.studentCode } });
    });
    try {
      await commitOps(operations);
      setMessage(`Timetable saved for ${timetableForm.className} • Section ${timetableForm.section}.`);
      await loadTeacherData();
    } catch (error) {
      setMessage(`Timetable could not be saved: ${error.message}`);
    }
  }

  async function generateDemoData() {
    if (!teacherLogged) return;
    const demoStudents = [
      ["Aarav Sharma", "Class 1", "A", "1"],
      ["Ananya Reddy", "Class 1", "A", "2"],
      ["Ishaan Kumar", "Class 1", "B", "1"],
      ["Diya Rao", "Class 2", "A", "1"],
      ["Rahul Verma", "Class 5", "B", "1"],
      ["Meera Singh", "Class 10", "A", "1"],
    ];
    try {
      const existingCodes = new Set(students.map((s) => `${s.name}|${s.className}|${s.section}`));
      for (const [name, className, section, roll] of demoStudents) {
        if (existingCodes.has(`${name}|${className}|${section}`)) continue;
        const code = makeStudentCode();
        await setDoc(doc(db, "students", code), {
          studentCode: code,
          name,
          className,
          section,
          roll,
          parent: "Demo Parent",
          phone: "9000000000",
          address: "Demo / Academic Dataset",
          photo: "",
          createdAt: serverTimestamp(),
          createdBy: auth.currentUser?.uid || "",
          dataset: "Demo / Academic Dataset",
        });
      }
      await loadTeacherData();
      setMessage("Demo / Academic Dataset loaded successfully.");
    } catch (error) {
      setMessage(`Demo data could not be loaded: ${error.message}`);
    }
  }

  function exportExcel() {
    const selectedCodes = new Set(reportStudents.map((s) => s.studentCode));
    const wb = XLSX.utils.book_new();
    const addSheet = (name, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ Info: "No records" }]), name.slice(0, 31));

    addSheet("Students", reportStudents.map((s) => ({
      StudentCode: s.studentCode,
      StudentName: s.name,
      Class: s.className,
      Section: s.section,
      Roll: s.roll,
      Parent: s.parent,
      Phone: s.phone,
      Address: s.address,
    })));

    addSheet("Attendance", attendance.filter((a) => selectedCodes.has(a.studentCode)).map((a) => ({
      StudentCode: a.studentCode,
      StudentName: a.studentName,
      Class: a.className,
      Section: a.section,
      Date: a.attendanceDate,
      Status: a.status,
    })));

    addSheet("Marks", marks.filter((m) => selectedCodes.has(m.studentCode)).map((m) => ({
      StudentCode: m.studentCode,
      StudentName: m.studentName,
      Class: m.className,
      Section: m.section,
      Exam: m.exam,
      Subject: m.subject,
      Obtained: m.obtained,
      Total: m.total,
      Percentage: m.percentage,
    })));

    addSheet("Homework", homework.filter((h) => selectedCodes.has(h.studentCode)).map((h) => ({
      StudentCode: h.studentCode,
      Title: h.title,
      Subject: h.subject,
      Description: h.description,
      DueDate: h.dueDate,
    })));

    addSheet("Notices", notices.filter((n) => selectedCodes.has(n.studentCode)).map((n) => ({
      StudentCode: n.studentCode,
      Title: n.title,
      Message: n.message,
      Published: formatDate(n.createdAt),
    })));

    addSheet("Timetable", timetable.map((t) => ({ Class: t.className, Section: t.section, Day: t.day, Time: t.time, Subject: t.subject, Room: t.room, Teacher: t.teacher })));
    addSheet("Notifications", notifications.filter((n) => selectedCodes.has(n.studentCode)).map((n) => ({ StudentCode: n.studentCode, Type: n.type, Title: n.title, Message: n.body, Date: formatDate(n.createdAt) })));

    XLSX.writeFile(wb, `BVB_School_Report_${Date.now()}.xlsx`);
  }

  async function openStudentCamera() {
    setCameraError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      setStudentCameraStream(stream);
      setStudentCameraOpen(true);
      setTimeout(() => {
        const video = document.getElementById("student-camera-video");
        if (video) {
          video.srcObject = stream;
          video.play().catch(() => {});
        }
      }, 100);
    } catch {
      setCameraError("Camera permission was denied or no camera is available.");
      setStudentCameraOpen(true);
    }
  }

  function closeStudentCamera() {
    if (studentCameraStream) studentCameraStream.getTracks().forEach((track) => track.stop());
    setStudentCameraStream(null);
    setStudentCameraOpen(false);
  }

  function captureStudentPhoto() {
    const video = document.getElementById("student-camera-video");
    if (!video || !video.videoWidth) {
      setCameraError("Camera is still starting. Please try again.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    setForm((prev) => ({ ...prev, photo: canvas.toDataURL("image/jpeg", 0.74) }));
    closeStudentCamera();
  }

  function handlePhotoInput(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setMessage("Please select an image file.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setMessage("Please choose an image smaller than 5 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setForm((prev) => ({ ...prev, photo: String(reader.result || "") }));
    reader.readAsDataURL(file);
  }

  function extractCode(value) {
    try {
      const url = new URL(value);
      return url.searchParams.get("student") || "";
    } catch {
      const raw = String(value || "").trim();
      return raw.startsWith("BVB-") ? raw : "";
    }
  }

  async function loadParentPortal(studentCode) {
    const code = extractCode(studentCode) || studentCode.trim();
    if (!code) {
      setParentError("Invalid student QR code.");
      return;
    }
    setParentLoading(true);
    setParentError("");
    try {
      const studentSnapshot = await getDoc(doc(db, "students", code));
      if (!studentSnapshot.exists()) throw new Error("Student record was not found for this QR code.");
      const student = { id: studentSnapshot.id, ...studentSnapshot.data() };

      const [markSnapshot, attendanceSnapshot, homeworkSnapshot, noticeSnapshot, notificationSnapshot, timetableSnapshot] = await Promise.all([
        getDocs(collection(db, "students", code, "marks")),
        getDocs(collection(db, "students", code, "attendance")),
        getDocs(collection(db, "students", code, "homework")),
        getDocs(collection(db, "students", code, "notices")),
        getDocs(collection(db, "students", code, "notifications")),
        getDocs(collection(db, "students", code, "timetable")),
      ]);

      const markRows = markSnapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      const attendanceRows = attendanceSnapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      const homeworkRows = homeworkSnapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      const noticeRows = noticeSnapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      const notificationRows = notificationSnapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      const timetableRows = timetableSnapshot.docs.map((d) => ({ id: d.id, ...d.data() }));

      const present = attendanceRows.filter((a) => a.status === "Present").length;
      const absent = attendanceRows.filter((a) => a.status === "Absent").length;
      const leave = attendanceRows.filter((a) => a.status === "Leave").length;
      const attendancePercentage = percent(present, attendanceRows.length);
      const obtained = markRows.reduce((sum, row) => sum + Number(row.obtained || 0), 0);
      const total = markRows.reduce((sum, row) => sum + Number(row.total || 0), 0);
      const academicPercentage = percent(obtained, total);

      setParentStudent({
        ...student,
        marks: markRows,
        attendanceRows,
        homework: homeworkRows,
        notices: noticeRows,
        notifications: notificationRows,
        timetable: timetableRows,
        attendanceSummary: { total: attendanceRows.length, present, absent, leave, percentage: attendancePercentage },
        academicPercentage,
        academicGrade: academicPercentage >= 90 ? "A+" : academicPercentage >= 80 ? "A" : academicPercentage >= 70 ? "B+" : academicPercentage >= 60 ? "B" : academicPercentage >= 50 ? "C" : "D",
      });
      setParentCodeInput(code);
      setTab("Parent Portal");
    } catch (error) {
      console.error(error);
      setParentStudent(null);
      setParentError(error.message || "Could not load the student portal.");
    } finally {
      setParentLoading(false);
    }
  }

  async function startParentScanner() {
    setParentError("");
    await stopParentScanner();
    try {
      const scanner = new Html5Qrcode("parent-qr-camera");
      parentScannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        async (decodedText) => {
          await stopParentScanner();
          await loadParentPortal(decodedText);
        },
        () => {},
      );
    } catch (error) {
      console.error(error);
      setParentError("Unable to start the camera. Allow camera permission and try again.");
    }
  }

  async function stopParentScanner() {
    if (parentScannerRef.current) {
      try { await parentScannerRef.current.stop(); } catch {}
      try { await parentScannerRef.current.clear(); } catch {}
      parentScannerRef.current = null;
    }
  }

  async function scanParentGallery(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setParentLoading(true);
    setParentError("");
    try {
      const scanner = new Html5Qrcode("parent-qr-gallery");
      const text = await scanner.scanFile(file, true);
      await scanner.clear();
      await loadParentPortal(text);
    } catch (error) {
      console.error(error);
      setParentError("No valid BVB student QR was found in that image.");
    } finally {
      setParentLoading(false);
      if (parentGalleryRef.current) parentGalleryRef.current.value = "";
    }
  }

  async function enableBrowserNotifications(studentCode) {
    try {
      if (typeof Notification === "undefined" || !("serviceWorker" in navigator)) {
        throw new Error("This browser does not support web notifications.");
      }
      const permission = await Notification.requestPermission();
      setBrowserNotificationState(permission);
      if (permission !== "granted") throw new Error("Browser notification permission was not granted.");

      const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
      if (!vapidKey) throw new Error("Add VITE_FIREBASE_VAPID_KEY to .env.local to enable phone/browser push notifications.");
      const supported = await isSupported();
      if (!supported) throw new Error("Firebase Messaging is not supported in this browser.");

      const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
      const messaging = getMessaging(app);
      const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
      if (!token) throw new Error("Firebase did not return a notification token.");

      await setDoc(doc(db, "parentTokens", token), {
        studentCode,
        token,
        active: true,
        createdAt: serverTimestamp(),
      }, { merge: true });

      setParentError("");
      setMessage("Browser / phone notifications are enabled for this parent device.");
    } catch (error) {
      console.error(error);
      setParentError(error.message || "Could not enable notifications.");
    }
  }

  const teacherMenu = [
    ["Overview", "⌂"],
    ["Students", "👨‍🎓"],
    ["Attendance", "📅"],
    ["Marks", "📊"],
    ["Homework", "📝"],
    ["Notices", "📢"],
    ["Timetable", "🕐"],
    ["Reports", "📥"],
    ["Notifications", "🔔"],
    ["Settings", "⚙️"],
  ];

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="brand-wrap">
          <div className="brand-mark">🏫</div>
          <div>
            <b>BVB Techno School</b>
            <span>Learn • Explore • Achieve</span>
          </div>
        </div>
        <nav className="top-nav">
          {["Home", "Parent Portal", "Teacher Login"].map((item) => (
            <button key={item} className={tab === item ? "nav-active" : ""} onClick={() => navigate(item)}>{item}</button>
          ))}
        </nav>
        <div className="header-status">{authReady && teacherLogged ? "Teacher signed in" : "School Portal"}</div>
      </header>

      <main>
        {tab === "Home" && (
          <div className="home-page">
            <section className="hero-section">
              <div className="hero-copy">
                <span className="eyebrow">BVB TECHNO SCHOOL · NURSERY TO CLASS 10</span>
                <h1>One connected school experience for <em>teachers, students and parents.</em></h1>
                <p>Manage admissions, attendance, marks, homework, notices, timetables and parent access from one modern dashboard.</p>
                <div className="hero-actions">
                  <button className="btn primary" onClick={() => navigate("Teacher Login")}>Teacher Dashboard →</button>
                  <button className="btn soft" onClick={() => navigate("Parent Portal")}>Open Parent Portal</button>
                </div>
              </div>
              <div className="hero-visual">
                <div className="hero-card hero-card-main"><span>LIVE SCHOOL VIEW</span><strong>Connected learning</strong><div className="hero-mini-grid"><div>👨‍🎓<b>Students</b></div><div>📅<b>Attendance</b></div><div>📊<b>Marks</b></div><div>🔔<b>Alerts</b></div></div></div>
                <div className="hero-float">✨ Smart School Portal</div>
              </div>
            </section>

            <section className="section-block">
              <div className="section-heading"><span className="eyebrow">EDUCATION JOURNEY</span><h2>Explore by school level</h2><p>Select a level to view the classes covered.</p></div>
              <div className="group-grid">
                {GROUPS.map((item) => (
                  <button className={`group-card ${group.title === item.title ? "selected" : ""}`} key={item.title} onClick={() => setGroup(item)}>
                    <span>{item.icon}</span><b>{item.title}</b><small>{item.classes.join(" · ")}</small>
                  </button>
                ))}
              </div>
              <div className="class-pill-row">{group.classes.map((cls) => <span key={cls} className="class-pill">{cls}</span>)}</div>
            </section>

            <section className="section-block feature-band">
              <div className="section-heading"><span className="eyebrow">ALL CORE MODULES</span><h2>Everything is connected</h2></div>
              <div className="feature-grid">
                {[
                  ["👨‍🎓", "Student Directory", "Profiles, parent details, class, section and QR access."],
                  ["📅", "Attendance", "Per-student Present / Absent / Leave with live percentages."],
                  ["📊", "Marks", "Subject-wise marks, exam-wise records and overall percentages."],
                  ["📝", "Homework", "Target every student, a class/section or a single student."],
                  ["📢", "Notices", "School communication and parent notifications."],
                  ["📥", "Reports", "Download overall Excel reports with multiple sheets."],
                ].map(([icon, title, body]) => <div className="feature-card" key={title}><span>{icon}</span><b>{title}</b><p>{body}</p></div>)}
              </div>
            </section>
          </div>
        )}

        {tab === "Teacher Login" && !teacherLogged && (
          <section className="auth-page">
            <div className="auth-card">
              <div className="auth-icon">👩‍🏫</div>
              <span className="eyebrow">STAFF ACCESS</span>
              <h2>Teacher Login</h2>
              <p>Use the Firebase Authentication account that has a <b>staff</b> document with role <b>teacher</b> or <b>admin</b>.</p>
              <form onSubmit={teacherLogin} className="stack-form">
                <label>Email<input type="email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} placeholder="teacher@school.com" required /></label>
                <label>Password<input type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} placeholder="Password" required /></label>
                {loginError && <div className="error-box">{loginError}</div>}
                <button className="btn primary wide" type="submit">Sign In to Teacher Dashboard →</button>
              </form>
            </div>
          </section>
        )}

        {tab === "Teacher Login" && teacherLogged && (
          <section className="teacher-page">
            <div className="teacher-page-head">
              <div><span className="eyebrow">TEACHER WORKSPACE</span><h2>BVB School Management</h2><p>Manage students, attendance, marks, communication and reports from one place.</p></div>
              <button className="btn outline" onClick={teacherLogout}>Logout</button>
            </div>

            <div className="selection-strip">
              <div><span className="selection-icon">🎯</span><div><b>Working group</b><small>Choose the class and section you are managing.</small></div></div>
              <label>Class<select value={classFilter} onChange={(e) => { setClassFilter(e.target.value); setSectionFilter("All"); }}><option>All</option>{CLASS_NAMES.map((cls) => <option key={cls}>{cls}</option>)}</select></label>
              <label>Section<select value={sectionFilter} onChange={(e) => setSectionFilter(e.target.value)}><option>All</option>{SECTIONS.map((section) => <option key={section}>{section}</option>)}</select></label>
              <div className="selection-count"><b>{filteredStudents.length}</b><span>students in view</span></div>
              {loadingTeacherData && <span className="loading-chip">Syncing…</span>}
            </div>

            <div className="dashboard-layout">
              <aside className="teacher-sidebar">
                <div className="sidebar-label">MODULES</div>
                {teacherMenu.map(([label, icon]) => <button key={label} className={teacherModule === label ? "active" : ""} onClick={() => setTeacherModule(label)}><span>{icon}</span>{label}</button>)}
                <div className="sidebar-tip"><b>Quick tip</b><small>Class + Section filters instantly update roster, attendance and marks.</small></div>
              </aside>

              <section className="teacher-content">
                {message && <div className="success-box">✓ {message}</div>}

                {teacherModule === "Overview" && (
                  <>
                    <div className="module-intro"><div><span className="eyebrow">TODAY'S CONTROL PANEL</span><h3>{classFilter === "All" ? "All Classes" : classFilter}{sectionFilter !== "All" ? ` · Section ${sectionFilter}` : ""}</h3><p>Live Firestore-backed information for the current selection.</p></div><button className="btn primary" onClick={() => setTeacherModule("Students")}>Open Student Directory →</button></div>
                    <div className="metric-grid">
                      <div className="metric-card"><span>👨‍🎓</span><small>Students</small><b>{filteredStudents.length}</b><em>Current selection</em></div>
                      <div className="metric-card green"><span>📅</span><small>Attendance</small><b>{overviewAttendancePercentage()}%</b><em>Present record ratio</em></div>
                      <div className="metric-card purple"><span>📊</span><small>Marks Entries</small><b>{filteredMarks().length}</b><em>Current class / section</em></div>
                      <div className="metric-card orange"><span>🔔</span><small>Notifications</small><b>{notifications.filter((n) => filteredStudents.some((s) => s.studentCode === n.studentCode)).length}</b><em>Current selection</em></div>
                    </div>
                    <div className="content-grid-2">
                      <section className="panel-card"><div className="panel-heading"><div><span className="eyebrow">ROSTER SNAPSHOT</span><h3>Students in this selection</h3></div><button className="btn soft small" onClick={() => setTeacherModule("Students")}>View all</button></div><div className="mini-roster">
                        {filteredStudents.slice(0, 8).map((student) => { const a = studentAttendanceStats(student.studentCode); const m = studentMarksStats(student.studentCode); return <div className="mini-student" key={student.studentCode}><div className="avatar">{student.photo ? <img src={student.photo} alt="" /> : student.name?.charAt(0)?.toUpperCase()}</div><div><b>{student.name}</b><small>{student.className} · {student.section} · Roll {student.roll}</small><div className="mini-bars"><span><i style={{ width: `${a.percentage}%` }} />Attendance {a.percentage}%</span><span><i style={{ width: `${m.percentage}%` }} />Marks {m.percentage}%</span></div></div></div>; })}
                        {!filteredStudents.length && <div className="empty-state"><span>👨‍🎓</span><b>No students in this selection.</b><small>Add a student or change the filters.</small></div>}
                      </div></section>
                      <section className="panel-card"><div className="panel-heading"><div><span className="eyebrow">QUICK WORK</span><h3>Jump to a task</h3></div></div><div className="quick-grid"><button onClick={() => setTeacherModule("Attendance")}><span>📅</span><b>Take Attendance</b><small>Every student</small></button><button onClick={() => setTeacherModule("Marks")}><span>📊</span><b>Enter Marks</b><small>Subject-wise</small></button><button onClick={() => setTeacherModule("Homework")}><span>📝</span><b>Post Homework</b><small>Class / Student</small></button><button onClick={() => setTeacherModule("Notices")}><span>📢</span><b>Publish Notice</b><small>Parent alerts</small></button></div></section>
                    </div>
                  </>
                )}

                {teacherModule === "Students" && (
                  <>
                    <div className="module-intro"><div><span className="eyebrow">STUDENT MANAGEMENT</span><h3>Student Directory</h3><p>Change Class and Section above to instantly show that complete roster.</p></div><button className="btn primary" onClick={() => document.getElementById("add-student-form")?.scrollIntoView({ behavior: "smooth" })}>＋ Add Student</button></div>
                    <div className="mini-kpis"><div><span>👨‍🎓</span><b>{filteredStudents.length}</b><small>Students</small></div><div><span>✅</span><b>{filteredStudents.filter((s) => studentAttendanceStats(s.studentCode).percentage >= 75).length}</b><small>75%+ Attendance</small></div><div><span>📊</span><b>{filteredStudents.filter((s) => studentMarksStats(s.studentCode).percentage >= 40).length}</b><small>40%+ Marks</small></div><div><span>🔔</span><b>{notifications.filter((n) => filteredStudents.some((s) => s.studentCode === n.studentCode)).length}</b><small>Alerts</small></div></div>
                    <section className="panel-card table-panel"><div className="table-head"><div><b>{classFilter === "All" ? "All students" : classFilter}{sectionFilter !== "All" ? ` · Section ${sectionFilter}` : ""}</b><small>{filteredStudents.length} live student records</small></div><span>Live roster</span></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Student</th><th>Class / Section</th><th>Roll</th><th>Parent</th><th>Attendance</th><th>Marks</th><th>Actions</th></tr></thead><tbody>{filteredStudents.map((student) => { const a = studentAttendanceStats(student.studentCode); const m = studentMarksStats(student.studentCode); return <tr key={student.studentCode}><td><div className="student-cell"><div className="avatar">{student.photo ? <img src={student.photo} alt="" /> : student.name?.charAt(0)?.toUpperCase()}</div><div><b>{student.name}</b><small>{student.studentCode}</small></div></div></td><td><span className="class-badge">{student.className} · {student.section}</span></td><td>{student.roll}</td><td><b>{student.parent || "—"}</b><small>{student.phone || "—"}</small></td><td><span className={`score-badge ${scoreTone(a.percentage)}`}>{a.percentage}%</span><small>{a.present}/{a.total || 0} present</small></td><td><span className={`score-badge ${scoreTone(m.percentage)}`}>{m.percentage}%</span><small>{m.count} entries</small></td><td><div className="action-buttons"><button title="Attendance" onClick={() => openAttendanceForStudent(student)}>📅</button><button title="Marks" onClick={() => openMarksForStudent(student)}>📊</button><button title="QR" onClick={() => { setSelectedStudent(student); generateQR(student); }}>🔳</button></div></td></tr>; })}</tbody></table>{!filteredStudents.length && <div className="empty-state"><span>👨‍🎓</span><b>No students found.</b><small>Select another Class / Section or add a new student.</small></div>}</div></section>

                    <section className="panel-card" id="add-student-form"><div className="panel-heading"><div><span className="eyebrow">NEW ADMISSION</span><h3>Add a Student</h3><p>After saving, the dashboard automatically switches to the student's Class and Section.</p></div><span className="ready-badge">QR ready</span></div><form className="form-grid" onSubmit={addStudent}><label>Student full name<input name="name" value={form.name} onChange={field} required placeholder="Student name" /></label><label>Class<select name="className" value={form.className} onChange={field}>{CLASS_NAMES.map((cls) => <option key={cls}>{cls}</option>)}</select></label><label>Section<select name="section" value={form.section} onChange={field}>{SECTIONS.map((section) => <option key={section}>{section}</option>)}</select></label><label>Roll number<input name="roll" value={form.roll} onChange={field} required placeholder="01" /></label><label>Parent / guardian<input name="parent" value={form.parent} onChange={field} placeholder="Parent name" /></label><label>Parent phone<input name="phone" value={form.phone} onChange={field} required placeholder="9876543210" /></label><label className="span-2">Address<textarea name="address" value={form.address} onChange={field} rows="3" placeholder="Residential address" /></label><label>Student photo<input type="file" accept="image/*" onChange={handlePhotoInput} /></label><div className="photo-box">{form.photo ? <img src={form.photo} alt="Preview" /> : <div>📷<small>Optional photo</small></div>}</div><div className="form-actions span-2"><button type="button" className="btn soft" onClick={openStudentCamera}>📷 Take Photo</button><button type="button" className="btn outline" onClick={() => setForm(EMPTY_STUDENT)}>Clear</button><button className="btn primary" disabled={saving}>{saving ? "Saving…" : "Create Student & Generate QR →"}</button></div></form></section>
                    {selectedStudent && <section className="panel-card qr-panel"><div className="panel-heading"><div><span className="eyebrow">STUDENT QR</span><h3>{selectedStudent.name}</h3><p>{selectedStudent.studentCode} · {selectedStudent.className} · Section {selectedStudent.section}</p></div><button className="btn outline" onClick={() => { setSelectedStudent(null); setSelectedQR(""); }}>Close</button></div><div className="qr-layout"><img src={selectedQR} alt="Student QR" /><div><b>Parent Portal QR</b><p>Scan this same QR with a phone camera or upload the image from the gallery.</p><a className="btn primary" href={selectedQR} download={`${selectedStudent.studentCode}.png`}>Download QR</a></div></div></section>}
                  </>
                )}

                {teacherModule === "Attendance" && <section className="panel-card module-card"><div className="module-intro"><div><span className="eyebrow">ATTENDANCE CENTER</span><h3>Daily Attendance</h3><p>Give every student an individual Present / Absent / Leave status and monitor the running percentage.</p></div><label className="date-field">Date<input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} /></label></div><div className="command-row"><button className="btn soft" onClick={() => setAllAttendance("Present")}>✓ Mark All Present</button><button className="btn outline" onClick={() => setAllAttendance("Absent")}>× Mark All Absent</button><span>{filteredStudents.length} students in current selection</span></div><div className="attendance-list">{filteredStudents.map((student) => { const stats = studentAttendanceStats(student.studentCode); const status = attendanceDraft[student.studentCode] || "Present"; return <div className="attendance-row" key={student.studentCode}><div className="student-cell"><div className="avatar">{student.photo ? <img src={student.photo} alt="" /> : student.name?.charAt(0)?.toUpperCase()}</div><div><b>{student.name}</b><small>{student.className} · Section {student.section} · Roll {student.roll}</small></div></div><div className="attendance-meter"><div><span>Attendance</span><b>{stats.percentage}%</b></div><div className="progress"><i style={{ width: `${stats.percentage}%` }} /></div><small>{stats.present} present · {stats.absent} absent · {stats.leave} leave</small></div><div className="status-group">{["Present", "Absent", "Leave"].map((item) => <button key={item} className={`${status === item ? "selected" : ""} status-${item.toLowerCase()}`} onClick={() => setAttendanceDraft((prev) => ({ ...prev, [student.studentCode]: item }))}>{item}</button>)}</div></div>; })}{!filteredStudents.length && <div className="empty-state"><span>📅</span><b>No students in this selection.</b></div>}</div><button className="btn primary wide" onClick={saveAttendance}>Save Today's Attendance & Create Parent Alerts</button></section>}

                {teacherModule === "Marks" && <section className="panel-card module-card"><div className="module-intro"><div><span className="eyebrow">ACADEMIC RECORDS</span><h3>Marks Management</h3><p>Select a student from the current Class / Section and add subject-wise marks.</p></div></div><form className="marks-form" onSubmit={saveMark}><label>Student<select value={marksForm.studentCode} onChange={(e) => setMarksForm((p) => ({ ...p, studentCode: e.target.value }))}><option value="">Select student</option>{filteredStudents.map((student) => <option key={student.studentCode} value={student.studentCode}>{student.roll} · {student.name}</option>)}</select></label><label>Exam<select value={marksForm.exam} onChange={(e) => setMarksForm((p) => ({ ...p, exam: e.target.value }))}><option>Internal Test</option><option>Unit Test - 1</option><option>Unit Test - 2</option><option>Quarterly</option><option>Half-Yearly</option><option>Annual</option></select></label><label>Subject<input value={marksForm.subject} onChange={(e) => setMarksForm((p) => ({ ...p, subject: e.target.value }))} /></label><label>Obtained<input type="number" min="0" value={marksForm.obtained} onChange={(e) => setMarksForm((p) => ({ ...p, obtained: e.target.value }))} /></label><label>Total<input type="number" min="1" value={marksForm.total} onChange={(e) => setMarksForm((p) => ({ ...p, total: e.target.value }))} /></label><label className="check-field"><input type="checkbox" checked={marksForm.notifyParent} onChange={(e) => setMarksForm((p) => ({ ...p, notifyParent: e.target.checked }))} /> Notify parent</label><button className="btn primary">Save Mark</button></form><div className="performance-grid">{filteredStudents.map((student) => { const stats = studentMarksStats(student.studentCode); return <button key={student.studentCode} className="performance-card" onClick={() => setMarksForm((p) => ({ ...p, studentCode: student.studentCode }))}><div className="student-cell"><div className="avatar">{student.photo ? <img src={student.photo} alt="" /> : student.name?.charAt(0)?.toUpperCase()}</div><div><b>{student.name}</b><small>Roll {student.roll}</small></div></div><strong>{stats.percentage}%</strong><small>{stats.count} marks entries</small></button>; })}</div><div className="table-scroll"><table className="data-table"><thead><tr><th>Student</th><th>Exam</th><th>Subject</th><th>Score</th><th>Percentage</th></tr></thead><tbody>{filteredMarks().slice(-80).reverse().map((mark) => <tr key={mark.id}><td><b>{mark.studentName}</b><small>{mark.className} · {mark.section}</small></td><td>{mark.exam}</td><td>{mark.subject}</td><td><b>{mark.obtained}/{mark.total}</b></td><td><span className={`score-badge ${scoreTone(mark.percentage)}`}>{mark.percentage}%</span></td></tr>)}</tbody></table></div></section>}

                {teacherModule === "Homework" && <section className="panel-card module-card"><div className="module-intro"><div><span className="eyebrow">CLASSWORK</span><h3>Post Homework</h3><p>Send homework to all students, a class/section, or one student.</p></div></div><form className="form-grid" onSubmit={postHomework}><label>Title<input value={homeworkForm.title} onChange={(e) => setHomeworkForm((p) => ({ ...p, title: e.target.value }))} required /></label><label>Subject<input value={homeworkForm.subject} onChange={(e) => setHomeworkForm((p) => ({ ...p, subject: e.target.value }))} /></label><label>Due date<input type="date" value={homeworkForm.dueDate} onChange={(e) => setHomeworkForm((p) => ({ ...p, dueDate: e.target.value }))} /></label><label>Send to<select value={homeworkForm.targetType} onChange={(e) => setHomeworkForm((p) => ({ ...p, targetType: e.target.value }))}><option value="all">Every Student</option><option value="class">Class / Section</option><option value="student">One Student</option></select></label>{homeworkForm.targetType !== "student" && <><label>Class<select value={homeworkForm.targetClass} onChange={(e) => setHomeworkForm((p) => ({ ...p, targetClass: e.target.value }))}>{CLASS_NAMES.map((cls) => <option key={cls}>{cls}</option>)}</select></label><label>Section<select value={homeworkForm.targetSection} onChange={(e) => setHomeworkForm((p) => ({ ...p, targetSection: e.target.value }))}><option>All</option>{SECTIONS.map((section) => <option key={section}>{section}</option>)}</select></label></>}{homeworkForm.targetType === "student" && <label>Student<select value={homeworkForm.targetStudentCode} onChange={(e) => setHomeworkForm((p) => ({ ...p, targetStudentCode: e.target.value }))}><option value="">Select student</option>{students.map((student) => <option key={student.studentCode} value={student.studentCode}>{student.name} · {student.className}-{student.section}</option>)}</select></label>}<label className="span-2">Description<textarea rows="5" value={homeworkForm.description} onChange={(e) => setHomeworkForm((p) => ({ ...p, description: e.target.value }))} /></label><div className="form-actions span-2"><button className="btn primary">Post Homework & Notify Parents</button></div></form><div className="list-card">{homework.slice(-20).reverse().map((item) => <div className="list-item" key={item.id}><span>📝</span><div><b>{item.title}</b><small>{item.subject} · Due {item.dueDate || "—"} · {item.studentName}</small></div></div>)}</div></section>}

                {teacherModule === "Notices" && <section className="panel-card module-card"><div className="module-intro"><div><span className="eyebrow">COMMUNICATION</span><h3>School Notices</h3><p>Publish announcements to all students, a class/section, or one student.</p></div></div><form className="form-grid" onSubmit={postNotice}><label>Notice title<input value={noticeForm.title} onChange={(e) => setNoticeForm((p) => ({ ...p, title: e.target.value }))} required /></label><label>Send to<select value={noticeForm.targetType} onChange={(e) => setNoticeForm((p) => ({ ...p, targetType: e.target.value }))}><option value="all">Every Student</option><option value="class">Class / Section</option><option value="student">One Student</option></select></label>{noticeForm.targetType !== "student" && <><label>Class<select value={noticeForm.targetClass} onChange={(e) => setNoticeForm((p) => ({ ...p, targetClass: e.target.value }))}>{CLASS_NAMES.map((cls) => <option key={cls}>{cls}</option>)}</select></label><label>Section<select value={noticeForm.targetSection} onChange={(e) => setNoticeForm((p) => ({ ...p, targetSection: e.target.value }))}><option>All</option>{SECTIONS.map((section) => <option key={section}>{section}</option>)}</select></label></>}{noticeForm.targetType === "student" && <label>Student<select value={noticeForm.targetStudentCode} onChange={(e) => setNoticeForm((p) => ({ ...p, targetStudentCode: e.target.value }))}><option value="">Select student</option>{students.map((student) => <option key={student.studentCode} value={student.studentCode}>{student.name} · {student.className}-{student.section}</option>)}</select></label>}<label className="span-2">Message<textarea rows="6" value={noticeForm.message} onChange={(e) => setNoticeForm((p) => ({ ...p, message: e.target.value }))} required /></label><div className="form-actions span-2"><button className="btn primary">Publish Notice & Notify Parents</button></div></form><div className="list-card">{notices.slice(-20).reverse().map((item) => <div className="list-item" key={item.id}><span>📢</span><div><b>{item.title}</b><small>{item.message}</small></div></div>)}</div></section>}

                {teacherModule === "Timetable" && <section className="panel-card module-card"><div className="module-intro"><div><span className="eyebrow">SCHEDULE</span><h3>Class Timetable</h3><p>Save a timetable row for every student in the selected class and section.</p></div></div><form className="form-grid" onSubmit={addTimetable}><label>Class<select value={timetableForm.className} onChange={(e) => setTimetableForm((p) => ({ ...p, className: e.target.value }))}>{CLASS_NAMES.map((cls) => <option key={cls}>{cls}</option>)}</select></label><label>Section<select value={timetableForm.section} onChange={(e) => setTimetableForm((p) => ({ ...p, section: e.target.value }))}>{SECTIONS.map((section) => <option key={section}>{section}</option>)}</select></label><label>Day<select value={timetableForm.day} onChange={(e) => setTimetableForm((p) => ({ ...p, day: e.target.value }))}>{DAYS.map((day) => <option key={day}>{day}</option>)}</select></label><label>Time<input value={timetableForm.time} onChange={(e) => setTimetableForm((p) => ({ ...p, time: e.target.value }))} /></label><label>Subject<input value={timetableForm.subject} onChange={(e) => setTimetableForm((p) => ({ ...p, subject: e.target.value }))} /></label><label>Room<input value={timetableForm.room} onChange={(e) => setTimetableForm((p) => ({ ...p, room: e.target.value }))} /></label><label>Teacher<input value={timetableForm.teacher} onChange={(e) => setTimetableForm((p) => ({ ...p, teacher: e.target.value }))} /></label><div className="form-actions"><button className="btn primary">Save Timetable</button></div></form><div className="list-card">{timetable.slice(-30).reverse().map((item) => <div className="list-item" key={item.id}><span>🕐</span><div><b>{item.day} · {item.time} · {item.subject}</b><small>{item.className} · {item.section} · Room {item.room} · {item.teacher}</small></div></div>)}</div></section>}

                {teacherModule === "Reports" && <section className="panel-card module-card"><div className="module-intro"><div><span className="eyebrow">REPORTING</span><h3>Excel Reports</h3><p>Download a multi-sheet school report based on the selected report filters.</p></div><button className="btn primary" onClick={exportExcel}>⬇ Download Excel</button></div><div className="report-box"><label>Report class<select value={reportClass} onChange={(e) => setReportClass(e.target.value)}><option>All</option>{CLASS_NAMES.map((cls) => <option key={cls}>{cls}</option>)}</select></label><label>Report section<select value={reportSection} onChange={(e) => setReportSection(e.target.value)}><option>All</option>{SECTIONS.map((section) => <option key={section}>{section}</option>)}</select></label><div className="report-stat"><b>{reportStudents.length}</b><span>students selected</span></div></div><div className="mini-kpis"><div><span>👨‍🎓</span><b>{reportStudents.length}</b><small>Students</small></div><div><span>📅</span><b>{attendance.filter((a) => reportStudents.some((s) => s.studentCode === a.studentCode)).length}</b><small>Attendance Rows</small></div><div><span>📊</span><b>{marks.filter((m) => reportStudents.some((s) => s.studentCode === m.studentCode)).length}</b><small>Marks Rows</small></div><div><span>🔔</span><b>{notifications.filter((n) => reportStudents.some((s) => s.studentCode === n.studentCode)).length}</b><small>Notifications</small></div></div></section>}

                {teacherModule === "Notifications" && <section className="panel-card module-card"><div className="module-intro"><div><span className="eyebrow">NOTIFICATION CENTER</span><h3>Parent Notifications</h3><p>Attendance alerts, marks updates, homework and notices generated by teacher actions.</p></div></div><div className="notification-list">{notifications.filter((n) => classFilter === "All" || filteredStudents.some((s) => s.studentCode === n.studentCode)).slice(-80).reverse().map((item) => <div className="notification-row" key={item.id}><span className={`notification-dot ${item.type}`} /> <div><b>{item.title}</b><small>{item.body}</small><em>{formatDate(item.createdAt)}</em></div></div>)}</div></section>}

                {teacherModule === "Settings" && <section className="panel-card module-card"><div className="module-intro"><div><span className="eyebrow">SYSTEM SETTINGS</span><h3>School Setup</h3><p>Useful tools for your academic/demo environment.</p></div></div><div className="settings-grid"><div><b>Firebase project</b><small>Connected through your `firebase.js` environment configuration.</small></div><div><b>Parent access</b><small>QR-only parent portal. No OTP is used.</small></div><div><b>Photo storage</b><small>Student photos are compressed and stored in Firestore, so Firebase Storage billing is not required for this build.</small></div><div><b>Notifications</b><small>In-app parent notifications are included. Optional browser/phone push uses FCM and a VAPID key.</small></div></div><button className="btn soft" onClick={generateDemoData}>Load Demo / Academic Dataset</button></section>}
              </section>
            </div>
          </section>
        )}

        {tab === "Parent Portal" && (
          <section className="parent-page">
            <div className="parent-hero"><div><span className="eyebrow">BVB PARENT PORTAL</span><h2>Your child's <em>learning journey</em> in one place.</h2><p>Scan the same student QR with the camera or upload the QR image from the gallery. No OTP is used.</p></div><div className="parent-hero-art">📱<span>+</span>🎓</div></div>

            {!parentStudent && <div className="parent-access-grid"><div className="parent-card"><span className="card-icon">📷</span><h3>Scan with Camera</h3><p>Use the phone or laptop camera to scan the student QR.</p><div id="parent-qr-camera" className="qr-camera-box" /><button className="btn primary wide" onClick={startParentScanner}>Start QR Camera</button></div><div className="parent-card"><span className="card-icon">🖼️</span><h3>Scan from Gallery</h3><p>Select the saved QR image from your device.</p><input ref={parentGalleryRef} type="file" accept="image/*" onChange={scanParentGallery} className="file-input" /><button className="btn soft wide" onClick={() => parentGalleryRef.current?.click()}>Choose QR Image</button><div id="parent-qr-gallery" className="hidden-qr-reader" /></div><div className="parent-card developer-card"><span className="card-icon">🔎</span><h3>Developer Test</h3><p>Paste a student code during development.</p><input value={parentCodeInput} onChange={(e) => setParentCodeInput(e.target.value)} placeholder="BVB-XXXXXXXXXX" /><button className="btn outline wide" onClick={() => loadParentPortal(parentCodeInput)}>Open Student</button></div></div>}

            {parentLoading && <div className="info-box">Loading student portal…</div>}
            {parentError && <div className="error-box parent-error">{parentError}</div>}

            {parentStudent && <section className="parent-dashboard"><div className="parent-student-head"><div className="parent-profile"><div className="parent-avatar">{parentStudent.photo ? <img src={parentStudent.photo} alt="" /> : parentStudent.name?.charAt(0)?.toUpperCase()}</div><div><span className="eyebrow">STUDENT PROFILE</span><h3>{parentStudent.name}</h3><p>{parentStudent.className} · Section {parentStudent.section} · Roll {parentStudent.roll} · {parentStudent.studentCode}</p><small>Parent: {parentStudent.parent || "—"} · {parentStudent.phone || "—"}</small></div></div><div className="parent-actions"><button className="btn soft" onClick={() => loadParentPortal(parentStudent.studentCode)}>↻ Refresh</button><button className="btn outline" onClick={() => { setParentStudent(null); setParentCodeInput(""); }}>Scan Another QR</button><button className="btn primary" onClick={() => enableBrowserNotifications(parentStudent.studentCode)}>🔔 Enable Notifications</button></div></div>

              <div className="parent-metrics"><div><span>📅</span><b>{parentStudent.attendanceSummary.percentage}%</b><small>Attendance</small></div><div><span>📊</span><b>{parentStudent.academicPercentage}%</b><small>Academic %</small></div><div><span>📝</span><b>{parentStudent.homework.length}</b><small>Homework</small></div><div><span>🔔</span><b>{parentStudent.notifications.length}</b><small>Alerts</small></div></div>

              <div className="parent-content-grid"><section className="parent-panel"><div className="panel-heading"><div><span className="eyebrow">ACADEMIC PERFORMANCE</span><h3>Marks & Result</h3></div><span className="grade-badge">{parentStudent.academicGrade}</span></div><div className="parent-score"><strong>{parentStudent.academicPercentage}%</strong><div className="progress"><i style={{ width: `${parentStudent.academicPercentage}%` }} /></div><span>Overall result</span></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Exam</th><th>Subject</th><th>Score</th><th>%</th></tr></thead><tbody>{parentStudent.marks.map((item) => <tr key={item.id}><td>{item.exam}</td><td>{item.subject}</td><td>{item.obtained}/{item.total}</td><td><span className="score-badge good">{item.percentage}%</span></td></tr>)}</tbody></table>{!parentStudent.marks.length && <div className="empty-state"><span>📊</span><small>No marks have been entered yet.</small></div>}</div></section>

                <section className="parent-panel"><div className="panel-heading"><div><span className="eyebrow">ATTENDANCE</span><h3>Attendance History</h3></div><span className="grade-badge">{parentStudent.attendanceSummary.percentage}%</span></div><div className="attendance-summary-grid"><div><b>{parentStudent.attendanceSummary.present}</b><small>Present</small></div><div><b>{parentStudent.attendanceSummary.absent}</b><small>Absent</small></div><div><b>{parentStudent.attendanceSummary.leave}</b><small>Leave</small></div></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Date</th><th>Status</th></tr></thead><tbody>{parentStudent.attendanceRows.slice().reverse().map((item) => <tr key={item.id}><td>{item.attendanceDate}</td><td><span className={`attendance-chip ${item.status.toLowerCase()}`}>{item.status}</span></td></tr>)}</tbody></table></div></section>

                <section className="parent-panel"><div className="panel-heading"><div><span className="eyebrow">CLASSWORK</span><h3>Homework</h3></div></div><div className="parent-list">{parentStudent.homework.slice().reverse().map((item) => <div className="parent-list-item" key={item.id}><span>📝</span><div><b>{item.title}</b><small>{item.subject} · Due {item.dueDate || "—"}</small><p>{item.description}</p></div></div>)}{!parentStudent.homework.length && <div className="empty-state"><small>No homework posted yet.</small></div>}</div></section>

                <section className="parent-panel"><div className="panel-heading"><div><span className="eyebrow">COMMUNICATION</span><h3>Notices & Alerts</h3></div></div><div className="parent-list">{parentStudent.notifications.slice().reverse().map((item) => <div className="parent-list-item" key={item.id}><span>🔔</span><div><b>{item.title}</b><small>{item.type} · {formatDate(item.createdAt)}</small><p>{item.body}</p></div></div>)}{!parentStudent.notifications.length && <div className="empty-state"><small>No new notifications.</small></div>}</div></section>

                <section className="parent-panel full-span"><div className="panel-heading"><div><span className="eyebrow">CLASS SCHEDULE</span><h3>Timetable</h3></div></div><div className="timetable-parent">{parentStudent.timetable.slice().sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day)).map((item) => <div key={item.id}><span>{item.day}</span><b>{item.time} · {item.subject}</b><small>Room {item.room || "—"} · {item.teacher || "—"}</small></div>)}{!parentStudent.timetable.length && <div className="empty-state"><small>No timetable entries yet.</small></div>}</div></section>
              </div>
            </section>}
          </section>
        )}
      </main>

      {studentCameraOpen && <div className="modal-backdrop"><div className="camera-modal"><div className="modal-heading"><h3>Take Student Photo</h3><button className="btn outline" onClick={closeStudentCamera}>Close</button></div><video id="student-camera-video" autoPlay playsInline muted /><p>{cameraError || "Position the student inside the frame."}</p><button className="btn primary wide" onClick={captureStudentPhoto}>Capture Photo</button></div></div>}
    </div>
  );
}
