// sessionBuilder.js

import { REVIEW_TYPES } from "./wordState.js";

const SESSION_SIZE = 50;

export function buildSession(words, wordStates, type = "learn") {
    const introduced = wordStates.filter(state => isWordIntroduced(state));
    const unintroduced = wordStates.filter(state => !isWordIntroduced(state));

    if (type === "learn" && unintroduced.length > 0) {
        const pick = unintroduced[Math.floor(Math.random() * unintroduced.length)];
        return [{ wordId: pick.id, cardType: "definition" }];
    }

    if (!introduced.length) {
        return [];
    }

    const session = [];
    for (let i = 0; i < SESSION_SIZE; i += 1) {
        const word = pickMostUrgentWord(introduced);
        session.push({
            wordId: word.id,
            cardType: pickReviewType(word, words[word.id])
        });
    }

    return session;
}

function pickMostUrgentWord(states) {
    let minUrgency = Number.POSITIVE_INFINITY;
    states.forEach(state => {
        minUrgency = Math.min(minUrgency, Number(state.urgency) || 0);
    });

    const tied = states.filter(state => (Number(state.urgency) || 0) === minUrgency);
    return tied[Math.floor(Math.random() * tied.length)];
}

function pickReviewType(wordState, wordEntry) {
    const eligible = [REVIEW_TYPES.RT1, REVIEW_TYPES.RT3, REVIEW_TYPES.RT4];

    if (isSingleWord(wordEntry?.vocab)) {
        eligible.push(REVIEW_TYPES.RT2);
    }
    if (isSingleWord(wordEntry?.vocab) && typeof wordEntry?.pron === "string" && wordEntry.pron.trim()) {
        eligible.push(REVIEW_TYPES.RT5);
    }
    if (hasRelationWords(wordEntry?.synonym)) {
        eligible.push(REVIEW_TYPES.RT6);
    }
    if (hasRelationWords(wordEntry?.antonym)) {
        eligible.push(REVIEW_TYPES.RT7);
    }

    const unseen = eligible.filter(type => (wordState.RTcounter?.[type] || 0) === 0);
    const pool = unseen.length ? unseen : eligible;
    return pool[Math.floor(Math.random() * pool.length)];
}

function shuffle(arr) {
    const clone = [...arr];
    for (let i = clone.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [clone[i], clone[j]] = [clone[j], clone[i]];
    }
    return clone;
}

function isSingleWord(value) {
    if (!value || typeof value !== "string") {
        return false;
    }
    return !/\s/.test(value.trim());
}

function hasRelationWords(values) {
    if (!Array.isArray(values)) {
        return false;
    }
    return values.some(item => typeof item === "string" && item.trim() && item.trim() !== "-");
}

function isWordIntroduced(wordState) {
    return (Number(wordState?.total_card_seen) || 0) > 0;
}