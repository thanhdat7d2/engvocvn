// sessionBuilder.js

import { computeUrgency, selectReviewType } from "./scheduler.js";

const SESSION_SIZE = 50;

export function buildSession(words, wordStates, type = "learn") {
    const session = [];
    const now = Date.now();

    const learnedWords = wordStates.filter(w => w.learned);
    const newWords = wordStates.filter(w => !w.learned);

    if (type === "review") {
        const sorted = orderByUrgencyWithShuffledTies(learnedWords);

        fillReviewCards(session, sorted, SESSION_SIZE, wordStates, words);

    } else {
        const newWordCount = decideNewWordChunkSize(learnedWords, newWords.length);
        const selectedNew = shuffle(newWords).slice(0, newWordCount);

        buildLearnSession(session, learnedWords, selectedNew, now, words);
    }

    return session.slice(0, SESSION_SIZE);
}

function buildLearnSession(session, learnedWords, selectedNew, now, words) {
    const definitionPositions = buildDefinitionPositions(
        SESSION_SIZE,
        selectedNew.length,
        learnedWords.length === 0
    );
    const definitionPosSet = new Set(definitionPositions);
    const shownNewWords = [];
    const selectedByPos = new Map(
        definitionPositions.map((position, index) => [position, selectedNew[index]])
    );

    const learnedReviewOrder = orderByUrgencyWithShuffledTies(learnedWords);
    let learnedCursor = 0;

    for (let i = 0; i < SESSION_SIZE; i += 1) {
        if (definitionPosSet.has(i)) {
            const word = selectedByPos.get(i);
            if (!word) {
                continue;
            }
            shownNewWords.push(word);

            session.push({
                wordId: word.id,
                cardType: "definition"
            });
            continue;
        }

        const hasLearned = learnedReviewOrder.length > 0;
        const hasShownNew = shownNewWords.length > 0;

        if (!hasLearned && !hasShownNew) {
            continue;
        }

        const useShownNew = hasShownNew && (!hasLearned || Math.random() < 0.45);

        let pickedWord;
        if (useShownNew) {
            pickedWord = shownNewWords[Math.floor(Math.random() * shownNewWords.length)];
        } else {
            if (learnedCursor >= learnedReviewOrder.length) {
                learnedCursor = 0;
            }
            pickedWord = learnedReviewOrder[learnedCursor];
            learnedCursor += 1;
        }

        session.push({
            wordId: pickedWord.id,
            cardType: selectReviewType(pickedWord, words[pickedWord.id])
        });
    }

    if (session.length < SESSION_SIZE) {
        fillReviewCards(
            session,
            [...learnedWords, ...shownNewWords],
            SESSION_SIZE - session.length,
            [],
            words
        );
    }
}

function buildDefinitionPositions(totalCards, definitionCount, pinFirstAtZero = false) {
    if (definitionCount <= 0 || totalCards <= 0) {
        return [];
    }

    if (definitionCount === 1) {
        return [Math.floor(Math.random() * totalCards)];
    }

    const gaps = Array(definitionCount + 1).fill(0);
    const betweenCount = definitionCount - 1;

    for (let i = 1; i <= betweenCount; i += 1) {
        gaps[i] = 1;
    }

    let reviewsLeft = (totalCards - definitionCount) - betweenCount;

    if (pinFirstAtZero) {
        gaps[0] = 0;
    }

    for (let i = 1; i <= betweenCount && reviewsLeft > 0; i += 1) {
        const preferredGap = preferredReviewGap();
        const extraNeeded = Math.max(0, preferredGap - 1);
        const extra = Math.min(extraNeeded, reviewsLeft);
        gaps[i] += extra;
        reviewsLeft -= extra;
    }

    while (reviewsLeft > 0) {
        const minGapIndex = pinFirstAtZero ? 1 : 0;
        const randomGapIndex = minGapIndex + Math.floor(Math.random() * (gaps.length - minGapIndex));
        gaps[randomGapIndex] += 1;
        reviewsLeft -= 1;
    }

    const positions = [];
    let cursor = gaps[0];

    for (let i = 0; i < definitionCount; i += 1) {
        positions.push(cursor);
        cursor += 1 + gaps[i + 1];
    }

    return positions;
}

function preferredReviewGap() {
    const roll = Math.random();

    if (roll < 0.08) {
        return 1;
    }

    if (roll < 0.63) {
        return 2;
    }

    if (roll < 0.9) {
        return 3;
    }

    return 4;
}

function fillReviewCards(session, words, count, fallbackWords = [], allWords = []) {
    if (count <= 0) {
        return;
    }

    const source = words.length ? words : fallbackWords;
    if (!source.length) {
        return;
    }

    const targetLength = session.length + count;
    let i = 0;
    let ordered = shuffle(source);

    while (session.length < targetLength) {
        if (i >= ordered.length) {
            ordered = shuffle(source);
            i = 0;
        }

        const w = ordered[i];

        session.push({
            wordId: w.id,
            cardType: selectReviewType(w, allWords[w.id])
        });

        i++;
    }
}

function shuffle(arr) {
    const clone = [...arr];
    for (let i = clone.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [clone[i], clone[j]] = [clone[j], clone[i]];
    }
    return clone;
}

function orderByUrgencyWithShuffledTies(words) {
    const bucketed = words.map(word => {
        const urgency = computeUrgency(word);
        const urgencyBucket = Math.round(urgency * 100);
        return { word, urgencyBucket };
    });

    bucketed.sort((a, b) => b.urgencyBucket - a.urgencyBucket);

    const ordered = [];
    let index = 0;

    while (index < bucketed.length) {
        const currentBucket = bucketed[index].urgencyBucket;
        const tieGroup = [];

        while (index < bucketed.length && bucketed[index].urgencyBucket === currentBucket) {
            tieGroup.push(bucketed[index].word);
            index += 1;
        }

        ordered.push(...shuffle(tieGroup));
    }

    return ordered;
}

function decideNewWordChunkSize(learnedWords, availableNewWords) {
    if (availableNewWords <= 0) {
        return 0;
    }

    if (learnedWords.length === 0) {
        return Math.min(randomChunkSize(), availableNewWords);
    }

    const stableLearnedCount = learnedWords.filter(word => {
        const accuracy = word.correctCount / Math.max(1, word.correctCount + word.wrongCount);
        return word.correctCount >= 3 && accuracy >= 0.75 && word.stability >= 1.5;
    }).length;

    const readinessRatio = stableLearnedCount / learnedWords.length;

    if (readinessRatio >= 0.65) {
        return Math.min(randomChunkSize(), availableNewWords);
    }

    return 0;
}

function randomChunkSize() {
    return 6 + Math.floor(Math.random() * 2);
}