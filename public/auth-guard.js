(function () {
  function getStoredToken() {
    return (
      localStorage.getItem("token") ||
      localStorage.getItem("authToken") ||
      localStorage.getItem("empiria_token") ||
      ""
    );
  }

  function clearSession() {
    localStorage.removeItem("token");
    localStorage.removeItem("authToken");
    localStorage.removeItem("empiria_token");
    localStorage.removeItem("user");
    localStorage.removeItem("empiria_user");
    localStorage.removeItem("access");
    localStorage.removeItem("empiria_access");
  }

  async function validateSession(options = {}) {
    const {
      redirectTo = "/",
      requiredRole = "",
      requireAuth = true,
    } = options;

    const token = getStoredToken();

    if (!requireAuth) {
      return { ok: true, token: token || null, user: null, access: null };
    }

    if (!token) {
      clearSession();
      window.location.href = redirectTo;
      return { ok: false };
    }

    try {
      const response = await fetch("/me", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        clearSession();
        window.location.href = redirectTo;
        return { ok: false };
      }

      const user = data.user || null;
      const access = data.access || null;

      localStorage.setItem("empiria_token", token);
      localStorage.setItem("empiria_user", JSON.stringify(user || {}));
      localStorage.setItem("empiria_access", JSON.stringify(access || {}));

      if (requiredRole) {
        const role = String(user?.role || "").toLowerCase();
        const allowedRole = String(requiredRole).toLowerCase();

        if (role !== allowedRole) {
          alert("No tienes permisos para acceder a esta sección.");
          window.location.href = "/";
          return { ok: false };
        }
      }

      return {
        ok: true,
        token,
        user,
        access,
      };
    } catch (error) {
      clearSession();
      window.location.href = redirectTo;
      return { ok: false, error };
    }
  }

  async function logout() {
    const token = getStoredToken();

    try {
      if (token) {
        await fetch("/logout", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
      }
    } catch (error) {
      // ignorado a propósito
    }

    clearSession();
    window.location.href = "/";
  }

  window.EmpiriaAuth = {
    getStoredToken,
    clearSession,
    validateSession,
    logout,
  };
})();