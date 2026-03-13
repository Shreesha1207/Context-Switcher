/**
 * Copilot Conversation Extractor
 * Works on: copilot.microsoft.com
 */

(function () {
    const bridge = window.__aiContextBridge;
    if (!bridge) return;

    bridge.platformName = "copilot";

    bridge.extractConversation = function () {
        const messages = [];

        // Strategy 1: Copilot uses specific message containers with role attributes
        const msgElements = document.querySelectorAll(
            "[data-content='ai-message'], [data-content='user-message'], " +
            ".user-message, .ai-message, " +
            "cib-message-group"
        );

        if (msgElements.length > 0) {
            msgElements.forEach(el => {
                const text = el.innerText.trim();
                if (!text) return;

                const isUser = el.matches("[data-content='user-message'], .user-message") ||
                    el.getAttribute("source") === "user" ||
                    el.classList.contains("user");

                const msg = {
                    role: isUser ? "user" : "assistant",
                    text: text
                };
                // Extract media (DALL-E images, file attachments)
                const media = bridge.extractMediaFromElement(el);
                if (media.length > 0) msg.media = media;
                messages.push(msg);
            });
        }

        // Strategy 2: Look for turn-based containers
        if (messages.length === 0) {
            const turns = document.querySelectorAll(
                "[class*='turn'], [class*='Turn'], [class*='message-pair']"
            );
            turns.forEach(turn => {
                // Within each turn, find user and assistant parts
                const userPart = turn.querySelector(
                    "[class*='user'], [class*='User'], [data-role='user']"
                );
                const aiPart = turn.querySelector(
                    "[class*='bot'], [class*='Bot'], [class*='assistant'], [data-role='assistant']"
                );

                if (userPart) {
                    const text = userPart.innerText.trim();
                    if (text) messages.push({ role: "user", text });
                }
                if (aiPart) {
                    const text = aiPart.innerText.trim();
                    if (text) messages.push({ role: "assistant", text });
                }
            });
        }

        // Strategy 3: General message containers with text content
        if (messages.length === 0) {
            const containers = document.querySelectorAll(
                "[class*='chat-message'], [class*='ChatMessage'], [class*='message-bubble']"
            );
            let isUser = true;
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
            console.log("AI Context Bridge: Using dynamic extractor for Copilot");
            return window.__dynamicExtractor.extract();
        }

        return messages;
    };

    bridge.getConversationId = function () {
        // URL patterns for Copilot
        const match = window.location.pathname.match(
            /\/chats\/([a-zA-Z0-9-]+)|\/c\/([a-zA-Z0-9-]+)/
        );
        return match ? (match[1] || match[2]) : null;
    };
})();
