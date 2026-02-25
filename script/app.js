const ASSET_VERSION = window.__ASSET_VERSION__ || Date.now().toString();

let createInitialWordState;
let REVIEW_TYPES;
let processReview;
let computeUrgency;
let loadState;
let saveState;
let clearState;
let loadLearnQueueState;
let saveLearnQueueState;
let clearLearnQueueState;

const SESSION_SIZE = 50;
const LEARNING_QUEUE_SIZE = 6;
const LEARNING_GRADUATION_SCORE = 3.8;

const progressFill = document.getElementById("progressFill");
const learnedProgressFill = document.getElementById("learnedProgressFill");
const wordText = document.getElementById("wordText");
const meaningText = document.getElementById("meaningText");
const promptText = document.getElementById("promptText");
const choicesWrap = document.getElementById("choicesWrap");
const typingInput = document.getElementById("typingInput");
const feedbackText = document.getElementById("feedbackText");
const audioWrap = document.getElementById("audioWrap");
const audioReplayBtn = document.getElementById("audioReplayBtn");
const pronAudio = document.getElementById("pronAudio");
const learnModeBtn = document.getElementById("learnModeBtn");
const reviewModeBtn = document.getElementById("reviewModeBtn");
const learnedWordsTabBtn = document.getElementById("learnedWordsTabBtn");
const resetProgressBtn = document.getElementById("resetProgressBtn");
const cardContainer = document.getElementById("cardContainer");
const learnedWordsPanel = document.getElementById("learnedWordsPanel");
const learnedWordsList = document.getElementById("learnedWordsList");
const learnedWordsTitle = learnedWordsPanel?.querySelector(".panel-title");
const headerLogo = document.querySelector(".header-logo");
const appInfoOverlay = document.getElementById("appInfoOverlay");
const appInfoCloseBtn = document.getElementById("appInfoCloseBtn");
const appInfoVersion = document.getElementById("appInfoVersion");
const appInfoWordCount = document.getElementById("appInfoWordCount");
const SPEAKER_ICON_SRC = `./icon/speaker.svg?v=${ASSET_VERSION}`;
const correctAudio = new Audio(`./audio/true.wav?v=${ASSET_VERSION}`);
const wrongAudio = new Audio(`./audio/false.wav?v=${ASSET_VERSION}`);

let data = [];
let wordStates = [];
let session = [];
let currentIndex = 0;
let mode = "learn";
let activeTab = "session";
let answered = false;
let touchStartX = 0;
let touchStartY = 0;
let sessionRuntime = null;

init();

async function init() {
    await loadDependencies();
    data = await fetchData();

    const savedState = loadState();

    if (!savedState) {
        wordStates = data.map((_, i) => createInitialWordState(i));
        saveState(wordStates);
    } else {
        wordStates = normalizeStates(savedState, data.length);
    }

    wireEvents();
    populateAppInfo();
    startSession("learn");
}

async function loadDependencies() {
    const [wordStateModule, reviewEngineModule, schedulerModule, storageModule] = await Promise.all([
        import(`./wordState.js?v=${ASSET_VERSION}`),
        import(`./reviewEngine.js?v=${ASSET_VERSION}`),
        import(`./scheduler.js?v=${ASSET_VERSION}`),
        import(`./storage.js?v=${ASSET_VERSION}`)
    ]);

    createInitialWordState = wordStateModule.createInitialWordState;
    REVIEW_TYPES = wordStateModule.REVIEW_TYPES;
    processReview = reviewEngineModule.processReview;
    computeUrgency = schedulerModule.computeUrgency;
    loadState = storageModule.loadState;
    saveState = storageModule.saveState;
    clearState = storageModule.clearState;
    loadLearnQueueState = storageModule.loadLearnQueueState;
    saveLearnQueueState = storageModule.saveLearnQueueState;
    clearLearnQueueState = storageModule.clearLearnQueueState;
}

async function fetchData() {
    const response = await fetch(`./data/data.json?v=${ASSET_VERSION}`, { cache: "no-store" });
    if (!response.ok) {
        throw new Error("Cannot load data.json");
    }
    return response.json();
}

function normalizeStates(savedState, dataLength) {
    const stateMap = new Map(savedState.map(s => [s.id, s]));
    const merged = [];

    for (let i = 0; i < dataLength; i += 1) {
        const existing = stateMap.get(i);
        merged.push(existing ? ensureWordStateShape(existing, i) : createInitialWordState(i));
    }

    saveState(merged);
    return merged;
}

function ensureWordStateShape(state, id) {
    const base = createInitialWordState(id);
    const shaped = {
        ...base,
        ...state,
        reviewTypeStats: {
            ...base.reviewTypeStats
        }
    };

    Object.keys(base.reviewTypeStats).forEach(type => {
        shaped.reviewTypeStats[type] = {
            ...base.reviewTypeStats[type],
            ...(state?.reviewTypeStats?.[type] || {})
        };
    });

    return shaped;
}

function wireEvents() {
    if (audioReplayBtn) {
        audioReplayBtn.querySelector("img")?.setAttribute("src", SPEAKER_ICON_SRC);
        audioReplayBtn.addEventListener("click", () => {
            playPronunciation();
        });
    }

    learnModeBtn.addEventListener("click", () => startSession("learn"));
    reviewModeBtn.addEventListener("click", () => startSession("review"));
    learnedWordsTabBtn.addEventListener("click", () => {
        activeTab = "learned";
        setActiveTabButtons();
        renderLearnedWordsPanel();
    });
    resetProgressBtn.addEventListener("click", resetProgress);

    if (headerLogo) {
        headerLogo.addEventListener("click", openAppInfoCard);
    }

    if (appInfoCloseBtn) {
        appInfoCloseBtn.addEventListener("click", closeAppInfoCard);
    }

    if (appInfoOverlay) {
        appInfoOverlay.addEventListener("click", event => {
            if (event.target === appInfoOverlay) {
                closeAppInfoCard();
            }
        });
    }

    typingInput.addEventListener("keydown", event => {
        if (event.key !== "Enter" || answered) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        submitTypingAnswerForCurrentCard();
    });

    document.addEventListener("keydown", event => {
        if (!appInfoOverlay?.classList.contains("hidden") && event.key === "Escape") {
            event.preventDefault();
            closeAppInfoCard();
            return;
        }

        if (event.key !== "Enter") {
            return;
        }

        const currentCard = session[currentIndex];
        const canAdvanceDefinition = currentCard?.cardType === "definition";
        if (!answered && !canAdvanceDefinition) {
            return;
        }

        event.preventDefault();
        goToNextCard();
    });

    document.addEventListener("touchstart", event => {
        const touch = event.changedTouches?.[0];
        if (!touch) {
            return;
        }

        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
    }, { passive: true });

    document.addEventListener("touchend", event => {
        const currentCard = session[currentIndex];
        const canAdvanceDefinition = currentCard?.cardType === "definition";
        const canSubmitTypingBySwipe = isTypingQuizCard(currentCard)
            && !answered
            && typingInput.value.trim().length > 0;

        if (!answered && !canAdvanceDefinition && !canSubmitTypingBySwipe) {
            return;
        }

        const touch = event.changedTouches?.[0];
        if (!touch) {
            return;
        }

        const dx = touch.clientX - touchStartX;
        const dy = touch.clientY - touchStartY;
        const isHorizontalSwipe = Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy);

        if (isHorizontalSwipe) {
            if (canSubmitTypingBySwipe) {
                submitTypingAnswerForCurrentCard();
                return;
            }
            goToNextCard();
        }
    }, { passive: true });
}

function isTypingQuizCard(card) {
    return Boolean(card && card.cardType === REVIEW_TYPES?.RT2);
}

function buildTypingHintMask(vocab) {
    const clean = typeof vocab === "string" ? vocab.trim() : "";
    if (!clean) {
        return "";
    }

    const firstChar = clean[0];
    const hiddenChars = "_".repeat(Math.max(0, clean.length - 1));
    return `${firstChar}${hiddenChars}`;
}

function submitTypingAnswerForCurrentCard() {
    const card = session[currentIndex];
    if (!isTypingQuizCard(card) || answered) {
        return false;
    }

    const entry = data[card.wordId];
    const userAnswer = typingInput.value.trim().toLowerCase();
    if (!userAnswer) {
        return false;
    }

    const correctAnswer = (entry.vocab || "").trim().toLowerCase();
    const isCorrect = userAnswer === correctAnswer;

    handleAnswered(card, isCorrect, `Answer: ${entry.vocab}`);
    return true;
}

function openAppInfoCard() {
    if (!appInfoOverlay) {
        return;
    }

    appInfoOverlay.classList.remove("hidden");
    appInfoOverlay.setAttribute("aria-hidden", "false");
}

function closeAppInfoCard() {
    if (!appInfoOverlay) {
        return;
    }

    appInfoOverlay.classList.add("hidden");
    appInfoOverlay.setAttribute("aria-hidden", "true");
}

function populateAppInfo() {
    if (appInfoVersion) {
        appInfoVersion.textContent = ASSET_VERSION;
    }

    if (appInfoWordCount) {
        appInfoWordCount.textContent = String(data.length);
    }
}

function goToNextCard() {
    markDefinitionAsLearnedIfNeeded();
    currentIndex += 1;
    renderCurrentCard();
}

function markDefinitionAsLearnedIfNeeded() {
    const card = session[currentIndex];
    if (!card || card.cardType !== "definition") {
        return;
    }

    const wordState = wordStates[card.wordId];
    if (!wordState || wordState.learned) {
        return;
    }

    wordState.learned = true;
    wordState.introducedAt = Date.now();
    saveState(wordStates);
}

function startSession(nextMode) {
    mode = nextMode;
    activeTab = "session";
    session = [];
    saveState(wordStates);
    currentIndex = 0;
    sessionRuntime = createSessionRuntime(mode);
    setModeButtons();
    setActiveTabButtons();
    showSessionPanel();
    ensureCardAvailable(currentIndex);
    renderCurrentCard();
}

function createSessionRuntime(nextMode) {
    const learnedWords = wordStates.filter(w => w.learned);
    const queueState = nextMode === "learn"
        ? createLearnQueueState(loadLearnQueueState ? loadLearnQueueState() : null)
        : { queuedLearningWordIds: [], pendingDefinitionWordIds: [], newWordOrderIds: [], nextWordCursor: 0 };

    const runtime = {
        mode: nextMode,
        targetSize: SESSION_SIZE,
        learnedReviewOrder: orderByUrgencyWithShuffledTies(learnedWords),
        learnedCursor: 0,
        newWordOrderIds: queueState.newWordOrderIds,
        nextWordCursor: queueState.nextWordCursor,
        queuedLearningWordIds: queueState.queuedLearningWordIds,
        pendingDefinitionWordIds: queueState.pendingDefinitionWordIds,
        shownDefinitionWordIds: new Set(),
        cardsSinceDefinition: Number.MAX_SAFE_INTEGER,
        nextDefinitionGap: randomPreferredDefinitionGap(),
        wrongStreakByWordId: new Map(),
        remedialDefinitionQueue: []
    };

    if (nextMode === "learn") {
        persistLearnQueueState(runtime);
    }

    return runtime;
}

function ensureCardAvailable(index) {
    while (session.length <= index && session.length < SESSION_SIZE) {
        const nextCard = generateNextCard();
        if (!nextCard) {
            break;
        }
        session.push(nextCard);
    }
}

function generateNextCard() {
    if (!sessionRuntime || session.length >= SESSION_SIZE) {
        return null;
    }

    const remedialWordId = popNextRemedialDefinitionWordId();
    if (remedialWordId != null) {
        sessionRuntime.shownDefinitionWordIds.add(remedialWordId);
        sessionRuntime.cardsSinceDefinition = 0;
        sessionRuntime.nextDefinitionGap = randomPreferredDefinitionGap();
        return {
            wordId: remedialWordId,
            cardType: "definition"
        };
    }

    if (shouldShowNewDefinitionNow()) {
        const wordId = sessionRuntime.pendingDefinitionWordIds.shift();
        if (wordId == null) {
            return null;
        }
        sessionRuntime.shownDefinitionWordIds.add(wordId);
        sessionRuntime.cardsSinceDefinition = 0;
        sessionRuntime.nextDefinitionGap = randomPreferredDefinitionGap();
        return {
            wordId,
            cardType: "definition"
        };
    }

    const reviewWord = pickNextReviewWordState();
    if (!reviewWord) {
        return null;
    }

    sessionRuntime.cardsSinceDefinition += 1;
    return {
        wordId: reviewWord.id,
        cardType: pickCardTypeAvoidingAdjacentDuplicate(reviewWord)
    };
}

function shouldShowNewDefinitionNow() {
    if (!sessionRuntime || sessionRuntime.mode !== "learn") {
        return false;
    }

    refillLearningQueueIfNeeded();

    if (!sessionRuntime.pendingDefinitionWordIds.length) {
        return false;
    }

    const previousCard = session[session.length - 1];
    if (previousCard?.cardType === "definition") {
        return false;
    }

    if (!sessionRuntime.learnedReviewOrder.length && !sessionRuntime.shownDefinitionWordIds.size) {
        return true;
    }

    return sessionRuntime.cardsSinceDefinition >= sessionRuntime.nextDefinitionGap;
}

function popNextRemedialDefinitionWordId() {
    if (!sessionRuntime || !sessionRuntime.remedialDefinitionQueue.length) {
        return null;
    }

    const previousCard = session[session.length - 1];
    if (previousCard?.cardType === "definition") {
        return null;
    }

    return sessionRuntime.remedialDefinitionQueue.shift();
}

function pickNextReviewWordState() {
    const candidates = buildEligibleReviewWordStates();
    if (!candidates.length) {
        return null;
    }

    const recentReviewWordIds = getRecentReviewWordIds();
    const blockedWordId = recentReviewWordIds.length >= 2
        && recentReviewWordIds[0] === recentReviewWordIds[1]
        ? recentReviewWordIds[0]
        : null;

    let ordered = orderByUrgencyWithShuffledTies(candidates);
    if (blockedWordId != null) {
        const withoutBlocked = ordered.filter(word => word.id !== blockedWordId);
        if (withoutBlocked.length) {
            ordered = withoutBlocked;
        }
    }

    return ordered[0] || null;
}

function buildEligibleReviewWordStates() {
    if (!sessionRuntime) {
        return [];
    }

    const candidates = [];

    sessionRuntime.learnedReviewOrder.forEach(word => {
        const currentState = wordStates[word.id];
        if (currentState?.learned && shouldIncludeLearnedWordInCurrentCard(currentState)) {
            candidates.push(currentState);
        }
    });

    if (!candidates.length && sessionRuntime.mode === "review") {
        const fallbackLearned = sessionRuntime.learnedReviewOrder
            .map(word => wordStates[word.id])
            .find(state => state?.learned);

        if (fallbackLearned) {
            candidates.push(fallbackLearned);
        }
    }

    if (sessionRuntime.mode === "learn") {
        sessionRuntime.shownDefinitionWordIds.forEach(wordId => {
            const word = wordStates[wordId];
            if (word && !candidates.some(item => item.id === word.id)) {
                candidates.push(word);
            }
        });
    }

    return candidates;
}

function refillLearningQueueIfNeeded() {
    if (!sessionRuntime || sessionRuntime.mode !== "learn") {
        return;
    }

    if (!canIntroduceAnotherNewWord()) {
        return;
    }

    let changed = false;

    while (
        sessionRuntime.pendingDefinitionWordIds.length < LEARNING_QUEUE_SIZE
        && sessionRuntime.nextWordCursor < sessionRuntime.newWordOrderIds.length
    ) {
        const nextWordId = sessionRuntime.newWordOrderIds[sessionRuntime.nextWordCursor];
        sessionRuntime.nextWordCursor += 1;

        const candidate = wordStates[nextWordId];
        if (!candidate || candidate.learned) {
            continue;
        }

        if (!sessionRuntime.queuedLearningWordIds.includes(nextWordId)) {
            sessionRuntime.queuedLearningWordIds.push(nextWordId);
        }

        if (sessionRuntime.pendingDefinitionWordIds.includes(nextWordId)) {
            continue;
        }

        sessionRuntime.pendingDefinitionWordIds.push(nextWordId);
        changed = true;
        break;
    }

    if (changed) {
        persistLearnQueueState(sessionRuntime);
    }
}

function maybeGraduateLearningWord(wordId) {
    if (!sessionRuntime || sessionRuntime.mode !== "learn") {
        return;
    }

    if (!sessionRuntime.queuedLearningWordIds.includes(wordId)) {
        return;
    }

    const wordState = wordStates[wordId];
    if (!wordState) {
        return;
    }

    if (!isWordReadyToGraduate(wordId, wordState)) {
        return;
    }

    sessionRuntime.queuedLearningWordIds = sessionRuntime.queuedLearningWordIds.filter(id => id !== wordId);
    sessionRuntime.pendingDefinitionWordIds = sessionRuntime.pendingDefinitionWordIds.filter(id => id !== wordId);
    refillLearningQueueIfNeeded();
    persistLearnQueueState(sessionRuntime);
}

function createLearnQueueState(savedQueueState) {
    const eligibleIds = wordStates
        .map((state, index) => ({ state, index }))
        .filter(item => item.state && !item.state.learned)
        .map(item => item.index);
    const eligibleIdSet = new Set(eligibleIds);

    const savedOrder = Array.isArray(savedQueueState?.newWordOrderIds)
        ? savedQueueState.newWordOrderIds
            .filter(id => Number.isInteger(id) && eligibleIdSet.has(id))
            .filter((id, index, arr) => arr.indexOf(id) === index)
        : [];

    const missingIds = eligibleIds.filter(id => !savedOrder.includes(id));
    const newWordOrderIds = [...savedOrder, ...shuffle(missingIds)];

    let nextWordCursor = Number.isInteger(savedQueueState?.nextWordCursor)
        ? savedQueueState.nextWordCursor
        : 0;
    nextWordCursor = Math.max(0, Math.min(nextWordCursor, newWordOrderIds.length));

    return {
        queuedLearningWordIds: [],
        pendingDefinitionWordIds: [],
        newWordOrderIds,
        nextWordCursor
    };
}

function persistLearnQueueState(runtime) {
    if (!saveLearnQueueState || !runtime || runtime.mode !== "learn") {
        return;
    }

    saveLearnQueueState({
        newWordOrderIds: runtime.newWordOrderIds,
        nextWordCursor: runtime.nextWordCursor
    });
}

function getRecentReviewWordIds() {
    const ids = [];

    for (let i = session.length - 1; i >= 0 && ids.length < 2; i -= 1) {
        const card = session[i];
        if (card.cardType === "definition") {
            continue;
        }
        ids.push(card.wordId);
    }

    return ids;
}

function setModeButtons() {
    const onSessionTab = activeTab === "session";
    learnModeBtn.classList.toggle("active", onSessionTab && mode === "learn");
    reviewModeBtn.classList.toggle("active", onSessionTab && mode === "review");
}

function setActiveTabButtons() {
    learnedWordsTabBtn.classList.toggle("active", activeTab === "learned");
    setModeButtons();
}

function showSessionPanel() {
    cardContainer.classList.remove("hidden");
    learnedWordsPanel.classList.add("hidden");
}

function showLearnedWordsPanel() {
    cardContainer.classList.add("hidden");
    learnedWordsPanel.classList.remove("hidden");
}

function renderLearnedWordsPanel() {
    showLearnedWordsPanel();
    learnedWordsList.innerHTML = "";

    const learned = wordStates
        .filter(state => state.learned && data[state.id])
        .sort((a, b) => {
            const scoreDiff = scoreOnFive(b) - scoreOnFive(a);
            if (Math.abs(scoreDiff) > 0.0001) {
                return scoreDiff;
            }
            return data[a.id].vocab.localeCompare(data[b.id].vocab);
        });

    if (learnedWordsTitle) {
        learnedWordsTitle.textContent = `Learned words (${learned.length}/${data.length})`;
    }

    if (learnedProgressFill) {
        const learnedPercent = data.length > 0 ? (learned.length / data.length) * 100 : 0;
        learnedProgressFill.style.width = `${learnedPercent}%`;
    }

    progressFill.style.width = "100%";

    if (!learned.length) {
        const empty = document.createElement("p");
        empty.textContent = "No learned words yet.";
        learnedWordsList.appendChild(empty);
        return;
    }

    learned.forEach(state => {
        const entry = data[state.id];

        const row = document.createElement("div");
        row.className = "learned-row learned-row-jumpable";
        row.setAttribute("role", "button");
        row.setAttribute("tabindex", "0");
        row.setAttribute("aria-label", `Open ${entry.vocab} definition in learn tab`);
        row.addEventListener("click", () => openDefinitionFromLearnedWord(state.id));
        row.addEventListener("keydown", event => {
            if (event.key !== "Enter" && event.key !== " ") {
                return;
            }
            event.preventDefault();
            openDefinitionFromLearnedWord(state.id);
        });


        const info = document.createElement("div");
        info.className = "learned-info-inline";
        // Word row (word + speaker)
        const wordRow = document.createElement("span");
        wordRow.className = "learned-word-row-inline";
        const word = document.createElement("span");
        word.className = "learned-word";
        word.textContent = entry.vocab;
        wordRow.appendChild(word);

        const speakerSlot = document.createElement("span");
        speakerSlot.className = "learned-speaker-slot";

        if (hasPronunciationForSingleWord(entry)) {
            const speakerButton = createSpeakerButton("small", () => {
                pronAudio.src = entry.pron;
                playPronunciation();
            });
            speakerButton.classList.add("learned-row-speaker");
            speakerSlot.appendChild(speakerButton);
        }

        wordRow.appendChild(speakerSlot);
        info.appendChild(wordRow);
        // Meaning row (inline, smaller)
        const meaning = document.createElement("span");
        meaning.className = "learned-meaning-inline";
        meaning.textContent = `${entry.meaning_vi || "-"} (${formatPos(entry?.pos)})`;
        info.appendChild(meaning);

        const score = scoreOnFive(state);
        const scorePercent = Math.max(0, Math.min(100, (score / 5) * 100));

        const scorePie = document.createElement("div");
        scorePie.className = "score-pie";
        scorePie.setAttribute("aria-label", `Score ${Math.round(scorePercent)} percent`);
        scorePie.style.background = `conic-gradient(#2563eb ${scorePercent}%, #e5e7eb 0)`;

        row.appendChild(info);
        row.appendChild(scorePie);
        learnedWordsList.appendChild(row);
    });
}

function openDefinitionFromLearnedWord(wordId) {
    if (!Number.isInteger(wordId) || !wordStates[wordId] || !data[wordId]) {
        return;
    }

    startSession("learn");

    session = [{
        wordId,
        cardType: "definition"
    }];
    currentIndex = 0;

    if (sessionRuntime && sessionRuntime.mode === "learn") {
        sessionRuntime.shownDefinitionWordIds.add(wordId);
        sessionRuntime.cardsSinceDefinition = 0;
        sessionRuntime.nextDefinitionGap = randomPreferredDefinitionGap();
    }

    renderCurrentCard();
}

function renderCurrentCard() {
    resetCardUi();
    updateProgress();

    ensureCardAvailable(currentIndex);

    if (currentIndex >= SESSION_SIZE || currentIndex >= session.length) {
        showPromptOnly();
        promptText.textContent = "Great job! You've completed the session.";
        progressFill.style.width = "100%";
        return;
    }

    const card = session[currentIndex];
    const entry = data[card.wordId];

    if (card.cardType === "definition") {
        showDefinition(entry);
        feedbackText.textContent = "Press Enter or swipe to continue";
        feedbackText.className = "correct";
        return;
    }

    showPromptOnly();
    renderReviewCard(card, entry);

    if (!feedbackText.textContent && shouldShowLearningGateHint()) {
        feedbackText.textContent = "Master current words first to unlock new words.";
        feedbackText.className = "hint";
    }
}

function renderReviewCard(card, entry) {
    const distractors = pickDistractors(card.wordId, 3);
    const singleWord = isSingleWord(entry?.vocab);
    const canUseAudio = singleWord && Boolean(entry?.pron) && isOnline();

    if (card.cardType === REVIEW_TYPES.RT1) {
        promptText.innerHTML = `
            <span class="meaning-mcq-text">${escapeHtml(entry.meaning_vi || "")}</span>
            <span class="meaning-mcq-pos">(${escapeHtml(formatPos(entry?.pos))})</span>
        `;
        const options = shuffle([entry.vocab, ...distractors.map(x => x.vocab)]);
        renderChoiceButtons(card, entry, options, option => option === entry.vocab, `Answer: ${entry.vocab}`);
        return;
    }

    if (card.cardType === REVIEW_TYPES.RT2 && singleWord) {
        promptText.innerHTML = `
            <span class="typing-meaning">${escapeHtml(entry.meaning_vi || "")}</span>
            <span class="typing-pos">(${escapeHtml(formatPos(entry?.pos))})</span>
        `;
        typingInput.classList.remove("hidden");
        typingInput.value = "";
        typingInput.disabled = false;
        typingInput.readOnly = false;
        typingInput.classList.remove("state-correct", "state-wrong");
        typingInput.focus();
        const hintMask = buildTypingHintMask(entry?.vocab || "");
        feedbackText.textContent = hintMask ? `Hint: ${hintMask}` : "";
        feedbackText.className = "hint";
        return;
    }

    if (card.cardType === REVIEW_TYPES.RT3) {
        renderWordPromptWithSpeaker(entry, card);
        const options = shuffle([entry.meaning_vi, ...distractors.map(x => x.meaning_vi)]);
        renderChoiceButtons(card, entry, options, option => option === entry.meaning_vi, `Answer: ${entry.meaning_vi}`);
        return;
    }

    if (card.cardType === REVIEW_TYPES.RT4) {
        const sample = Array.isArray(entry.example) ? (entry.example[0] || "") : "";
        promptText.innerHTML = `${renderExampleWithFallback(sample, entry.vocab)}`;
        const options = shuffle([entry.meaning_vi, ...distractors.map(x => x.meaning_vi)]);
        renderChoiceButtons(card, entry, options, option => option === entry.meaning_vi, `Answer: ${entry.meaning_vi}`);
        return;
    }

    if (card.cardType === REVIEW_TYPES.RT5 && canUseAudio) {
        promptText.textContent = "";
        audioWrap.classList.remove("hidden");
        pronAudio.src = entry.pron;
        playPronunciation();
        const options = shuffle([entry.meaning_vi, ...distractors.map(x => x.meaning_vi)]);
        renderChoiceButtons(card, entry, options, option => option === entry.meaning_vi, `Answer: ${entry.meaning_vi}`);
        return;
    }

    if (card.cardType === REVIEW_TYPES.RT6) {
        const rendered = renderLexicalRelationQuiz(card, entry, "synonym");
        if (rendered) {
            return;
        }
    }

    if (card.cardType === REVIEW_TYPES.RT7) {
        const rendered = renderLexicalRelationQuiz(card, entry, "antonym");
        if (rendered) {
            return;
        }
    }

    renderWordPromptWithSpeaker(entry, card);
    const options = shuffle([entry.meaning_vi, ...distractors.map(x => x.meaning_vi)]);
    renderChoiceButtons(card, entry, options, option => option === entry.meaning_vi, `Answer: ${entry.meaning_vi}`);
}

function renderLexicalRelationQuiz(card, entry, relationType) {
    const relationWords = relationType === "synonym"
        ? normalizeWordItems(entry?.synonym)
        : normalizeWordItems(entry?.antonym);

    if (!relationWords.length) {
        return false;
    }

    const uniqueRelationWords = [...new Set(relationWords.map(item => item.trim()).filter(Boolean))];
    if (!uniqueRelationWords.length) {
        return false;
    }

    const correctOption = uniqueRelationWords[Math.floor(Math.random() * uniqueRelationWords.length)];
    const optionSet = new Set(uniqueRelationWords.map(word => word.toLowerCase()));
    optionSet.add((entry?.vocab || "").toLowerCase());

    const distractors = pickLexicalWordDistractors(optionSet, 3);
    const options = shuffle([correctOption, ...distractors]);

    renderWordPromptWithSpeaker(entry, card);

    feedbackText.textContent = relationType === "synonym"
        ? "Chọn từ đồng nghĩa"
        : "Chọn từ trái nghĩa";
    feedbackText.className = "hint";

    renderChoiceButtons(
        card,
        entry,
        options,
        option => option === correctOption,
        `Answer: ${correctOption}`
    );

    return true;
}

function pickLexicalWordDistractors(excludedLowerSet, count) {
    const pool = data
        .map(item => (typeof item?.vocab === "string" ? item.vocab.trim() : ""))
        .filter(Boolean)
        .filter(word => !excludedLowerSet.has(word.toLowerCase()));

    const shuffled = shuffle(pool);
    const picks = [];
    for (let i = 0; i < shuffled.length && picks.length < count; i += 1) {
        const candidate = shuffled[i];
        const key = candidate.toLowerCase();
        if (excludedLowerSet.has(key)) {
            continue;
        }
        excludedLowerSet.add(key);
        picks.push(candidate);
    }

    return picks;
}

function renderWordPromptWithSpeaker(entry, card) {
    promptText.textContent = "";
    promptText.appendChild(createWordWithPosBlock(entry, "prompt-word-stack", {
        showIpaInline: false,
        clickableWord: true,
        onWordClick: () => jumpToDefinitionCard(card?.wordId)
    }));
}

function jumpToDefinitionCard(wordId) {
    if (answered || !Number.isInteger(wordId)) {
        return;
    }

    const currentCard = session[currentIndex];
    if (!currentCard || currentCard.cardType === "definition") {
        return;
    }

    session[currentIndex] = {
        wordId,
        cardType: "definition"
    };

    renderCurrentCard();
}

function highlightWordInExample(exampleText, vocab) {
    const rawExample = typeof exampleText === "string" ? exampleText : "";
    const safeExample = escapeHtml(rawExample);

    if (!isSingleWord(vocab)) {
        return safeExample;
    }

    const escapedVocab = escapeRegExp(vocab.trim());
    if (!escapedVocab) {
        return safeExample;
    }

    const regex = new RegExp(`\\b(${escapedVocab})\\b`, "ig");
    return safeExample.replace(regex, '<mark>$1</mark>');
}

function renderExampleWithFallback(exampleText, vocab, shouldAppendFallback = true) {
    const rawExample = typeof exampleText === "string" ? exampleText : "";
    const safeExample = escapeHtml(rawExample);
    const cleanVocab = typeof vocab === "string" ? vocab.trim() : "";
    const safeVocab = escapeHtml(cleanVocab);

    if (!cleanVocab) {
        return safeExample;
    }

    if (isSingleWord(cleanVocab)) {
        const escapedVocab = escapeRegExp(cleanVocab);
        const regex = new RegExp(`\\b(${escapedVocab})\\b`, "i");
        if (!regex.test(rawExample)) {
            return shouldAppendFallback ? `${safeExample} (${safeVocab})` : safeExample;
        }
        return highlightWordInExample(rawExample, cleanVocab);
    }

    const escapedVocab = escapeRegExp(cleanVocab);
    const phraseRegex = new RegExp(`(${escapedVocab})`, "ig");
    if (!phraseRegex.test(rawExample)) {
        return shouldAppendFallback ? `${safeExample} (${safeVocab})` : safeExample;
    }

    return safeExample.replace(phraseRegex, '<mark>$1</mark>');
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(value) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function isSingleWord(value) {
    if (!value || typeof value !== "string") {
        return false;
    }

    return !/\s/.test(value.trim());
}

function isOnline() {
    return typeof navigator === "undefined" ? true : navigator.onLine;
}

function renderChoiceButtons(card, entry, options, isCorrectOption, answerLabel) {
    const optionButtons = [];

    options.forEach(option => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = option;
        const correctForThisOption = isCorrectOption(option, entry);
        optionButtons.push({ btn, isCorrect: correctForThisOption });

        btn.addEventListener("click", () => {
            if (answered) {
                return;
            }

            const isCorrect = correctForThisOption;
            paintOptionFeedback(optionButtons, btn, isCorrect);
            handleAnswered(card, isCorrect, answerLabel);
        });
        choicesWrap.appendChild(btn);
    });
}

function handleAnswered(card, isCorrect, correctText) {
    answered = true;

    const wordState = wordStates[card.wordId];
    processReview(wordState, card.cardType, isCorrect);

    if (sessionRuntime) {
        const prev = sessionRuntime.wrongStreakByWordId.get(card.wordId) || 0;
        sessionRuntime.wrongStreakByWordId.set(card.wordId, isCorrect ? 0 : prev + 1);

        const wrongStreak = sessionRuntime.wrongStreakByWordId.get(card.wordId) || 0;
        const score = scoreOnFive(wordState);
        const alreadyQueued = sessionRuntime.remedialDefinitionQueue.includes(card.wordId);
        const shouldForceDefinitionNow = wordState.learned && score <= 2.4;

        if (!isCorrect && !alreadyQueued && (shouldForceDefinitionNow || (wrongStreak >= 2 && score <= 2.2))) {
            sessionRuntime.remedialDefinitionQueue.push(card.wordId);
        }
    }

    saveState(wordStates);
    maybeGraduateLearningWord(card.wordId);
    playAnswerSound(isCorrect);

    if (isTypingQuizCard(card)) {
        typingInput.disabled = true;
        typingInput.readOnly = true;
        typingInput.classList.remove("state-correct", "state-wrong");
        typingInput.classList.add(isCorrect ? "state-correct" : "state-wrong");
    }

    feedbackText.textContent = isCorrect ? "Correct" : `${correctText}`;
    feedbackText.className = isCorrect ? "correct" : "wrong";
}

function scoreOnFive(wordState) {
    const total = wordState.correctCount + wordState.wrongCount;
    const accuracy = total > 0 ? wordState.correctCount / total : 0;
    const stabilityScore = Math.min(wordState.stability / 5, 1);
    const masteryScore = Math.min(
        Object.values(wordState.reviewTypeStats).reduce((sum, item) => sum + item.mastery, 0) /
        Math.max(1, Object.values(wordState.reviewTypeStats).length),
        1
    );

    const weighted = (accuracy * 0.5) + (stabilityScore * 0.3) + (masteryScore * 0.2);
    return Math.max(1, weighted * 5);
}

function resetProgress() {
    const ok = window.confirm("Delete all learned words?");
    if (!ok) {
        return;
    }

    clearState();
    if (clearLearnQueueState) {
        clearLearnQueueState();
    }
    wordStates = data.map((_, i) => createInitialWordState(i));
    saveState(wordStates);
    startSession("learn");
}

function pickDistractors(correctId, count) {
    const correctEntry = data[correctId];
    const targetPos = (correctEntry?.pos || "").trim().toLowerCase();
    const samePosIds = data
        .map((item, index) => ({ index, pos: (item?.pos || "").trim().toLowerCase() }))
        .filter(item => item.index !== correctId && item.pos === targetPos)
        .map(item => item.index);

    const learnedIds = samePosIds.filter(id => wordStates[id]?.learned);
    const unlearnedIds = samePosIds.filter(id => !wordStates[id]?.learned);

    const selectedIds = [];
    const includeLearnedSometimes = learnedIds.length > 0 && Math.random() < 0.4;

    if (includeLearnedSometimes) {
        const learnedPool = shuffle(learnedIds);
        selectedIds.push(learnedPool[0]);
    }

    const remainingPool = shuffle([...unlearnedIds, ...learnedIds.filter(id => !selectedIds.includes(id))]);
    for (let i = 0; i < remainingPool.length && selectedIds.length < count; i += 1) {
        selectedIds.push(remainingPool[i]);
    }

    const picks = [];
    for (let i = 0; i < selectedIds.length && picks.length < count; i += 1) {
        picks.push(data[selectedIds[i]]);
    }

    return picks;
}

function shuffle(arr) {
    const clone = [...arr];
    for (let i = clone.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [clone[i], clone[j]] = [clone[j], clone[i]];
    }
    return clone;
}

function paintOptionFeedback(optionButtons, selectedButton, isCorrect) {
    optionButtons.forEach(({ btn, isCorrect: optionIsCorrect }) => {
        btn.disabled = true;

        if (btn === selectedButton && isCorrect) {
            btn.classList.add("option-correct");
            return;
        }

        if (btn === selectedButton && !isCorrect) {
            btn.classList.add("option-wrong");
            return;
        }

        if (!isCorrect && optionIsCorrect) {
            btn.classList.add("option-correct");
        }
    });
}

function playAnswerSound(isCorrect) {
    const audio = isCorrect ? correctAudio : wrongAudio;
    audio.currentTime = 0;
    audio.play().catch(() => { });
}

function showDefinition(entry) {
    wordText.classList.remove("hidden");
    meaningText.classList.remove("hidden");
    promptText.classList.remove("hidden");

    wordText.textContent = "";
    wordText.appendChild(createWordWithPosBlock(entry, "definition-word-stack", { showIpaInline: true }));

    if (hasPronunciationForSingleWord(entry)) {
        pronAudio.src = entry.pron;
        playPronunciation();
    }

    meaningText.textContent = entry.meaning_vi || "";
    promptText.innerHTML = buildDefinitionMetaHtml(entry);
}

function showPromptOnly() {
    wordText.classList.add("hidden");
    meaningText.classList.add("hidden");
    promptText.classList.remove("hidden");
}

function updateProgress() {
    if (!SESSION_SIZE) {
        progressFill.style.width = "0%";
        return;
    }

    const completed = Math.min(currentIndex, SESSION_SIZE);
    const percent = (completed / SESSION_SIZE) * 100;
    progressFill.style.width = `${percent}%`;
}

function resetCardUi() {
    answered = false;
    choicesWrap.innerHTML = "";
    wordText.textContent = "";
    meaningText.textContent = "";
    showPromptOnly();
    typingInput.classList.add("hidden");
    typingInput.disabled = false;
    typingInput.readOnly = false;
    typingInput.classList.remove("state-correct", "state-wrong");
    audioWrap.classList.add("hidden");
    pronAudio.removeAttribute("src");
    pronAudio.load();
    feedbackText.textContent = "";
    feedbackText.className = "";
}

function buildDefinitionMetaHtml(entry) {
    const examples = Array.isArray(entry?.example)
        ? entry.example
            .map(item => (typeof item === "string" ? item.trim() : ""))
            .filter(Boolean)
        : [];
    const examplesHtml = examples.length
        ? examples.map(example => `<p class="definition-example-line">${renderExampleWithFallback(example, entry?.vocab || "", false)}</p>`).join("")
        : "<p class=\"definition-example-line\">-</p>";
    const synonyms = normalizeWordItems(entry?.synonym);
    const antonyms = normalizeWordItems(entry?.antonym);
    const synonymsHtml = synonyms.length
        ? synonyms.map(item => `<li>${escapeHtml(item)}</li>`).join("")
        : "<li>-</li>";
    const antonymsHtml = antonyms.length
        ? antonyms.map(item => `<li>${escapeHtml(item)}</li>`).join("")
        : "<li>-</li>";

    return [
        `<div class="definition-meta">`,
        `<div class="definition-example-box">${examplesHtml}</div>`,
        `<p class="definition-section-title">Synonym:</p>`,
        `<ul class="definition-word-list">${synonymsHtml}</ul>`,
        `<p class="definition-section-title">Antonym:</p>`,
        `<ul class="definition-word-list">${antonymsHtml}</ul>`,
        `</div>`
    ].join("");
}

function normalizeIpa(ipaRaw) {
    const ipa = typeof ipaRaw === "string" ? ipaRaw.trim() : "";
    if (!ipa) {
        return "-";
    }

    const stripped = ipa.replace(/^\/+|\/+$/g, "").trim();
    if (!stripped) {
        return "-";
    }

    return `/${stripped}/`;
}

function normalizeWordItems(values) {
    if (!Array.isArray(values)) {
        return [];
    }

    return values
        .map(item => (typeof item === "string" ? item.trim() : ""))
        .filter(item => item && item !== "-");
}

function createSpeakerButton(size, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `audio-replay-btn ${size}`;
    button.setAttribute("aria-label", "Replay audio");

    const icon = document.createElement("img");
    icon.src = SPEAKER_ICON_SRC;
    icon.alt = "Replay audio";
    button.appendChild(icon);

    button.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
    });

    return button;
}

function playPronunciation() {
    if (!pronAudio.src) {
        return;
    }

    pronAudio.currentTime = 0;
    pronAudio.play().catch(() => { });
}

function hasPronunciationForSingleWord(entry) {
    const pron = typeof entry?.pron === "string" ? entry.pron.trim() : "";
    return isSingleWord(entry?.vocab) && /\.mp3(\?|$)/i.test(pron);
}

function randomPreferredDefinitionGap() {
    const roll = Math.random();
    if (roll < 0.15) {
        return 1;
    }
    if (roll < 0.7) {
        return 2;
    }
    return 3;
}

function shouldIncludeLearnedWordInCurrentCard(wordState) {
    const now = Date.now();
    const nextReview = Number.isFinite(wordState?.nextReview) ? wordState.nextReview : 0;
    const dayMs = 24 * 60 * 60 * 1000;

    if (!nextReview || nextReview <= now) {
        return true;
    }

    const daysUntilReview = Math.max(0, (nextReview - now) / dayMs);
    const stability = Math.max(0.3, wordState?.stability || 1);
    const relativeDistance = daysUntilReview / stability;

    if (relativeDistance <= 0.25) {
        return Math.random() < 0.4;
    }

    if (relativeDistance <= 0.75) {
        return Math.random() < 0.22;
    }

    if (relativeDistance <= 1.5) {
        return Math.random() < 0.12;
    }

    return Math.random() < 0.05;
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

function pickCardTypeAvoidingAdjacentDuplicate(wordState) {
    const baseTypes = getEligibleReviewTypesForWord(wordState.id);

    const previous = session[session.length - 1];
    const blockedType = previous && previous.wordId === wordState.id && previous.cardType !== "definition"
        ? previous.cardType
        : null;

    const inActiveLearningQueue = Boolean(
        sessionRuntime
        && sessionRuntime.mode === "learn"
        && sessionRuntime.queuedLearningWordIds.includes(wordState.id)
    );

    if (inActiveLearningQueue) {
        const unseenRequiredTypes = baseTypes.filter(type => {
            const seenCount = wordState.reviewTypeStats?.[type]?.seen || 0;
            return seenCount < 1;
        });

        if (unseenRequiredTypes.length) {
            const unseenWithoutBlocked = blockedType && unseenRequiredTypes.length > 1
                ? unseenRequiredTypes.filter(type => type !== blockedType)
                : unseenRequiredTypes;

            const unseenPool = unseenWithoutBlocked.length ? unseenWithoutBlocked : unseenRequiredTypes;
            const unseenRandomIndex = Math.floor(Math.random() * unseenPool.length);
            return unseenPool[unseenRandomIndex];
        }
    }

    const candidates = blockedType && baseTypes.length > 1
        ? baseTypes.filter(type => type !== blockedType)
        : baseTypes;

    const randomIndex = Math.floor(Math.random() * candidates.length);
    return candidates[randomIndex];
}

function getEligibleReviewTypesForWord(wordId) {
    const entry = data[wordId];
    const eligibleTypes = [
        REVIEW_TYPES.RT1,
        REVIEW_TYPES.RT3,
        REVIEW_TYPES.RT4
    ];

    if (isSingleWord(entry?.vocab)) {
        eligibleTypes.push(REVIEW_TYPES.RT2);
    }

    if (isSingleWord(entry?.vocab) && typeof entry?.pron === "string" && entry.pron.trim().length > 0 && isOnline()) {
        eligibleTypes.push(REVIEW_TYPES.RT5);
    }

    if (normalizeWordItems(entry?.synonym).length > 0) {
        eligibleTypes.push(REVIEW_TYPES.RT6);
    }

    if (normalizeWordItems(entry?.antonym).length > 0) {
        eligibleTypes.push(REVIEW_TYPES.RT7);
    }

    return eligibleTypes;
}

function hasSeenAllRequiredReviewTypes(wordId, wordState) {
    const requiredTypes = getEligibleReviewTypesForWord(wordId);
    return requiredTypes.every(type => (wordState.reviewTypeStats?.[type]?.seen || 0) > 0);
}

function isWordReadyToGraduate(wordId, wordState) {
    return scoreOnFive(wordState) >= LEARNING_GRADUATION_SCORE
        && hasSeenAllRequiredReviewTypes(wordId, wordState);
}

function createWordWithPosBlock(entry, stackClassName, options = {}) {
    const stack = document.createElement("div");
    stack.className = stackClassName;

    const wordRow = document.createElement("span");
    wordRow.className = "word-with-audio";

    const wordLabel = document.createElement("span");
    wordLabel.className = "word-main-text";
    wordLabel.textContent = entry?.vocab || "";

    if (options.clickableWord) {
        wordLabel.classList.add("word-jumpable");
        wordLabel.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            options.onWordClick?.();
        });
    }

    wordRow.appendChild(wordLabel);

    if (hasPronunciationForSingleWord(entry)) {
        wordRow.appendChild(createSpeakerButton("small", () => {
            pronAudio.src = entry.pron;
            playPronunciation();
        }));
    }

    const posText = `(${formatPos(entry?.pos)})`;

    if (options.showIpaInline) {
        const posInline = document.createElement("span");
        posInline.className = "word-pos-inline";
        posInline.textContent = posText;
        wordRow.appendChild(posInline);

        const ipaBelow = document.createElement("span");
        ipaBelow.className = "word-ipa-below";
        ipaBelow.textContent = normalizeIpa(entry?.ipa);

        stack.appendChild(wordRow);
        stack.appendChild(ipaBelow);
        return stack;
    }

    const posLabel = document.createElement("span");
    posLabel.className = "word-pos";
    posLabel.textContent = posText;

    stack.appendChild(wordRow);
    stack.appendChild(posLabel);
    return stack;
}

function formatPos(rawPos) {
    if (typeof rawPos !== "string") {
        return "-";
    }

    const cleaned = rawPos.trim();
    return cleaned || "-";
}

function canIntroduceAnotherNewWord() {
    if (!sessionRuntime || sessionRuntime.mode !== "learn") {
        return false;
    }

    if (!sessionRuntime.queuedLearningWordIds.length) {
        return true;
    }

    return sessionRuntime.queuedLearningWordIds.every(wordId => {
        const state = wordStates[wordId];
        if (!state || state.learned) {
            return true;
        }

        return hasSeenAllRequiredReviewTypes(wordId, state)
            && scoreOnFive(state) >= LEARNING_GRADUATION_SCORE;
    });
}

function shouldShowLearningGateHint() {
    if (!sessionRuntime || sessionRuntime.mode !== "learn") {
        return false;
    }

    if (sessionRuntime.pendingDefinitionWordIds.length > 0) {
        return false;
    }

    if (sessionRuntime.nextWordCursor >= sessionRuntime.newWordOrderIds.length) {
        return false;
    }

    return !canIntroduceAnotherNewWord();
}