import { initializeApp  } from 'firebase/app';
import { getMessaging } from "firebase/messaging";

// Firebase project config and messaging instance used for web push notifications.
const firebaseConfig = {
  apiKey: "AIzaSyCLdiBKVOyiSxeT9stpDjcmK5aO99ZAXtw",
  authDomain: "balensia-001.firebaseapp.com",
  projectId: "balensia-001",
  storageBucket: "balensia-001.firebasestorage.app",
  messagingSenderId: "478316007747",
  appId: "1:478316007747:web:eb36adde0e901f1494dff6"
};

const app = initializeApp(firebaseConfig);
export const messaging = getMessaging(app);