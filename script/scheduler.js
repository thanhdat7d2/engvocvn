// scheduler.js

import { averageMastery } from "./reviewEngine.js";
import { REVIEW_TYPES } from "./wordState.js";

export function computeUrgency(wordState) {
    const now = Date.now();

    const overdueRatio =
        (now - wordState.nextReview) /
        (wordState.stability * 24 * 60 * 60 * 1000);

    const avgMastery = averageMastery(wordState);

    return (
        0.5 * overdueRatio +
        0.3 * (1 - avgMastery) +
        0.2 * wordState.difficulty
    );
}

export function selectReviewType(wordState, wordEntry) {
    const eligibleTypes = [
        REVIEW_TYPES.RT1,
        REVIEW_TYPES.RT3,
        REVIEW_TYPES.RT4
    ];

    if (isSingleWord(wordEntry?.vocab)) {
        eligibleTypes.push(REVIEW_TYPES.RT2);
    }

    if (canUseAudioQuiz(wordEntry)) {
        eligibleTypes.push(REVIEW_TYPES.RT5);
    }

    if (hasRelationWords(wordEntry?.synonym)) {
        eligibleTypes.push(REVIEW_TYPES.RT6);
    }

    if (hasRelationWords(wordEntry?.antonym)) {
        eligibleTypes.push(REVIEW_TYPES.RT7);
    }

    const randomIndex = Math.floor(Math.random() * eligibleTypes.length);
    return eligibleTypes[randomIndex];
}

function isSingleWord(value) {
    if (!value || typeof value !== "string") {
        return false;
    }

    return !/\s/.test(value.trim());
}

function canUseAudioQuiz(wordEntry) {
    const hasPron = typeof wordEntry?.pron === "string" && wordEntry.pron.trim().length > 0;
    const isOnline = typeof navigator === "undefined" ? true : navigator.onLine;
    return isSingleWord(wordEntry?.vocab) && hasPron && isOnline;
}

function hasRelationWords(values) {
    if (!Array.isArray(values)) {
        return false;
    }

    return values.some(item => typeof item === "string" && item.trim() && item.trim() !== "-");
}