// storage.js

export function saveState(wordStates) {
    localStorage.setItem(
        "vocab_state",
        JSON.stringify(wordStates)
    );
}

export function loadState() {
    const raw = localStorage.getItem("vocab_state");
    if (!raw) {
        return null;
    }

    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

export function clearState() {
    localStorage.removeItem("vocab_state");
}

export function saveLearnQueueState(queueState) {
    localStorage.setItem(
        "vocab_learn_queue_state",
        JSON.stringify(queueState)
    );
}

export function loadLearnQueueState() {
    const raw = localStorage.getItem("vocab_learn_queue_state");
    if (!raw) {
        return null;
    }

    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
        return null;
    }
}

export function clearLearnQueueState() {
    localStorage.removeItem("vocab_learn_queue_state");
}