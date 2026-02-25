// reviewEngine.js

function daysBetween(t1, t2) {
    return Math.max(0, (t2 - t1) / (1000 * 60 * 60 * 24));
}

function recallProbability(deltaDays, stability) {
    return Math.exp(-deltaDays / stability);
}

export function processReview(wordState, reviewType, isCorrect) {
    const now = Date.now();

    const deltaDays = wordState.lastReview
        ? daysBetween(wordState.lastReview, now)
        : 0;

    const pRecall = recallProbability(deltaDays, wordState.stability);

    const rtState = wordState.reviewTypeStats[reviewType];
    rtState.seen += 1;

    if (isCorrect) {
        // ---------- CORRECT ----------
        wordState.correctCount += 1;
        rtState.correct += 1;

        const Snew =
            wordState.stability *
            (1 + 0.4 * (1 - pRecall)) *
            (1 / wordState.difficulty);

        wordState.stability = Snew;

        rtState.mastery =
            rtState.mastery + 0.2 * (1 - rtState.mastery);

        let factor = 1.0;
        if (coverage(wordState) >= 5) factor = 1.3;
        if (averageMastery(wordState) > 0.8) factor = 1.6;

        const nextIntervalDays = Snew * factor;

        wordState.nextReview =
            now + nextIntervalDays * 24 * 60 * 60 * 1000;

    } else {
        // ---------- INCORRECT ----------
        wordState.wrongCount += 1;
        rtState.wrong += 1;

        wordState.stability = Math.max(
            0.3,
            wordState.stability * 0.5
        );

        wordState.difficulty *= 1.1;

        rtState.mastery *= 0.5;

        const soon = Math.min(0.25, wordState.stability);

        wordState.nextReview =
            now + soon * 24 * 60 * 60 * 1000;
    }

    wordState.lastReview = now;

    return wordState;
}

export function coverage(wordState) {
    return Object.values(wordState.reviewTypeStats)
        .filter(rt => rt.seen > 0).length;
}

export function averageMastery(wordState) {
    const values = Object.values(wordState.reviewTypeStats)
        .map(rt => rt.mastery);
    return values.reduce((a, b) => a + b, 0) / values.length;
}