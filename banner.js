/**
 * In-page banner for AI Context Bridge.
 * Shows a notification when the user has saved conversations from other AI platforms.
 * Only shows once per page load, and can be dismissed.
 */

(function () {
    // Don't run if already initialized
    if (window.__acbBannerInitialized) return;
    window.__acbBannerInitialized = true;

    const PLATFORM_NAMES = {
        chatgpt: "ChatGPT",
        gemini: "Gemini",
        claude: "Claude",
        copilot: "Copilot",
        perplexity: "Perplexity"
    };

    const PLATFORM_ICONS = {
        chatgpt: "🟢",
        gemini: "🔵",
        claude: "🟠",
        copilot: "🔷",
        perplexity: "🟦"
    };

    // Detect current platform from the bridge
    function getCurrentPlatform() {
        if (window.__aiContextBridge) {
            return window.__aiContextBridge.platformName;
        }
        // Fallback: detect from URL
        const url = window.location.href;
        if (url.includes("chatgpt.com") || url.includes("chat.openai.com")) return "chatgpt";
        if (url.includes("gemini.google.com")) return "gemini";
        if (url.includes("claude.ai")) return "claude";
        if (url.includes("copilot.microsoft.com")) return "copilot";
        if (url.includes("perplexity.ai")) return "perplexity";
        return null;
    }

    // Safely send a message to the background script with retry logic.
    // Service workers can be inactive — this gives them time to wake up.
    async function safeSendMessage(message, retries = 3, delay = 1000) {
        for (let i = 0; i < retries; i++) {
            try {
                // Check if runtime is still valid (extension might have been reloaded)
                if (!chrome.runtime?.id) return null;

                const result = await chrome.runtime.sendMessage(message);
                return result;
            } catch (err) {
                if (i < retries - 1) {
                    // Wait before retrying — service worker may be waking up
                    await new Promise(r => setTimeout(r, delay * (i + 1)));
                } else {
                    // All retries exhausted — silently fail (don't spam console)
                    return null;
                }
            }
        }
        return null;
    }

    // Check for conversations from other platforms and show banner
    async function checkAndShowBanner() {
        const currentPlatform = getCurrentPlatform();
        if (!currentPlatform) return;

        // Check if banner was already dismissed this session
        const dismissKey = `acb_banner_dismissed_${currentPlatform}`;
        const dismissed = sessionStorage.getItem(dismissKey);
        if (dismissed) return;

        const result = await safeSendMessage({
            action: "getConversationsForBanner",
            platform: currentPlatform
        });

        if (!result) return; // Background not available or no data

        const convos = result.conversations || [];
        if (convos.length === 0) return;

        // Show banner with info about available conversations
        showBanner(convos, currentPlatform, dismissKey);
    }

    function showBanner(convos, currentPlatform, dismissKey) {
        // Build a summary of platforms available
        const platforms = [...new Set(convos.map(c => c.platform))];
        const platformList = platforms
            .map(p => `${PLATFORM_ICONS[p] || "💬"} ${PLATFORM_NAMES[p] || p}`)
            .join(", ");

        const banner = document.createElement("div");
        banner.className = "acb-banner";
        banner.innerHTML = `
      <span class="acb-banner-icon">⚡</span>
      <span class="acb-banner-text">
        You have <strong>${convos.length} saved conversation${convos.length > 1 ? "s" : ""}</strong>
        from ${platformList}. Continue them here?
      </span>
      <div class="acb-banner-actions">
        <button class="acb-banner-btn acb-banner-btn-primary" id="acb-open-popup">
          Open Context Bridge
        </button>
        <button class="acb-banner-btn acb-banner-btn-dismiss" id="acb-dismiss">
          Dismiss
        </button>
      </div>
    `;

        document.body.prepend(banner);

        // Open popup (clicking the extension icon programmatically isn't possible,
        // so we just draw attention to it)
        banner.querySelector("#acb-open-popup").addEventListener("click", () => {
            // Can't programmatically open extension popup, so show inline hint
            const btn = banner.querySelector("#acb-open-popup");
            btn.textContent = "👆 Click the ⚡ icon in your toolbar!";
            btn.style.pointerEvents = "none";
            setTimeout(() => {
                dismissBanner(banner, dismissKey);
            }, 4000);
        });

        banner.querySelector("#acb-dismiss").addEventListener("click", () => {
            dismissBanner(banner, dismissKey);
        });
    }

    function dismissBanner(banner, dismissKey) {
        banner.classList.add("acb-banner-hidden");
        sessionStorage.setItem(dismissKey, "true");
        setTimeout(() => banner.remove(), 300);
    }

    // Wait for service worker to be ready, then check.
    // 3s initial delay + retry logic inside safeSendMessage handles late service worker starts.
    setTimeout(checkAndShowBanner, 3000);
})();
