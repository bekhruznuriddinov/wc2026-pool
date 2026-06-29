const _lbUser = getSession();
if (_lbUser) renderUserBar(_lbUser);

async function initLeaderboard() {
  document.getElementById("loading").style.display = "flex";

  try {
    // Load all users
    const usersSnap = await db.collection("users").get();
    const users = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Load all rounds (for column headers)
    const roundsSnap = await db.collection("rounds").orderBy("order").get();
    const rounds = roundsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const activeRounds = rounds.filter(r => r.status === "complete" || r.status === "open");

    // Load all matches (for scoring reference)
    const matchesSnap = await db.collection("matches").get();
    const matches = {};
    matchesSnap.docs.forEach(d => { matches[d.id] = d.data(); });

    // Load all predictions
    const predsSnap = await db.collection("predictions").get();
    const predictions = {};
    predsSnap.docs.forEach(d => { predictions[d.id] = d.data(); });

    // Total real matches in active rounds (denominator for stats columns)
    const totalMatches = Object.values(matches).filter(m => {
      const round = rounds.find(r => r.id === m.roundId);
      return round && round.status !== "upcoming" && m.team1 && m.team1 !== "TBD";
    }).length;

    // Calculate scores for each user
    const ranked = users.map(u => {
      const userPreds = predictions[u.id] || {};
      const picks = userPreds.picks || {};

      let totalPoints = 0;
      let statPicked = 0;    // picks made for decided matches
      let statCorrect = 0;   // correct winner
      let statMargin = 0;    // correct winner + correct goal difference
      let statExact = 0;     // correct winner + exact scoreline
      const roundScores = {};

      rounds.forEach(round => {
        if (round.status === "upcoming") return;
        let rScore = 0;
        Object.entries(matches).forEach(([matchId, match]) => {
          if (match.roundId !== round.id) return;

          // Freebie: everyone gets base round points, no result needed
          if (match.freebie) {
            statPicked++;
            statCorrect++;
            rScore += ROUND_POINTS[round.id];
            return;
          }

          if (!match.result) return;

          const pick = picks[matchId];
          if (!pick) return;

          statPicked++;
          const winner = typeof pick === "object" ? pick.winner : pick;
          const correctWin = winner === match.result;
          if (correctWin) statCorrect++;

          let pts = correctWin ? ROUND_POINTS[round.id] : 0;

          if (typeof pick === "object" && pick.score1 !== null && pick.score2 !== null) {
            const s1 = parseInt(pick.score1), s2 = parseInt(pick.score2);
            const a1 = parseInt(match.score1), a2 = parseInt(match.score2);
            if (!isNaN(s1) && !isNaN(s2) && !isNaN(a1) && !isNaN(a2)) {
              if (s1 === a1 && s2 === a2) {
                if (correctWin) { statExact++; statMargin++; pts += 6; } // +5 exact +1 margin
              } else if ((s1 - s2) === (a1 - a2)) {
                if (correctWin) { statMargin++; pts += 1; }
              } else if (correctWin) {
                pts -= 1; // penalty only neutralises a winner pick, never goes negative
              }
            }
          }
          rScore += pts;
        });
        roundScores[round.id] = rScore;
        totalPoints += rScore;
      });

      return { ...u, totalPoints, statPicked, statCorrect, statMargin, statExact, roundScores };
    });

    // Sort by total points desc, then name
    ranked.sort((a, b) => b.totalPoints - a.totalPoints || a.name.localeCompare(b.name));

    document.getElementById("loading").style.display = "none";

    // Stats
    document.getElementById("playerCount").textContent = ranked.length;
    document.getElementById("roundsComplete").textContent =
      rounds.filter(r => r.status === "complete").length;
    document.getElementById("topScore").textContent =
      ranked.length ? ranked[0].totalPoints : 0;

    // Table
    if (ranked.length === 0) {
      document.getElementById("tableWrap").innerHTML =
        `<div class="empty-state"><div class="icon">🏆</div><h3>No players yet</h3><p>Be the first to join!</p></div>`;
      return;
    }

    const scoredRounds = rounds.filter(r => r.status !== "upcoming");

    document.getElementById("tableWrap").innerHTML = `
      <table class="leaderboard-table">
        <thead>
          <tr>
            <th style="width:48px">#</th>
            <th>Player</th>
            ${scoredRounds.map(r => `
              <th style="text-align:center">
                ${r.name.split(" ")[0]}
                ${r.status === "open" || r.status === "closed"
                  ? `<span class="badge badge-open" style="font-size:0.55rem;margin-left:3px">live</span>`
                  : ""}
                <br><span style="color:var(--text-dim);font-size:0.65rem">${ROUND_POINTS[r.id]}pt ea</span>
              </th>`).join("")}
            <th style="text-align:center">Picked<br><span style="color:var(--text-dim);font-size:0.65rem">submitted</span></th>
            <th style="text-align:center">Winners<br><span style="color:var(--text-dim);font-size:0.65rem">correct</span></th>
            <th style="text-align:center">Margin<br><span style="color:var(--text-dim);font-size:0.65rem">+1 bonus</span></th>
            <th style="text-align:center">Exact<br><span style="color:var(--text-dim);font-size:0.65rem">+5 bonus</span></th>
            <th style="text-align:right">Total</th>
          </tr>
        </thead>
        <tbody>
          ${ranked.map((u, i) => {
            const rank = i + 1;
            const rankClass = rank <= 3 ? `rank-${rank}` : "";
            return `
              <tr>
                <td><span class="rank-badge ${rankClass}">${rank}</span></td>
                <td>
                  <div class="flex">
                    <div class="user-avatar" style="width:28px;height:28px;font-size:0.75rem">${initials(u.name)}</div>
                    <span>${u.name}</span>
                  </div>
                </td>
                ${scoredRounds.map(r => `<td style="text-align:center"><span class="score-chip">${u.roundScores[r.id] || 0}</span></td>`).join("")}
                <td style="text-align:center" class="stat-cell">${u.statPicked}/${totalMatches}</td>
                <td style="text-align:center" class="stat-cell">${u.statCorrect}/${totalMatches}</td>
                <td style="text-align:center" class="stat-cell">${u.statMargin}/${totalMatches}</td>
                <td style="text-align:center" class="stat-cell">${u.statExact}/${totalMatches}</td>
                <td style="text-align:right"><span class="points-big">${u.totalPoints}</span></td>
              </tr>`;
          }).join("")}
        </tbody>
      </table>
    `;

  } catch (err) {
    console.error(err);
    document.getElementById("loading").innerHTML =
      `<p class="text-muted">Failed to load leaderboard.</p>`;
  }
}

function initials(name) {
  return (name || "?").split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase();
}

initLeaderboard();
