// Admin access is checked by email
const user = getSession();
if (!user || user.email !== ADMIN_EMAIL) {
  document.body.innerHTML = `
    <div class="page" style="text-align:center;padding-top:4rem">
      <h2 style="color:var(--red)">Access denied</h2>
      <p class="text-muted mt-2">This page is for admins only.</p>
      <a href="predictions.html" class="btn btn-secondary mt-3" style="display:inline-flex">Back to pool</a>
    </div>`;
} else {
  initAdmin();
}

async function initAdmin() {
  document.getElementById("adminEmail").textContent = user.email;
  await Promise.all([loadRoundsAdmin(), loadMatchesAdmin()]);
}

// ---- ROUNDS ----
async function loadRoundsAdmin() {
  const snap = await db.collection("rounds").orderBy("order").get();
  const rounds = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderRoundsTable(rounds);
}

function renderRoundsTable(rounds) {
  const el = document.getElementById("roundsTable");
  if (rounds.length === 0) {
    el.innerHTML = `<p class="text-muted">No rounds yet. Create one below.</p>`;
    return;
  }
  el.innerHTML = `
    <table class="leaderboard-table" style="width:100%">
      <thead><tr><th>Round</th><th>Points</th><th>Status</th><th>Deadline</th><th>Actions</th></tr></thead>
      <tbody>
        ${rounds.map(r => `
          <tr>
            <td><strong>${r.name}</strong></td>
            <td>${ROUND_POINTS[r.id]}</td>
            <td><span class="badge badge-${r.status}">${r.status}</span></td>
            <td class="text-muted text-small">${r.deadline ? formatDate(r.deadline.toDate ? r.deadline.toDate() : new Date(r.deadline)) : "—"}</td>
            <td>
              <div class="flex" style="gap:0.4rem;flex-wrap:wrap">
                ${r.status === "upcoming" ? `<button class="btn btn-success btn-sm" onclick="setRoundStatus('${r.id}','open')">Open</button>` : ""}
                ${r.status === "open" ? `<button class="btn btn-secondary btn-sm" onclick="setRoundStatus('${r.id}','closed')">Close picks</button>` : ""}
                ${r.status === "closed" ? `<button class="btn btn-success btn-sm" onclick="setRoundStatus('${r.id}','complete')">Mark complete</button>` : ""}
                ${r.status === "complete" ? `<button class="btn btn-ghost btn-sm" onclick="recalcScores('${r.id}')">Recalc scores</button>` : ""}
              </div>
            </td>
          </tr>`).join("")}
      </tbody>
    </table>
  `;
}

async function setRoundStatus(roundId, status) {
  await db.collection("rounds").doc(roundId).update({ status });
  if (status === "complete") {
    await recalcScores(roundId);
  }
  await loadRoundsAdmin();
  showAdminAlert(`Round status updated to "${status}".`, "success");
}

// ---- CREATE ROUND ----
document.getElementById("createRoundBtn").addEventListener("click", async () => {
  const id = document.getElementById("newRoundId").value;
  const name = document.getElementById("newRoundName").value.trim();
  const deadline = document.getElementById("newRoundDeadline").value;
  const order = parseInt(document.getElementById("newRoundOrder").value, 10);

  if (!id || !name || !order) {
    showAdminAlert("Fill in all required fields.", "error");
    return;
  }

  const existing = await db.collection("rounds").doc(id).get();
  if (existing.exists) {
    showAdminAlert("A round with this ID already exists.", "error");
    return;
  }

  await db.collection("rounds").doc(id).set({
    name,
    order,
    status: "upcoming",
    deadline: deadline ? new Date(deadline) : null,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  showAdminAlert(`Round "${name}" created.`, "success");
  await loadRoundsAdmin();
});

// ---- MATCHES ----
async function loadMatchesAdmin() {
  const snap = await db.collection("matches").get();
  const matches = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.roundId + a.matchNum).localeCompare(b.roundId + b.matchNum) || a.matchNum - b.matchNum);
  renderMatchesAdmin(matches);
}

function renderMatchesAdmin(matches) {
  const el = document.getElementById("matchesTable");
  if (matches.length === 0) {
    el.innerHTML = `<p class="text-muted">No matches yet. Add one below.</p>`;
    return;
  }

  el.innerHTML = `
    <table class="leaderboard-table" style="width:100%">
      <thead><tr><th>#</th><th>Round</th><th>Team 1</th><th>Team 2</th><th>Result</th><th>Actions</th></tr></thead>
      <tbody>
        ${matches.map(m => `
          <tr id="mrow-${m.id}">
            <td>${m.matchNum}</td>
            <td class="text-muted text-small">${m.roundId}</td>
            <td>
              <div style="display:flex;align-items:center;gap:6px">
                <span>${flag(m.team1)}</span>
                <input type="text" value="${m.team1 || ""}" placeholder="Team 1"
                  style="width:110px;padding:0.4rem 0.6rem;font-size:0.85rem"
                  onchange="updateMatchField('${m.id}','team1',this.value)">
              </div>
            </td>
            <td>
              <div style="display:flex;align-items:center;gap:6px">
                <span>${flag(m.team2)}</span>
                <input type="text" value="${m.team2 || ""}" placeholder="Team 2"
                  style="width:110px;padding:0.4rem 0.6rem;font-size:0.85rem"
                  onchange="updateMatchField('${m.id}','team2',this.value)">
              </div>
            </td>
            <td>
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                <input type="number" min="0" max="20" placeholder="0"
                  value="${m.score1 ?? ""}"
                  style="width:48px;padding:0.4rem 0.5rem;font-size:0.85rem;text-align:center"
                  onchange="updateMatchField('${m.id}','score1',this.value)">
                <span style="color:var(--text-muted)">–</span>
                <input type="number" min="0" max="20" placeholder="0"
                  value="${m.score2 ?? ""}"
                  style="width:48px;padding:0.4rem 0.5rem;font-size:0.85rem;text-align:center"
                  onchange="updateMatchField('${m.id}','score2',this.value)">
                <select onchange="setResult('${m.id}',this.value)" style="width:110px;padding:0.4rem 0.5rem;font-size:0.85rem">
                  <option value="" ${!m.result ? "selected" : ""}>Winner…</option>
                  <option value="team1" ${m.result==="team1"?"selected":""}>${m.team1 || "Team 1"}</option>
                  <option value="team2" ${m.result==="team2"?"selected":""}>${m.team2 || "Team 2"}</option>
                </select>
              </div>
            </td>
            <td>
              <button class="btn btn-danger btn-sm" onclick="deleteMatch('${m.id}')">Delete</button>
            </td>
          </tr>`).join("")}
      </tbody>
    </table>
  `;
}

async function updateMatchField(matchId, field, value) {
  await db.collection("matches").doc(matchId).update({ [field]: value.trim() });
}

async function setResult(matchId, result) {
  const row = document.getElementById(`mrow-${matchId}`);
  const inputs = row ? row.querySelectorAll("input[type=number]") : [];
  const score1 = inputs[0] ? parseInt(inputs[0].value) : null;
  const score2 = inputs[1] ? parseInt(inputs[1].value) : null;
  await db.collection("matches").doc(matchId).update({
    result: result || null,
    score1: isNaN(score1) ? null : score1,
    score2: isNaN(score2) ? null : score2,
    status: result ? "complete" : "pending"
  });
  showAdminAlert("Result saved. Recalculate scores when all matches in the round are done.", "info");
}

async function deleteMatch(matchId) {
  if (!confirm("Delete this match?")) return;
  await db.collection("matches").doc(matchId).delete();
  await loadMatchesAdmin();
}

// ---- ADD MATCH ----
document.getElementById("addMatchBtn").addEventListener("click", async () => {
  const roundId = document.getElementById("matchRound").value.trim();
  const matchNum = parseInt(document.getElementById("matchNum").value, 10);
  const team1 = document.getElementById("matchTeam1").value.trim();
  const team2 = document.getElementById("matchTeam2").value.trim();

  if (!roundId || !matchNum) {
    showAdminAlert("Round ID and match number are required.", "error");
    return;
  }

  await db.collection("matches").add({
    roundId,
    matchNum,
    team1: team1 || "TBD",
    team2: team2 || "TBD",
    result: null,
    status: "pending",
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  showAdminAlert("Match added.", "success");
  document.getElementById("matchNum").value = matchNum + 1;
  document.getElementById("matchTeam1").value = "";
  document.getElementById("matchTeam2").value = "";
  await loadMatchesAdmin();
});

// ---- BULK ADD MATCHES ----
document.getElementById("bulkAddBtn").addEventListener("click", async () => {
  const roundId = document.getElementById("bulkRoundId").value.trim();
  const count = parseInt(document.getElementById("bulkCount").value, 10);
  if (!roundId || !count) { showAdminAlert("Fill in all fields.", "error"); return; }

  const btn = document.getElementById("bulkAddBtn");
  btn.disabled = true;
  btn.textContent = "Adding…";

  const batch = db.batch();
  for (let i = 1; i <= count; i++) {
    const ref = db.collection("matches").doc();
    batch.set(ref, {
      roundId, matchNum: i,
      team1: "TBD", team2: "TBD",
      result: null, status: "pending",
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }
  await batch.commit();

  btn.disabled = false;
  btn.textContent = "Bulk add";
  showAdminAlert(`${count} matches added to "${roundId}".`, "success");
  await loadMatchesAdmin();
});

// ---- R32 KICKOFF TIMES ----
// All times UTC. Source: official FIFA 2026 schedule (ET = UTC-4 in summer)
const R32_KICKOFFS = [
  { teams: ["South Africa", "Canada"],           kickoff: "2026-06-28T19:00:00Z" },
  { teams: ["Brazil", "Japan"],                  kickoff: "2026-06-29T17:00:00Z" },
  { teams: ["Germany", "Paraguay"],              kickoff: "2026-06-29T20:30:00Z" },
  { teams: ["Netherlands", "Morocco"],           kickoff: "2026-06-30T01:00:00Z" },
  { teams: ["Ivory Coast", "Norway"],            kickoff: "2026-06-30T17:00:00Z" },
  { teams: ["France", "Sweden"],                 kickoff: "2026-06-30T21:00:00Z" },
  { teams: ["Mexico", "Ecuador"],                kickoff: "2026-07-01T01:00:00Z" },
  { teams: ["England", "Congo DR"],              kickoff: "2026-07-01T16:00:00Z" },
  { teams: ["Belgium", "Senegal"],               kickoff: "2026-07-01T20:00:00Z" },
  { teams: ["USA", "Bosnia & Herzegovina"],      kickoff: "2026-07-02T00:00:00Z" },
  { teams: ["Spain", "Austria"],                 kickoff: "2026-07-02T19:00:00Z" },
  { teams: ["Portugal", "Croatia"],              kickoff: "2026-07-02T23:00:00Z" },
  { teams: ["Switzerland", "Algeria"],           kickoff: "2026-07-03T03:00:00Z" },
  { teams: ["Australia", "Egypt"],               kickoff: "2026-07-03T18:00:00Z" },
  { teams: ["Argentina", "Cape Verde"],          kickoff: "2026-07-03T22:00:00Z" },
  { teams: ["Colombia", "Ghana"],                kickoff: "2026-07-04T01:30:00Z" },
];

async function setR32Kickoffs() {
  const btn = document.getElementById("setKickoffsBtn");
  btn.disabled = true; btn.textContent = "Setting…";
  try {
    const snap = await db.collection("matches").where("roundId", "==", "r32").get();
    const batch = db.batch();
    let count = 0;

    snap.docs.forEach(doc => {
      const { team1, team2 } = doc.data();
      const entry = R32_KICKOFFS.find(e =>
        e.teams.includes(team1) && e.teams.includes(team2)
      );
      if (entry) {
        batch.update(doc.ref, { kickoff: new Date(entry.kickoff) });
        count++;
      }
    });

    await batch.commit();
    showAdminAlert(`Kickoff times set for ${count}/16 R32 matches.`, "success");
    await loadMatchesAdmin();
  } catch (err) {
    console.error(err);
    showAdminAlert("Failed to set kickoff times.", "error");
  } finally {
    btn.disabled = false; btn.textContent = "Set R32 kickoff times";
  }
}

// ---- SCORE RECALCULATION ----
async function recalcScores(roundId) {
  const btn = document.getElementById("recalcBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Recalculating…"; }

  try {
    const matchSnap = await db.collection("matches").where("roundId", "==", roundId).get();
    const matches = matchSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    const predsSnap = await db.collection("predictions").get();
    const batch = db.batch();
    let updated = 0;

    for (const predDoc of predsSnap.docs) {
      const picks = predDoc.data().picks || {};
      let roundScore = 0;

      matches.forEach(m => {
        const pick = picks[m.id];
        // picks are objects { winner, score1, score2 } or legacy strings
        const winner = (pick && typeof pick === "object") ? pick.winner : pick;
        if (!m.result || winner !== m.result) return;

        let pts = ROUND_POINTS[roundId] || 0;

        // Scoreline bonuses
        if (pick && typeof pick === "object") {
          const s1 = parseInt(pick.score1), s2 = parseInt(pick.score2);
          const a1 = parseInt(m.score1),    a2 = parseInt(m.score2);
          if (!isNaN(s1) && !isNaN(s2) && !isNaN(a1) && !isNaN(a2)) {
            if (s1 === a1 && s2 === a2) pts += 5;
            else if ((s1 - s2) === (a1 - a2)) pts += 1;
          }
        }

        roundScore += pts;
      });

      batch.update(db.collection("predictions").doc(predDoc.id),
        { [`roundScores.${roundId}`]: roundScore });
      updated++;
    }

    await batch.commit();

    // Recalculate totalPoints from all round scores
    const predsSnap2 = await db.collection("predictions").get();
    const batch2 = db.batch();

    for (const predDoc of predsSnap2.docs) {
      const roundScores = predDoc.data().roundScores || {};
      const total = Object.values(roundScores).reduce((s, v) => s + (v || 0), 0);
      batch2.update(db.collection("users").doc(predDoc.id), { totalPoints: total });
      batch2.update(db.collection("predictions").doc(predDoc.id), { totalPoints: total });
    }

    await batch2.commit();
    showAdminAlert(`Scores recalculated for ${updated} players.`, "success");

  } catch (err) {
    console.error(err);
    showAdminAlert("Failed to recalculate scores.", "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Recalculate all scores"; }
  }
}

document.getElementById("recalcBtn").addEventListener("click", async () => {
  const roundId = prompt("Enter round ID to recalculate (e.g. r32, r16, qf, sf, final):");
  if (roundId) await recalcScores(roundId);
});

// ---- SETTINGS ----
async function loadSettings() {
  const doc = await db.collection("settings").doc("main").get();
  if (doc.exists) {
    const s = doc.data();
    if (s.tournamentName) document.getElementById("settingName").value = s.tournamentName;
    if (s.buyIn) document.getElementById("settingBuyIn").value = s.buyIn;
  }
}

document.getElementById("saveSettingsBtn").addEventListener("click", async () => {
  const name = document.getElementById("settingName").value.trim();
  const buyIn = parseFloat(document.getElementById("settingBuyIn").value) || 0;
  await db.collection("settings").doc("main").set({ tournamentName: name, buyIn, adminEmail: user.email }, { merge: true });
  showAdminAlert("Settings saved.", "success");
});

loadSettings();

// ---- UTILS ----
function showAdminAlert(msg, type = "info") {
  const el = document.getElementById("adminAlert");
  el.className = `alert alert-${type}`;
  el.textContent = msg;
  el.style.display = "block";
  setTimeout(() => { el.style.display = "none"; }, 4000);
}

function formatDate(d) {
  return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
