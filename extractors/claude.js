/**
 * Claude Conversation Extractor
 * Works on: claude.ai
 */

(function () {
    const bridge = window.__aiContextBridge;
    if (!bridge) return;

    bridge.platformName = "claude";

    bridge.extractConversation = function () {
        const messages = [];

        // Strategy 1: Look for data-is-streaming containers with role indicators
        // Claude uses div containers with data attributes for messages
        const msgContainers = document.querySelectorAll(
            "[data-testid='user-message'], [data-testid='ai-message'], " +
            ".font-user-message, .font-claude-response"
        );

        if (msgContainers.length > 0) {
            msgContainers.forEach(el => {
                const text = el.innerText.trim();
                if (!text) return;

                const isUser = el.matches("[data-testid='user-message'], .font-user-message") ||
                    el.closest("[data-testid='user-message']") !== null;

                const msg = {
                    role: isUser ? "user" : "assistant",
                    text: text
                };
                // Extract media (uploaded images, file attachments)
                const media = bridge.extractMediaFromElement(el);
                if (media.length > 0) msg.media = media;
                messages.push(msg);
            });
        }

        // Strategy 2: Look for message pairs using Claude's conversation structure
        if (messages.length === 0) {
            // Claude typically wraps messages in divs with specific class patterns
            const humanMsgs = document.querySelectorAll(
                "[class*='human'], [class*='Human'], [data-role='human']"
            );
            const assistantMsgs = document.querySelectorAll(
                "[class*='assistant'], [class*='Assistant'], [data-role='assistant']"
            );

            const allMsgs = [];
            humanMsgs.forEach(el => {
                const text = el.innerText.trim();
                if (text) allMsgs.push({ role: "user", text, element: el });
            });
            assistantMsgs.forEach(el => {
                const text = el.innerText.trim();
                if (text) allMsgs.push({ role: "assistant", text, element: el });
            });

            // Sort by DOM position
            allMsgs.sort((a, b) => {
                const pos = a.element.compareDocumentPosition(b.element);
                return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
            });

            allMsgs.forEach(m => messages.push({ role: m.role, text: m.text }));
        }

        // Strategy 3: Claude's chat messages often use specific grid/flex containers
        if (messages.length === 0) {
            // Look for the conversation thread container and extract alternating messages
            const threadContainer = document.querySelector(
                "[class*='thread'], [class*='conversation'], [class*='messages']"
            );
            if (threadContainer) {
                const children = threadContainer.querySelectorAll(":scope > div");
                children.forEach((child, index) => {
                    const text = child.innerText.trim();
                    if (text && text.length > 1) {
                        // Claude alternates: human, assistant, human, assistant
                        messages.push({
                            role: index % 2 === 0 ? "user" : "assistant",
                            text: text
                        });
                    }
                });
            }
        }

        // Final fallback: dynamic heuristic extraction
        if (messages.length === 0 && window.__dynamicExtractor) {
            console.log("AI Context Bridge: Using dynamic extractor for Claude");
            return window.__dynamicExtractor.extract();
        }

        return messages;
    };

    bridge.getConversationId = function () {
        // URL pattern: claude.ai/chat/<id>
        const match = window.location.pathname.match(/\/chat\/([a-zA-Z0-9-]+)/);
        return match ? match[1] : null;
    };
})();
