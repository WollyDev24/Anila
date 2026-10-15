// Diagnostic only. Wraps window.fetch inside the Miruro page (contextIsolation
// must be off for this window) and logs every /api/ request/response so we can
// learn the current wire format. Not used in normal operation.

const XOR_KEY = new TextEncoder().encode("miruro/catalog");

function headersToObject(h) {
  const out = {};
  try {
    if (!h) return out;
    if (typeof h.forEach === "function" && !Array.isArray(h)) {
      h.forEach((v, k) => (out[k] = v));
    } else if (Array.isArray(h)) {
      for (const [k, v] of h) out[k] = v;
    } else if (typeof h === "object") {
      Object.assign(out, h);
    }
  } catch {}
  return out;
}

async function decodeGz(buf) {
  const u = new Uint8Array(buf);
  for (let i = 0; i < u.length; i++) u[i] ^= XOR_KEY[i % XOR_KEY.length];
  for (const fmt of ["gzip", "deflate", "deflate-raw"]) {
    try {
      const ds = new DecompressionStream(fmt);
      const stream = new Blob([u]).stream().pipeThrough(ds);
      return await new Response(stream).text();
    } catch {}
  }
  // fall back to raw text
  return new TextDecoder().decode(u);
}

const orig = window.fetch;
window.fetch = async function (...args) {
  const [input, init] = args;
  let url = typeof input === "string" ? input : (input && input.url) || "";
  const method = (init && init.method) || (input && input.method) || "GET";
  let reqHeaders = (init && init.headers) || (input && input.headers) || null;
  try {
    url = new URL(url, location.href).href;
  } catch {}
  let res;
  try {
    res = await orig.apply(window, args);
  } catch (err) {
    console.log("PROBE_ERR", method, url, String((err && err.message) || err));
    throw err;
  }
  if (/\/api\//i.test(url)) {
    let body = "";
    try {
      const clone = res.clone();
      const ct = clone.headers.get("content-type") || "";
      if (ct.includes("octet-stream") || ct.includes("gzip")) {
        const buf = await clone.arrayBuffer();
        body = await decodeGz(buf);
      } else {
        body = await clone.text();
      }
    } catch (err) {
      body = `<read-error ${(err && err.message) || err}>`;
    }
    console.log(
      "PROBE",
      method,
      url,
      "->",
      res.status,
      "REQHDRS",
      JSON.stringify(headersToObject(reqHeaders)),
      "BODY",
      body.slice(0, 8000)
    );
  }
  return res;
};
console.log("PROBE_READY");
