importScripts("https://www.gstatic.com/firebasejs/12.0.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.0.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyD_gK6KTXrns5H9lzisiV8y-mhQElPFWiQ",
  authDomain: "bvb-techno-school.firebaseapp.com",
  projectId: "bvb-techno-school",
  storageBucket: "bvb-techno-school.firebasestorage.app",
  messagingSenderId: "665152555498",
  appId: "1:665152555498:web:00106972b13479b99b8a93",
  measurementId: "G-M03K2YBCHL",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload?.notification?.title || "BVB Techno School";
  const options = {
    body: payload?.notification?.body || "New school notification",
    icon: "/school-icon.png",
    data: payload?.data || {},
  };
  self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow("/");
      return undefined;
    }),
  );
});
