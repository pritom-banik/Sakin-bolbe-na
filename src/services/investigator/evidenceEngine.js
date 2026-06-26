const EVIDENCE_VERDICTS = {
    CONSISTENT: "consistent",
    INCONSISTENT: "inconsistent",
    INSUFFICIENT_DATA: "insufficient_data"
};

const MATCH_CONFIDENCE_FLOOR = 0.45;
const DUPLICATE_WINDOW_SECONDS = 300;
const ESTABLISHED_RECIPIENT_THRESHOLD = 2;

const normalize = (value = "") => {
    return value
        .toString()
        .trim()
        .toLowerCase();
};

const isPresent = (value) => {
    return value !== null &&
        value !== undefined &&
        value !== "";
};

const toNumber = (value) => {
    const number = Number(value);

    return Number.isNaN(number)
        ? null
        : number;
};

const normalizeTransactionList = (transactionHistory = []) => {
    return Array.isArray(transactionHistory)
        ? transactionHistory
        : [];
};

const resolveMatchContext = (
    transactionOrMatchResult,
    fallbackHistory = []
) => {
    const defaultContext = {
        relevantTransaction: null,
        relevantTransactionId: null,
        matchConfidence: 0,
        matchReasons: [],
        transactionHistory: normalizeTransactionList(
            fallbackHistory
        )
    };

    if (!transactionOrMatchResult) {
        return defaultContext;
    }

    if (
        typeof transactionOrMatchResult === "object" &&
        "relevantTransaction" in transactionOrMatchResult
    ) {
        return {
            relevantTransaction:
                transactionOrMatchResult.relevantTransaction ?? null,
            relevantTransactionId:
                transactionOrMatchResult.relevantTransactionId ??
                transactionOrMatchResult.relevantTransaction?.transaction_id ??
                null,
            matchConfidence:
                transactionOrMatchResult.confidence ?? 0,
            matchReasons:
                transactionOrMatchResult.reasons ?? [],
            transactionHistory: normalizeTransactionList(
                fallbackHistory
            )
        };
    }

    return {
        relevantTransaction: transactionOrMatchResult,
        relevantTransactionId:
            transactionOrMatchResult?.transaction_id ?? null,
        matchConfidence: 0,
        matchReasons: [],
        transactionHistory: normalizeTransactionList(
            fallbackHistory
        )
    };
};

const isAmountMatched = (
    parsedComplaint,
    transaction
) => {
    if (
        !transaction ||
        !isPresent(parsedComplaint?.primaryAmount)
    ) {
        return false;
    }

    return toNumber(parsedComplaint.primaryAmount) ===
        toNumber(transaction.amount);
};

const isTransactionTypeMatched = (
    parsedComplaint,
    transaction
) => {
    if (
        !transaction ||
        normalize(parsedComplaint?.transactionType) === "unknown"
    ) {
        return false;
    }

    return normalize(parsedComplaint.transactionType) ===
        normalize(transaction.type);
};

const isCounterpartyMatched = (
    parsedComplaint,
    transaction
) => {
    if (!transaction) {
        return false;
    }

    const counterparty = normalize(
        transaction.counterparty ?? ""
    );

    return [
        parsedComplaint?.primaryPhoneNumber,
        parsedComplaint?.primaryMerchantId,
        parsedComplaint?.primaryAgentId
    ]
        .filter(isPresent)
        .some(value =>
            counterparty.includes(
                normalize(value)
            )
        );
};

const getComplaintHour = (time) => {
    if (!time) {
        return null;
    }

    const normalizedTime = normalize(time);
    const match = normalizedTime.match(/\d{1,2}/);

    if (!match) {
        return null;
    }

    let hour = Number(match[0]);

    if (
        normalizedTime.includes("pm") &&
        hour !== 12
    ) {
        hour += 12;
    }

    if (
        normalizedTime.includes("am") &&
        hour === 12
    ) {
        hour = 0;
    }

    return hour;
};

const getTransactionTime = (timestamp) => {
    if (!timestamp) {
        return null;
    }

    const date = new Date(timestamp);

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return date.getTime();
};

const isTimeMatched = (
    parsedComplaint,
    transaction
) => {
    if (
        !transaction ||
        !parsedComplaint?.time
    ) {
        return false;
    }

    const complaintHour =
        getComplaintHour(parsedComplaint.time);
    const transactionTime =
        getTransactionTime(transaction.timestamp);

    if (
        complaintHour === null ||
        transactionTime === null
    ) {
        return false;
    }

    const transactionHour =
        new Date(transactionTime).getHours();

    return Math.abs(
        complaintHour - transactionHour
    ) <= 2;
};

const hasExplicitCounterparty = (
    parsedComplaint
) => {
    return Boolean(
        parsedComplaint?.primaryPhoneNumber ||
        parsedComplaint?.primaryMerchantId ||
        parsedComplaint?.primaryAgentId
    );
};

const getComplaintText = (
    parsedComplaint
) => {
    return normalize(
        parsedComplaint?.normalizedComplaint ||
        parsedComplaint?.originalComplaint ||
        ""
    );
};

const complaintIncludesAny = (
    parsedComplaint,
    keywords = []
) => {
    const complaintText =
        getComplaintText(parsedComplaint);

    return keywords.some(keyword =>
        complaintText.includes(
            normalize(keyword)
        )
    );
};

const resolveCaseHint = (
    parsedComplaint,
    relevantTransaction,
    transactionHistory
) => {
    const parsedCaseHint = normalize(
        parsedComplaint?.caseHint ?? "other"
    );

    if (
        parsedComplaint?.flags?.hasRisk ||
        complaintIncludesAny(parsedComplaint, [
            "otp",
            "pin",
            "password",
            "scam",
            "fraud",
            "fake call"
        ])
    ) {
        return "phishing_or_social_engineering";
    }

    const duplicateEvidence =
        hasNearDuplicatePayment(
            relevantTransaction,
            transactionHistory
        );

    if (
        duplicateEvidence ||
        complaintIncludesAny(parsedComplaint, [
            "twice",
            "double payment",
            "duplicate",
            "charged twice"
        ])
    ) {
        return "duplicate_payment";
    }

    if (
        parsedCaseHint !== "other" &&
        parsedCaseHint !== "payment_failed"
    ) {
        return parsedCaseHint;
    }

    if (
        parsedCaseHint === "payment_failed" &&
        !duplicateEvidence
    ) {
        return parsedCaseHint;
    }

    if (
        complaintIncludesAny(parsedComplaint, [
            "wrong transfer",
            "wrong number",
            "wrong person",
            "by mistake",
            "didn't get it",
            "did not get it"
        ]) &&
        normalize(
            parsedComplaint?.transactionType
        ) === "transfer"
    ) {
        return "wrong_transfer";
    }

    if (
        normalize(parsedComplaint?.transactionType) ===
        "cash_in" &&
        (
            parsedComplaint?.flags?.hasAgent ||
            normalize(
                relevantTransaction?.counterparty
            ).includes("agent")
        )
    ) {
        return "agent_cash_in_issue";
    }

    if (
        normalize(relevantTransaction?.type) ===
        "settlement" ||
        (
            normalize(parsedComplaint?.userType) ===
            "merchant" &&
            complaintIncludesAny(parsedComplaint, [
                "settlement",
                "sales",
                "settled"
            ])
        )
    ) {
        return "merchant_settlement_delay";
    }

    return parsedCaseHint;
};

const getRuleSnapshot = (
    parsedComplaint,
    transaction
) => {
    const status = normalize(
        transaction?.status ?? ""
    );

    return {
        transactionExists: Boolean(transaction),
        amountMatched: isAmountMatched(
            parsedComplaint,
            transaction
        ),
        transactionTypeMatched:
            isTransactionTypeMatched(
                parsedComplaint,
                transaction
            ),
        counterpartyMatched:
            isCounterpartyMatched(
                parsedComplaint,
                transaction
            ),
        timeMatched: isTimeMatched(
            parsedComplaint,
            transaction
        ),
        status,
        completedStatus:
            status === "completed",
        failedStatus:
            status === "failed",
        pendingStatus:
            status === "pending",
        reversedStatus:
            status === "reversed"
    };
};

const calculatePlausibilityScore = (
    parsedComplaint,
    transaction
) => {
    let score = 0;

    if (
        isPresent(parsedComplaint?.primaryAmount) &&
        isAmountMatched(parsedComplaint, transaction)
    ) {
        score += 3;
    }

    if (
        normalize(parsedComplaint?.transactionType) !== "unknown" &&
        isTransactionTypeMatched(parsedComplaint, transaction)
    ) {
        score += 2;
    }

    if (
        hasExplicitCounterparty(parsedComplaint) &&
        isCounterpartyMatched(parsedComplaint, transaction)
    ) {
        score += 2;
    }

    if (
        parsedComplaint?.time &&
        isTimeMatched(parsedComplaint, transaction)
    ) {
        score += 1;
    }

    return score;
};

const findPlausibleTransactions = (
    parsedComplaint,
    transactionHistory
) => {
    return transactionHistory
        .map(transaction => ({
            transaction,
            score: calculatePlausibilityScore(
                parsedComplaint,
                transaction
            )
        }))
        .filter(({ score, transaction }) => {
            const amountMatch =
                isAmountMatched(
                    parsedComplaint,
                    transaction
                );

            const typeMatch =
                isTransactionTypeMatched(
                    parsedComplaint,
                    transaction
                );

            return score >= 3 ||
                (amountMatch && typeMatch);
        })
        .sort((left, right) =>
            right.score - left.score
        );
};

const hasAmbiguousMatch = (
    parsedComplaint,
    transactionHistory,
    relevantTransaction
) => {
    if (!transactionHistory.length) {
        return false;
    }

    const plausibleTransactions =
        findPlausibleTransactions(
            parsedComplaint,
            transactionHistory
        );

    if (plausibleTransactions.length < 2) {
        return false;
    }

    if (!relevantTransaction) {
        return true;
    }

    const bestScore =
        plausibleTransactions[0].score;

    const competingTransactions =
        plausibleTransactions.filter(
            ({ score, transaction }) =>
                score === bestScore &&
                transaction.transaction_id !==
                relevantTransaction.transaction_id
        );

    if (competingTransactions.length === 0) {
        return false;
    }

    return !hasExplicitCounterparty(
        parsedComplaint
    );
};

const hasEstablishedRecipientPattern = (
    relevantTransaction,
    transactionHistory
) => {
    if (
        !relevantTransaction ||
        normalize(relevantTransaction.type) !==
        "transfer"
    ) {
        return false;
    }

    const counterparty = normalize(
        relevantTransaction.counterparty ?? ""
    );

    if (!counterparty) {
        return false;
    }

    const priorSimilarTransfers =
        transactionHistory.filter(transaction => {
            return transaction.transaction_id !==
                relevantTransaction.transaction_id &&
                normalize(transaction.type) === "transfer" &&
                normalize(transaction.counterparty) === counterparty;
        });

    return priorSimilarTransfers.length >=
        ESTABLISHED_RECIPIENT_THRESHOLD;
};

const hasNearDuplicatePayment = (
    relevantTransaction,
    transactionHistory
) => {
    if (!relevantTransaction) {
        return false;
    }

    const relevantTime =
        getTransactionTime(
            relevantTransaction.timestamp
        );

    if (relevantTime === null) {
        return false;
    }

    return transactionHistory.some(transaction => {
        if (
            transaction.transaction_id ===
            relevantTransaction.transaction_id
        ) {
            return false;
        }

        const candidateTime =
            getTransactionTime(
                transaction.timestamp
            );

        if (candidateTime === null) {
            return false;
        }

        return normalize(transaction.type) ===
            normalize(relevantTransaction.type) &&
            normalize(transaction.counterparty) ===
            normalize(
                relevantTransaction.counterparty
            ) &&
            toNumber(transaction.amount) ===
            toNumber(
                relevantTransaction.amount
            ) &&
            Math.abs(
                relevantTime - candidateTime
            ) <= DUPLICATE_WINDOW_SECONDS * 1000;
    });
};

const buildEvidenceReasons = ({
    verdict,
    parsedComplaint,
    rules,
    matchConfidence,
    ambiguousMatch,
    establishedRecipientPattern,
    duplicateEvidence
}) => {
    const reasons = [];

    if (!rules.transactionExists) {
        reasons.push("transaction_not_found");
    } else {
        reasons.push("transaction_found");
    }

    if (rules.amountMatched) {
        reasons.push("amount_matched");
    }

    if (rules.transactionTypeMatched) {
        reasons.push("transaction_type_matched");
    }

    if (rules.counterpartyMatched) {
        reasons.push("counterparty_matched");
    }

    if (rules.timeMatched) {
        reasons.push("time_matched");
    }

    if (rules.failedStatus) {
        reasons.push("failed_transaction");
    }

    if (rules.pendingStatus) {
        reasons.push("pending_transaction");
    }

    if (rules.completedStatus) {
        reasons.push("completed_transaction");
    }

    if (ambiguousMatch) {
        reasons.push("ambiguous_match");
    }

    if (establishedRecipientPattern) {
        reasons.push(
            "established_recipient_pattern"
        );
    }

    if (duplicateEvidence) {
        reasons.push("duplicate_pattern_detected");
    }

    if (
        matchConfidence > 0 &&
        matchConfidence < MATCH_CONFIDENCE_FLOOR
    ) {
        reasons.push("low_match_confidence");
    }

    if (
        normalize(parsedComplaint?.caseHint) ===
        "phishing_or_social_engineering"
    ) {
        reasons.push("safety_case");
    }

    if (
        verdict === EVIDENCE_VERDICTS.INSUFFICIENT_DATA &&
        !ambiguousMatch &&
        !rules.transactionExists
    ) {
        reasons.push("insufficient_history");
    }

    return reasons;
};

const calculateEvidenceConfidence = ({
    verdict,
    rules,
    matchConfidence,
    ambiguousMatch,
    establishedRecipientPattern,
    duplicateEvidence
}) => {
    let confidence = matchConfidence || 0.5;

    if (verdict === EVIDENCE_VERDICTS.CONSISTENT) {
        confidence += 0.2;
    }

    if (verdict === EVIDENCE_VERDICTS.INCONSISTENT) {
        confidence += 0.1;
    }

    if (rules.amountMatched) {
        confidence += 0.08;
    }

    if (rules.transactionTypeMatched) {
        confidence += 0.08;
    }

    if (rules.counterpartyMatched) {
        confidence += 0.07;
    }

    if (rules.timeMatched) {
        confidence += 0.05;
    }

    if (duplicateEvidence) {
        confidence += 0.08;
    }

    if (establishedRecipientPattern) {
        confidence += 0.06;
    }

    if (ambiguousMatch) {
        confidence -= 0.18;
    }

    if (!rules.transactionExists) {
        confidence = Math.min(confidence, 0.55);
    }

    return Number(
        Math.max(
            0.3,
            Math.min(confidence, 0.98)
        ).toFixed(2)
    );
};

const determineEvidenceVerdict = ({
    parsedComplaint,
    resolvedCaseHint,
    rules,
    matchConfidence,
    ambiguousMatch,
    establishedRecipientPattern,
    duplicateEvidence
}) => {
    const caseHint = normalize(
        resolvedCaseHint ?? "other"
    );

    if (
        caseHint ===
        "phishing_or_social_engineering"
    ) {
        return EVIDENCE_VERDICTS.INSUFFICIENT_DATA;
    }

    if (ambiguousMatch) {
        return EVIDENCE_VERDICTS.INSUFFICIENT_DATA;
    }

    if (!rules.transactionExists) {
        return EVIDENCE_VERDICTS.INSUFFICIENT_DATA;
    }

    if (
        matchConfidence > 0 &&
        matchConfidence < MATCH_CONFIDENCE_FLOOR &&
        ![
            "agent_cash_in_issue",
            "merchant_settlement_delay",
            "duplicate_payment"
        ].includes(caseHint) &&
        !rules.amountMatched &&
        !rules.counterpartyMatched
    ) {
        return EVIDENCE_VERDICTS.INSUFFICIENT_DATA;
    }

    if (
        caseHint === "wrong_transfer"
    ) {
        if (
            establishedRecipientPattern
        ) {
            return EVIDENCE_VERDICTS.INCONSISTENT;
        }

        if (
            rules.amountMatched &&
            rules.transactionTypeMatched &&
            rules.completedStatus
        ) {
            return EVIDENCE_VERDICTS.CONSISTENT;
        }

        return EVIDENCE_VERDICTS.INSUFFICIENT_DATA;
    }

    if (
        caseHint === "payment_failed"
    ) {
        if (
            rules.amountMatched &&
            rules.transactionTypeMatched &&
            rules.failedStatus
        ) {
            return EVIDENCE_VERDICTS.CONSISTENT;
        }

        if (rules.completedStatus) {
            return EVIDENCE_VERDICTS.INCONSISTENT;
        }

        return EVIDENCE_VERDICTS.INSUFFICIENT_DATA;
    }

    if (
        caseHint === "refund_request"
    ) {
        if (
            rules.amountMatched &&
            rules.transactionTypeMatched &&
            (
                rules.completedStatus ||
                rules.reversedStatus
            )
        ) {
            return EVIDENCE_VERDICTS.CONSISTENT;
        }

        return EVIDENCE_VERDICTS.INSUFFICIENT_DATA;
    }

    if (
        caseHint === "duplicate_payment"
    ) {
        if (
            rules.transactionTypeMatched &&
            rules.amountMatched &&
            duplicateEvidence
        ) {
            return EVIDENCE_VERDICTS.CONSISTENT;
        }

        return EVIDENCE_VERDICTS.INSUFFICIENT_DATA;
    }

    if (
        caseHint ===
        "merchant_settlement_delay"
    ) {
        if (
            (
                rules.transactionTypeMatched ||
                normalize(
                    rules.status
                ) === "pending" ||
                normalize(
                    rules.status
                ) === "completed"
            ) &&
            (
                rules.pendingStatus ||
                rules.completedStatus
            )
        ) {
            return EVIDENCE_VERDICTS.CONSISTENT;
        }

        return EVIDENCE_VERDICTS.INSUFFICIENT_DATA;
    }

    if (
        caseHint ===
        "agent_cash_in_issue"
    ) {
        if (
            (
                rules.transactionTypeMatched ||
                normalize(
                    parsedComplaint?.transactionType
                ) === "cash_in"
            ) &&
            (
                rules.pendingStatus ||
                rules.completedStatus
            ) &&
            (
                rules.amountMatched ||
                rules.counterpartyMatched ||
                parsedComplaint?.flags?.hasAgent
            )
        ) {
            return EVIDENCE_VERDICTS.CONSISTENT;
        }

        return EVIDENCE_VERDICTS.INSUFFICIENT_DATA;
    }

    if (
        rules.amountMatched &&
        rules.transactionTypeMatched &&
        (
            rules.counterpartyMatched ||
            rules.timeMatched ||
            rules.completedStatus
        )
    ) {
        return EVIDENCE_VERDICTS.CONSISTENT;
    }

    return EVIDENCE_VERDICTS.INSUFFICIENT_DATA;
};

const evidenceEngine = (
    parsedComplaint = {},
    transactionOrMatchResult = null,
    transactionHistory = []
) => {
    const {
        relevantTransaction,
        relevantTransactionId,
        matchConfidence,
        matchReasons,
        transactionHistory: normalizedHistory
    } = resolveMatchContext(
        transactionOrMatchResult,
        transactionHistory
    );

    const rules = getRuleSnapshot(
        parsedComplaint,
        relevantTransaction
    );

    const resolvedCaseHint =
        resolveCaseHint(
            parsedComplaint,
            relevantTransaction,
            normalizedHistory
        );

    const ambiguousMatch =
        resolvedCaseHint === "duplicate_payment"
            ? false
            : hasAmbiguousMatch(
                parsedComplaint,
                normalizedHistory,
                relevantTransaction
            );

    const establishedRecipientPattern =
        hasEstablishedRecipientPattern(
            relevantTransaction,
            normalizedHistory
        );

    const duplicateEvidence =
        hasNearDuplicatePayment(
            relevantTransaction,
            normalizedHistory
        );

    const verdict =
        determineEvidenceVerdict({
            parsedComplaint,
            resolvedCaseHint,
            rules,
            matchConfidence,
            ambiguousMatch,
            establishedRecipientPattern,
            duplicateEvidence
        });

    const reasons = [
        ...new Set([
            ...matchReasons,
            ...buildEvidenceReasons({
                verdict,
                parsedComplaint,
                rules,
                matchConfidence,
                ambiguousMatch,
                establishedRecipientPattern,
                duplicateEvidence
            })
        ])
    ];

    const confidence =
        calculateEvidenceConfidence({
            verdict,
            rules,
            matchConfidence,
            ambiguousMatch,
            establishedRecipientPattern,
            duplicateEvidence
        });

    return {
        verdict,
        confidence,
        reasons,
        relevantTransaction,
        relevantTransactionId:
            ambiguousMatch ||
            (
                verdict ===
                EVIDENCE_VERDICTS.INSUFFICIENT_DATA &&
                (
                    resolvedCaseHint === "other" ||
                    (
                        matchConfidence <
                        MATCH_CONFIDENCE_FLOOR &&
                        ![
                            "agent_cash_in_issue",
                            "merchant_settlement_delay",
                            "duplicate_payment"
                        ].includes(resolvedCaseHint)
                    ) ||
                    (
                        !rules.amountMatched &&
                        !rules.counterpartyMatched &&
                        !rules.timeMatched &&
                        resolvedCaseHint === "other"
                    )
                )
            )
                ? null
                : relevantTransactionId,
        ruleSnapshot: {
            ...rules,
            resolvedCaseHint,
            ambiguousMatch,
            establishedRecipientPattern,
            duplicateEvidence
        }
    };
};

export {
    EVIDENCE_VERDICTS
};

export default evidenceEngine;
