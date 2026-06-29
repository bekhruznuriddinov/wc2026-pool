const _statsUser = getSession();
if (_statsUser) renderUserBar(_statsUser);

const CHART_COLORS = [
  "#378ADD","#1D9E75","#D85A30","#7F77DD","#D4537E",
  "#BA7517","#639922","#E24B4A","#185FA5","#0F6E56",
];

function calcPts(roundId, match, pick) {
  if (!match.result) return null;
  if (match.freebie) return ROUND_POINTS[roundId];
  if (!pick?.winner) return 0;
  const correctWin = pick.winner === match.result;
  let pts = correctWin ? ROUND_POINTS[roundId] : 0;
  const s1 = parseInt(pick.score1), s2 = parseInt(pick.score2);
  const a1 = parseInt(match.score1), a2 = parseInt(match.score2);
  if (!isNaN(s1) && !isNaN(s2) && !isNaN(a1) && !isNaN(a2)) {
    if (s1 === a1 && s2 === a2) { if (correctWin) pts += 6; }
    else if ((s1 - s2) === (a1 - a2)) { if (correctWin) pts += 1; }
    else if (correctWin) pts -= 1;
  }
  return pts;
}

function isExact(match, pick) {
  if (!match.result || !pick?.winner || pick.winner !== match.result) return false;
  const s1 = parseInt(pick.score1), s2 = parseInt(pick.score2);
  const a1 = parseInt(match.score1), a2 = parseInt(match.score2);
  return !isNaN(s1) && !isNaN(s2) && !isNaN(a1) && !isNaN(a2) && s1 === a1 && s2 === a2;
}

async function initStats() {
  try {
    const [usersSnap, roundsSnap, matchesSnap, predsSnap] = await Promise.all([
      db.collection("users").get(),
      db.collection("rounds").orderBy("order").get(),
      db.collection("matches").get(),
      db.collection("predictions").get(),
    ]);

    const users = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const rounds = roundsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const matches = {};
    matchesSnap.docs.forEach(d => { matches[d.id] = { id: d.id, ...d.data() }; });
    const allPreds = {};
    predsSnap.docs.forEach(d => { allPreds[d.id] = d.data().picks || {}; });

    const activeRounds = rounds.filter(r => r.status !== "upcoming");

    // Pick counts per match across all users
    const pickCounts = {};
    users.forEach(u => {
      const picks = allPreds[u.id] || {};
      Object.entries(picks).forEach(([matchId, pick]) => {
        const winner = (pick && typeof pick === "object") ? pick.winner : pick;
        if (winner !== "team1" && winner !== "team2") return;
        if (!pickCounts[matchId]) pickCounts[matchId] = { team1: 0, team2: 0 };
        pickCounts[matchId][winner]++;
      });
    });

    // Per-user stats
    const ranked = users.map(u => {
      const picks = allPreds[u.id] || {};
      const roundScores = {};
      const matchResults = {};
      let totalPoints = 0, statExact = 0, statContrarian = 0;

      activeRounds.forEach(round => {
        let rScore = 0;
        Object.values(matches).forEach(match => {
          if (match.roundId !== round.id) return;
          const pick = match.freebie ? { winner: match.result } : (picks[match.id] || null);
          const pts = calcPts(round.id, match, pick);
          if (pts === null) return;
          rScore += pts;
          const correct = match.freebie || pick?.winner === match.result;
          const exact = isExact(match, pick);
          const hasPick = match.freebie || !!(picks[match.id]?.winner || (typeof picks[match.id] === "string" && picks[match.id]));
          if (exact) statExact++;
          matchResults[match.id] = { pts, correct, exact, hasPick };
        });
        roundScores[round.id] = rScore;
        totalPoints += rScore;
      });

      // Contrarian: picked minority team on a decided match
      Object.entries(picks).forEach(([matchId, pick]) => {
        const match = matches[matchId];
        if (!match?.result) return;
        const winner = (pick && typeof pick === "object") ? pick.winner : pick;
        if (winner !== "team1" && winner !== "team2") return;
        const counts = pickCounts[matchId];
        if (!counts) return;
        const total = counts.team1 + counts.team2;
        if (total < 2) return;
        if (counts[winner] < total / 2) statContrarian++;
      });

      return { ...u, totalPoints, roundScores, matchResults, statExact, statContrarian };
    }).sort((a, b) => b.totalPoints - a.totalPoints || a.name.localeCompare(b.name));

    document.getElementById("loading").style.display = "none";
    document.getElementById("statsContent").style.display = "block";

    renderSpotlight(ranked, matches, pickCounts);
    renderPointsRace(ranked, activeRounds);
    renderConsensus(matches, rounds, pickCounts);
    renderHeatmap(ranked, matches, rounds);

  } catch (err) {
    console.error(err);
    document.getElementById("loading").innerHTML = `<p style="color:var(--text-muted);text-align:center">Failed to load stats.</p>`;
  }
}

function renderSpotlight(ranked, matches, pickCounts) {
  const decidedMatches = Object.values(matches).filter(m => m.result);

  // Biggest upset
  let upset = null, lowestPct = 1;
  decidedMatches.forEach(m => {
    const c = pickCounts[m.id];
    if (!c) return;
    const total = c.team1 + c.team2;
    if (total < 2) return;
    const pct = (c[m.result] || 0) / total;
    if (pct < lowestPct) { lowestPct = pct; upset = { m, total, correct: c[m.result] || 0 }; }
  });

  const guru     = [...ranked].filter(u => u.statExact > 0).sort((a,b) => b.statExact - a.statExact)[0];
  const maverick = [...ranked].filter(u => u.statContrarian > 0).sort((a,b) => b.statContrarian - a.statContrarian)[0];

  // Leader — handle ties
  const topScore  = ranked.length ? ranked[0].totalPoints : 0;
  const leaders   = ranked.filter(u => u.totalPoints === topScore && topScore > 0);
  let leaderValue, leaderSub;
  if (!leaders.length) {
    leaderValue = `<div class="spotlight-value spotlight-empty">–</div>`;
    leaderSub   = "No picks yet";
  } else if (leaders.length === 1) {
    leaderValue = `<div class="spotlight-value" style="color:var(--green)">${leaders[0].name}</div>`;
    leaderSub   = `${topScore} pts`;
  } else {
    const names = leaders.length <= 3
      ? leaders.map(u => u.name.split(" ")[0]).join(", ")
      : `${leaders.length} players`;
    leaderValue = `<div class="spotlight-value" style="font-size:0.9rem;color:var(--green)">${names}</div>`;
    leaderSub   = `Tied at ${topScore} pts`;
  }

  const card = (label, valueHtml, sub) => `
    <div class="spotlight-card">
      <div class="spotlight-label">${label}</div>
      ${valueHtml}
      <div class="spotlight-sub">${sub}</div>
    </div>`;

  const upsetCard = upset
    ? card("Biggest upset",
        `<div class="spotlight-value">${upset.m.result === "team1" ? upset.m.team1 : upset.m.team2}</div>`,
        `Only ${upset.correct}/${upset.total} called it (${Math.round(lowestPct*100)}%)`)
    : card("Biggest upset",
        `<div class="spotlight-value spotlight-empty">–</div>`,
        "Updates after first results");

  const guruCard = guru
    ? card("Score guru",
        `<div class="spotlight-value" style="color:var(--gold)">${guru.name}</div>`,
        `${guru.statExact} exact score${guru.statExact !== 1 ? "s" : ""}`)
    : card("Score guru",
        `<div class="spotlight-value spotlight-empty">–</div>`,
        "Most exact score predictions");

  const maverickCard = maverick
    ? card("Maverick",
        `<div class="spotlight-value" style="color:#7F77DD">${maverick.name}</div>`,
        `${maverick.statContrarian} minority pick${maverick.statContrarian !== 1 ? "s" : ""}`)
    : card("Maverick",
        `<div class="spotlight-value spotlight-empty">–</div>`,
        "Most picks against the crowd");

  document.getElementById("spotlightCards").innerHTML =
    card("Current leader", leaderValue, leaderSub) + upsetCard + guruCard + maverickCard;
}


function renderPointsRace(ranked, activeRounds) {
  if (activeRounds.length < 1 || ranked.length === 0) {
    document.getElementById("pointsRaceSection").style.display = "none";
    return;
  }
  const labels = activeRounds.map(r => r.name);
  const datasets = ranked.map((u, i) => {
    let cum = 0;
    return {
      label: u.name,
      data: activeRounds.map(r => { cum += u.roundScores[r.id] || 0; return cum; }),
      borderColor: CHART_COLORS[i % CHART_COLORS.length],
      backgroundColor: "transparent",
      tension: 0.3,
      pointRadius: 4,
      borderWidth: 2,
    };
  });

  new Chart(document.getElementById("pointsRaceChart").getContext("2d"), {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "bottom", labels: { color: "#5A6B80", font: { size: 11 }, boxWidth: 12, padding: 12 } },
      },
      scales: {
        x: { ticks: { color: "#5A6B80", font: { size: 11 } }, grid: { color: "rgba(90,107,128,0.15)" } },
        y: { ticks: { color: "#5A6B80", font: { size: 11 } }, grid: { color: "rgba(90,107,128,0.15)" }, beginAtZero: true },
      },
    },
  });
}

function renderConsensus(matches, rounds, pickCounts) {
  const activeRounds = rounds.filter(r => r.status !== "upcoming");
  let html = "";

  activeRounds.forEach(round => {
    const roundMatches = Object.values(matches)
      .filter(m => m.roundId === round.id && m.team1 && m.team1 !== "TBD" && !m.freebie && (m.result || pickCounts[m.id]))
      .sort((a, b) => (a.matchNum || 0) - (b.matchNum || 0));
    if (!roundMatches.length) return;

    html += `<div class="consensus-round-label">${round.name}</div>`;

    roundMatches.forEach(match => {
      const c = pickCounts[match.id] || { team1: 0, team2: 0 };
      const total = c.team1 + c.team2;
      const pct1 = total ? Math.round((c.team1 / total) * 100) : 50;
      const pct2 = 100 - pct1;
      const t1won = match.result === "team1";
      const t2won = match.result === "team2";

      html += `
        <div class="consensus-row">
          <div class="consensus-bar-wrap">
            <div class="consensus-team ${t1won ? "ct-won" : match.result ? "ct-lost" : ""}">${match.team1}</div>
            <div class="consensus-track">
              <div class="consensus-fill ${t1won ? "cf-win" : match.result ? "cf-lose" : c.team1 >= c.team2 ? "cf-fav" : "cf-und"}" style="width:${pct1}%">
                ${pct1 >= 18 ? `<span>${pct1}%</span>` : ""}
              </div>
              <div class="consensus-fill ${t2won ? "cf-win" : match.result ? "cf-lose" : c.team2 > c.team1 ? "cf-fav" : "cf-und"}" style="width:${pct2}%;justify-content:flex-end">
                ${pct2 >= 18 ? `<span>${pct2}%</span>` : ""}
              </div>
            </div>
            <div class="consensus-team ct-right ${t2won ? "ct-won" : match.result ? "ct-lost" : ""}">${match.team2}</div>
          </div>
          <div class="consensus-meta">${total} pick${total !== 1 ? "s" : ""}${match.result ? ` · ${t1won ? match.team1 : match.team2} won` : ""}</div>
        </div>`;
    });
  });

  document.getElementById("consensusList").innerHTML = html || `<p style="color:var(--text-muted)">No match data yet.</p>`;
}

function renderHeatmap(ranked, matches, rounds) {
  const activeRounds = rounds.filter(r => r.status !== "upcoming");
  const decided = activeRounds.flatMap(round =>
    Object.values(matches)
      .filter(m => m.roundId === round.id && (m.result || m.freebie) && m.team1 && m.team1 !== "TBD")
      .sort((a, b) => (a.matchNum || 0) - (b.matchNum || 0))
  );

  if (!decided.length || !ranked.length) {
    document.getElementById("heatmap").innerHTML = `<p style="color:var(--text-muted)">No results yet.</p>`;
    return;
  }

  let html = `<div class="hm-grid">`;

  // Header
  html += `<div class="hm-row"><div class="hm-name-cell"></div>`;
  decided.forEach(m => {
    html += `<div class="hm-cell hm-col-head" title="${m.team1} vs ${m.team2}">${m.matchNum || "?"}</div>`;
  });
  html += `</div>`;

  // Player rows
  ranked.forEach(u => {
    html += `<div class="hm-row"><div class="hm-name-cell"><span class="hm-name">${u.name}</span></div>`;
    decided.forEach(m => {
      const r = u.matchResults[m.id];
      let cls = "hm-cell ";
      let tip = "";
      if (!r || !r.hasPick) {
        cls += "hm-no-pick"; tip = "no pick";
      } else if (r.exact) {
        cls += "hm-exact"; tip = `exact score +${r.pts}pts`;
      } else if (r.correct) {
        cls += "hm-correct"; tip = `correct +${r.pts}pts`;
      } else {
        cls += "hm-wrong"; tip = "wrong";
      }
      html += `<div class="${cls}" title="${tip}"></div>`;
    });
    html += `</div>`;
  });

  html += `</div>`;
  document.getElementById("heatmap").innerHTML = html;
}

initStats();
