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

export function createInitialWordState(id) {
    return {
        id,
        learned: false,
        introducedAt: null,

        stability: 0.5,
        difficulty: 1.0,

        lastReview: null,
        nextReview: Date.now(),

        correctCount: 0,
        wrongCount: 0,

        reviewTypeStats: Object.values(REVIEW_TYPES).reduce((acc, type) => {
            acc[type] = {
                seen: 0,
                correct: 0,
                wrong: 0,
                mastery: 0
            };
            return acc;
        }, {})
    };
}