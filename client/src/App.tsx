export default function App() {
  return (
    <div className="demo">
      <style>{css}</style>
      <header className="nav">
        <strong className="brand">Northline</strong>
        <nav className="nav-links">
          <a href="#overview">Overview</a>
          <a href="#routes">Routes</a>
          <a href="#dispatch">Dispatch</a>
          <a href="#billing">Billing</a>
        </nav>
        <button type="button" className="nav-cta">
          Open workspace
        </button>
      </header>

      <main>
        <section className="hero" id="overview">
          <p className="eyebrow">Fleet operations</p>
          <h1>Keep every route moving without the morning scramble</h1>
          <p className="lede">
            See late trucks, idle drivers, and missed windows in one place before the first delivery leaves the yard.
          </p>
          <div className="hero-actions">
            <button type="button" className="primary">
              Start a shift
            </button>
            <button type="button" className="ghost">
              Watch a two-minute tour
            </button>
          </div>
        </section>

        <section className="stats">
          <article>
            <p className="stat">128</p>
            <p>Active vehicles this hour</p>
          </article>
          <article>
            <p className="stat">6</p>
            <p>Routes waiting on a driver</p>
          </article>
          <article>
            <p className="stat">94%</p>
            <p>Stops completed on time today</p>
          </article>
        </section>

        <section className="split" id="routes">
          <article className="card">
            <h2>Today’s exceptions</h2>
            <ul className="rows">
              <li>
                <span className="badge warn">Late</span>
                <div>
                  <strong>Route 14B is 22 minutes behind</strong>
                  <p>Harbor loop. Last ping was at the fuel stop on 3rd.</p>
                </div>
              </li>
              <li>
                <span className="badge">Idle</span>
                <div>
                  <strong>Two drivers have not started</strong>
                  <p>Both were assigned before 7:00. Dispatch can reassign from here.</p>
                </div>
              </li>
              <li>
                <span className="badge ok">Clear</span>
                <div>
                  <strong>Downtown milk run is on pace</strong>
                  <p>Nine of twelve stops are already closed.</p>
                </div>
              </li>
            </ul>
          </article>

          <form className="card form" id="dispatch" onSubmit={(event) => event.preventDefault()}>
            <h2>Reassign a stop</h2>
            <label>
              Stop
              <input defaultValue="Harbor loop · dock 4" />
            </label>
            <label>
              Driver
              <select defaultValue="alex">
                <option value="alex">Alex Morgan</option>
                <option value="sam">Sam Patel</option>
                <option value="riley">Riley Chen</option>
              </select>
            </label>
            <label>
              Note for the driver
              <textarea defaultValue="Use the side gate. The main door is closed until noon." rows={3} />
            </label>
            <button type="submit" className="primary">
              Send reassignment
            </button>
          </form>
        </section>

        <section className="card table-wrap" id="billing">
          <div className="table-head">
            <h2>Open invoices</h2>
            <button type="button" className="ghost">
              Export week
            </button>
          </div>
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Route</th>
                <th>Status</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Cedar Market</td>
                <td>West side</td>
                <td>Due Friday</td>
                <td>$1,240</td>
              </tr>
              <tr>
                <td>Harbor Cold Storage</td>
                <td>Dock loop</td>
                <td>Past due</td>
                <td>$860</td>
              </tr>
              <tr>
                <td>Lumen Clinics</td>
                <td>Medical</td>
                <td>Paid</td>
                <td>$2,015</td>
              </tr>
            </tbody>
            </table>
        </section>

        <section className="plans">
          <article className="card plan">
            <h3>Yard</h3>
            <p className="price">$40</p>
            <p>One site, live map, and the morning exception list.</p>
            <button type="button" className="ghost">
              Choose Yard
            </button>
          </article>
          <article className="card plan featured">
            <h3>Network</h3>
            <p className="price">$120</p>
            <p>Every site, driver reassignment, and invoice status in the same view.</p>
            <button type="button" className="primary">
              Choose Network
            </button>
          </article>
          <article className="card plan">
            <h3>Region</h3>
            <p className="price">Talk</p>
            <p>Shared reporting across teams, with a named rollout owner.</p>
            <button type="button" className="ghost">
              Talk to sales
            </button>
          </article>
        </section>

        <aside className="banner">
          <strong>Maintenance window tonight</strong>
          <p>Maps stay available. Invoice export pauses from 1:00 to 1:20.</p>
        </aside>
      </main>
    </div>
  );
}

const css = `
.demo {
  min-height: 100vh;
  background: #f3f1ea;
  color: #1c1915;
  font-family: "Iowan Old Style", Palatino, Georgia, serif;
}
.demo button, .demo input, .demo select, .demo textarea, .demo table {
  font-family: ui-sans-serif, system-ui, sans-serif;
}
.nav {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 16px 28px;
  background: #1c1915;
  color: #f6f1e7;
}
.brand { letter-spacing: -0.03em; font-size: 18px; }
.nav-links { display: flex; gap: 16px; flex: 1; }
.nav-links a { color: #e7dfd2; text-decoration: none; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 14px; }
.nav-cta, .primary, .ghost {
  border-radius: 999px;
  padding: 8px 14px;
  cursor: pointer;
  font-size: 14px;
}
.nav-cta, .primary { border: 0; background: #c4552a; color: #fff; }
.ghost { border: 1px solid #c8bfb2; background: transparent; color: inherit; }
.nav-cta { margin-left: auto; }
main { max-width: 980px; margin: 0 auto; padding: 36px 20px 80px; display: flex; flex-direction: column; gap: 22px; }
.hero h1 { margin: 8px 0 0; font-size: 48px; line-height: 1.05; letter-spacing: -0.03em; max-width: 16ch; }
.eyebrow { margin: 0; text-transform: uppercase; letter-spacing: 0.14em; font-size: 12px; font-family: ui-sans-serif, system-ui, sans-serif; color: #8a5a32; }
.lede { max-width: 42rem; font-size: 20px; line-height: 1.45; color: #3d3832; }
.hero-actions { display: flex; gap: 10px; }
.stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.stats article, .card { background: #fffdf8; border: 1px solid #e4dccf; border-radius: 16px; padding: 16px 18px; }
.stat { margin: 0; font-size: 36px; letter-spacing: -0.04em; }
.stats p { margin: 4px 0 0; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 14px; color: #514a43; }
.split { display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 16px; }
h2, h3 { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; letter-spacing: -0.02em; }
.rows { list-style: none; margin: 14px 0 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
.rows li { display: flex; gap: 12px; align-items: flex-start; }
.rows strong, .rows p { display: block; margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; }
.rows p { color: #5c564e; font-size: 14px; line-height: 1.4; margin-top: 2px; }
.badge { flex: none; border-radius: 999px; padding: 3px 8px; background: #ece7df; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 12px; }
.badge.warn { background: #f3d2c4; color: #8a3416; }
.badge.ok { background: #d7ead8; color: #1f5b32; }
.form { display: flex; flex-direction: column; gap: 10px; }
.form label { display: flex; flex-direction: column; gap: 4px; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 13px; }
.form input, .form select, .form textarea { border: 1px solid #d9d0c4; border-radius: 8px; padding: 8px 10px; background: #fff; color: inherit; }
.table-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th { text-align: left; font-size: 12px; color: #6d665e; padding: 8px 6px; }
td { padding: 10px 6px; border-top: 1px solid #eee6db; }
.plans { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.plan p { font-family: ui-sans-serif, system-ui, sans-serif; font-size: 14px; line-height: 1.45; color: #514a43; }
.price { margin: 8px 0; font-size: 32px; }
.featured { background: #243126; color: #f4f7f2; }
.featured p { color: #d5e0d6; }
.featured .ghost, .featured .primary { color: #243126; background: #f4f7f2; border-color: transparent; }
.banner { display: flex; flex-direction: column; gap: 4px; padding: 14px 16px; border-radius: 12px; background: #efe2b8; }
.banner p { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; }
@media (max-width: 800px) {
  .stats, .split, .plans { grid-template-columns: 1fr; }
  .hero h1 { font-size: 36px; }
  .nav-links { display: none; }
}
`;
