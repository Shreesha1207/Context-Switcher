/**
 * Background service worker for AI Context Bridge.
 * Manages conversation storage and badge notifications.
 */

console.log("AI Context Bridge background script loaded");

// ─── Storage Helpers ───────────────────────────────────────────────

async function getAllConversations() {
    const data = await chrome.storage.local.get("conversations");
    return data.conversations || {};
}

async function saveConversation(convo) {
    const conversations = await getAllConversations();
    conversations[convo.id] = convo;
    await chrome.storage.local.set({ conversations });
}

async function deleteConversation(id) {
    const conversations = await getAllConversations();
    delete conversations[id];
    await chrome.storage.local.set({ conversations });
}

// ─── Platform Detection ────────────────────────────────────────────

function detectPlatform(url) {
    if (!url) return null;
    if (url.includes("chatgpt.com") || url.includes("chat.openai.com")) return "chatgpt";
    if (url.includes("gemini.google.com")) return "gemini";
    if (url.includes("claude.ai")) return "claude";
    if (url.includes("copilot.microsoft.com")) return "copilot";
    if (url.includes("perplexity.ai")) return "perplexity";
    return null;
}

// ─── Badge Management ──────────────────────────────────────────────

async function updateBadge(tabId, url) {
    const currentPlatform = detectPlatform(url);
    if (!currentPlatform) {
        chrome.action.setBadgeText({ tabId, text: "" });
        return;
    }

    const conversations = await getAllConversations();
    const otherPlatformConvos = Object.values(conversations).filter(
        c => c.platform !== currentPlatform
    );

    if (otherPlatformConvos.length > 0) {
        chrome.action.setBadgeText({ tabId, text: String(otherPlatformConvos.length) });
        chrome.action.setBadgeBackgroundColor({ tabId, color: "#6366f1" });
    } else {
        chrome.action.setBadgeText({ tabId, text: "" });
    }
}

// ─── Message Handling ──────────────────────────────────────────────

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    handleMessage(request, sender).then(sendResponse);
    return true; // keep channel open for async response
});

async function handleMessage(request, sender) {
    switch (request.action) {
        case "saveConversation": {
            const id = request.data.conversationId || generateId();
            const convo = {
                id,
                platform: request.data.platform,
                title: request.data.title,
                messages: request.data.conversation,
                messageCount: request.data.messageCount,
                estimatedTokens: request.data.estimatedTokens,
                capturedAt: new Date().toISOString(),
                url: request.data.url || (sender.tab ? sender.tab.url : "")
            };
            await saveConversation(convo);
            return { success: true, id };
        }

        case "getConversations": {
            const conversations = await getAllConversations();
            // Sort by capturedAt descending
            const sorted = Object.values(conversations).sort(
                (a, b) => new Date(b.capturedAt) - new Date(a.capturedAt)
            );
            return { conversations: sorted };
        }

        case "deleteConversation": {
            await deleteConversation(request.id);
            return { success: true };
        }

        case "clearAllConversations": {
            await chrome.storage.local.set({ conversations: {} });
            return { success: true };
        }

        case "getConversationsForBanner": {
            const currentPlatform = request.platform;
            const conversations = await getAllConversations();
            const otherConvos = Object.values(conversations)
                .filter(c => c.platform !== currentPlatform)
                .sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt));
            return { conversations: otherConvos };
        }

        case "captureTab": {
            return await captureFromTab(request.tabId, request.url);
        }

        default:
            return { error: "Unknown action" };
    }
}

// ─── Programmatic Capture ──────────────────────────────────────────

async function captureFromTab(tabId, url) {
    const platform = detectPlatform(url);
    if (!platform) {
        return { error: "Not a supported AI chat page. Supported: ChatGPT, Gemini, Claude, Copilot, Perplexity." };
    }

    // Map platform to its extractor file
    const extractorFile = `extractors/${platform}.js`;

    try {
        // Step 1: Inject the scripts in order
        // Each injection uses a WORLD so they share the same global scope
        await chrome.scripting.executeScript({
            target: { tabId },
            files: ["extractors/common.js"]
        });

        await chrome.scripting.executeScript({
            target: { tabId },
            files: ["extractors/condenser.js"]
        });

        await chrome.scripting.executeScript({
            target: { tabId },
            files: ["extractors/dynamic.js"]
        });

        await chrome.scripting.executeScript({
            target: { tabId },
            files: [extractorFile]
        });

        // Step 2: Run the extraction
        const results = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
                const bridge = window.__aiContextBridge;
                if (!bridge) {
                    return { error: "Bridge not initialized" };
                }

                const messages = bridge.safeExtract();
                const title = bridge.generateTitle(messages);
                const conversationId = bridge.getConversationId();
                const estimatedTokens = bridge.estimateTokens(messages);

                return {
                    conversation: messages,
                    platform: bridge.platformName,
                    conversationId,
                    title,
                    messageCount: messages.length,
                    estimatedTokens
                };
            }
        });

        // chrome.scripting.executeScript returns an array of results
        if (results && results[0] && results[0].result) {
            return results[0].result;
        }

        return { error: "Extraction returned no result." };

    } catch (err) {
        console.error("AI Context Bridge: captureFromTab error:", err);

        // Fallback: try the old way in case content scripts ARE loaded
        try {
            const response = await chrome.tabs.sendMessage(tabId, { action: "extract" });
            return response || { error: "No response from content script." };
        } catch (fallbackErr) {
            return { error: `Could not access page. Try refreshing the page and capturing again. (${err.message})` };
        }
    }
}

// ─── Tab Events ────────────────────────────────────────────────────

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === "complete" && tab.url) {
        updateBadge(tabId, tab.url);
    }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab.url) {
        updateBadge(activeInfo.tabId, tab.url);
    }
});

// ─── Utilities ─────────────────────────────────────────────────────

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}
