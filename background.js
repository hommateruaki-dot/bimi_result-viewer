/* global BimiViewer, messenger */

let lastDisplayedMessage = null;
let lastDisplayedTabId = null;

function t(key) {
  return messenger.i18n.getMessage(key) || key;
}

function normalizeMessageList(list) {
  if (!list) return [];
  if (Array.isArray(list)) return list;
  if (Array.isArray(list.messages)) return list.messages;
  return [];
}

async function setActionState(tabId, result) {
  if (!tabId || !messenger.messageDisplayAction) return;

  const text = result.pass ? "PASS" : (result.bimiResult ? "FAIL" : "N/A");
  const title = text;

  try {
    await messenger.messageDisplayAction.setBadgeText({ tabId, text });
    await messenger.messageDisplayAction.setTitle({ tabId, title });
  } catch (e) {
    console.warn("Unable to update messageDisplayAction state", e);
  }
}

async function clearActionState(tabId, title = null) {
  if (!tabId || !messenger.messageDisplayAction) return;

  try {
    await messenger.messageDisplayAction.setBadgeText({ tabId, text: "" });
    await messenger.messageDisplayAction.setTitle({ tabId, title: title || t("actionTitle") });
  } catch (e) {
    console.warn("Unable to clear messageDisplayAction state", e);
  }
}

async function analyzeMessage(message, tabId = null) {
  const result = await BimiViewer.analyzeMessage(message);
  if (tabId) {
    await setActionState(tabId, result);
  }
  return result;
}

async function getDisplayedMessagesFromTab(tabId) {
  if (!tabId) return [];
  try {
    const list = await messenger.messageDisplay.getDisplayedMessages(tabId);
    return normalizeMessageList(list);
  } catch (e) {
    return [];
  }
}

async function getMessageFromSingularDisplay(tabId = null) {
  if (!messenger.messageDisplay || !messenger.messageDisplay.getDisplayedMessage) {
    return null;
  }

  try {
    const message = tabId === null
      ? await messenger.messageDisplay.getDisplayedMessage()
      : await messenger.messageDisplay.getDisplayedMessage(tabId);
    return message || null;
  } catch (e) {
    return null;
  }
}

async function getSelectedMessagesFromMailTab(tabId = null) {
  if (!messenger.mailTabs || !messenger.mailTabs.getSelectedMessages) {
    return [];
  }

  try {
    const list = tabId === null
      ? await messenger.mailTabs.getSelectedMessages()
      : await messenger.mailTabs.getSelectedMessages(tabId);
    return normalizeMessageList(list);
  } catch (e) {
    return [];
  }
}

async function findCurrentDisplayedMessage() {
  const diagnostics = [];

  // 1. MV2-compatible singular API, when available.
  const singularMessage = await getMessageFromSingularDisplay(null);
  if (singularMessage) {
    return {
      message: singularMessage,
      tabId: null,
      source: "messageDisplay.getDisplayedMessage()",
      diagnostics
    };
  }
  diagnostics.push("messageDisplay.getDisplayedMessage(): no message");

  // 2. Current displayed message list API.
  try {
    const list = await messenger.messageDisplay.getDisplayedMessages();
    const messages = normalizeMessageList(list);
    diagnostics.push(`messageDisplay.getDisplayedMessages(): ${messages.length}`);
    if (messages.length === 1) {
      return {
        message: messages[0],
        tabId: null,
        source: "messageDisplay.getDisplayedMessages()",
        diagnostics
      };
    }
  } catch (e) {
    diagnostics.push(`messageDisplay.getDisplayedMessages() failed: ${e && e.message ? e.message : String(e)}`);
  }

  // 3. Active mail tab selected message fallback. This is useful in the 3-pane mail tab.
  const selectedInCurrentMailTab = await getSelectedMessagesFromMailTab(null);
  diagnostics.push(`mailTabs.getSelectedMessages(): ${selectedInCurrentMailTab.length}`);
  if (selectedInCurrentMailTab.length === 1) {
    return {
      message: selectedInCurrentMailTab[0],
      tabId: null,
      source: "mailTabs.getSelectedMessages()",
      diagnostics
    };
  }

  // 4. Active tab in current window.
  try {
    const activeTabs = await messenger.tabs.query({ active: true, currentWindow: true });
    diagnostics.push(`active tabs: ${(activeTabs || []).length}`);
    for (const tab of activeTabs || []) {
      const singularFromTab = await getMessageFromSingularDisplay(tab.id);
      if (singularFromTab) {
        return {
          message: singularFromTab,
          tabId: tab.id,
          source: "active tab getDisplayedMessage",
          diagnostics
        };
      }

      const displayedMessages = await getDisplayedMessagesFromTab(tab.id);
      diagnostics.push(`active tab ${tab.id} displayed: ${displayedMessages.length}`);
      if (displayedMessages.length === 1) {
        return {
          message: displayedMessages[0],
          tabId: tab.id,
          source: "active tab getDisplayedMessages",
          diagnostics
        };
      }

      const selectedMessages = await getSelectedMessagesFromMailTab(tab.id);
      diagnostics.push(`active tab ${tab.id} selected: ${selectedMessages.length}`);
      if (selectedMessages.length === 1) {
        return {
          message: selectedMessages[0],
          tabId: tab.id,
          source: "active tab mailTabs.getSelectedMessages",
          diagnostics
        };
      }
    }
  } catch (e) {
    diagnostics.push(`active tab lookup failed: ${e && e.message ? e.message : String(e)}`);
  }

  // 5. Any tab which currently displays or selects exactly one message.
  try {
    const allTabs = await messenger.tabs.query({});
    diagnostics.push(`all tabs: ${(allTabs || []).length}`);
    for (const tab of allTabs || []) {
      const singularFromTab = await getMessageFromSingularDisplay(tab.id);
      if (singularFromTab) {
        return {
          message: singularFromTab,
          tabId: tab.id,
          source: "all tabs getDisplayedMessage",
          diagnostics
        };
      }

      const displayedMessages = await getDisplayedMessagesFromTab(tab.id);
      if (displayedMessages.length === 1) {
        return {
          message: displayedMessages[0],
          tabId: tab.id,
          source: "all tabs getDisplayedMessages",
          diagnostics
        };
      }

      const selectedMessages = await getSelectedMessagesFromMailTab(tab.id);
      if (selectedMessages.length === 1) {
        return {
          message: selectedMessages[0],
          tabId: tab.id,
          source: "all tabs mailTabs.getSelectedMessages",
          diagnostics
        };
      }
    }
  } catch (e) {
    diagnostics.push(`all tabs scan failed: ${e && e.message ? e.message : String(e)}`);
  }

  // 6. Last message notified by onMessagesDisplayed.
  if (lastDisplayedMessage) {
    return {
      message: lastDisplayedMessage,
      tabId: lastDisplayedTabId,
      source: "last displayed message",
      diagnostics
    };
  }
  diagnostics.push("lastDisplayedMessage: none");

  return { message: null, tabId: null, source: "not found", diagnostics };
}

if (messenger.messageDisplay && messenger.messageDisplay.onMessagesDisplayed) {
  messenger.messageDisplay.onMessagesDisplayed.addListener(async (tab, displayedMessages) => {
    try {
      const messages = normalizeMessageList(displayedMessages);
      if (messages.length !== 1) {
        lastDisplayedMessage = null;
        lastDisplayedTabId = tab && tab.id;
        await clearActionState(lastDisplayedTabId, `${t("actionTitle")}: ${t("reasonNoMessage")}`);
        return;
      }

      lastDisplayedMessage = messages[0];
      lastDisplayedTabId = tab && tab.id;
      await analyzeMessage(lastDisplayedMessage, lastDisplayedTabId);
    } catch (e) {
      console.error("BIMI analysis failed", e);
      if (tab && tab.id) {
        await clearActionState(tab.id, `${t("actionTitle")}: analysis failed`);
      }
    }
  });
}

messenger.runtime.onMessage.addListener((request) => {
  if (!request || request.type !== "BIMI_GET_CURRENT_RESULT") {
    return false;
  }

  return (async () => {
    const current = await findCurrentDisplayedMessage();
    if (!current || !current.message) {
      return {
        ok: false,
        errorKey: "errorNoSingleDisplayedMessage",
        diagnostics: current && current.diagnostics ? current.diagnostics : []
      };
    }

    try {
      const result = await analyzeMessage(current.message, current.tabId);
      return {
        ok: true,
        source: current.source,
        diagnostics: current.diagnostics || [],
        message: {
          id: current.message.id,
          subject: current.message.subject || "",
          author: current.message.author || ""
        },
        result
      };
    } catch (e) {
      console.error("BIMI analysis failed", e);
      return {
        ok: false,
        error: e && e.message ? e.message : String(e)
      };
    }
  })();
});
