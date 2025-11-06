const http = require("http");
const url = require("url");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const {
  isForbidden,
  isSelect,
  isInsert,
  touchesPatient,
} = require("./utils/sql");
const { cors, readBody, sendJSON, sendText } = require("./utils/http");

// ------------ SQLite Server Class ------------
class SQLiteServer {
  constructor(port = 8080, dbPath = null) {
    this.port = port;
    this.dbPath = dbPath || path.join(__dirname, "lab5.sqlite");
    this.db = null;
    this.server = null;
  }

  // ------------ DB SETUP ------------
  // Initialize SQLite DB & patient table
  bootstrap() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath);
      this.db.serialize(() => {
        this.db.run(
          `
          CREATE TABLE IF NOT EXISTS patient (
            patientid   INTEGER PRIMARY KEY AUTOINCREMENT,
            name        VARCHAR(100) NOT NULL,
            dateOfBirth DATETIME
          );
        `,
          (e) => (e ? reject(e) : resolve())
        );
      });
    });
  }

  // Seed the database with initial patient data
  // Return Promise that resolves with {inserted: N}
  seed() {
    return new Promise((resolve, reject) => {
      const rows = [
        ["Sara Brown", "1901-01-01 00:00:00"],
        ["John Smith", "1941-01-01 00:00:00"],
        ["Jack Ma", "1961-01-30 00:00:00"],
        ["Elon Musk", "1999-01-01 00:00:00"],
      ];

      // Build a single INSERT ... VALUES (...), (...), (...), (...)
      const placeholders = rows.map(() => "(?, ?)").join(", ");
      const flatParams = rows.flat(); //merge into 1D array

      const sql = `INSERT INTO patient (name, dateOfBirth) VALUES ${placeholders};`;

      this.db.run(sql, flatParams, function (err) {
        if (err) return reject(err);
        resolve({ inserted: this.changes || rows.length });
      });
    });
  }

  // ------------ DB ops ------------
  // Ensure the patient table exists before running queries
  ensureTableExists() {
    return new Promise((resolve, reject) => {
      this.db.run(
        `
        CREATE TABLE IF NOT EXISTS patient (
          patientid   INTEGER PRIMARY KEY AUTOINCREMENT,
          name        VARCHAR(100) NOT NULL,
          dateOfBirth DATETIME
        );
      `,
        (err) => (err ? reject(err) : resolve())
      );
    });
  }

  // Run a SELECT query and return Error obj or all rows in array
  async runSelect(sql) {
    await this.ensureTableExists();
    return new Promise((resolve, reject) => {
      this.db.all(sql, (err, rows) => (err ? reject(err) : resolve(rows)));
    });
  }

  // Run an INSERT query and return Error obj or {changes and lastID}
  async runInsert(sql) {
    await this.ensureTableExists();
    return new Promise((resolve, reject) => {
      this.db.run(sql, function (err) {
        if (err) return reject(err);
        resolve({
          affectedRows: this.changes || 0,
          insertId: this.lastID || null,
        });
      });
    });
  }

  // ------------ Handlers ------------
  // Handle OPTIONS preflight,  caching for 10 minutes
  handleOptions(req, res) {
    res.writeHead(204, cors({ "Access-Control-Max-Age": "600" }));
    res.end();
  }

  // GET /api/v1/sql/{SQL}
  // Execute a SELECT query, return rows as JSON
  async handleGetSql(req, res, pathname) {
    const parts = pathname.split("/").filter(Boolean);
    if (parts.length < 4)
      return sendJSON(res, 400, { error: "Missing SQL in path." });

    let sql;
    try {
      sql = decodeURIComponent(parts.slice(3).join("/")); //Get everything after /api/v1/sql/
    } catch {
      return sendJSON(res, 400, { error: "Badly encoded SQL." });
    }

    if (isForbidden(sql))
      //SELECT and INSERT only
      return sendJSON(res, 403, { error: "Forbidden statement." });
    if (!isSelect(sql))
      return sendJSON(res, 400, { error: "GET only allows SELECT." });
    if (!touchesPatient(sql))
      return sendJSON(res, 400, { error: "Query must reference 'patient'." });

    try {
      const rows = await this.runSelect(sql); //Execute the SELECT and return array of rows
      return sendJSON(res, 200, { rows }); //Return rows in JSON
    } catch (e) {
      return sendJSON(res, 400, { error: e.message });
    }
  }

  async handlePostSql(req, res) {
    let raw;
    try {
      raw = await readBody(req); //Read full req body as string
    } catch (e) {
      return sendJSON(res, 413, { error: e.message || "Body too large" });
    }

    let payload;
    // turn JSON-string req body as JS object
    try {
      payload = JSON.parse(raw || "{}");
    } catch {
      return sendJSON(res, 400, { error: "Invalid JSON body." });
    }

    const sql = String(payload.query || "");
    if (!sql.trim())
      //Empty string is falsey
      return sendJSON(res, 400, { error: "Missing 'query' field." });
    if (isForbidden(sql))
      //Only allow INSERT on 'patient' table
      return sendJSON(res, 403, { error: "Forbidden statement." });
    if (!isInsert(sql))
      return sendJSON(res, 400, { error: "POST only allows INSERT." });
    if (!touchesPatient(sql))
      return sendJSON(res, 400, { error: "Query must reference 'patient'." });

    try {
      const result = await this.runInsert(sql);
      return sendJSON(res, 200, { ok: true, ...result }); //Return affectedRows and insertId
    } catch (e) {
      return sendJSON(res, 400, { error: e.message });
    }
  }

  // POST /api/v1/seed
  async handleSeed(req, res) {
    try {
      const result = await this.seed();
      return sendJSON(res, 200, {
        ok: true,
        message: "Database seeded successfully.",
        ...result,
      });
    } catch (e) {
      return sendJSON(res, 400, { error: e.message });
    }
  }

  // ------------ Request Router ------------
  handleRequest(req, res) {
    const { pathname } = url.parse(req.url);

    if (req.method === "OPTIONS") {
      return this.handleOptions(req, res);
    }

    if (req.method === "GET" && pathname.startsWith("/api/v1/sql/")) {
      return this.handleGetSql(req, res, pathname);
    }

    if (req.method === "POST" && pathname === "/api/v1/sql") {
      return this.handlePostSql(req, res);
    }

    if (req.method === "POST" && pathname === "/api/v1/seed") {
      return this.handleSeed(req, res);
    }

    if (req.method === "GET" && pathname === "/") {
      return sendText(
        res,
        200,
        "Lab5 SQLite API ready.\nTry: /api/v1/sql/select%20*%20from%20patient"
      );
    }

    return sendJSON(res, 404, { error: "Not found" });
  }

  // ------------ Start Server ------------
  start() {
    this.server = http.createServer((req, res) => this.handleRequest(req, res));
    this.server.listen(this.port, () =>
      console.log(`Server2 (SQLite) on http://0.0.0.0:${this.port}`)
    );
  }

  // ------------ Initialize & Start ------------
  async init() {
    try {
      await this.bootstrap();
      console.log("SQLite DB & patient table ready.");
      this.start();
    } catch (e) {
      console.error("Startup error:", e);
      process.exit(1);
    }
  }
}

// ------------ Boot ------------
const PORT = Number(process.env.PORT || "8080");
const server = new SQLiteServer(PORT);
server.init();
