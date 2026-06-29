const _adminUser = getSession();
if (!_adminUser) {
  window.location.href = "index.html";
} else if (_adminUser.email !== ADMIN_EMAIL) {
  window.location.href = "predictions.html";
} else {
  renderUserBar(_adminUser);
}

async function initAdmin() {
  try {
    const [usersSnap, roundsSnap, matchesSnap, predsSnap] = await Promise.all([
      db.collection("users").get(),
      db.collection("rounds").orderBy("order").get(),
      db.collection("matches").get(),
      db.collection("predictions").get(),
    ]);

    let settings = {};
    try {
      const s = await db.collection("settings").doc("pool").get();
      if (s.exists) settings = s.data();
    } catch (_) {}

    const users   = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const rounds  = roundsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const matches = {};
    matchesSnap.docs.forEach(d => { matches[d.id] = { id: d.id, ...d.data() }; });
    const predictions = {};
    predsSnap.docs.forEach(d => { predictions[d.id] = d.data().picks || {}; });

    const pickCounts = {};
    predsSnap.docs.forEach(doc => {
      Object.entries(doc.data().picks || {}).forEach(([matchId, pick]) => {
        const winner = typeof pick === "object" ? pick.winner : pick;
        if (winner !== "team1" && winner !== "team2") return;
        if (!pickCounts[matchId]) pickCounts[matchId] = { team1: 0, team2: 0 };
        pickCounts[matchId][winner]++;
      });
    });

    const openRound = rounds.find(r => r.status === "open");

    document.getElementById("loading").style.display = "none";
    document.getElementById("dashContent").style.display = "block";

    renderOverview(users, rounds, openRound, matches, predictions, settings);
    if (openRound) renderPicksTracker(users, openRound, matches, predictions);
    renderPlayerList(users, rounds, matches, predictions, pickCounts);
    renderPicksMatrix(users, rounds, matches, predictions);
  } catch (err) {
    console.error(err);
    document.getElementById("loading").innerHTML =
      `<p style="color:var(--text-muted);text-align:center">Failed to load dashboard.</p>`;
  }
}

function renderOverview(users, rounds, openRound, matches, predictions, settings) {
  let completionText = "–", completionSub = "No open round";
  if (openRound) {
    const roundMatches = Object.values(matches).filter(m =>
      m.roundId === openRound.id && m.team1 && m.team1 !== "TBD" && !m.freebie
    );
    const totalM = roundMatches.length;
    const done = users.filter(u => {
      const picks = predictions[u.id] || {};
      return totalM > 0 && roundMatches.every(m => {
        const p = picks[m.id];
        return p && (typeof p === "string" ? p : p.winner);
      });
    }).length;
    completionText = `${done}/${users.length}`;
    completionSub  = `players done — ${totalM} match${totalM !== 1 ? "es" : ""}`;
  }

  const buyIn = settings.buyIn ? Number(settings.buyIn) : null;
  const pot    = buyIn ? `$${(buyIn * users.length).toLocaleString()}` : "–";
  const potSub = buyIn ? `$${buyIn} × ${users.length} players` : "Set buy-in in Firebase";

  const card = (label, value, sub, color) => `
    <div class="spotlight-card">
      <div class="spotlight-label">${label}</div>
      <div class="spotlight-value"${color ? ` style="color:${color}"` : ""}>${value}</div>
      <div class="spotlight-sub">${sub}</div>
    </div>`;

  const activeCount = rounds.filter(r => r.status !== "upcoming").length;

  document.getElementById("overviewCards").innerHTML =
    card("Players",        users.length,     `${activeCount} active round${activeCount !== 1 ? "s" : ""}`) +
    card("Open round",     openRound ? openRound.name : "–",
                           openRound ? "accepting picks" : "No round open",
                           openRound ? "var(--green)" : null) +
    card("Picks complete", completionText, completionSub) +
    card("Prize pool",     pot, potSub, buyIn ? "var(--gold)" : null);
}

function renderPicksTracker(users, openRound, matches, predictions) {
  const roundMatches = Object.values(matches).filter(m =>
    m.roundId === openRound.id && m.team1 && m.team1 !== "TBD" && !m.freebie
  );
  const totalM = roundMatches.length;

  const rows = users.map(u => {
    const picks = predictions[u.id] || {};
    const made = roundMatches.filter(m => {
      const p = picks[m.id];
      return p && (typeof p === "string" ? p : p.winner);
    }).length;
    return { ...u, made, done: made === totalM && totalM > 0 };
  }).sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1; // incomplete first
    return a.name.localeCompare(b.name);
  });

  document.getElementById("picksTitle").textContent = `${openRound.name} — picks tracker`;
  document.getElementById("picksSection").style.display = "block";
  document.getElementById("picksDivider").style.display = "block";

  document.getElementById("picksTable").innerHTML = `
    <thead>
      <tr>
        <th>Player</th>
        <th style="text-align:center">Picks</th>
        <th>Progress</th>
        <th style="text-align:right">Status</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map(u => {
        const pct = totalM ? Math.round((u.made / totalM) * 100) : 0;
        const barColor = u.done ? "var(--green)" : u.made > 0 ? "var(--gold)" : "transparent";
        const status = u.done
          ? `<span class="badge badge-open">All done</span>`
          : u.made === 0
          ? `<span class="badge badge-closed">Not started</span>`
          : `<span class="badge badge-upcoming">${totalM - u.made} left</span>`;
        return `
          <tr>
            <td>
              <div class="flex">
                <div class="user-avatar" style="width:28px;height:28px;font-size:0.75rem">${initials(u.name)}</div>
                <span>${u.name}</span>
              </div>
            </td>
            <td style="text-align:center" class="stat-cell">${u.made}/${totalM}</td>
            <td style="min-width:140px">
              <div style="background:var(--border);border-radius:4px;height:8px;overflow:hidden">
                <div style="background:${barColor};height:100%;width:${pct}%;border-radius:4px;transition:width 0.4s"></div>
              </div>
            </td>
            <td style="text-align:right">${status}</td>
          </tr>`;
      }).join("")}
    </tbody>`;
}

function renderPlayerList(users, rounds, matches, predictions, pickCounts) {
  if (!users.length) {
    document.getElementById("playersTable").innerHTML =
      `<tr><td colspan="5"><div class="empty-state"><div class="icon">👥</div><h3>No players yet</h3></div></td></tr>`;
    return;
  }

  const activeRounds = rounds.filter(r => r.status !== "upcoming");

  const userPoints = {};
  users.forEach(u => {
    const picks = predictions[u.id] || {};
    let total = 0;
    activeRounds.forEach(round => {
      Object.values(matches).forEach(match => {
        if (match.roundId !== round.id) return;
        if (match.freebie) { total += ROUND_POINTS[round.id]; return; }
        if (!match.result) return;
        const pick = picks[match.id];
        if (!pick) return;
        const winner = typeof pick === "object" ? pick.winner : pick;
        if (winner !== match.result) return;
        let pts = ROUND_POINTS[round.id];
        if (isMaverick(match.id, winner, pickCounts)) pts += 1;
        if (typeof pick === "object") {
          const s1 = parseInt(pick.score1), s2 = parseInt(pick.score2);
          let a1 = parseInt(match.score1), a2 = parseInt(match.score2);
          const isPens = !isNaN(a1) && !isNaN(a2) && a1 === a2 && !!match.result;
          if (isPens) { if (match.result === "team1") a1++; else a2++; }
          let ps1 = s1, ps2 = s2;
          if (isPens && !isNaN(ps1) && !isNaN(ps2) && ps1 === ps2 && winner) {
            if (winner === "team1") ps1++; else ps2++;
          }
          if (!isNaN(ps1) && !isNaN(ps2) && !isNaN(a1) && !isNaN(a2)) {
            if (ps1 === a1 && ps2 === a2) pts += 6;
            else if ((ps1 - ps2) === (a1 - a2)) pts += 1;
            else pts -= 1;
          }
        }
        total += pts;
      });
    });
    userPoints[u.id] = total;
  });

  const sorted = [...users].sort((a, b) =>
    (userPoints[b.id] || 0) - (userPoints[a.id] || 0) || a.name.localeCompare(b.name)
  );

  document.getElementById("playersTable").innerHTML = `
    <thead>
      <tr>
        <th style="width:48px">#</th>
        <th>Name</th>
        <th>Email</th>
        <th style="text-align:right">Points</th>
        <th style="text-align:right">Joined</th>
      </tr>
    </thead>
    <tbody>
      ${sorted.map((u, i) => {
        const joined = u.joinedAt?.toDate
          ? u.joinedAt.toDate().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
          : "–";
        return `
          <tr>
            <td><span class="rank-badge ${i < 3 ? `rank-${i + 1}` : ""}">${i + 1}</span></td>
            <td>
              <div class="flex">
                <div class="user-avatar" style="width:28px;height:28px;font-size:0.75rem">${initials(u.name)}</div>
                <span>${u.name}</span>
              </div>
            </td>
            <td class="stat-cell">${u.email || "–"}</td>
            <td style="text-align:right"><span class="points-big">${userPoints[u.id] || 0}</span></td>
            <td style="text-align:right" class="stat-cell">${joined}</td>
          </tr>`;
      }).join("")}
    </tbody>`;
}

function renderPicksMatrix(users, rounds, matches, predictions) {
  const container = document.getElementById("picksMatrix");
  if (!container) return;

  const activeRounds = rounds.filter(r => r.status !== "upcoming");
  if (!activeRounds.length) {
    container.innerHTML = `<p class="text-muted" style="text-align:center;padding:1rem 0">No active rounds yet.</p>`;
    return;
  }

  const sortedUsers = [...users].sort((a, b) => a.name.localeCompare(b.name));
  const shortName = n => n.split(" ")[0];
  const shorten = (s, max) => s && s.length > max ? s.slice(0, max) + "…" : (s || "TBD");

  let html = "";

  activeRounds.forEach(round => {
    const roundMatches = Object.values(matches)
      .filter(m => m.roundId === round.id && !m.freebie)
      .sort((a, b) => {
        const ta = a.kickoff ? (a.kickoff.toDate ? a.kickoff.toDate() : new Date(a.kickoff)).getTime() : 0;
        const tb = b.kickoff ? (b.kickoff.toDate ? b.kickoff.toDate() : new Date(b.kickoff)).getTime() : 0;
        return ta - tb;
      });
    if (!roundMatches.length) return;

    const rows = roundMatches.map(match => {
      const t1 = match.team1 || "TBD", t2 = match.team2 || "TBD";
      const origA1 = parseInt(match.score1), origA2 = parseInt(match.score2);
      let adjA1 = origA1, adjA2 = origA2;
      const isPens = !isNaN(origA1) && !isNaN(origA2) && origA1 === origA2 && match.result;
      if (isPens) { if (match.result === "team1") adjA1++; else adjA2++; }

      const resultLabel = match.result
        ? `${origA1}–${origA2}${isPens ? " pens" : ""} · ${match.result === "team1" ? shorten(t1, 12) : shorten(t2, 12)} wins`
        : "";

      const cells = sortedUsers.map(u => {
        const pick = (predictions[u.id] || {})[match.id];
        if (!pick) return `<td style="text-align:center;color:var(--text-dim);font-size:0.8rem">–</td>`;

        const winner = typeof pick === "object" ? pick.winner : pick;
        const pickedTeam = winner === "team1" ? t1 : t2;
        const s1 = pick.score1 != null ? parseInt(pick.score1) : NaN;
        const s2 = pick.score2 != null ? parseInt(pick.score2) : NaN;
        const scoreStr = !isNaN(s1) && !isNaN(s2) ? `${s1}–${s2}` : "";

        let color = "inherit", icon = "";
        if (match.result) {
          if (winner === match.result) {
            let ps1 = s1, ps2 = s2;
            if (isPens && !isNaN(ps1) && !isNaN(ps2) && ps1 === ps2 && winner) {
              if (winner === "team1") ps1++; else ps2++;
            }
            const exact = !isNaN(ps1) && !isNaN(ps2) && ps1 === adjA1 && ps2 === adjA2;
            color = "var(--green)";
            icon = exact ? "★ " : "✓ ";
          } else {
            color = "var(--text-dim)";
            icon = "✗ ";
          }
        }

        return `<td style="text-align:center;font-size:0.78rem;color:${color}">
          <div style="font-weight:600;white-space:nowrap">${icon}${shorten(pickedTeam, 11)}</div>
          ${scoreStr ? `<div style="font-size:0.7rem;opacity:0.75">${scoreStr}</div>` : ""}
        </td>`;
      }).join("");

      return `<tr>
        <td style="white-space:nowrap">
          <div style="font-size:0.8rem;font-weight:600">${shorten(t1, 14)} <span style="color:var(--text-dim)">v</span> ${shorten(t2, 14)}</div>
          ${resultLabel ? `<div style="font-size:0.7rem;color:var(--text-muted)">${resultLabel}</div>` : ""}
        </td>
        ${cells}
      </tr>`;
    }).join("");

    html += `
      <h3 style="font-size:0.95rem;font-weight:700;margin:1.5rem 0 0.5rem;color:var(--navy)">${round.name}</h3>
      <div style="overflow-x:auto;margin-bottom:0.5rem">
        <table class="leaderboard-table" style="min-width:max-content">
          <thead>
            <tr>
              <th style="min-width:160px">Match</th>
              ${sortedUsers.map(u => `<th style="text-align:center;min-width:72px">${shortName(u.name)}</th>`).join("")}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  });

  container.innerHTML = html || `<p class="text-muted" style="text-align:center;padding:1rem 0">No picks yet.</p>`;
}

initAdmin();
