// Server2 (SQLite): plain Node http, no Express.
// DB file: lab5.sqlite (created automatically)
// Table schema (matches your screenshot):
//   patient(
//     patientid   INTEGER PRIMARY KEY AUTOINCREMENT,
//     name        VARCHAR(100) NOT NULL,
//     dateOfBirth DATETIME
//   )

const http = require("http");
const url = require("url");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

// ------------ Config ------------
const PORT = Number(process.env.PORT || "8080");
// In production set this to your Server1 origin, e.g. "https://server1.example.com"
const CORS_ALLOW_ORIGIN = process.env.CORS_ALLOW_ORIGIN || "*";
const DB_PATH = path.join(__dirname, "lab5.sqlite");

// ------------ Helpers ------------
function cors(extra = {}) {
  return {
    "Access-Control-Allow-Origin": CORS_ALLOW_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    ...extra
  };
}
function sendJSON(res, status, obj) {
  res.writeHead(status, { ...cors({ "Content-Type": "application/json; charset=utf-8" }) });
  res.end(JSON.stringify(obj));
}
function sendText(res, status, txt) {
  res.writeHead(status, { ...cors({ "Content-Type": "text/plain; charset=utf-8" }) });
  res.end(txt);
}
function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", c => {
      size += c.length;
      if (size > limit) { reject(new Error("BODY_TOO_LARGE")); req.destroy(); }
      else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
const isForbidden = sql => /\b(update|delete|drop|alter|truncate|grant|revoke|attach|detach|pragma)\b/i.test(sql);
const isSelect    = sql => /^\s*select\b/i.test(sql);
const isInsert    = sql => /^\s*insert\b/i.test(sql);
const touchesPatient = sql => /\bpatient\b/i.test(sql);

// ------------ DB bootstrap ------------
const db = new sqlite3.Database(DB_PATH);
function bootstrap() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`
        CREATE TABLE IF NOT EXISTS patient (
          patientid   INTEGER PRIMARY KEY AUTOINCREMENT,
          name        VARCHAR(100) NOT NULL,
          dateOfBirth DATETIME
        );
      `, (e) => e ? reject(e) : resolve());
    });
  });
}

// ------------ DB ops ------------
function runSelect(sql) {
  return new Promise((resolve, reject) => {
    db.all(sql, (err, rows) => err ? reject(err) : resolve(rows));
  });
}
function runInsert(sql) {
  return new Promise((resolve, reject) => {
    db.run(sql, function(err) {
      if (err) return reject(err);
      resolve({ affectedRows: this.changes || 0, insertId: this.lastID || null });
    });
  });
}
function seed() {
  return new Promise((resolve, reject) => {
    const rows = [
      ["Sara Brown", "1901-01-01 00:00:00"],
      ["John Smith", "1941-01-01 00:00:00"],
      ["Jack Ma",    "1961-01-30 00:00:00"],
      ["Elon Musk",  "1999-01-01 00:00:00"]
    ];

    // Build a single INSERT ... VALUES (...), (...), (...), (...)
    const placeholders = rows.map(() => "(?, ?)").join(", ");
    const flatParams = rows.flat();

    const sql = `INSERT INTO patient (name, dateOfBirth) VALUES ${placeholders};`;

    db.run(sql, flatParams, function (err) {
      if (err) return reject(err);
      resolve({ inserted: this.changes || rows.length });
    });
  });
}


// ------------ Handlers ------------
function handleOptions(req, res) {
  res.writeHead(204, cors({ "Access-Control-Max-Age": "600" }));
  res.end();
}

async function handleGetSql(req, res, pathname) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length < 4) return sendJSON(res, 400, { error: "Missing SQL in path." });

  let sql;
  try { sql = decodeURIComponent(parts.slice(3).join("/")); }
  catch { return sendJSON(res, 400, { error: "Badly encoded SQL." }); }

  if (isForbidden(sql))           return sendJSON(res, 403, { error: "Forbidden statement." });
  if (!isSelect(sql))             return sendJSON(res, 400, { error: "GET only allows SELECT." });
  if (!touchesPatient(sql))       return sendJSON(res, 400, { error: "Query must reference 'patient'." });

  try {
    const rows = await runSelect(sql);
    return sendJSON(res, 200, { rows });
  } catch (e) {
    return sendJSON(res, 400, { error: e.message });
  }
}

async function handlePostSql(req, res) {
  let raw;
  try { raw = await readBody(req); }
  catch (e) { return sendJSON(res, 413, { error: e.message || "Body too large" }); }

  let payload;
  try { payload = JSON.parse(raw || "{}"); }
  catch { return sendJSON(res, 400, { error: "Invalid JSON body." }); }

  const sql = String(payload.query || "");
  if (!sql.trim())               return sendJSON(res, 400, { error: "Missing 'query' field." });
  if (isForbidden(sql))          return sendJSON(res, 403, { error: "Forbidden statement." });
  if (!isInsert(sql))            return sendJSON(res, 400, { error: "POST only allows INSERT." });
  if (!touchesPatient(sql))      return sendJSON(res, 400, { error: "Query must reference 'patient'." });

  try {
    const result = await runInsert(sql);
    return sendJSON(res, 200, { ok: true, ...result });
  } catch (e) {
    return sendJSON(res, 400, { error: e.message });
  }
}

async function handlePostSeed(req, res) {
  try {
    const out = await seed();
    return sendJSON(res, 200, { ok: true, ...out });
  } catch (e) {
    return sendJSON(res, 500, { error: e.message });
  }
}

// ------------ Server ------------
function start() {
  const server = http.createServer((req, res) => {
    const { pathname } = url.parse(req.url);
    if (req.method === "OPTIONS") return handleOptions(req, res);
    if (req.method === "GET"  && pathname.startsWith("/api/v1/sql/")) return handleGetSql(req, res, pathname);
    if (req.method === "POST" && pathname === "/api/v1/sql")          return handlePostSql(req, res);
    if (req.method === "POST" && pathname === "/api/v1/seed")         return handlePostSeed(req, res);

    if (req.method === "GET" && pathname === "/") {
      return sendText(res, 200, "Lab5 SQLite API ready.\nTry: /api/v1/sql/select%20*%20from%20patient");
    }
    return sendJSON(res, 404, { error: "Not found" });
  });
  server.listen(PORT, () => console.log(`Server2 (SQLite) on http://0.0.0.0:${PORT}`));
}

// ------------ Boot ------------
bootstrap()
  .then(() => { console.log("SQLite DB & patient table ready."); start(); })
  .catch((e) => { console.error("Startup error:", e); process.exit(1); });
