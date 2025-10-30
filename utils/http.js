// Utility functions for handling HTTP requests and responses

// CORS headers
function cors(extra = {}) {``
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    ...extra, //Default param to prevent undefined error no params passed
  };
}

// Read the full body of a POST request, up to `limit= 1MB` bytes
//To keep server from crashing on large bodies
//Return Promise that resolves with body as string
function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("BODY_TOO_LARGE"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8"))); //resolve with full body as string
    req.on("error", reject);
  });
}

function sendJSON(res, status, obj) {
  res.writeHead(status, {
    ...cors({ "Content-Type": "application/json; charset=utf-8" }),
  });
  res.end(JSON.stringify(obj));
}


function sendText(res, status, txt) {
  res.writeHead(status, {
    ...cors({ "Content-Type": "text/plain; charset=utf-8" }),
  });
  res.end(txt);
}


module.exports = {cors, readBody, sendJSON, sendText}