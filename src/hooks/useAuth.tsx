import { useState, useEffect, useRef, createContext, useContext, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

interface AuthContextType {
  user: User | null;
  profile: { nome: string; email: string; gc_user_id: string | null; auvo_user_id: string | null; grupo_id: string | null } | null;
  isAdmin: boolean;
  isCliente: boolean;
  role: string | null;
  roleLoaded: boolean;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  isAdmin: false,
  isCliente: false,
  role: null,
  roleLoaded: false,
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<AuthContextType["profile"]>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isCliente, setIsCliente] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [roleLoaded, setRoleLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const currentUserIdRef = useRef<string | null>(null);

  const fetchUserData = async (u: User) => {
    try {
      const [{ data: profileData }, { data: roleData }] = await Promise.all([
        supabase.from("profiles").select("nome, email, gc_user_id, auvo_user_id, grupo_id").eq("id", u.id).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", u.id).maybeSingle(),
      ]);
      setProfile(profileData as any);
      const r = (roleData?.role as string) ?? null;
      setRole(r);
      setIsAdmin(r === "admin");
      setIsCliente(r === "cliente");
      setRoleLoaded(true);
    } catch (err) {
      console.error("Error fetching user data:", err);
      setProfile(null);
      setIsAdmin(false);
      setIsCliente(false);
      setRole(null);
      setRoleLoaded(true);
    }
  };

  useEffect(() => {
    let isMounted = true;

    const releaseLoading = () => {
      if (isMounted) setLoading(false);
    };

    // Fail-safe: never allow infinite spinner
    const loadingTimeout = window.setTimeout(() => {
      console.warn("Auth loading timeout reached, releasing UI");
      releaseLoading();
    }, 2500);

    const applySession = (session: Session | null) => {
      if (!isMounted) return;

      const u = session?.user ?? null;
      setUser(u);

      if (!u) {
        currentUserIdRef.current = null;
        setProfile(null);
        setIsAdmin(false);
        setIsCliente(false);
        setRole(null);
        setRoleLoaded(true);
        releaseLoading();
        return;
      }

      const isSameUser = currentUserIdRef.current === u.id;
      currentUserIdRef.current = u.id;
      if (!isSameUser) setRoleLoaded(false);
      // Do not block UI on profile/role fetch
      void fetchUserData(u).finally(() => {
        releaseLoading();
      });
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      applySession(session);
    });

    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        applySession(session);
      })
      .catch((err) => {
        console.error("Error initializing auth:", err);
        if (isMounted) {
          setUser(null);
          setProfile(null);
          setIsAdmin(false);
          setIsCliente(false);
          setRole(null);
        }
        releaseLoading();
      });

    return () => {
      isMounted = false;
      window.clearTimeout(loadingTimeout);
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, profile, isAdmin, isCliente, role, roleLoaded, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
