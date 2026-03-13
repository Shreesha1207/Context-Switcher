/**
 * Gemini Conversation Extractor
 * Works on: gemini.google.com
 */

(function () {
    const bridge = window.__aiContextBridge;
    if (!bridge) return;

    bridge.platformName = "gemini";

    bridge.extractConversation = function () {
        const messages = [];

        // Strategy 1: Look for user-query and model-response custom elements
        const userQueries = document.querySelectorAll("user-query, .user-query");
        const modelResponses = document.querySelectorAll("model-response, .model-response");

        if (userQueries.length > 0 || modelResponses.length > 0) {
            // Collect all message elements with their position in the DOM
            const allMessages = [];

            userQueries.forEach(el => {
                const textEl = el.querySelector(".query-text, .query-content, .user-query-text") || el;
                const text = textEl.innerText.trim();
                if (text) {
                    const msg = { role: "user", text, element: el };
                    const media = bridge.extractMediaFromElement(el);
                    if (media.length > 0) msg.media = media;
                    allMessages.push(msg);
                }
            });

            modelResponses.forEach(el => {
                const textEl = el.querySelector(".markdown, .model-response-text, .response-content, message-content") || el;
                const text = textEl.innerText.trim();
                if (text) {
                    const msg = { role: "assistant", text, element: el };
                    const media = bridge.extractMediaFromElement(el);
                    if (media.length > 0) msg.media = media;
                    allMessages.push(msg);
                }
            });

            // Sort by DOM position
            allMessages.sort((a, b) => {
                const pos = a.element.compareDocumentPosition(b.element);
                return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
            });

            allMessages.forEach(m => {
                const msg = { role: m.role, text: m.text };
                if (m.media) msg.media = m.media;
                messages.push(msg);
            });
        }

        // Strategy 2: Look for conversation-turn or message-content elements
        if (messages.length === 0) {
            const turns = document.querySelectorAll("conversation-turn, .conversation-turn");
            turns.forEach(turn => {
                const text = turn.innerText.trim();
                if (!text) return;

                // Determine role by checking for class names or position
                const isUser = turn.classList.contains("user") ||
                    turn.querySelector(".user-query, user-query") !== null ||
                    turn.getAttribute("data-role") === "user";

                messages.push({
                    role: isUser ? "user" : "assistant",
                    text: text
                });
            });
        }

        // Strategy 3: Generic message container fallback
        if (messages.length === 0) {
            const containers = document.querySelectorAll("message-content, .message-content");
            let isUser = true; // Assume alternating pattern starting with user
            containers.forEach(el => {
                const text = el.innerText.trim();
                if (text) {
                    messages.push({ role: isUser ? "user" : "assistant", text });
                    isUser = !isUser;
                }
            });
        }

        // Final fallback: dynamic heuristic extraction
        if (messages.length === 0 && window.__dynamicExtractor) {
            console.log("AI Context Bridge: Using dynamic extractor for Gemini");
            return window.__dynamicExtractor.extract();
        }

        return messages;
    };

    bridge.getConversationId = function () {
        // URL pattern: gemini.google.com/app/<id> or similar
        const match = window.location.pathname.match(/\/app\/([a-zA-Z0-9-_]+)/);
        return match ? match[1] : null;
    };
})();
