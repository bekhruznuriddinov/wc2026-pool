// User session — stored in localStorage
// { userId, name, email }
function getSession() {
  try { return JSON.parse(localStorage.getItem("wc2026_user")); }
  catch { return null; }
}

function setSession(user) {
  localStorage.setItem("wc2026_user", JSON.stringify(user));
}

function clearSession() {
  localStorage.removeItem("wc2026_user");
}

// Redirect to login if not logged in
function requireAuth() {
  const user = getSession();
  if (!user) {
    window.location.href = "index.html";
    return null;
  }
  return user;
}

// Returns initials for avatar
function initials(name) {
  return name.split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase();
}

// Render user bar in header
function renderUserBar(user) {
  const el = document.getElementById("userBar");
  if (!el || !user) return;
  el.style.cssText = "display:flex;align-items:center;gap:0.75rem;";
  const adminLink = user.email === ADMIN_EMAIL
    ? `<a href="admin.html" class="btn btn-ghost btn-sm" style="color:rgba(255,255,255,0.6);border-color:rgba(255,255,255,0.15);white-space:nowrap">Admin</a>`
    : "";
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px">
      <div class="user-avatar">${initials(user.name)}</div>
      <span style="color:rgba(255,255,255,0.75);font-size:0.82rem;white-space:nowrap">${user.name}</span>
    </div>
    ${adminLink}
    <button class="btn btn-ghost btn-sm" onclick="logout()" style="color:rgba(255,255,255,0.6);border-color:rgba(255,255,255,0.15);white-space:nowrap">Sign out</button>
  `;
}

function logout() {
  clearSession();
  window.location.href = "index.html";
}

// ---- Login page logic ----
const loginForm = document.getElementById("loginForm");
if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("nameInput").value.trim();
    const email = document.getElementById("emailInput").value.trim().toLowerCase();
    if (!name || !email) return;

    const btn = loginForm.querySelector("button[type=submit]");
    btn.disabled = true;
    btn.textContent = "Joining…";

    try {
      // Check if user already exists by email
      const snap = await db.collection("users")
        .where("email", "==", email)
        .limit(1)
        .get();

      let userId, userData;

      if (!snap.empty) {
        // Returning user
        const doc = snap.docs[0];
        userId = doc.id;
        userData = doc.data();
        // Update name if changed
        if (userData.name !== name) {
          await db.collection("users").doc(userId).update({ name });
          userData.name = name;
        }
      } else {
        // New user
        userId = db.collection("users").doc().id;
        userData = {
          name,
          email,
          joinedAt: firebase.firestore.FieldValue.serverTimestamp(),
          totalPoints: 0
        };
        await db.collection("users").doc(userId).set(userData);
      }

      setSession({ userId, name: userData.name, email });
      window.location.href = "predictions.html";

    } catch (err) {
      console.error(err);
      showAlert("alertBox", "Something went wrong. Please try again.", "error");
      btn.disabled = false;
      btn.textContent = "Enter the Pool →";
    }
  });
}

// Redirect if already logged in
if (loginForm && getSession()) {
  window.location.href = "predictions.html";
}

function showAlert(id, msg, type = "info") {
  const el = document.getElementById(id);
  if (el) {
    el.className = `alert alert-${type}`;
    el.textContent = msg;
    el.style.display = "block";
  }
}
