// reviewEngine.js

import { recalculateWordMetrics, REVIEW_TYPES } from "./wordState.js";

function ceilMinOne(value) {
    return Math.max(1, Math.ceil(value));
}

function clampGrowRate(value) {
    return Math.min(1.4, Math.max(1.2, value));
}

function determineGrowRateOnIncorrect(recentIncorrect, incorrectRatio) {
    if (recentIncorrect > 3 || incorrectRatio > 0.3) {
        return 1.2;
    }
    if (recentIncorrect === 3 || incorrectRatio > 0.25) {
        return 1.25;
    }
    if (recentIncorrect === 2 || incorrectRatio > 0.2) {
        return 1.3;
    }
    if (recentIncorrect === 1 || incorrectRatio > 0.15) {
        return 1.35;
    }
    return 1.4;
}

export function processReview(wordState, reviewType, isCorrect) {
    if (!wordState || !wordState.RTcounter) {
        return {
            wordState,
            shouldShowDefinitionImmediately: false
        };
    }

    if (!Array.isArray(wordState.recent_queue)) {
        wordState.recent_queue = [0, 0, 0, 0, 0];
    }

    const safeTotalSeen = Math.max(1, Number(wordState.total_card_seen) || 1);

    const isLexicalRelationCard = reviewType === REVIEW_TYPES.RT6 || reviewType === REVIEW_TYPES.RT7;

    if (isCorrect) {
        wordState.recent_queue.push(0);
        if (wordState.grow_rate < 1.4) {
            wordState.grow_rate += 0.07;
            if (wordState.grow_rate > 1.4) {
                wordState.grow_rate = 1.4;
            }
        }
        if (wordState.grow_rate > 1.4) {
            wordState.grow_rate = 1.4;
        }

        wordState.distance = ceilMinOne((Number(wordState.distance) || 1) * (Number(wordState.grow_rate) || 1.4));
        wordState.stability = Math.max(6, wordState.distance / 0.16252);
        wordState.counter = 0;
        wordState.RTcounter[reviewType] = (Number(wordState.RTcounter[reviewType]) || 0) + 1;
    } else {
        wordState.total_incorrect = (Number(wordState.total_incorrect) || 0) + 1;
        wordState.recent_queue.push(1);

        if (isLexicalRelationCard) {
            wordState.grow_rate = 1.33;
            wordState.distance = ceilMinOne((Number(wordState.distance) || 1) * 0.75);
            wordState.RTcounter[REVIEW_TYPES.RT1] = (Number(wordState.RTcounter[REVIEW_TYPES.RT1]) || 0) - 1;
            wordState.RTcounter[REVIEW_TYPES.RT3] = (Number(wordState.RTcounter[REVIEW_TYPES.RT3]) || 0) - 1;
        } else {
            const recentIncorrect = wordState.recent_queue.reduce((sum, value) => {
                return sum + (value ? 1 : 0);
            }, 0);
            const incorrectRatio = wordState.total_incorrect / safeTotalSeen;

            wordState.grow_rate = clampGrowRate(determineGrowRateOnIncorrect(recentIncorrect, incorrectRatio));
            wordState.distance = ceilMinOne((Number(wordState.distance) || 1) / 4);
        }
        wordState.stability = Math.max(6, wordState.distance / 0.16252);
        wordState.counter = 0;
    }

    wordState.recent_queue.shift();
    wordState.total_card_seen = safeTotalSeen + 1;
    recalculateWordMetrics(wordState);

    return {
        wordState,
        shouldShowDefinitionImmediately: !isCorrect
    };
}