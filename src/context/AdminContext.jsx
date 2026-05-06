import { createContext, useContext, useState, useCallback } from "react";

const AdminContext = createContext(null);

// Sabit admin kimlik bilgileri
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "road2026";

export function AdminProvider({ children }) {
  const [isAdmin, setIsAdmin] = useState(() => {
    return sessionStorage.getItem("rqm_admin_session") === "true";
  });

  const login = useCallback((username, password) => {
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
      setIsAdmin(true);
      sessionStorage.setItem("rqm_admin_session", "true");
      return true;
    }
    return false;
  }, []);

  const logout = useCallback(() => {
    setIsAdmin(false);
    sessionStorage.removeItem("rqm_admin_session");
  }, []);

  return (
    <AdminContext.Provider value={{ isAdmin, login, logout }}>
      {children}
    </AdminContext.Provider>
  );
}

export function useAdmin() {
  const context = useContext(AdminContext);
  if (!context) {
    throw new Error("useAdmin must be used within an AdminProvider");
  }
  return context;
}

export default AdminContext;
