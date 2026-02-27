const ASSET_VERSION = window.__ASSET_VERSION__ || Date.now().toString();

let createInitialWordState;
let REVIEW_TYPES;
let processReview;
let initializeIntroducedWordState;
let recalculateWordMetrics;
let loadState;
let saveState;
let clearState;
let loadBootstrapState;
let saveBootstrapState;
let clearBootstrapState;

const SESSION_SIZE = 50;
const ACTIVE_POOL = 7;
const THRESHOLD_STABILITY = 173;
const BOOTSTRAP_SEQUENCE = [
    { mode: "definition", slot: 1 },
    { mode: "review", slot: 1 },
    { mode: "definition", slot: 2 },
    { mode: "review", slot: 2 },
    { mode: "review", slot: 1 },
    { mode: "definition", slot: 3 },
    { mode: "review", slot: 2 },
    { mode: "review", slot: 3 },
    { mode: "definition", slot: 4 },
    { mode: "review", slot: 1 },
    { mode: "review", slot: 4 },
    { mode: "review", slot: 2 },
    { mode: "review", slot: 3 },
    { mode: "definition", slot: 5 },
    { mode: "review", slot: 5 },
    { mode: "review", slot: 4 },
    { mode: "review", slot: 5 },
    { mode: "review", slot: 1 },
    { mode: "definition", slot: 6 },
    { mode: "review", slot: 6 },
    { mode: "review", slot: 2 },
    { mode: "review", slot: 3 },
    { mode: "review", slot: 5 },
    { mode: "review", slot: 6 },
    { mode: "review", slot: 4 },
    { mode: "review", slot: 6 },
    { mode: "definition", slot: 7 },
    { mode: "review", slot: 7 },
    { mode: "review", slot: 1 },
    { mode: "review", slot: 6 },
    { mode: "review", slot: 5 },
    { mode: "review", slot: 7 },
    { mode: "review", slot: 2 },
    { mode: "review", slot: 1 },
    { mode: "review", slot: 7 },
    { mode: "review", slot: 3 },
    { mode: "review", slot: 2 }
];

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
    const [wordStateModule, reviewEngineModule, storageModule] = await Promise.all([
        import(`./wordState.js?v=${ASSET_VERSION}`),
        import(`./reviewEngine.js?v=${ASSET_VERSION}`),
        import(`./storage.js?v=${ASSET_VERSION}`)
    ]);

    createInitialWordState = wordStateModule.createInitialWordState;
    REVIEW_TYPES = wordStateModule.REVIEW_TYPES;
    initializeIntroducedWordState = wordStateModule.initializeIntroducedWordState;
    recalculateWordMetrics = wordStateModule.recalculateWordMetrics;
    processReview = reviewEngineModule.processReview;
    loadState = storageModule.loadState;
    saveState = storageModule.saveState;
    clearState = storageModule.clearState;
    loadBootstrapState = storageModule.loadBootstrapState;
    saveBootstrapState = storageModule.saveBootstrapState;
    clearBootstrapState = storageModule.clearBootstrapState;
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
    const shaped = { ...base, ...state, RTcounter: { ...base.RTcounter } };

    Object.keys(base.RTcounter).forEach(type => {
        const legacyTypeStat = state?.reviewTypeStats?.[type];
        const legacySeen = Number(legacyTypeStat?.seen) || 0;
        const nextCount = Number(state?.RTcounter?.[type]);
        shaped.RTcounter[type] = Number.isFinite(nextCount)
            ? Math.max(0, nextCount)
            : Math.max(0, legacySeen);
    });

    if (!Array.isArray(shaped.recent_queue)) {
        shaped.recent_queue = [0, 0, 0, 0, 0];
    } else if (shaped.recent_queue.length !== 5) {
        const tail = shaped.recent_queue.map(v => (v ? 1 : 0)).slice(-5);
        while (tail.length < 5) {
            tail.unshift(0);
        }
        shaped.recent_queue = tail;
    }

    if (typeof state?.learned === "boolean") {
        if (state.learned) {
            shaped.total_card_seen = Math.max(1, Number(shaped.total_card_seen) || 1);
        } else {
            const hasRtHistory = Object.values(shaped.RTcounter || {}).some(count => (Number(count) || 0) > 0);
            const hasIncorrectHistory = (Number(shaped.total_incorrect) || 0) > 0;
            if (!hasRtHistory && !hasIncorrectHistory) {
                shaped.total_card_seen = 0;
            }
        }
    }

    if (!Number.isInteger(shaped.bootstrap_slot) || shaped.bootstrap_slot < 1) {
        shaped.bootstrap_slot = null;
    }

    recalculateWordMetrics(shaped);
    return shaped;
}

function isWordIntroduced(wordState) {
    return (Number(wordState?.total_card_seen) || 0) > 0;
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
            && !answered;

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

    const length = clean.length;
    if (length === 1) {
        return `${clean} (${length} letter)`;
    }

    const firstChar = clean[0];
    const lastChar = clean[length - 1];
    const middleSlots = Array(Math.max(0, length - 2)).fill("_").join(" ");
    const core = middleSlots
        ? `${firstChar} ${middleSlots} ${lastChar}`
        : `${firstChar} ${lastChar}`;

    return `${core} (${length} letters)`;
}

function submitTypingAnswerForCurrentCard() {
    const card = session[currentIndex];
    if (!isTypingQuizCard(card) || answered) {
        return false;
    }

    const entry = data[card.wordId];
    const userAnswer = typingInput.value.trim().toLowerCase();
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
    // const finishedCard = session[currentIndex];
    markDefinitionAsLearnedIfNeeded();
    applyPostCardCounterProgress();
    refreshGlobalSrsStats();
    // logSrsDebugAfterCard(finishedCard);
    saveState(wordStates);
    currentIndex += 1;
    renderCurrentCard();
}

function logSrsDebugAfterCard(card) {
    const introduced = wordStates
        .filter(state => isWordIntroduced(state))
        .map(state => ({
            id: state.id,
            word: data[state.id]?.vocab || `#${state.id}`,
            stability: Number((Number(state.stability) || 0).toFixed(4))
        }));

    console.log("[SRS DEBUG]", {
        cardIndex: currentIndex + 1,
        card: card
            ? {
                wordId: card.wordId,
                word: data[card.wordId]?.vocab || `#${card.wordId}`,
                cardType: card.cardType
            }
            : null,
        learnedWordStabilityList: introduced,
        systemStability: Number((sessionRuntime?.systemStability || 0).toFixed(6)),
        activeWord: sessionRuntime?.activeWordCount || 0,
        bootstrapStep: sessionRuntime?.bootstrapStep ?? BOOTSTRAP_SEQUENCE.length,
        bootstrapActive: isBootstrapActive()
    });
}

function markDefinitionAsLearnedIfNeeded() {
    const card = session[currentIndex];
    if (!card || card.cardType !== "definition") {
        return;
    }

    const wordState = wordStates[card.wordId];
    if (!wordState) {
        return;
    }

    if (!isWordIntroduced(wordState)) {
        const initialized = initializeIntroducedWordState(wordState);
        wordStates[card.wordId] = initialized;
    }
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
    const runtime = {
        mode: nextMode,
        targetSize: SESSION_SIZE,
        forceDefinitionWordId: null,
        activeWordCount: 0,
        systemStability: 0,
        lastReviewWordId: null,
        lastReviewType: null,
        secondLastReviewWordId: null,
        bootstrapStep: BOOTSTRAP_SEQUENCE.length
    };

    if (nextMode === "learn") {
        const introducedCount = wordStates.filter(state => isWordIntroduced(state)).length;
        const savedBootstrap = loadBootstrapState ? loadBootstrapState() : null;
        const rawStep = Number(savedBootstrap?.step);
        const hasSavedStep = Number.isInteger(rawStep);

        if (hasSavedStep) {
            runtime.bootstrapStep = Math.max(0, Math.min(rawStep, BOOTSTRAP_SEQUENCE.length));
        } else if (introducedCount === 0) {
            runtime.bootstrapStep = 0;
            persistBootstrapStep(runtime.bootstrapStep);
        }

        if (introducedCount === 0 && runtime.bootstrapStep >= BOOTSTRAP_SEQUENCE.length) {
            runtime.forceDefinitionWordId = pickRandomUnintroducedWordId();
        }
    }

    updateRuntimeSrsStats(runtime);
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

    if (sessionRuntime.forceDefinitionWordId != null) {
        const forcedWordId = sessionRuntime.forceDefinitionWordId;
        sessionRuntime.forceDefinitionWordId = null;
        return {
            wordId: forcedWordId,
            cardType: "definition"
        };
    }

    if (isBootstrapActive()) {
        const bootstrapCard = generateNextBootstrapCard();
        if (bootstrapCard) {
            return bootstrapCard;
        }
    }

    if (mode === "learn" && shouldIntroduceNewWord()) {
        const newWordId = pickRandomUnintroducedWordId();
        if (newWordId != null) {
            return {
                wordId: newWordId,
                cardType: "definition"
            };
        }
    }

    const reviewWordId = pickNextReviewWordId();
    if (reviewWordId == null) {
        return null;
    }

    return {
        wordId: reviewWordId,
        cardType: pickReviewTypeForWord(reviewWordId)
    };
}

function shouldIntroduceNewWord() {
    if (!sessionRuntime || sessionRuntime.mode !== "learn") {
        return false;
    }

    const hasUnintroduced = wordStates.some(state => !isWordIntroduced(state));
    if (!hasUnintroduced) {
        return false;
    }

    return sessionRuntime.activeWordCount < ACTIVE_POOL
        && sessionRuntime.systemStability > THRESHOLD_STABILITY;
}

function isBootstrapActive() {
    return Boolean(
        sessionRuntime
        && sessionRuntime.mode === "learn"
        && sessionRuntime.bootstrapStep < BOOTSTRAP_SEQUENCE.length
    );
}

function persistBootstrapStep(step) {
    if (!saveBootstrapState) {
        return;
    }

    saveBootstrapState({ step: Math.max(0, Math.min(step, BOOTSTRAP_SEQUENCE.length)) });
}

function getBootstrapWordIdBySlot(slot) {
    const match = wordStates.find(state => Number(state.bootstrap_slot) === slot && isWordIntroduced(state));
    return match ? match.id : null;
}

function generateNextBootstrapCard() {
    if (!sessionRuntime) {
        return null;
    }

    const step = sessionRuntime.bootstrapStep;
    const script = BOOTSTRAP_SEQUENCE[step];
    if (!script) {
        return null;
    }

    let wordId = getBootstrapWordIdBySlot(script.slot);

    if (script.mode === "definition") {
        if (wordId == null) {
            wordId = pickRandomUnintroducedWordId();
        }
        if (wordId == null) {
            return null;
        }

        const wordState = wordStates[wordId];
        if (wordState) {
            wordState.bootstrap_slot = script.slot;
        }

        sessionRuntime.bootstrapStep += 1;
        persistBootstrapStep(sessionRuntime.bootstrapStep);

        return {
            wordId,
            cardType: "definition"
        };
    }

    if (wordId == null) {
        wordId = pickNextReviewWordId();
    }
    if (wordId == null) {
        return null;
    }

    sessionRuntime.bootstrapStep += 1;
    persistBootstrapStep(sessionRuntime.bootstrapStep);

    return {
        wordId,
        cardType: pickReviewTypeForWord(wordId)
    };
}

function pickRandomUnintroducedWordId() {
    const candidates = wordStates
        .map((state, index) => ({ state, index }))
        .filter(item => item.state && !isWordIntroduced(item.state))
        .map(item => item.index);

    if (!candidates.length) {
        return null;
    }

    const randomIndex = Math.floor(Math.random() * candidates.length);
    return candidates[randomIndex];
}

function pickNextReviewWordId() {
    const candidates = wordStates.filter(state => isWordIntroduced(state));
    if (!candidates.length) {
        return null;
    }

    let minUrgency = Number.POSITIVE_INFINITY;
    for (let i = 0; i < candidates.length; i += 1) {
        minUrgency = Math.min(minUrgency, Number(candidates[i].urgency));
    }

    const tied = candidates.filter(state => Number(state.urgency) === minUrgency);
    if (!tied.length) {
        return candidates[0].id;
    }

    let pool = tied;

    if (sessionRuntime?.secondLastReviewWordId != null
        && sessionRuntime.secondLastReviewWordId === sessionRuntime.lastReviewWordId) {
        const notTriple = pool.filter(state => state.id !== sessionRuntime.lastReviewWordId);
        if (notTriple.length) {
            pool = notTriple;
        }
    }

    if (pool.length > 1 && sessionRuntime?.lastReviewWordId != null) {
        const excludingPrev = pool.filter(state => state.id !== sessionRuntime.lastReviewWordId);
        if (excludingPrev.length) {
            pool = excludingPrev;
        }
    }

    return pool[Math.floor(Math.random() * pool.length)].id;
}

function pickReviewTypeForWord(wordId) {
    const wordState = wordStates[wordId];
    const eligibleTypes = getEligibleReviewTypesForWord(wordId);

    if (!wordState || !eligibleTypes.length) {
        return REVIEW_TYPES.RT3;
    }

    const unseenTypes = eligibleTypes.filter(type => (wordState.RTcounter?.[type] || 0) === 0);
    let candidateTypes = unseenTypes.length
        ? [...unseenTypes]
        : (() => {
            const minCount = Math.min(...eligibleTypes.map(type => wordState.RTcounter?.[type] || 0));
            return eligibleTypes.filter(type => (wordState.RTcounter?.[type] || 0) === minCount);
        })();

    if (sessionRuntime?.lastReviewWordId === wordId && sessionRuntime?.lastReviewType) {
        const filtered = candidateTypes.filter(type => type !== sessionRuntime.lastReviewType);
        if (filtered.length) {
            candidateTypes = filtered;
        }
    }

    return candidateTypes[Math.floor(Math.random() * candidateTypes.length)];
}

function applyPostCardCounterProgress() {
    const card = session[currentIndex];
    if (!card) {
        return;
    }

    const excludedWordId = card.cardType === "definition" ? null : card.wordId;

    wordStates.forEach(state => {
        if (!isWordIntroduced(state) || state.id === excludedWordId) {
            return;
        }

        state.counter = Math.max(0, Number(state.counter) || 0) + 1;
        recalculateWordMetrics(state);
    });
}

function refreshGlobalSrsStats() {
    updateRuntimeSrsStats(sessionRuntime);
}

function updateRuntimeSrsStats(targetRuntime) {
    const introduced = wordStates.filter(state => isWordIntroduced(state));
    if (!introduced.length) {
        if (targetRuntime) {
            targetRuntime.activeWordCount = 0;
            targetRuntime.systemStability = 0;
        }
        return;
    }

    const activeWordCount = introduced.filter(state => Number(state.stability) < THRESHOLD_STABILITY).length;
    const sumStability = introduced.reduce((sum, state) => sum + (Number(state.stability) || 6), 0);
    const systemStability = sumStability / introduced.length;

    if (targetRuntime) {
        targetRuntime.activeWordCount = activeWordCount;
        targetRuntime.systemStability = systemStability;
    }
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
        .filter(state => isWordIntroduced(state) && data[state.id])
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

        const scorePercent = Math.max(1, Math.min(100, Number(state.mastery_score) || 1));

        const scorePie = document.createElement("div");
        scorePie.className = "score-pie";
        scorePie.setAttribute("aria-label", `Mastery ${Math.round(scorePercent)} percent`);
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
        sessionRuntime.forceDefinitionWordId = null;
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
}

function renderReviewCard(card, entry) {
    const singleWord = isSingleWord(entry?.vocab);
    const canUseAudio = singleWord && Boolean(entry?.pron) && isOnline();

    if (card.cardType === REVIEW_TYPES.RT1) {
        const correctVocab = (entry.vocab || "").trim();
        promptText.innerHTML = `
            <span class="meaning-mcq-text">${escapeHtml(entry.meaning_vi || "")}</span>
            <span class="meaning-mcq-pos">(${escapeHtml(formatPos(entry?.pos))})</span>
        `;
        const options = buildUniqueMcqOptions(card.wordId, "vocab", 4);
        renderChoiceButtons(card, entry, options, option => option === correctVocab, `Answer: ${correctVocab}`);
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
        const correctMeaning = (entry.meaning_vi || "").trim();
        renderWordPromptWithSpeaker(entry, card);
        const options = buildUniqueMcqOptions(card.wordId, "meaning", 4);
        renderChoiceButtons(card, entry, options, option => option === correctMeaning, `Answer: ${correctMeaning}`);
        return;
    }

    if (card.cardType === REVIEW_TYPES.RT4) {
        const correctMeaning = (entry.meaning_vi || "").trim();
        const sample = Array.isArray(entry.example) ? (entry.example[0] || "") : "";
        promptText.innerHTML = `${renderExampleWithFallback(sample, entry.vocab)}`;
        const options = buildUniqueMcqOptions(card.wordId, "meaning", 4);
        renderChoiceButtons(card, entry, options, option => option === correctMeaning, `Answer: ${correctMeaning}`);
        return;
    }

    if (card.cardType === REVIEW_TYPES.RT5 && canUseAudio) {
        const correctMeaning = (entry.meaning_vi || "").trim();
        promptText.textContent = "";
        audioWrap.classList.remove("hidden");
        pronAudio.src = entry.pron;
        playPronunciation();
        const options = buildUniqueMcqOptions(card.wordId, "meaning", 4);
        renderChoiceButtons(card, entry, options, option => option === correctMeaning, `Answer: ${correctMeaning}`);
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

    const correctMeaning = (entry.meaning_vi || "").trim();
    renderWordPromptWithSpeaker(entry, card);
    const options = buildUniqueMcqOptions(card.wordId, "meaning", 4);
    renderChoiceButtons(card, entry, options, option => option === correctMeaning, `Answer: ${correctMeaning}`);
}

function buildUniqueMcqOptions(correctId, field, desiredCount = 4) {
    const entry = data[correctId] || {};
    const correctValue = field === "vocab"
        ? (entry.vocab || "").trim()
        : (entry.meaning_vi || "").trim();

    const distractors = pickDistractors(correctId, Math.max(0, desiredCount - 1));
    const primary = distractors.map(item => {
        return field === "vocab"
            ? (item?.vocab || "").trim()
            : (item?.meaning_vi || "").trim();
    });

    const options = [];
    const seen = new Set();
    const pushUnique = value => {
        if (!value) {
            return;
        }
        const key = value.toLowerCase();
        if (seen.has(key)) {
            return;
        }
        seen.add(key);
        options.push(value);
    };

    pushUnique(correctValue);
    primary.forEach(pushUnique);

    if (options.length < desiredCount) {
        const targetPos = (entry?.pos || "").trim().toLowerCase();
        const samePosPool = shuffle(
            data
                .map((item, index) => ({ item, index }))
                .filter(pair => pair.index !== correctId)
                .filter(pair => ((pair.item?.pos || "").trim().toLowerCase() === targetPos))
                .map(pair => field === "vocab"
                    ? (pair.item?.vocab || "").trim()
                    : (pair.item?.meaning_vi || "").trim())
                .filter(Boolean)
        );

        for (let i = 0; i < samePosPool.length && options.length < desiredCount; i += 1) {
            pushUnique(samePosPool[i]);
        }
    }

    if (options.length < desiredCount) {
        const fallbackPool = shuffle(
            data
                .map(item => field === "vocab"
                    ? (item?.vocab || "").trim()
                    : (item?.meaning_vi || "").trim())
                .filter(Boolean)
        );

        for (let i = 0; i < fallbackPool.length && options.length < desiredCount; i += 1) {
            pushUnique(fallbackPool[i]);
        }
    }

    return shuffle(options.slice(0, desiredCount));
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
    const reviewResult = processReview(wordState, card.cardType, isCorrect);

    if (sessionRuntime) {
        sessionRuntime.secondLastReviewWordId = sessionRuntime.lastReviewWordId;
        sessionRuntime.lastReviewWordId = card.wordId;
        sessionRuntime.lastReviewType = card.cardType;

        if (reviewResult.shouldShowDefinitionImmediately) {
            sessionRuntime.forceDefinitionWordId = card.wordId;
        }
    }

    refreshGlobalSrsStats();
    saveState(wordStates);
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
    const mastery = Number(wordState?.mastery_score);
    const safeMastery = Number.isFinite(mastery) ? mastery : 1;
    return Math.max(1, Math.min(5, safeMastery / 20));
}

function resetProgress() {
    const ok = window.confirm("Delete all learned words?");
    if (!ok) {
        return;
    }

    clearState();
    if (clearBootstrapState) {
        clearBootstrapState();
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

    const learnedIds = samePosIds.filter(id => isWordIntroduced(wordStates[id]));
    const unlearnedIds = samePosIds.filter(id => !isWordIntroduced(wordStates[id]));

    const selectedIds = [];
    const includeLearnedSometimes = learnedIds.length > 0 && Math.random() < 0.4;

    if (includeLearnedSometimes) {
        selectedIds.push(shuffle(learnedIds)[0]);
    }

    const prioritizedPool = shuffle([
        ...unlearnedIds,
        ...learnedIds.filter(id => !selectedIds.includes(id))
    ]);

    for (let i = 0; i < prioritizedPool.length && selectedIds.length < count; i += 1) {
        selectedIds.push(prioritizedPool[i]);
    }

    if (selectedIds.length < count) {
        const fallbackIds = shuffle(
            (samePosIds.length
                ? samePosIds
                : data
                    .map((_, index) => index)
                    .filter(index => index !== correctId))
                .filter(id => !selectedIds.includes(id))
        );

        for (let i = 0; i < fallbackIds.length && selectedIds.length < count; i += 1) {
            selectedIds.push(fallbackIds[i]);
        }
    }

    return selectedIds
        .slice(0, count)
        .map(id => data[id])
        .filter(Boolean);
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
    const randomExample = examples.length
        ? examples[Math.floor(Math.random() * examples.length)]
        : "";
    const examplesHtml = randomExample
        ? `<p class="definition-example-line">${renderExampleWithFallback(randomExample, entry?.vocab || "", false)}</p>`
        : "<p class=\"definition-example-line\">-</p>";
    const synonyms = normalizeWordItems(entry?.synonym);
    const antonyms = normalizeWordItems(entry?.antonym);
    const synonymsHtml = synonyms.length
        ? [
            `<p class="definition-section-title">Synonym:</p>`,
            `<ul class="definition-word-list">${synonyms.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
        ].join("")
        : "";
    const antonymsHtml = antonyms.length
        ? [
            `<p class="definition-section-title">Antonym:</p>`,
            `<ul class="definition-word-list">${antonyms.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
        ].join("")
        : "";

    return [
        `<div class="definition-meta">`,
        `<div class="definition-example-box">${examplesHtml}</div>`,
        synonymsHtml,
        antonymsHtml,
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

        const ipaText = normalizeIpa(entry?.ipa);
        const ipaBelow = document.createElement("span");
        ipaBelow.className = "word-ipa-below";
        ipaBelow.textContent = ipaText;

        stack.appendChild(wordRow);
        stack.appendChild(ipaBelow);

        requestAnimationFrame(() => {
            if (wordRow.scrollWidth > wordRow.clientWidth && posInline.isConnected) {
                posInline.remove();
                const posBelow = document.createElement("span");
                posBelow.className = "word-pos";
                posBelow.textContent = posText;
                stack.insertBefore(posBelow, ipaBelow);
            }
        });

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