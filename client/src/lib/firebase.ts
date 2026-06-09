import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyB7S7HHdAYrJwet_E3h2iW5HO574mBcZ-M',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'fixo-builder.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'fixo-builder',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'fixo-builder.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '330402290645',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:330402290645:web:083b36e84eb64847e47b5c'
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });
