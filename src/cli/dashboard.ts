import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { listAllMemories } from "../learning/consolidator.js";
import {
  computeBurrStats,
  computeLearningProgression,
} from "../metrics/tracker.js";
import { listRuns, loadRun } from "../runtime/action-ledger.js";
import { userHome } from "../shared/home.js";

function renderHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Burr Dashboard | Local Learning & Reliability Runtime</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20128%20128%22%20role%3D%22img%22%20aria-label%3D%22Burr%22%3E%0A%20%20%3Crect%20width%3D%22128%22%20height%3D%22128%22%20fill%3D%22%230F0F0E%22%2F%3E%0A%20%20%3Cg%20transform%3D%22translate%2864%2064%29%22%3E%0A%20%20%20%20%3Cg%20fill%3D%22%23F4EEE7%22%3E%0A%20%20%20%20%20%20%3Cpath%20transform%3D%22rotate%2815%29%22%20d%3D%22M4.6-16.2%20C6.4-28%207.2-38%205.4-46.2%20C12.8-44.6%2016.2-40.4%2014.8-33.6%20L8.8-16.4%20Z%22%2F%3E%0A%20%20%20%20%20%20%3Cpath%20transform%3D%22rotate%28105%29%22%20d%3D%22M4.6-16.2%20C6.4-28%207.2-38%205.4-46.2%20C12.8-44.6%2016.2-40.4%2014.8-33.6%20L8.8-16.4%20Z%22%2F%3E%0A%20%20%20%20%20%20%3Cpath%20transform%3D%22rotate%28150%29%22%20d%3D%22M4.6-16.2%20C6.4-28%207.2-38%205.4-46.2%20C12.8-44.6%2016.2-40.4%2014.8-33.6%20L8.8-16.4%20Z%22%2F%3E%0A%20%20%20%20%20%20%3Cpath%20transform%3D%22rotate%28195%29%22%20d%3D%22M4.6-16.2%20C6.4-28%207.2-38%205.4-46.2%20C12.8-44.6%2016.2-40.4%2014.8-33.6%20L8.8-16.4%20Z%22%2F%3E%0A%20%20%20%20%20%20%3Cpath%20transform%3D%22rotate%28240%29%22%20d%3D%22M4.6-16.2%20C6.4-28%207.2-38%205.4-46.2%20C12.8-44.6%2016.2-40.4%2014.8-33.6%20L8.8-16.4%20Z%22%2F%3E%0A%20%20%20%20%20%20%3Cpath%20transform%3D%22rotate%28285%29%22%20d%3D%22M4.6-16.2%20C6.4-28%207.2-38%205.4-46.2%20C12.8-44.6%2016.2-40.4%2014.8-33.6%20L8.8-16.4%20Z%22%2F%3E%0A%20%20%20%20%20%20%3Cpath%20transform%3D%22rotate%2860%29%22%20d%3D%22M4.6-16.2%20C6.4-28%207.2-38%205.4-46.2%20C12.8-44.6%2016.2-40.4%2014.8-33.6%20L8.8-16.4%20Z%22%2F%3E%0A%20%20%20%20%3C%2Fg%3E%0A%20%20%20%20%3Cpath%20transform%3D%22rotate%28330%29%22%20fill%3D%22%23FF5A1F%22%20d%3D%22M4.6-16.2%20C6.4-28%207.2-38%205.4-46.2%20C12.8-44.6%2016.2-40.4%2014.8-33.6%20L8.8-16.4%20Z%22%2F%3E%0A%20%20%20%20%3Ccircle%20r%3D%2217.5%22%20fill%3D%22%23F4EEE7%22%2F%3E%0A%20%20%3C%2Fg%3E%0A%3C%2Fsvg%3E%0A">
  <style>
    :root {
      --ink: #0F0F0E;
      --cream: #F4EEE7;
      --cream-card: #FFFFFF;
      --ember: #FF5A1F;
      --ember-light: #FFF0EB;
      --border: #E5DCD2;
      --text-muted: #6E6861;
      --green: #10B981;
      --red: #EF4444;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--cream);
      color: var(--ink);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.5;
      padding: 24px;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 2px solid var(--border);
    }
    .brand { display: flex; align-items: center; gap: 12px; }
    .brand-logo {
      width: 32px;
      height: 32px;
      background: var(--ember);
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: 900;
      font-size: 18px;
    }
    .brand h1 { font-size: 24px; font-weight: 800; letter-spacing: -0.5px; }
    .brand p { font-size: 14px; color: var(--text-muted); }
    .badge {
      background: var(--ember-light);
      color: var(--ember);
      padding: 4px 10px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 700;
    }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .card {
      background: var(--cream-card);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 16px 20px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.03);
    }
    .card-title { font-size: 13px; color: var(--text-muted); text-transform: uppercase; font-weight: 600; margin-bottom: 6px; }
    .card-val { font-size: 28px; font-weight: 800; color: var(--ink); }
    .card-sub { font-size: 12px; color: var(--text-muted); margin-top: 4px; }
    .section-title { font-size: 18px; font-weight: 700; margin: 24px 0 12px; }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
    @media (max-width: 768px) { .two-col { grid-template-columns: 1fr; } }
    .bar-chart { margin-top: 12px; }
    .bar-row { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; font-size: 13px; }
    .bar-label { width: 80px; font-weight: 600; }
    .bar-track { flex: 1; height: 22px; background: var(--border); border-radius: 4px; overflow: hidden; position: relative; }
    .bar-fill { height: 100%; background: var(--ember); border-radius: 4px; transition: width 0.5s ease; }
    .bar-val { width: 60px; text-align: right; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; padding: 10px 12px; background: var(--cream); color: var(--text-muted); font-weight: 600; }
    td { padding: 10px 12px; border-top: 1px solid var(--border); }
    .tag { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600; }
    .tag-green { background: #DCFCE7; color: #15803D; }
    .tag-red { background: #FEE2E2; color: #B91C1C; }
    .tag-blue { background: #DBEAFE; color: #1D4ED8; }
    .tag-ember { background: var(--ember-light); color: var(--ember); }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="brand">
        <div class="brand-logo">B</div>
        <div>
          <h1>Burr Runtime Dashboard</h1>
          <p>Local Learning & Reliability Runtime for Coding Agents</p>
        </div>
      </div>
      <div>
        <span class="badge" id="localAddress">Local Mode</span>
      </div>
    </header>

    <div class="grid" id="statsGrid">
      <div class="card"><div class="card-title">Active Memories</div><div class="card-val" id="activeMemories">-</div><div class="card-sub" id="hitRateSub">Hit rate: -%</div></div>
      <div class="card"><div class="card-title">Candidates Awaiting Admission</div><div class="card-val" id="candidates">-</div><div class="card-sub">Caller verification required</div></div>
      <div class="card"><div class="card-title">Loops Prevented</div><div class="card-val" id="loopsDetected">-</div><div class="card-sub" id="blockedSub">- blocked</div></div>
      <div class="card"><div class="card-title">Verified Recoveries</div><div class="card-val" id="verifiedRecoveries">-</div><div class="card-sub" id="reusedSub">- reused</div></div>
    </div>

    <div class="two-col">
      <div class="card">
        <div class="card-title">Learning Progression (Tool Calls per Task)</div>
        <div class="bar-chart" id="progressionChart">
          <p style="color: var(--text-muted); font-size: 13px;">Loading learning curves...</p>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Loop Guard Risk Breakdown</div>
        <div class="bar-chart" id="loopBreakdown">
          <p style="color: var(--text-muted); font-size: 13px;">Loading loop statistics...</p>
        </div>
      </div>
    </div>

    <div class="card" style="margin-bottom: 24px;">
      <div class="card-title" style="margin-bottom: 12px;">Active Memory & Learned Rules</div>
      <div style="overflow-x: auto;">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Type</th>
              <th>Scope</th>
              <th>Confidence</th>
              <th>Learned Statement</th>
              <th>Reuse (Pass/Fail)</th>
            </tr>
          </thead>
          <tbody id="memoriesTable">
            <tr><td colspan="6" style="text-align: center; color: var(--text-muted);">Loading memories...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-title" style="margin-bottom: 12px;">Recent Execution Runs</div>
      <div style="overflow-x: auto;">
        <table>
          <thead>
            <tr>
              <th>Session ID</th>
              <th>Harness</th>
              <th>Tool Calls</th>
              <th>Failed Calls</th>
              <th>Loops Detected</th>
              <th>Duration</th>
              <th>Verified</th>
            </tr>
          </thead>
          <tbody id="runsTable">
            <tr><td colspan="7" style="text-align: center; color: var(--text-muted);">Loading sessions...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <script>
    function escapeHtml(value) {
      return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    document.getElementById('localAddress').innerText = location.host + ' | Local Mode';
    async function refreshDashboard() {
      try {
        const statsRes = await fetch('/api/stats');
        const stats = await statsRes.json();

        document.getElementById('activeMemories').innerText = stats.memory.active;
        document.getElementById('hitRateSub').innerText = 'Hit rate: ' + stats.memory.hitRate + '% (' + stats.memory.hits + ' hits / ' + stats.memory.searches + ' searches)';
        document.getElementById('candidates').innerText = stats.memory.candidates;
        document.getElementById('loopsDetected').innerText = stats.runtime.loopsDetected.total;
        document.getElementById('blockedSub').innerText = stats.runtime.actionsBlocked + ' actions blocked';
        document.getElementById('verifiedRecoveries').innerText = stats.runtime.verifiedRecoveries;
        document.getElementById('reusedSub').innerText = stats.learning.successfulReuse + ' successful reuses';

        // Loop breakdown
        const loops = stats.runtime.loopsDetected;
        const maxLoop = Math.max(1, loops.exact, loops.fuzzy, loops.cycles, loops.stagnation);
        document.getElementById('loopBreakdown').innerHTML = \`
          <div class="bar-row"><span class="bar-label">Exact repeat</span><div class="bar-track"><div class="bar-fill" style="width:\${(loops.exact/maxLoop)*100}%;"></div></div><span class="bar-val">\${loops.exact}</span></div>
          <div class="bar-row"><span class="bar-label">Fuzzy repeat</span><div class="bar-track"><div class="bar-fill" style="width:\${(loops.fuzzy/maxLoop)*100}%;"></div></div><span class="bar-val">\${loops.fuzzy}</span></div>
          <div class="bar-row"><span class="bar-label">Cycles (2-6)</span><div class="bar-track"><div class="bar-fill" style="width:\${(loops.cycles/maxLoop)*100}%;"></div></div><span class="bar-val">\${loops.cycles}</span></div>
          <div class="bar-row"><span class="bar-label">Stagnation</span><div class="bar-track"><div class="bar-fill" style="width:\${(loops.stagnation/maxLoop)*100}%;"></div></div><span class="bar-val">\${loops.stagnation}</span></div>
        \`;

        // Progression
        const progRes = await fetch('/api/progression');
        const progression = await progRes.json();
        if (progression && progression.length > 0) {
          const maxCalls = Math.max(...progression.map(p => p.toolCalls), 1);
          document.getElementById('progressionChart').innerHTML = progression.map(p => \`
            <div class="bar-row">
              <span class="bar-label">Run \${p.sequence}</span>
              <div class="bar-track"><div class="bar-fill" style="width:\${(p.toolCalls/maxCalls)*100}%;"></div></div>
              <span class="bar-val">\${p.toolCalls} calls</span>
            </div>
          \`).join('');
        } else {
          document.getElementById('progressionChart').innerHTML = '<p style="color: var(--text-muted); font-size: 13px;">No runs recorded yet. Start a session to observe learning.</p>';
        }

        // Memories
        const memRes = await fetch('/api/memories');
        const memories = await memRes.json();
        if (memories && memories.length > 0) {
          document.getElementById('memoriesTable').innerHTML = memories.map(m => \`
            <tr>
              <td><code>\${escapeHtml(m.id)}</code></td>
              <td><span class="tag tag-ember">\${escapeHtml(m.type)}</span></td>
              <td>\${escapeHtml(m.scope.repo || m.scope.repository || m.scope.level)}</td>
              <td>\${Math.round(m.confidence * 100)}%</td>
              <td>\${escapeHtml(m.statement || m.title)}</td>
              <td><span class="tag tag-green">\${escapeHtml(m.evidence.successfulReuse)}</span> / <span class="tag tag-red">\${escapeHtml(m.evidence.failedReuse)}</span></td>
            </tr>
          \`).join('');
        } else {
          document.getElementById('memoriesTable').innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No active memories yet.</td></tr>';
        }

        // Runs
        const runsRes = await fetch('/api/runs');
        const runs = await runsRes.json();
        if (runs && runs.length > 0) {
          document.getElementById('runsTable').innerHTML = runs.map(r => \`
            <tr>
              <td><code>\${escapeHtml(r.sessionId)}</code></td>
              <td><span class="tag tag-blue">\${escapeHtml(r.harness)}</span></td>
              <td>\${escapeHtml(r.toolCalls)}</td>
              <td>\${escapeHtml(r.failedCalls)}</td>
              <td>\${escapeHtml(r.loopsDetected)}</td>
              <td>\${Math.round(r.durationMs / 1000)}s</td>
              <td>\${r.verified ? '<span class="tag tag-green">Verified</span>' : '<span class="tag tag-red">Unverified</span>'}</td>
            </tr>
          \`).join('');
        } else {
          document.getElementById('runsTable').innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">No runs recorded yet.</td></tr>';
        }

      } catch (err) {
        console.error("Dashboard refresh error", err);
      }
    }

    refreshDashboard();
    setInterval(refreshDashboard, 5000);
  </script>
</body>
</html>`;
}

export async function runDashboard(
  options: { port?: number; home?: string } = {},
): Promise<number> {
  const port =
    options.port ?? (process.env.PORT ? Number(process.env.PORT) : 4747);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("Dashboard port must be an integer between 0 and 65535.");
  }
  const home = options.home ?? userHome();

  const server = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      const address = server.address();
      const activePort =
        address && typeof address !== "string" ? address.port : port;
      const hosts = [`127.0.0.1:${activePort}`, `localhost:${activePort}`];
      if (
        !hosts.includes(req.headers.host ?? "") ||
        (req.headers.origin &&
          req.headers.origin !== `http://${req.headers.host}`) ||
        req.headers["sec-fetch-site"] === "cross-site"
      ) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("Forbidden");
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { Allow: "GET, HEAD" });
        res.end();
        return;
      }
      try {
        const url = new URL(req.url || "/", "http://127.0.0.1");
        const pathname = url.pathname;

        if (pathname === "/") {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(renderHtml());
          return;
        }

        if (pathname === "/api/stats") {
          const stats = await computeBurrStats(home);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(stats));
          return;
        }

        if (pathname === "/api/progression") {
          const prog = await computeLearningProgression(home);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(prog));
          return;
        }

        if (pathname === "/api/memories") {
          const memories = await listAllMemories(home);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(memories));
          return;
        }

        if (pathname === "/api/runs") {
          const runIds = await listRuns(home);
          const runs = await Promise.all(
            runIds
              .slice(-20)
              .reverse()
              .map((id) => loadRun(home, id)),
          );
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(runs.filter(Boolean)));
          return;
        }

        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
      } catch {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Unable to read local dashboard data.");
      }
    },
  );

  return new Promise((resolve, reject) => {
    const stop = () => server.close(() => resolve(0));
    server.once("close", () => process.removeListener("SIGINT", stop));
    server.once("error", (error) => {
      process.removeListener("SIGINT", stop);
      reject(error);
    });
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const activePort =
        address && typeof address !== "string" ? address.port : port;
      console.log(`Burr Dashboard running at http://127.0.0.1:${activePort}/`);
      console.log("Press Ctrl+C to stop.");
    });

    process.once("SIGINT", stop);
  });
}
