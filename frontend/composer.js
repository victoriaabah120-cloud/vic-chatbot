// Message composer behaviour: the textarea grows upward as the message wraps,
// shrinks again when text is deleted, and never grows past a sensible ceiling.
// It also decides what Enter does on a touch keyboard. Nothing here touches
// sending, attachments, voice input or image creation; those stay in script.js.

const messageInput = document.getElementById("messageInput");

if (messageInput && messageInput.tagName === "TEXTAREA") {
    const coarsePointer = window.matchMedia("(pointer: coarse)");

    // On a phone keyboard the return key should insert a line; on a physical
    // keyboard it should send. The key's label is kept in step.
    function labelReturnKey() {
        messageInput.setAttribute("enterkeyhint", coarsePointer.matches ? "enter" : "send");
    }

    function maximumHeight() {
        const ceiling = parseFloat(getComputedStyle(messageInput).maxHeight);

        return Number.isFinite(ceiling) ? ceiling : 200;
    }

    function resize() {
        const ceiling = maximumHeight();

        // Collapse first so scrollHeight reports the height the text needs.
        messageInput.style.height = "auto";

        const needed = messageInput.scrollHeight;
        const target = Math.min(needed, ceiling);

        messageInput.style.height = target + "px";
        messageInput.style.overflowY = needed > ceiling ? "auto" : "hidden";

        // Keep the newest line in view while the message grows past the ceiling.
        if (needed > ceiling) {
            messageInput.scrollTop = messageInput.scrollHeight;
        }
    }

    messageInput.addEventListener("input", resize);
    messageInput.addEventListener("change", resize);

    // Pasting, voice transcripts and programmatic clears all land here.
    ["keyup", "paste", "cut", "drop"].forEach((type) => {
        messageInput.addEventListener(type, resize);
    });

    window.addEventListener("resize", resize);

    if (window.visualViewport) {
        window.visualViewport.addEventListener("resize", () => {
            resize();

            // A phone keyboard can leave the composer under it; keep it visible.
            if (messageInput === document.activeElement) {
                messageInput.scrollIntoView({ block: "nearest" });
            }
        });
    }

    if (typeof coarsePointer.addEventListener === "function") {
        coarsePointer.addEventListener("change", labelReturnKey);
    }

    labelReturnKey();

    // script.js clears the field when a message is sent, so expose the resize
    // for it to call afterwards.
    window.vicComposer = { resize };

    resize();
}
