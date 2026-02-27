// wordState.js

export const REVIEW_TYPES = {
    RT1: "meaning_to_word_mcq",
    RT2: "meaning_to_word_typing",
    RT3: "word_to_meaning_mcq",
    RT4: "example_to_meaning_mcq",
    RT5: "audio_to_meaning_mcq",
    RT6: "word_to_synonym_mcq",
    RT7: "word_to_antonym_mcq"
};

const S_MIN = 6.0;
const S_MAX = 1829.480804;

export function masteryScoreFromStability(stability) {
    const safeStability = Math.max(S_MIN, Number(stability) || S_MIN);
    const raw = 1 + 99 * Math.log(safeStability / S_MIN) / Math.log(S_MAX / S_MIN);
    return Math.max(1, Math.min(100, raw));
}

export function computeUrgency(counter, stability) {
    const safeCounter = Math.max(0, Number(counter) || 0);
    const safeStability = Math.max(S_MIN, Number(stability) || S_MIN);
    return Math.exp(-safeCounter / safeStability) - 0.85;
}

function createRtCounter() {
    return Object.values(REVIEW_TYPES).reduce((acc, type) => {
        acc[type] = 0;
        return acc;
    }, {});
}

export function createInitialWordState(id) {
    return {
        id,
        bootstrap_slot: null,
        stability: 6,
        counter: 0,
        distance: 1,
        grow_rate: 1.4,

        urgency: computeUrgency(0, 6),
        mastery_score: masteryScoreFromStability(6),

        RTcounter: createRtCounter(),

        total_card_seen: 0,
        total_incorrect: 0,
        recent_queue: [0, 0, 0, 0, 0]
    };
}

export function initializeIntroducedWordState(wordState) {
    const next = {
        ...wordState,
        stability: 6,
        counter: 0,
        distance: 1,
        grow_rate: 1.4,
        urgency: computeUrgency(0, 6),
        mastery_score: masteryScoreFromStability(6),
        RTcounter: createRtCounter(),
        total_card_seen: 1,
        total_incorrect: 0,
        recent_queue: [0, 0, 0, 0, 0]
    };

    return next;
}

export function recalculateWordMetrics(wordState) {
    wordState.stability = Math.max(6, Number(wordState.stability) || 6);
    wordState.counter = Math.max(0, Number(wordState.counter) || 0);
    wordState.urgency = computeUrgency(wordState.counter, wordState.stability);
    wordState.mastery_score = masteryScoreFromStability(wordState.stability);
    return wordState;
}