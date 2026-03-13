/**
 * ChatGPT Conversation Extractor
 * Works on: chatgpt.com, chat.openai.com
 */

(function () {
    const bridge = window.__aiContextBridge;
    if (!bridge) return;

    bridge.platformName = "chatgpt";

    bridge.extractConversation = function () {
        const messages = [];

        // Primary selector: data-message-author-role attribute (most reliable)
        const elements = document.querySelectorAll("[data-message-author-role]");

        if (elements.length > 0) {
            elements.forEach(el => {
                const role = el.getAttribute("data-message-author-role");
                // Get the text content, preferring the markdown-rendered content
                const contentEl = el.querySelector(".markdown, .prose, .text-message") || el;
                const text = contentEl.innerText.trim();

                if (text && (role === "user" || role === "assistant")) {
                    const msg = {
                        role: role === "user" ? "user" : "assistant",
                        text: text
                    };
                    // Extract media (uploaded images, DALL-E output, files)
                    const media = bridge.extractMediaFromElement(el);
                    if (media.length > 0) msg.media = media;
                    messages.push(msg);
                }
            });
        }

        // Fallback: try article elements with role structure
        if (messages.length === 0) {
            const articles = document.querySelectorAll("article");
            articles.forEach((article, index) => {
                const text = article.innerText.trim();
                if (!text) return;

                // Check for explicit role attribute first
                const isUser = article.querySelector('[data-message-author-role="user"]') !== null;
                const isAssistant = article.querySelector('[data-message-author-role="assistant"]') !== null;

                let role;
                if (isUser) role = "user";
                else if (isAssistant) role = "assistant";
                else role = index % 2 === 0 ? "user" : "assistant"; // alternating fallback

                messages.push({ role, text });
            });
        }

        // Final fallback: dynamic heuristic extraction
        if (messages.length === 0 && window.__dynamicExtractor) {
            console.log("AI Context Bridge: Using dynamic extractor for ChatGPT");
            return window.__dynamicExtractor.extract();
        }

        return messages;
    };

    bridge.getConversationId = function () {
        // URL pattern: chatgpt.com/c/<id> or chatgpt.com/g/<id>/c/<id>
        const match = window.location.pathname.match(/\/c\/([a-zA-Z0-9-]+)/);
        return match ? match[1] : null;
    };
})();
