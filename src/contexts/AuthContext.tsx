import React, { createContext, useContext, useState, useEffect } from 'react';
import { auth, db } from '../firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';

interface UserProfile {
  role: 'admin' | 'restaurant' | 'rider' | 'customer';
  name?: string;
  email?: string;
  [key: string]: any;
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType>({ user: null, profile: null, loading: true });

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let profileUnsub: (() => void) | null = null;

    const authUnsub = onAuthStateChanged(auth, async (currentUser) => {
      // Clean up previous profile listener
      if (profileUnsub) {
        profileUnsub();
        profileUnsub = null;
      }

      setUser(currentUser);

      if (currentUser) {
        try {
          // Check admins collection first (fast path)
          const adminSnap = await getDoc(doc(db, 'admins', currentUser.uid));
          if (adminSnap.exists()) {
            setProfile({ role: 'admin', email: currentUser.email ?? '', ...adminSnap.data() });
            setLoading(false);
            // Also set up live listener on user profile for name changes
            profileUnsub = onSnapshot(doc(db, 'users', currentUser.uid), (snap) => {
              if (snap.exists()) {
                setProfile(prev => ({ ...prev, ...snap.data(), role: 'admin' }));
              }
            });
            return;
          }

          // Fall back to users collection
          profileUnsub = onSnapshot(doc(db, 'users', currentUser.uid), (snap) => {
            if (snap.exists()) {
              setProfile(snap.data() as UserProfile);
            } else {
              // New user not in Firestore yet (e.g. Google sign-in first time)
              setProfile({ role: 'admin', email: currentUser.email ?? '' });
            }
            setLoading(false);
          });
        } catch (error) {
          console.error('Error fetching user profile:', error);
          setProfile(null);
          setLoading(false);
        }
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => {
      authUnsub();
      if (profileUnsub) profileUnsub();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, profile, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
