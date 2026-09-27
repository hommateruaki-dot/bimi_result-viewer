/*
 * BIMI header parser for Thunderbird MailExtension.
 * This file intentionally uses only standard WebExtension/MailExtension APIs.
 */

var BimiViewer = (() => {
  function normalizeHeaderName(name) {
    return String(name || "").trim().toLowerCase();
  }

  function splitRawHeaders(raw) {
    const normalized = String(raw || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const idx = normalized.indexOf("\n\n");
    return idx >= 0 ? normalized.slice(0, idx) : normalized;
  }

  function parseHeaders(raw) {
    const headerBlock = splitRawHeaders(raw);
    const lines = headerBlock.split("\n");
    const unfolded = [];

    for (const line of lines) {
      if (/^[ \t]/.test(line) && unfolded.length) {
        unfolded[unfolded.length - 1] += " " + line.trim();
      } else if (line.includes(":")) {
        unfolded.push(line);
      }
    }

    const headers = new Map();
    for (const line of unfolded) {
      const pos = line.indexOf(":");
      if (pos < 0) continue;
      const name = normalizeHeaderName(line.slice(0, pos));
      const value = line.slice(pos + 1).trim();
      if (!headers.has(name)) headers.set(name, []);
      headers.get(name).push(value);
    }
    return headers;
  }

  function getHeader(headers, name) {
    const values = headers.get(normalizeHeaderName(name));
    return values && values.length ? values[0] : "";
  }

  function getHeaders(headers, name) {
    return headers.get(normalizeHeaderName(name)) || [];
  }

  function decodeMimeWords(str) {
    // Small RFC 2047 decoder for common UTF-8 Base64/Q encoded words.
    // Thunderbird may already decode message headers in MessageHeader, but raw source is not decoded.
    return String(str || "").replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_, charset, enc, text) => {
      try {
        let bytes;
        if (enc.toUpperCase() === "B") {
          const binary = atob(text.replace(/\s/g, ""));
          bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
        } else {
          const qp = text.replace(/_/g, " ").replace(/=([A-Fa-f0-9]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
          bytes = Uint8Array.from(qp, c => c.charCodeAt(0));
        }
        return new TextDecoder(charset).decode(bytes);
      } catch (e) {
        return _;
      }
    });
  }

  function extractEmailAddress(mailbox) {
    const value = decodeMimeWords(mailbox || "");
    const angle = value.match(/<([^<>@\s]+@[^<>\s]+)>/);
    if (angle) return angle[1].trim();
    const plain = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return plain ? plain[0].trim() : "";
  }

  function extractDomainFromAddress(address) {
    const m = String(address || "").toLowerCase().match(/@([^>\s]+)$/);
    return m ? m[1].replace(/[)>;,]+$/g, "") : "";
  }

  function findResult(authHeaders, key) {
    const re = new RegExp("(?:^|[\\s;])" + key + "\\s*=\\s*([a-z0-9_-]+)", "i");
    for (const h of authHeaders) {
      const m = h.match(re);
      if (m) return m[1].toLowerCase();
    }
    return "";
  }

  function findAuthParam(authHeaders, name) {
    // Handles parameters such as header.d=, header.from=, policy.authority=, policy.indicator-uri=
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp("(?:^|[\\s;])" + escaped + "\\s*=\\s*(\\\"[^\\\"]+\\\"|[^;\\s]+)", "i");
    for (const h of authHeaders) {
      const m = h.match(re);
      if (m) return m[1].replace(/^\"|\"$/g, "").trim();
    }
    return "";
  }

  function normalizeDomain(domain) {
    return String(domain || "").trim().toLowerCase().replace(/^\.+|\.+$/g, "");
  }

  function isSameDomain(a, b) {
    return normalizeDomain(a) !== "" && normalizeDomain(a) === normalizeDomain(b);
  }

  function extractUrl(value) {
    const text = String(value || "");
    const url = text.match(/https?:\/\/[^\s<>\"')]+/i);
    return url ? url[0] : "";
  }

  function makeReasonFlags(data) {
    const flags = [];

    if (data.bimiResult !== "pass") {
      flags.push("reasonBimiNotPass");
    }

    if (data.policyAuthority !== "pass") {
      flags.push("reasonPolicyAuthorityNotPass");
    }

    if (!data.hasBimiIndicator) {
      flags.push("reasonNoBimiIndicator");
    }

    if (!data.domainMatched) {
      flags.push("reasonDomainMismatch");
    }

    return flags;
  }

  function analyze(raw, messageHeader = {}) {
    const headers = parseHeaders(raw);
    const authHeaders = getHeaders(headers, "Authentication-Results");
    const fromRaw = getHeader(headers, "From") || messageHeader.author || "";
    const subjectRaw = getHeader(headers, "Subject") || messageHeader.subject || "";
    const fromAddress = extractEmailAddress(fromRaw);
    const headerFromDomain = extractDomainFromAddress(fromAddress);

    const bimiIndicator = getHeader(headers, "BIMI-Indicator");
    const bimiResult = findResult(authHeaders, "bimi");
    const dmarcResult = findResult(authHeaders, "dmarc");
    const dkimResult = findResult(authHeaders, "dkim");
    const spfResult = findResult(authHeaders, "spf");

    const bimiHeaderD = findAuthParam(authHeaders, "header.d");
    const dmarcHeaderFrom = findAuthParam(authHeaders, "header.from");
    const policyAuthority = findAuthParam(authHeaders, "policy.authority").toLowerCase();
    const indicatorUri = findAuthParam(authHeaders, "policy.indicator-uri") || extractUrl(bimiIndicator);
    const authorityUri = findAuthParam(authHeaders, "policy.authority-uri");

    const domainMatched = isSameDomain(bimiHeaderD, headerFromDomain);
    const hasBimiIndicator = Boolean(bimiIndicator);

    const data = {
      subject: decodeMimeWords(subjectRaw),
      from: decodeMimeWords(fromRaw),
      fromAddress,
      headerFromDomain,
      bimiHeaderD,
      dmarcHeaderFrom,
      bimiResult,
      dmarcResult,
      dkimResult,
      spfResult,
      policyAuthority,
      hasBimiIndicator,
      bimiIndicator,
      indicatorUri,
      authorityUri,
      domainMatched,
      pass: false,
      reasons: [],
      authHeaderCount: authHeaders.length
    };

    data.pass = data.bimiResult === "pass" &&
      data.policyAuthority === "pass" &&
      data.hasBimiIndicator &&
      data.domainMatched;
    data.reasons = makeReasonFlags(data);
    return data;
  }

  async function getRawText(messageId) {
    const raw = await messenger.messages.getRaw(messageId, { data_format: "File" });
    if (typeof raw === "string") return raw;
    if (raw && typeof raw.text === "function") return await raw.text();
    return String(raw || "");
  }

  async function analyzeMessage(messageHeader) {
    const raw = await getRawText(messageHeader.id);
    return analyze(raw, messageHeader);
  }

  return {
    analyze,
    analyzeMessage,
    parseHeaders,
    decodeMimeWords
  };
})();
