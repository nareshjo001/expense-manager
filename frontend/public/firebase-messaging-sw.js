/* eslint-env serviceworker */
/* eslint-disable no-restricted-globals */
/* global firebase */
/* eslint-disable no-undef */

importScripts("https://www.gstatic.com/firebasejs/10.0.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.0.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyCLdiBKVOyiSxeT9stpDjcmK5aO99ZAXtw",
  authDomain: "balensia-001.firebaseapp.com",
  projectId: "balensia-001",
  storageBucket: "balensia-001.firebasestorage.app",
  messagingSenderId: "478316007747",
  appId: "1:478316007747:web:eb36adde0e901f1494dff6"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const {
    title = "Notification",
    body = "",
    route = "/",
    tag = "general",
    icon,
    badge,
    image
  } = payload.data || {};

  self.registration.showNotification(title, {
    body,
    icon,
    badge,
    image,
    tag,
    renotify: true,
    requireInteraction: false,
    data: { route },
    actions: [
      {
        action: "open",
        title: "Open App"
      }
    ]
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const route = event.notification.data?.route || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {

        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && "focus" in client) {
            client.focus();
            return client.navigate(route);
          }
        }

        return clients.openWindow(route);
      })
  );
});
