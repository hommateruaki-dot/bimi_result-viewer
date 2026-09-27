/* global messenger */

function t(key, substitutions) {
  return messenger.i18n.getMessage(key, substitutions) || key;
}

function applyI18n() {
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    const key = element.getAttribute("data-i18n");
    element.textContent = t(key);
  });

  document.title = t("appTitle");
}

function setText(id, value, className = "") {
  const el = document.getElementById(id);
  el.textContent = value || "-";
  el.className = className;
}

function resultClass(value) {
  if (!value || value === "not found") return "na";
  return String(value).toLowerCase() === "pass" ? "ok" : "ng";
}

function setOverall(result) {
  const el = document.getElementById("overall");
  if (result.pass) {
    el.textContent = "PASS";
    el.className = "status status-pass";
  } else {
    el.textContent = result.bimiResult ? "FAIL" : "N/A";
    el.className = result.bimiResult ? "status status-fail" : "status status-na";
  }
}

function setReasons(result) {
  const ul = document.getElementById("reasons");
  ul.textContent = "";

  const reasons = result.pass ? [t("reasonPass")] : (result.reasons || []);
  for (const reason of reasons) {
    const li = document.createElement("li");

    // result.reasons が reasonNoBimiIndicator のようなキーなら翻訳する
    // 通常の文章ならそのまま表示する
    const translated = t(reason);
    li.textContent = translated !== reason ? translated : reason;

    ul.appendChild(li);
  }
}

function setLogo(result) {
  const img = document.getElementById("logo");
  const note = document.getElementById("logoNote");

  img.hidden = true;
  img.removeAttribute("src");
  note.textContent = t("noLogoUrl");
  note.hidden = false;

  if (!result.indicatorUri) return;

  note.textContent = t("logoLoading");
  img.onload = () => {
    note.hidden = true;
    img.hidden = false;
  };
  img.onerror = () => {
    img.hidden = true;
    note.hidden = false;
    note.textContent = `${t("logoLoadFailed")}: ${result.indicatorUri}`;
  };
  img.src = result.indicatorUri;
}

function showError(message) {
  document.getElementById("overall").textContent = "N/A";
  document.getElementById("overall").className = "status status-na";

  const errorMessage = message || t("errorNoDisplayedMessage");

  setText("subject", errorMessage);
  setText("from", "-");
  setText("headerFromDomain", "-");
  setText("bimiHeaderD", "-");
  setText("bimiResult", "-");
  setText("dmarcResult", "-");
  setText("dkimResult", "-");
  setText("spfResult", "-");
  setText("policyAuthority", "-");
  setText("bimiIndicator", "-");
  setText("domainMatched", "-");

  const ul = document.getElementById("reasons");
  ul.textContent = "";
  const li = document.createElement("li");
  li.textContent = errorMessage;
  ul.appendChild(li);
}

async function main() {
  applyI18n();

  try {
    const response = await messenger.runtime.sendMessage({ type: "BIMI_GET_CURRENT_RESULT" });
    if (!response || !response.ok) {
      const errorMessage =
        response && response.errorKey
          ? t(response.errorKey)
          : response && response.error
            ? response.error
            : t("errorNoDisplayedMessage");

      showError(errorMessage);
      return;
    }

    const result = response.result;
    const message = response.message || {};

    setOverall(result);

    setText("subject", result.subject || message.subject || "-");
    setText("from", result.from || message.author || "-");
    setText("headerFromDomain", result.headerFromDomain || "-");
    setText("bimiHeaderD", result.bimiHeaderD || "-");

    setText("bimiResult", result.bimiResult || "not found", resultClass(result.bimiResult || "not found"));
    setText("dmarcResult", result.dmarcResult || "not found", resultClass(result.dmarcResult || "not found"));
    setText("dkimResult", result.dkimResult || "not found", resultClass(result.dkimResult || "not found"));
    setText("spfResult", result.spfResult || "not found", resultClass(result.spfResult || "not found"));
    setText("policyAuthority", result.policyAuthority || "not found", resultClass(result.policyAuthority || "not found"));
    setText("bimiIndicator", result.hasBimiIndicator ? t("present") : "not found", result.hasBimiIndicator ? "ok" : "ng");
    setText("domainMatched", result.domainMatched ? "pass" : "fail", result.domainMatched ? "ok" : "ng");

    setLogo(result);
    setReasons(result);
  } catch (e) {
    console.error(e);
    showError(e && e.message ? e.message : String(e));
  }
}

document.addEventListener("DOMContentLoaded", main);