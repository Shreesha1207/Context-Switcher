/**
 * Popup script for AI Context Bridge.
 * Handles capturing, listing, copying, and deleting conversations.
 */

// ─── DOM References ────────────────────────────────────────────────

const captureBtn = document.getElementById("captureBtn");
const statusMsg = document.getElementById("statusMsg");
const convoList = document.getElementById("convoList");
const convoCount = document.getElementById("convoCount");
const clearAllBtn = document.getElementById("clearAllBtn");
const copyModal = document.getElementById("copyModal");
const modalPlatform = document.getElementById("modalPlatform");
const modalStats = document.getElementById("modalStats");
const modalCopyBtn = document.getElementById("modalCopyBtn");
const modalCancelBtn = document.getElementById("modalCancelBtn");
const modalTitle = document.getElementById("modalTitle");
const recentCountGroup = document.getElementById("recentCountGroup");
const recentCountSelect = document.getElementById("recentCount");
const tokenEstimate = document.getElementById("tokenEstimate");

let currentModalConvo = null;

// ─── Condenser Helpers (popup runs in its own context, not the page) ─

const CONDENSER_CONFIG = {
    MAX_PROSE_CHARS: 200,
    LATEST_CODE_COUNT: 2,
    CODE_HEAVY_THRESHOLD: 0.4,
    RECENT_FULL_COUNT: 3,
    MAX_CODE_LINES: 15,
    MAX_TOPIC_CHARS: 200
};

// Boilerplate phrases AI assistants pad their responses with
const BOILERPLATE_PATTERNS = [
    /^(sure|of course|absolutely|great question|certainly|no problem|happy to help)[!.,]?\s*/i,
    /^(here'?s?|let me|i'?ll|i can|i will|i would|allow me to)\s+(show|explain|help|provide|give|walk|break|update|fix|create)/i,
    /^(okay|ok|alright|right)[!.,]?\s*/i,
    /let me know if you (need|have|want|require) .{0,30}$/i,
    /hope this helps[!.]?$/i,
    /feel free to (ask|reach|let me know).{0,40}$/i,
    /is there anything else .{0,40}$/i,
    /don'?t hesitate to .{0,40}$/i
];

// Trivial messages that carry no context
const TRIVIAL_PATTERNS = [
    /^(thanks|thank you|thx|ty|cheers|appreciated)[!.]*$/i,
    /^(got it|understood|noted)[!.]*$/i,
    /^you'?re welcome[!.]*$/i,
    /^glad (to|i could) help[!.]*$/i,
    /^(good luck|best of luck)[!.]*$/i
];

const DECISION_KEYWORDS = [
    "should", "need to", "must", "decided", "solution", "fix",
    "issue", "problem", "error", "because", "instead", "better",
    "recommend", "approach", "implement", "use ", "change",
    "update", "add ", "remove", "create", "configure", "install",
    "the key", "important", "note that", "make sure", "however",
    "resolved", "working", "fixed", "correct", "wrong"
];

function detectCodeHeavy(messages) {
    if (messages.length === 0) return false;
    const codeCount = messages.filter(m => /```[\s\S]*?```/.test(m.text)).length;
    return (codeCount / messages.length) >= CONDENSER_CONFIG.CODE_HEAVY_THRESHOLD;
}

function extractCodeBlocksFromText(text) {
    const blocks = [];
    const regex = /```(\w*)\n?([\s\S]*?)```/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        blocks.push({ lang: match[1] || "", code: match[2].trim(), full: match[0] });
    }
    return blocks;
}

function truncateCodeBlock(code, maxLines) {
    const lines = code.split("\n");
    if (lines.length <= maxLines) return code;
    const kept = lines.slice(0, maxLines);
    return kept.join("\n") + `\n// ... (${lines.length - maxLines} more lines trimmed)`;
}

function removeCodeBlocksFromText(text) {
    return text.replace(/```[\s\S]*?```/g, "").trim();
}

function truncateText(text, maxChars) {
    if (text.length <= maxChars) return text;
    const truncated = text.substring(0, maxChars);
    const lastPeriod = truncated.lastIndexOf(".");
    const lastNewline = truncated.lastIndexOf("\n");
    const cutPoint = Math.max(lastPeriod, lastNewline);
    if (cutPoint > maxChars * 0.5) {
        return truncated.substring(0, cutPoint + 1).trim();
    }
    return truncated.trim() + "...";
}

/**
 * Extract the most important sentences from text using keyword scoring.
 */
function extractKeySentences(text, maxChars = 200) {
    if (text.length <= maxChars) return text;

    const sentences = text
        .replace(/\n+/g, ". ")
        .split(/(?<=[.!?])\s+/)
        .map(s => s.trim())
        .filter(s => s.length > 5);

    if (sentences.length === 0) return truncateText(text, maxChars);
    if (sentences.length <= 2) return sentences.join(" ");

    const scored = sentences.map((s, i) => {
        let score = 0;
        const lower = s.toLowerCase();
        if (i === 0) score += 3;
        if (i === sentences.length - 1) score += 2;
        for (const kw of DECISION_KEYWORDS) {
            if (lower.includes(kw)) score += 1;
        }
        if (s.length < 20) score -= 2;
        return { sentence: s, score, index: i };
    });

    scored.sort((a, b) => b.score - a.score);
    const selected = [];
    let charCount = 0;
    for (const item of scored) {
        if (charCount + item.sentence.length > maxChars) break;
        selected.push(item);
        charCount += item.sentence.length;
    }
    selected.sort((a, b) => a.index - b.index);
    return selected.map(s => s.sentence).join(" ");
}

/**
 * Strip boilerplate filler phrases from AI responses.
 */
function stripBoilerplate(text) {
    let cleaned = text;
    for (const pattern of BOILERPLATE_PATTERNS) {
        cleaned = cleaned.replace(pattern, '');
    }
    return cleaned.trim();
}

/**
 * Strip markdown formatting, keeping plain text.
 */
function stripMarkdownFormatting(text) {
    return text
        .replace(/^#{1,6}\s+/gm, '')       // # headings
        .replace(/\*\*(.+?)\*\*/g, '$1')    // **bold**
        .replace(/\*(.+?)\*/g, '$1')        // *italic*
        .replace(/__(.+?)__/g, '$1')        // __bold__
        .replace(/_(.+?)_/g, '$1')          // _italic_
        .replace(/~~(.+?)~~/g, '$1')        // ~~strikethrough~~
        .replace(/^[\s]*[-*+]\s+/gm, '• ')  // - list items → bullet
        .replace(/^\d+\.\s+/gm, '')         // 1. ordered lists
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // [link](url) → link
        .replace(/^>\s+/gm, '');            // > blockquotes
}

/**
 * Check if a message is trivial (no useful context).
 */
function isTrivialMessage(text) {
    const trimmed = text.trim();
    if (trimmed.length > 80) return false;
    return TRIVIAL_PATTERNS.some(p => p.test(trimmed));
}

function summarizeUserMessage(text) {
    const prose = removeCodeBlocksFromText(text).trim();
    if (!prose) {
        const blocks = extractCodeBlocksFromText(text);
        if (blocks.length > 0) {
            const lang = blocks[0].lang ? ` (${blocks[0].lang})` : "";
            return `[shared code${lang}, ${blocks[0].code.split("\n").length} lines]`;
        }
        return null;
    }
    if (prose.length <= 120) return prose;
    return extractKeySentences(prose, 120);
}

function summarizeAssistantMessage(text) {
    const prose = stripMarkdownFormatting(stripBoilerplate(removeCodeBlocksFromText(text))).trim();
    const blocks = extractCodeBlocksFromText(text);
    if (!prose && blocks.length === 0) return null;

    let summary = "";
    if (prose) {
        summary = extractKeySentences(prose, 200);
    }
    if (blocks.length > 0) {
        const codeNote = blocks.map(b => {
            const lang = b.lang || "code";
            const lines = b.code.split("\n").length;
            return `${lang} (${lines} lines)`;
        }).join(", ");
        summary += summary ? ` [Provided: ${codeNote}]` : `[Provided: ${codeNote}]`;
    }
    return summary || null;
}

// ─── Media Placeholder Helpers ─────────────────────────────────────

function formatMediaPlaceholder(item) {
    const parts = [];
    const typeLabel = item.type.charAt(0).toUpperCase() + item.type.slice(1);
    if (item.filename) parts.push(item.filename);
    if (item.alt && item.alt !== item.filename) parts.push(`"${item.alt}"`);
    if (item.width && item.height) parts.push(`${item.width}×${item.height}`);
    return parts.length > 0 ? `[${typeLabel}: ${parts.join(', ')}]` : `[${typeLabel}]`;
}

function formatAllMediaPlaceholders(mediaItems) {
    if (!mediaItems || mediaItems.length === 0) return '';
    return mediaItems.map(m => formatMediaPlaceholder(m)).join('\n');
}

function countMediaInMessages(messages) {
    let count = 0;
    for (const m of messages) {
        if (m.media) count += m.media.length;
    }
    return count;
}

function segmentConversation(messages) {
    const segments = [];
    let i = 0;
    while (i < messages.length) {
        const segment = { user: null, assistant: null };
        if (messages[i].role === "user") {
            segment.user = messages[i];
            i++;
            if (i < messages.length && messages[i].role === "assistant") {
                segment.assistant = messages[i];
                i++;
            }
        } else if (messages[i].role === "assistant") {
            segment.assistant = messages[i];
            i++;
        } else {
            i++;
        }
        segments.push(segment);
    }
    return segments;
}

/**
 * Condense ENTIRE conversation for Smart mode.
 * Processes all messages with intelligent summarization.
 */
function condenseSmart(messages, recentCount) {
    if (!messages || messages.length === 0) return "";

    const recentExchanges = recentCount || CONDENSER_CONFIG.RECENT_FULL_COUNT;
    const recentMsgCount = recentExchanges * 2;
    const maxCodeLines = CONDENSER_CONFIG.MAX_CODE_LINES;

    // Short conversations: still condense code blocks + strip boilerplate
    if (messages.length <= recentMsgCount + 4) {
        return messages.map(m => {
            let text = m.text;
            if (m.role === 'assistant') {
                text = stripMarkdownFormatting(stripBoilerplate(text));
            }
            const blocks = extractCodeBlocksFromText(text);
            if (blocks.length > 0) {
                for (const b of blocks) {
                    const truncated = truncateCodeBlock(b.code, maxCodeLines);
                    text = text.replace(b.full, "```" + b.lang + "\n" + truncated + "\n```");
                }
            }
            let line = `${m.role.toUpperCase()}: ${text}`;
            if (m.media && m.media.length > 0) {
                line += '\n' + formatAllMediaPlaceholders(m.media);
            }
            return line;
        }).join("\n\n");
    }

    const isCodeConvo = detectCodeHeavy(messages);
    const segments = segmentConversation(messages);
    const totalSegments = segments.length;
    const recentSegmentStart = Math.max(0, totalSegments - recentExchanges);
    const parts = [];

    // Section 1: Topic (strip code, summarize concisely)
    const firstUserMsg = messages.find(m => m.role === "user");
    if (firstUserMsg) {
        const prose = removeCodeBlocksFromText(firstUserMsg.text).trim();
        const codeBlocks = extractCodeBlocksFromText(firstUserMsg.text);
        let topicText = prose.length > CONDENSER_CONFIG.MAX_TOPIC_CHARS
            ? truncateText(prose, CONDENSER_CONFIG.MAX_TOPIC_CHARS)
            : prose;
        if (codeBlocks.length > 0 && !topicText) {
            const lang = codeBlocks[0].lang ? ` (${codeBlocks[0].lang})` : "";
            topicText = `[shared code${lang}, ${codeBlocks[0].code.split("\n").length} lines]`;
        } else if (codeBlocks.length > 0) {
            topicText += ` [+${codeBlocks.length} code block(s)]`;
        }
        let topicLine = "[TOPIC]\nUSER: " + topicText;
        if (firstUserMsg.media && firstUserMsg.media.length > 0) {
            topicLine += '\n' + formatAllMediaPlaceholders(firstUserMsg.media);
        }
        parts.push(topicLine);
    }

    // Section 2: Full conversation summary (ALL middle segments)
    const middleSegments = segments.slice(1, recentSegmentStart);
    if (middleSegments.length > 0) {
        const summaryLines = [];
        for (const seg of middleSegments) {
            // Skip only if BOTH user AND assistant messages are trivial
            const userTrivial = seg.user && isTrivialMessage(seg.user.text);
            const assistantTrivial = seg.assistant && isTrivialMessage(seg.assistant.text);
            if (userTrivial && (!seg.assistant || assistantTrivial)) continue;
            if (!seg.user && assistantTrivial) continue;

            if (seg.user) {
                const userSummary = summarizeUserMessage(seg.user.text);
                if (userSummary) {
                    let line = "→ " + userSummary;
                    if (seg.user.media && seg.user.media.length > 0) {
                        line += ' ' + seg.user.media.map(m => formatMediaPlaceholder(m)).join(' ');
                    }
                    summaryLines.push(line);
                }
            }
            if (seg.assistant) {
                const assistantSummary = summarizeAssistantMessage(seg.assistant.text);
                if (assistantSummary) {
                    let line = "  ↳ " + assistantSummary;
                    if (seg.assistant.media && seg.assistant.media.length > 0) {
                        line += ' ' + seg.assistant.media.map(m => formatMediaPlaceholder(m)).join(' ');
                    }
                    summaryLines.push(line);
                }
            }
        }
        if (summaryLines.length > 0) {
            parts.push(
                `[CONVERSATION SUMMARY - ${middleSegments.length} exchanges condensed]\n` +
                summaryLines.join("\n")
            );
        }
    }

    // Section 3: Latest code state (code-heavy only, from non-recent part)
    if (isCodeConvo) {
        const nonRecentMessages = messages.slice(0, -recentMsgCount);
        const allBlocks = [];
        for (const msg of nonRecentMessages) {
            for (const block of extractCodeBlocksFromText(msg.text)) {
                allBlocks.push({ role: msg.role, lang: block.lang, code: block.code });
            }
        }
        // Deduplicate by language: keep only the LAST block per language
        const byLang = new Map();
        for (const block of allBlocks) {
            const key = block.lang || 'unknown';
            byLang.set(key, block);
        }
        const dedupedBlocks = Array.from(byLang.values()).slice(-CONDENSER_CONFIG.LATEST_CODE_COUNT);
        if (dedupedBlocks.length > 0) {
            parts.push("[LATEST CODE STATE]");
            for (const block of dedupedBlocks) {
                const langLabel = block.lang ? ` (${block.lang})` : "";
                const truncatedCode = truncateCodeBlock(block.code, maxCodeLines);
                parts.push(
                    `${block.role.toUpperCase()}${langLabel}:\n` +
                    "```" + block.lang + "\n" + truncatedCode + "\n```"
                );
            }
        }
    }

    // Section 4: Recent exchanges (condense both roles)
    const recentMsgs = messages.slice(-recentMsgCount);
    parts.push(`[RECENT EXCHANGES - last ${recentExchanges} of ${totalSegments} total]`);

    for (const msg of recentMsgs) {
        const codeBlocks = extractCodeBlocksFromText(msg.text);
        const prose = removeCodeBlocksFromText(msg.text).trim();

        if (msg.role === "assistant" && msg.text.length > CONDENSER_CONFIG.MAX_PROSE_CHARS * 2) {
            let condensed = stripMarkdownFormatting(stripBoilerplate(prose));
            condensed = condensed.length > CONDENSER_CONFIG.MAX_PROSE_CHARS
                ? extractKeySentences(condensed, CONDENSER_CONFIG.MAX_PROSE_CHARS)
                : condensed;
            if (codeBlocks.length > 0) {
                // Keep only last 2 code blocks, truncated
                const keptBlocks = codeBlocks.slice(-2);
                condensed += "\n" + keptBlocks.map(b =>
                    "```" + b.lang + "\n" + truncateCodeBlock(b.code, maxCodeLines) + "\n```"
                ).join("\n");
                if (codeBlocks.length > 2) {
                    condensed += `\n[${codeBlocks.length - 2} earlier code block(s) omitted]`;
                }
            }
            parts.push("ASSISTANT: " + condensed);
            if (msg.media && msg.media.length > 0) {
                parts[parts.length - 1] += '\n' + formatAllMediaPlaceholders(msg.media);
            }
        } else if (msg.role === "user" && msg.text.length > CONDENSER_CONFIG.MAX_PROSE_CHARS) {
            // Condense long user messages too
            let condensed = prose.length > CONDENSER_CONFIG.MAX_PROSE_CHARS
                ? extractKeySentences(prose, CONDENSER_CONFIG.MAX_PROSE_CHARS)
                : prose;
            if (codeBlocks.length > 0) {
                const keptBlocks = codeBlocks.slice(-1);
                condensed += "\n" + keptBlocks.map(b =>
                    "```" + b.lang + "\n" + truncateCodeBlock(b.code, maxCodeLines) + "\n```"
                ).join("\n");
                if (codeBlocks.length > 1) {
                    condensed += `\n[${codeBlocks.length - 1} earlier code block(s) omitted]`;
                }
            }
            parts.push("USER: " + condensed);
            if (msg.media && msg.media.length > 0) {
                parts[parts.length - 1] += '\n' + formatAllMediaPlaceholders(msg.media);
            }
        } else {
            // Short messages: still truncate code blocks
            let text = msg.text;
            if (codeBlocks.length > 0) {
                for (const b of codeBlocks) {
                    const truncated = truncateCodeBlock(b.code, maxCodeLines);
                    text = text.replace(b.full, "```" + b.lang + "\n" + truncated + "\n```");
                }
            }
            let line = `${msg.role.toUpperCase()}: ${text}`;
            if (msg.media && msg.media.length > 0) {
                line += '\n' + formatAllMediaPlaceholders(msg.media);
            }
            parts.push(line);
        }
    }

    return parts.join("\n\n");
}


// ─── Platform Info ─────────────────────────────────────────────────

const PLATFORM_ICONS = {
    chatgpt: "🟢",
    gemini: "🔵",
    claude: "🟠",
    copilot: "🔷",
    perplexity: "🟦"
};

const PLATFORM_NAMES = {
    chatgpt: "ChatGPT",
    gemini: "Gemini",
    claude: "Claude",
    copilot: "Copilot",
    perplexity: "Perplexity"
};

// ─── Initialize ────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
    loadConversations();
    setupEventListeners();
});

function setupEventListeners() {
    captureBtn.addEventListener("click", captureConversation);
    modalCancelBtn.addEventListener("click", closeModal);
    copyModal.querySelector(".modal-backdrop").addEventListener("click", closeModal);
    modalCopyBtn.addEventListener("click", copyToClipboard);

    // Mode selector toggle for recent count
    document.querySelectorAll('input[name="copyMode"]').forEach(input => {
        input.addEventListener("change", (e) => {
            recentCountGroup.classList.toggle("hidden", e.target.value !== "recent");
            updateTokenEstimate();
        });
    });

    recentCountSelect.addEventListener("input", updateTokenEstimate);

    // Clear All button
    clearAllBtn.addEventListener("click", clearAllConversations);
}

// ─── Platform Detection (duplicated here so popup doesn't need background) ─

function detectPlatformFromUrl(url) {
    if (!url) return null;
    if (url.includes("chatgpt.com") || url.includes("chat.openai.com")) return "chatgpt";
    if (url.includes("gemini.google.com")) return "gemini";
    if (url.includes("claude.ai")) return "claude";
    if (url.includes("copilot.microsoft.com")) return "copilot";
    if (url.includes("perplexity.ai")) return "perplexity";
    return null;
}

// ─── Capture ───────────────────────────────────────────────────────

async function captureConversation() {
    captureBtn.classList.add("loading");
    captureBtn.textContent = "Capturing...";

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab) {
            showStatus("No active tab found.", "error");
            return;
        }

        const platform = detectPlatformFromUrl(tab.url);
        if (!platform) {
            showStatus("Not a supported AI page. Supported: ChatGPT, Gemini, Claude, Copilot, Perplexity.", "error");
            return;
        }

        const extractorFile = `extractors/${platform}.js`;

        // Inject scripts directly from the popup (no background script needed)
        try {
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ["extractors/common.js"]
            });
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ["extractors/condenser.js"]
            });
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ["extractors/dynamic.js"]
            });
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: [extractorFile]
            });
        } catch (injectErr) {
            console.error("Script injection failed:", injectErr);
            showStatus(`Cannot access this page. Try refreshing the page first. (${injectErr.message})`, "error");
            return;
        }

        // Run the extraction function on the page
        let results;
        try {
            results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => {
                    try {
                        const bridge = window.__aiContextBridge;
                        if (!bridge) {
                            return { error: "Bridge not found on page" };
                        }
                        const messages = bridge.safeExtract();
                        return {
                            conversation: messages,
                            platform: bridge.platformName,
                            conversationId: bridge.getConversationId(),
                            title: bridge.generateTitle(messages),
                            messageCount: messages.length,
                            estimatedTokens: bridge.estimateTokens(messages)
                        };
                    } catch (e) {
                        return { error: e.message };
                    }
                }
            });
        } catch (execErr) {
            console.error("Extraction execution failed:", execErr);
            showStatus(`Extraction failed: ${execErr.message}`, "error");
            return;
        }

        // Parse the result
        const response = results && results[0] && results[0].result;

        if (!response) {
            showStatus("Extraction returned no data. Try refreshing the page.", "error");
            return;
        }

        if (response.error) {
            showStatus(`Extraction error: ${response.error}`, "error");
            return;
        }

        if (!response.conversation || response.conversation.length === 0) {
            showStatus("No messages found on this page. Make sure you have an active conversation visible.", "error");
            return;
        }

        // Save via background script (storage operations only)
        const saveResult = await chrome.runtime.sendMessage({
            action: "saveConversation",
            data: {
                conversation: response.conversation,
                platform: response.platform,
                conversationId: response.conversationId,
                title: response.title,
                messageCount: response.messageCount,
                estimatedTokens: response.estimatedTokens,
                url: tab.url
            }
        });

        if (saveResult && saveResult.success) {
            showStatus(
                `✅ Captured ${response.messageCount} messages from ${PLATFORM_NAMES[response.platform] || response.platform}!`,
                "success"
            );
            loadConversations();
        } else {
            showStatus("Captured messages but failed to save. Try again.", "error");
        }
    } catch (err) {
        console.error("Capture error:", err);
        showStatus(`Error: ${err.message}`, "error");
    } finally {
        captureBtn.classList.remove("loading");
        captureBtn.innerHTML = '<span class="btn-icon">📸</span> Capture Current Conversation';
    }
}

// ─── Load & Render Conversations ───────────────────────────────────

async function loadConversations() {
    const result = await chrome.runtime.sendMessage({ action: "getConversations" });
    const conversations = result.conversations || [];

    convoCount.textContent = conversations.length;

    // Show/hide Clear All button
    clearAllBtn.classList.toggle("hidden", conversations.length === 0);

    if (conversations.length === 0) {
        convoList.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">💬</span>
        <p>No saved conversations yet.</p>
        <p class="hint">Go to any AI chatbot and click "Capture" to save a conversation.</p>
      </div>
    `;
        return;
    }

    convoList.innerHTML = conversations.map(convo => renderConvoCard(convo)).join("");

    // Attach event listeners
    convoList.querySelectorAll(".btn-copy").forEach(btn => {
        btn.addEventListener("click", () => openCopyModal(btn.dataset.id, conversations));
    });

    convoList.querySelectorAll(".btn-delete").forEach(btn => {
        btn.addEventListener("click", () => deleteConversation(btn.dataset.id));
    });
}

function sanitizeTitle(convo) {
    let title = convo.title || '';
    if (title.includes('<!DOCTYPE') || title.includes('<html') || title.includes('<head') || title.includes('<meta')) {
        const firstUser = (convo.messages || []).find(m => m.role === 'user');
        return firstUser ? (firstUser.text.trim().substring(0, 60) + (firstUser.text.length > 60 ? '...' : '')) : 'Untitled';
    }
    return title;
}

function renderConvoCard(convo) {
    const icon = PLATFORM_ICONS[convo.platform] || "💬";
    const name = PLATFORM_NAMES[convo.platform] || convo.platform;
    const time = formatTime(convo.capturedAt);
    const msgCount = convo.messages ? convo.messages.length : 0;
    const exchangeCount = Math.ceil(msgCount / 2);
    const tokenEst = convo.estimatedTokens || "?";
    const mediaCount = convo.messages ? countMediaInMessages(convo.messages) : 0;
    const mediaBadge = mediaCount > 0 ? ` · 🖼️ ${mediaCount}` : '';
    const title = sanitizeTitle(convo);

    return `
    <div class="convo-card">
      <div class="convo-card-top">
        <div class="convo-card-info">
          <span class="convo-title">${escapeHtml(title)}</span>
          <div class="convo-meta">
            <span class="platform-badge platform-${convo.platform}">${icon} ${name}</span>
            <span class="convo-time">${time}</span>
          </div>
          <span class="convo-stats">${exchangeCount} exchanges${mediaBadge} · ~${tokenEst} tokens</span>
        </div>
        <div class="convo-card-actions">
          <button class="btn-copy" data-id="${convo.id}" title="Copy context">📋</button>
          <button class="btn-delete" data-id="${convo.id}" title="Delete">🗑️</button>
        </div>
      </div>
    </div>
  `;
}

// ─── Copy Modal ────────────────────────────────────────────────────

function openCopyModal(convoId, conversations) {
    currentModalConvo = conversations.find(c => c.id === convoId);
    if (!currentModalConvo) return;

    const name = PLATFORM_NAMES[currentModalConvo.platform] || currentModalConvo.platform;
    const icon = PLATFORM_ICONS[currentModalConvo.platform] || "💬";
    const msgCount = currentModalConvo.messages ? currentModalConvo.messages.length : 0;
    const exchangeCount = Math.ceil(msgCount / 2);
    const mediaCount = currentModalConvo.messages ? countMediaInMessages(currentModalConvo.messages) : 0;
    const mediaBit = mediaCount > 0 ? ` · 🖼️ ${mediaCount}` : '';

    modalPlatform.textContent = `${icon} ${name}`;
    modalPlatform.className = `platform-badge platform-${currentModalConvo.platform}`;
    modalStats.textContent = `${exchangeCount} exchanges${mediaBit}`;
    modalTitle.textContent = sanitizeTitle(currentModalConvo);

    // Reset to smart mode
    document.querySelector('input[name="copyMode"][value="smart"]').checked = true;
    recentCountGroup.classList.add("hidden");

    updateTokenEstimate();
    copyModal.classList.remove("hidden");
}

function closeModal() {
    copyModal.classList.add("hidden");
    currentModalConvo = null;
}

function updateTokenEstimate() {
    if (!currentModalConvo) return;

    const mode = document.querySelector('input[name="copyMode"]:checked').value;
    const recentN = parseInt(recentCountSelect.value);
    const messages = currentModalConvo.messages || [];
    let tokens;
    let msgCount;

    if (mode === "smart") {
        // Use condenser to estimate condensed token count
        const result = condenseSmart(messages, recentN);
        tokens = Math.ceil(result.length / 4);
        msgCount = messages.length;
        const isCodeConvo = detectCodeHeavy(messages);
        const label = isCodeConvo ? "condensed + latest code" : "condensed";
        tokenEstimate.textContent = `📊 ~${tokens.toLocaleString()} tokens · ${msgCount} messages (${label})`;
    } else {
        // Recent mode: use segmentConversation for proper exchange pairing
        const segments = segmentConversation(messages);
        const recentSegments = segments.slice(-recentN);
        const selectedMessages = [];
        for (const seg of recentSegments) {
            if (seg.user) selectedMessages.push(seg.user);
            if (seg.assistant) selectedMessages.push(seg.assistant);
        }
        const totalChars = selectedMessages.reduce((sum, m) => sum + m.text.length, 0);
        tokens = Math.ceil(totalChars / 4);
        msgCount = selectedMessages.length;
        tokenEstimate.textContent = `📊 ~${tokens.toLocaleString()} tokens · ${recentSegments.length} exchange${recentSegments.length !== 1 ? 's' : ''} (${msgCount} messages) will be copied`;
    }
}

async function copyToClipboard() {
    if (!currentModalConvo) return;

    const mode = document.querySelector('input[name="copyMode"]:checked').value;
    const recentN = parseInt(recentCountSelect.value);
    const messages = currentModalConvo.messages || [];

    // Format the text
    const platform = PLATFORM_NAMES[currentModalConvo.platform] || currentModalConvo.platform;
    let formattedMessages = "";

    if (mode === "recent") {
        // Use segmentConversation to get proper user+assistant pairs
        const segments = segmentConversation(messages);
        const recentSegments = segments.slice(-recentN);
        const recentMsgs = [];
        for (const seg of recentSegments) {
            if (seg.user) recentMsgs.push(seg.user);
            if (seg.assistant) recentMsgs.push(seg.assistant);
        }
        formattedMessages = `[RECENT EXCHANGES - last ${recentSegments.length}]\n` +
            recentMsgs.map(m => {
                let line = `${m.role.toUpperCase()}: ${m.text}`;
                if (m.media && m.media.length > 0) {
                    line += '\n' + formatAllMediaPlaceholders(m.media);
                }
                return line;
            }).join("\n\n");
    } else {
        // Smart mode: use condenser for entire conversation
        formattedMessages = condenseSmart(messages, recentN);
    }

    const finalText = `I am continuing a conversation from ${platform}.\nHere is the relevant context:\n\n${formattedMessages}\n\nPlease continue from where we left off.`;

    try {
        await navigator.clipboard.writeText(finalText);
        modalCopyBtn.textContent = "✅ Copied! Now paste into your AI";
        setTimeout(() => {
            modalCopyBtn.textContent = "📋 Copy to Clipboard";
            closeModal();
        }, 1800);
    } catch (err) {
        console.error("Clipboard write failed:", err);
        modalCopyBtn.textContent = "❌ Failed — try again";
        setTimeout(() => {
            modalCopyBtn.textContent = "📋 Copy to Clipboard";
        }, 2000);
    }
}

// ─── Delete ────────────────────────────────────────────────────────

async function deleteConversation(id) {
    const result = await chrome.runtime.sendMessage({
        action: "deleteConversation",
        id
    });

    if (result.success) {
        loadConversations();
    }
}

async function clearAllConversations() {
    const count = convoCount.textContent;

    // Don't use confirm() — it causes the popup to lose focus and close,
    // killing the script before storage operations complete.
    // Instead, use an inline confirmation UI.
    clearAllBtn.disabled = true;
    clearAllBtn.textContent = "⚠️ Confirm?";
    clearAllBtn.classList.add("confirming");

    // Create a cancel button next to it
    const cancelClearBtn = document.createElement("button");
    cancelClearBtn.textContent = "Cancel";
    cancelClearBtn.className = "btn-cancel-clear";
    clearAllBtn.insertAdjacentElement("afterend", cancelClearBtn);

    // Wait for user to click confirm or cancel
    const userChoice = await new Promise(resolve => {
        clearAllBtn.addEventListener("click", () => resolve(true), { once: true });
        cancelClearBtn.addEventListener("click", () => resolve(false), { once: true });
        clearAllBtn.disabled = false;
    });

    // Clean up
    cancelClearBtn.remove();
    clearAllBtn.classList.remove("confirming");
    clearAllBtn.textContent = "🗑️ Clear All";

    if (!userChoice) return;

    const result = await chrome.runtime.sendMessage({ action: "clearAllConversations" });
    if (result && result.success) {
        showStatus("All conversations cleared.", "success");
        loadConversations();
    } else {
        showStatus("Failed to clear conversations. Try again.", "error");
    }
}

// ─── Helpers ───────────────────────────────────────────────────────

function showStatus(message, type) {
    statusMsg.textContent = message;
    statusMsg.className = `status-msg ${type}`;
    statusMsg.classList.remove("hidden");

    setTimeout(() => {
        statusMsg.classList.add("hidden");
    }, 4000);
}

function formatTime(isoString) {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}
