"use strict";

const express = require("express");
const { execFile } = require("child_process");
const { spawn } = require("child_process");
const http = require("http");
const https = require("https");
const { Resolver: DnsPromiseResolver } = require("dns").promises;
const { Resolver: DnsCallbackResolver } = require("dns");
const path = require("path");
const rateLimit = require("express-rate-limit");

// Combine the system DNS servers with Google's public resolvers so the app
// works when the system stub resolver (e.g. systemd-resolved on 127.0.0.53)
// is unavailable. System servers are tried first; public servers are used as
// fallback when the system resolver refuses or times out.
const PUBLIC_DNS = [
  "8.8.8.8",
  "8.8.4.4",
  "2001:4860:4860::8888",
  "2001:4860:4860::8844",
];
const COMBINED_DNS = [...require("dns").getServers(), ...PUBLIC_DNS];

const dnsResolver = new DnsPromiseResolver();
dnsResolver.setServers(COMBINED_DNS);

// HTTP agent with a custom lookup so that http.get() calls (e.g. to
// ip-api.com) use the combined DNS resolver rather than getaddrinfo().
// IPv4 is preferred for the GeoIP endpoint because ip-api.com is an
// IPv4-only service.
const cbResolver = new DnsCallbackResolver();
cbResolver.setServers(COMBINED_DNS);
const geoipAgent = new http.Agent({
  lookup: (hostname, _opts, cb) => {
    cbResolver.resolve4(hostname, (err, v4) => {
      if (!err) return cb(null, v4[0], 4);
      cbResolver.resolve6(hostname, (err2, v6) => {
        if (!err2) return cb(null, v6[0], 6);
        cb(err2);
      });
    });
  },
});

const geoipHttpsAgent = new https.Agent({
  lookup: (hostname, _opts, cb) => {
    cbResolver.resolve4(hostname, (err, v4) => {
      if (!err) return cb(null, v4[0], 4);
      cbResolver.resolve6(hostname, (err2, v6) => {
        if (!err2) return cb(null, v6[0], 6);
        cb(err2);
      });
    });
  },
});

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.use("/css", express.static(path.join(__dirname, "css")));
app.use("/js", express.static(path.join(__dirname, "js")));

// GET /api/health - lightweight health check for deployments and monitoring
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "ip-check",
    node: process.version,
    uptimeSec: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

/* ─── IP validation ──────────────────────────────────────────────────── */

function isIPv4(ip) {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  return parts.every(
    (p) => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255,
  );
}

function isIPv6(ip) {
  // Covers the main IPv6 format variants (RFC 5952):
  //  - Full 8-group:                         1:2:3:4:5:6:7:8
  //  - :: compressed forms:                  ::1, 1::, 1:2::3, etc.
  //  - Link-local with zone ID:              fe80::1%eth0
  //  - IPv4-mapped / IPv4-compatible:        ::ffff:192.0.2.1, ::192.0.2.1
  return (
    /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]+|::(ffff(:0{1,4})?:)?((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9]))$/.test(
      ip,
    ) || ip === "::1"
  );
}

function isValidIP(ip) {
  return isIPv4(ip) || isIPv6(ip);
}

/* ─── Ping output parser ─────────────────────────────────────────────── */

function parsePingOutput(output) {
  const lines = output.split("\n");
  const packets = [];

  for (const line of lines) {
    // Linux/macOS reply: 64 bytes from 8.8.8.8: icmp_seq=1 ttl=55 time=14.2 ms
    const replyMatch = line.match(
      /(\d+) bytes from (.+?): icmp_seq=(\d+) ttl=(\d+) time=([\d.]+) ms/,
    );
    if (replyMatch) {
      packets.push({
        seq: parseInt(replyMatch[3], 10),
        bytes: parseInt(replyMatch[1], 10),
        from: replyMatch[2],
        ttl: parseInt(replyMatch[4], 10),
        time: parseFloat(replyMatch[5]),
        status: "reply",
      });
      continue;
    }
    // Timeout (macOS)
    const timeoutMac = line.match(/Request timeout for icmp_seq (\d+)/);
    if (timeoutMac) {
      packets.push({ seq: parseInt(timeoutMac[1], 10), status: "timeout" });
      continue;
    }
    // Unreachable
    if (
      line.includes("Destination Host Unreachable") ||
      line.includes("unreachable")
    ) {
      const seqM = line.match(/icmp_seq=(\d+)/);
      if (seqM)
        packets.push({ seq: parseInt(seqM[1], 10), status: "unreachable" });
    }
  }

  // Stats: "5 packets transmitted, 4 received, 20% packet loss"
  const statsMatch = output.match(
    /(\d+) packets? transmitted[, ]+(\d+) (?:packets? )?received.*?(\d+(?:\.\d+)?)%\s*packet loss/,
  );
  const stats = statsMatch
    ? {
        transmitted: parseInt(statsMatch[1], 10),
        received: parseInt(statsMatch[2], 10),
        packetLoss: parseFloat(statsMatch[3]),
      }
    : null;

  // RTT: "rtt min/avg/max/mdev = 14.2/14.4/14.8/0.2 ms"
  const rttMatch = output.match(
    /(?:rtt|round-trip)\s+min\/avg\/max(?:\/(?:mdev|stddev))?\s*=\s*([\d.]+)\/([\d.]+)\/([\d.]+)/,
  );
  const rtt = rttMatch
    ? {
        min: parseFloat(rttMatch[1]),
        avg: parseFloat(rttMatch[2]),
        max: parseFloat(rttMatch[3]),
      }
    : null;

  return { packets, stats, rtt };
}

function parsePingPacketLine(line) {
  const replyMatch = line.match(
    /(\d+) bytes from (.+?): icmp_seq=(\d+) ttl=(\d+) time=([\d.]+) ms/,
  );
  if (replyMatch) {
    return {
      seq: parseInt(replyMatch[3], 10),
      bytes: parseInt(replyMatch[1], 10),
      from: replyMatch[2],
      ttl: parseInt(replyMatch[4], 10),
      time: parseFloat(replyMatch[5]),
      status: "reply",
    };
  }

  const timeoutMac = line.match(/Request timeout for icmp_seq (\d+)/);
  if (timeoutMac) {
    return { seq: parseInt(timeoutMac[1], 10), status: "timeout" };
  }

  if (
    line.includes("Destination Host Unreachable") ||
    line.includes("unreachable")
  ) {
    const seqM = line.match(/icmp_seq=(\d+)/);
    if (seqM) {
      return { seq: parseInt(seqM[1], 10), status: "unreachable" };
    }
  }

  return null;
}

function getPingCommand(ip, count) {
  const isWin = process.platform === "win32";
  if (isWin) {
    return { bin: "ping", args: ["-n", String(count), ip] };
  }
  if (isIPv6(ip)) {
    return { bin: "ping", args: ["-6", "-c", String(count), "-W", "3", ip] };
  }
  return { bin: "ping", args: ["-4", "-c", String(count), "-W", "3", ip] };
}

/* ─── Routes ─────────────────────────────────────────────────────────── */

// Rate limiter: max 10 ping/DNS requests per minute per IP
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});

// POST /api/ping
app.post("/api/ping", apiLimiter, (req, res) => {
  const { ip } = req.body || {};
  if (!ip || typeof ip !== "string") {
    return res.status(400).json({ error: "IP address is required" });
  }
  const trimmed = ip.trim();
  if (!isValidIP(trimmed)) {
    return res.status(400).json({ error: "Invalid IP address format" });
  }

  const count = 5;
  const { bin, args } = getPingCommand(trimmed, count);

  execFile(bin, args, { timeout: 30000 }, (error, stdout, stderr) => {
    // error is set when the process exits non-zero (e.g. 100% packet loss)
    // or when the command itself cannot be found / times out.
    if (error && !stdout && !stderr) {
      return res.status(500).json({
        error:
          error.code === "ETIMEDOUT"
            ? "Ping timed out"
            : "Ping command failed: " + error.message,
      });
    }
    const output = stdout || stderr || "";
    const parsed = parsePingOutput(output);
    res.json({
      ip: trimmed,
      success: parsed.packets.some((p) => p.status === "reply"),
      parsed,
      raw: output,
      timestamp: new Date().toISOString(),
    });
  });
});

// POST /api/ping/stream - stream ping packets in near real-time (NDJSON)
app.post("/api/ping/stream", apiLimiter, (req, res) => {
  const { ip } = req.body || {};
  if (!ip || typeof ip !== "string") {
    return res.status(400).json({ error: "IP address is required" });
  }
  const trimmed = ip.trim();
  if (!isValidIP(trimmed)) {
    return res.status(400).json({ error: "Invalid IP address format" });
  }

  const count = 5;

  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  let fullOutput = "";
  let clientClosed = false;
  let runningChild = null;

  function sendEvent(payload) {
    if (!res.writableEnded && !clientClosed) {
      res.write(JSON.stringify(payload) + "\n");
    }
  }

  function runSingleProbe(targetIp) {
    return new Promise((resolve, reject) => {
      const { bin, args } = getPingCommand(targetIp, 1);
      runningChild = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });

      let output = "";
      runningChild.stdout.on("data", (chunk) => {
        output += chunk.toString("utf8");
      });
      runningChild.stderr.on("data", (chunk) => {
        output += chunk.toString("utf8");
      });

      runningChild.on("error", (err) => {
        runningChild = null;
        reject(err);
      });

      runningChild.on("close", () => {
        runningChild = null;
        resolve(output);
      });
    });
  }

  (async () => {
    const packets = [];

    for (let i = 0; i < count; i += 1) {
      if (clientClosed) {
        return;
      }

      try {
        const output = await runSingleProbe(trimmed);
        fullOutput += output;

        const packet =
          parsePingPacketLine(output) ||
          parsePingOutput(output).packets[0] || {
            seq: i + 1,
            status: "timeout",
          };

        packets.push(packet);
        sendEvent({ type: "packet", packet });
      } catch (err) {
        sendEvent({ type: "error", error: "Ping command failed: " + err.message });
        if (!res.writableEnded) {
          res.end();
        }
        return;
      }
    }

    const replyPackets = packets.filter(
      (p) => p.status === "reply" && typeof p.time === "number",
    );
    const transmitted = packets.length;
    const received = replyPackets.length;
    const packetLoss = transmitted
      ? Number((((transmitted - received) / transmitted) * 100).toFixed(1))
      : 100;
    const times = replyPackets.map((p) => p.time);
    const rtt = times.length
      ? {
          min: Number(Math.min(...times).toFixed(3)),
          avg: Number((times.reduce((a, b) => a + b, 0) / times.length).toFixed(3)),
          max: Number(Math.max(...times).toFixed(3)),
        }
      : null;

    sendEvent({
      type: "summary",
      data: {
        ip: trimmed,
        success: received > 0,
        parsed: {
          packets,
          stats: { transmitted, received, packetLoss },
          rtt,
        },
        raw: fullOutput,
        timestamp: new Date().toISOString(),
      },
    });

    if (!res.writableEnded) {
      res.end();
    }
  })();

  req.on("close", () => {
    clientClosed = true;
    if (runningChild && !runningChild.killed) {
      runningChild.kill("SIGTERM");
    }
  });
});

// GET /api/geoip/:ip  (pass "me" to geolocate the server/client IP automatically)
app.get("/api/geoip/:ip", apiLimiter, (req, res) => {
  const { ip } = req.params;
  if (ip !== "me" && !isValidIP(ip)) {
    return res.status(400).json({ error: "Invalid IP address" });
  }
  const fields =
    "status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,query";
  const apiPath = ip === "me" ? "" : ip;
  const apiUrl = `http://ip-api.com/json/${apiPath}?fields=${fields}`;

  function normalizeIpApiCo(payload) {
    return {
      status: "success",
      country: payload.country_name || null,
      countryCode: payload.country_code || null,
      region: payload.region_code || null,
      regionName: payload.region || null,
      city: payload.city || null,
      zip: payload.postal || null,
      lat: payload.latitude,
      lon: payload.longitude,
      timezone: payload.timezone || null,
      isp: payload.org || null,
      org: payload.org || null,
      as: payload.asn || null,
      query: payload.ip || null,
    };
  }

  function fallbackIpApiCo() {
    const fallbackUrl =
      ip === "me"
        ? "https://ipapi.co/json/"
        : `https://ipapi.co/${encodeURIComponent(ip)}/json/`;

    https
      .get(fallbackUrl, { agent: geoipHttpsAgent }, (fallbackRes) => {
        let fallbackData = "";
        fallbackRes.on("data", (chunk) => {
          fallbackData += chunk;
        });
        fallbackRes.on("end", () => {
          try {
            const parsed = JSON.parse(fallbackData);
            if (parsed && !parsed.error && !parsed.reason) {
              return res.json(normalizeIpApiCo(parsed));
            }
            return res
              .status(500)
              .json({ error: "Geolocation service unavailable" });
          } catch (_) {
            return res
              .status(500)
              .json({ error: "Failed to parse geolocation response" });
          }
        });
      })
      .on("error", () =>
        res.status(500).json({ error: "Geolocation service unavailable" }),
      );
  }

  http
    .get(apiUrl, { agent: geoipAgent }, (apiRes) => {
      let data = "";
      apiRes.on("data", (chunk) => {
        data += chunk;
      });
      apiRes.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed && parsed.status !== "fail") {
            return res.json(parsed);
          }
          return fallbackIpApiCo();
        } catch (_) {
          return fallbackIpApiCo();
        }
      });
    })
    .on("error", fallbackIpApiCo);
});

// GET /api/dns?domain=example.com&type=A
app.get("/api/dns", apiLimiter, async (req, res) => {
  const { domain, type = "A" } = req.query;
  const domainRe =
    /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
  if (!domain || !domainRe.test(domain)) {
    return res.status(400).json({ error: "Invalid domain name" });
  }
  const recordType = (type || "A").toUpperCase();
  const allowed = ["A", "AAAA", "MX", "NS", "TXT", "CNAME", "SOA"];
  if (!allowed.includes(recordType)) {
    return res.status(400).json({ error: "Unsupported record type" });
  }

  try {
    let records = [];
    switch (recordType) {
      case "A": {
        const v4 = await dnsResolver.resolve4(domain, { ttl: true });
        records = v4.map((r) => ({ address: r.address, ttl: r.ttl }));
        break;
      }
      case "AAAA": {
        const v6 = await dnsResolver.resolve6(domain, { ttl: true });
        records = v6.map((r) => ({ address: r.address, ttl: r.ttl }));
        break;
      }
      case "MX": {
        const mx = await dnsResolver.resolveMx(domain);
        records = mx.map((r) => ({
          priority: r.priority,
          exchange: r.exchange,
        }));
        break;
      }
      case "NS":
        records = await dnsResolver.resolveNs(domain);
        break;
      case "TXT": {
        const txt = await dnsResolver.resolveTxt(domain);
        records = txt.map((r) => r.join(""));
        break;
      }
      case "CNAME":
        records = await dnsResolver.resolveCname(domain);
        break;
      case "SOA":
        records = [await dnsResolver.resolveSoa(domain)];
        break;
    }
    res.json({ domain, type: recordType, records });
  } catch (err) {
    if (err.code === "ENODATA" || err.code === "ENOTFOUND") {
      res.json({
        domain,
        type: recordType,
        records: [],
        info: "No records found",
      });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

// GET /api/myip – return the client IP as seen by the server.
// Useful as a fallback when the browser cannot reach external IP-detection
// APIs (e.g. ipify.org).
app.get("/api/myip", (req, res) => {
  const forwarded = req.headers["x-forwarded-for"];
  let ip = forwarded
    ? forwarded.split(",")[0].trim()
    : req.socket.remoteAddress;
  // Strip the IPv4-mapped IPv6 prefix (::ffff:x.x.x.x → x.x.x.x)
  if (ip && ip.startsWith("::ffff:")) ip = ip.slice(7);
  res.json({ ip: ip || null });
});

/* ─── Start server ───────────────────────────────────────────────────── */
app.listen(PORT, () => {
  console.log(`IP Check server running on http://localhost:${PORT}`);
});
