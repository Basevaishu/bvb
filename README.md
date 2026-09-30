# BVB Techno School — Complete Teacher + QR Parent Portal

This is a clean rebuild of the BVB Techno School React + Firebase project.

## Included

- Public school home page
- Nursery to Class 10 class groups
- Firebase Email/Password teacher login
- Teacher role check using `staff/{uid}` with role `teacher` or `admin`
- Modern teacher dashboard
- Class + Section master filters
- Student directory
- Add student with photo
- Automatic student QR generation
- QR download
- Individual attendance controls: Present / Absent / Leave
- Running attendance percentage for every student
- Automatic parent absence notifications
- Marks entry with student picker, exam, subject, obtained/total and percentage
- Optional parent notification when marks are saved
- Homework posting to all / class-section / one student
- Notice posting to all / class-section / one student
- Timetable posting to a class-section
- Excel report export with multiple sheets
- Notification center
- Demo / Academic Dataset loader
- QR-only Parent Portal — **no OTP**
- Parent QR camera scan
- Parent QR gallery scan
- Parent portal showing profile, marks, attendance, homework, notices, notifications and timetable
- Optional Firebase Cloud Messaging browser/phone push notifications
- Firebase Cloud Function for push notifications
- Firestore rules
- Firebase Storage is NOT required by this build; student photos are compressed and stored in Firestore

## Folder structure

```text
BVB_Techno_School_Complete_2026/
├── frontend/
│   ├── public/
│   │   └── firebase-messaging-sw.js
│   ├── src/
│   │   ├── App.jsx
│   │   ├── firebase.js
│   │   ├── main.jsx
│   │   └── style.css
│   ├── .env.example
│   ├── index.html
│   └── package.json
├── functions/
│   ├── index.js
│   └── package.json
├── firebase.json
├── firestore.rules
└── README.md
```

## 1. Create / use your Firebase project

Use the BVB Techno School Firebase project.

Enable:

- Authentication → Email/Password
- Firestore Database

Phone Authentication is NOT needed because the parent portal is QR-only.

Firebase Storage is also NOT needed for this build.

## 2. Firebase environment variables

Create:

```text
frontend/.env.local
```

Use your Firebase web configuration values:

```env
VITE_FIREBASE_API_KEY=YOUR_VALUE
VITE_FIREBASE_AUTH_DOMAIN=bvb-techno-school.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=bvb-techno-school
VITE_FIREBASE_STORAGE_BUCKET=bvb-techno-school.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=665152555498
VITE_FIREBASE_APP_ID=YOUR_VALUE
VITE_FIREBASE_MEASUREMENT_ID=G-M03K2YBCHL

# Optional push notifications
VITE_FIREBASE_VAPID_KEY=YOUR_WEB_PUSH_PUBLIC_KEY
```

## 3. Install frontend packages

Open Command Prompt inside `frontend`:

```cmd
npm install
npm run dev
```

## 4. Teacher account

Create a teacher user in Firebase Authentication → Users.

Then create:

```text
Firestore → staff → <AUTH_USER_UID>
```

with:

```text
email: teacher@gmail.com
role: teacher
```

For an admin user, use:

```text
role: admin
```

## 5. Firestore rules

Open:

```text
Firebase Console → Firestore Database → Rules
```

Paste `firestore.rules` from this project and Publish.

## 6. Start the app

```cmd
cd C:\Users\basev\Downloads\BVB_Techno_School_Fullstack_Starter\BVB_Techno_School_Project\frontend
npm install
npm run dev
```

## 7. Create a student

Teacher Login → Students → Add Student.

Enter:

- name
- class
- section
- roll number
- parent
- parent phone
- address
- optional photo

After saving, the dashboard automatically changes to the student's class and section and the student appears in the roster.

The QR can be downloaded immediately.

## 8. Parent portal

The parent QR can be:

- scanned with camera
- selected from gallery
- tested by entering a student code in Developer Test

There is **no OTP** in this build.

## 9. Push notifications (optional)

The basic Parent Portal already receives teacher-created information inside the portal.

For background browser/phone push:

1. Firebase Console → Project settings → Cloud Messaging
2. Under Web configuration, create or copy the Web Push certificate public key.
3. Put it in `.env.local`:

```env
VITE_FIREBASE_VAPID_KEY=YOUR_PUBLIC_KEY
```

4. Keep `frontend/public/firebase-messaging-sw.js` in place.
5. Deploy the Cloud Function if using background push.

From the project root:

```cmd
cd functions
npm install
cd ..
firebase deploy --only functions
```

## QR-only access note

Because the parent portal intentionally does not use OTP, possession of a student's QR acts like possession of the access key for that student's portal. Do not put highly sensitive records in a QR-only academic portal without an additional authentication layer. The included rules intentionally keep teacher writes locked down while enabling the QR parent experience.

## Demo dataset

Teacher Dashboard → Settings → Load Demo / Academic Dataset

The demo records are labeled as a demo/academic dataset.
