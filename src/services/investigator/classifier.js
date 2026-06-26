const CASE_TYPES = {
    WRONG_TRANSFER: "wrong_transfer",
    PAYMENT_FAILED: "payment_failed",
    REFUND_REQUEST: "refund_request",
    DUPLICATE_PAYMENT: "duplicate_payment",
    MERCHANT_SETTLEMENT_DELAY:
        "merchant_settlement_delay",
    AGENT_CASH_IN_ISSUE:
        "agent_cash_in_issue",
    PHISHING_OR_SOCIAL_ENGINEERING:
        "phishing_or_social_engineering",
    OTHER: "other"
};

const normalize = (value = "") => {
    return value
        .toString()
        .trim()
        .toLowerCase();
};

const getComplaintText = (
    parsedComplaint = {}
) => {
    return normalize(
        parsedComplaint.normalizedComplaint ||
        parsedComplaint.originalComplaint ||
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

const getTransactionType = (
    evidenceResult = {},
    fallbackTransaction = null
) => {
    return normalize(
        evidenceResult.relevantTransaction?.type ||
        fallbackTransaction?.type ||
        ""
    );
};

const getTransactionStatus = (
    evidenceResult = {},
    fallbackTransaction = null
) => {
    return normalize(
        evidenceResult.relevantTransaction?.status ||
        fallbackTransaction?.status ||
        ""
    );
};

const resolveEvidenceCaseHint = (
    evidenceResult = {}
) => {
    return normalize(
        evidenceResult.ruleSnapshot?.resolvedCaseHint ||
        ""
    );
};

const resolveParsedCaseHint = (
    parsedComplaint = {}
) => {
    return normalize(
        parsedComplaint.caseHint ||
        ""
    );
};

const hasDuplicateEvidence = (
    evidenceResult = {},
    transactionHistory = []
) => {
    if (
        evidenceResult.ruleSnapshot?.duplicateEvidence
    ) {
        return true;
    }

    const relevantTransaction =
        evidenceResult.relevantTransaction;

    if (!relevantTransaction) {
        return false;
    }

    return transactionHistory.some(transaction => {
        if (
            transaction.transaction_id ===
            relevantTransaction.transaction_id
        ) {
            return false;
        }

        return normalize(transaction.type) ===
            normalize(relevantTransaction.type) &&
            normalize(transaction.counterparty) ===
            normalize(
                relevantTransaction.counterparty
            ) &&
            Number(transaction.amount) ===
            Number(relevantTransaction.amount);
    });
};

const classifyFromExplicitSignals = (
    parsedComplaint = {},
    evidenceResult = {},
    fallbackTransaction = null,
    transactionHistory = []
) => {
    const evidenceCaseHint =
        resolveEvidenceCaseHint(
            evidenceResult
        );

    if (
        Object.values(CASE_TYPES).includes(
            evidenceCaseHint
        ) &&
        evidenceCaseHint !== CASE_TYPES.OTHER
    ) {
        return evidenceCaseHint;
    }

    const parsedCaseHint =
        resolveParsedCaseHint(
            parsedComplaint
        );

    if (
        Object.values(CASE_TYPES).includes(
            parsedCaseHint
        ) &&
        parsedCaseHint !== CASE_TYPES.OTHER
    ) {
        return parsedCaseHint;
    }

    if (
        parsedComplaint.flags?.hasRisk ||
        complaintIncludesAny(parsedComplaint, [
            "otp",
            "pin",
            "password",
            "scam",
            "fraud",
            "fake call"
        ])
    ) {
        return CASE_TYPES.PHISHING_OR_SOCIAL_ENGINEERING;
    }

    if (
        hasDuplicateEvidence(
            evidenceResult,
            transactionHistory
        ) ||
        complaintIncludesAny(parsedComplaint, [
            "duplicate",
            "double payment",
            "charged twice",
            "deducted twice",
            "twice"
        ])
    ) {
        return CASE_TYPES.DUPLICATE_PAYMENT;
    }

    const transactionType =
        getTransactionType(
            evidenceResult,
            fallbackTransaction
        );

    const transactionStatus =
        getTransactionStatus(
            evidenceResult,
            fallbackTransaction
        );

    if (
        transactionType === "settlement" ||
        (
            normalize(parsedComplaint.userType) ===
            "merchant" &&
            complaintIncludesAny(parsedComplaint, [
                "settlement",
                "sales",
                "merchant balance",
                "not settled"
            ])
        )
    ) {
        return CASE_TYPES.MERCHANT_SETTLEMENT_DELAY;
    }

    if (
        transactionType === "cash_in" &&
        (
            parsedComplaint.flags?.hasAgent ||
            complaintIncludesAny(parsedComplaint, [
                "agent",
                "cash in",
                "cashin"
            ])
        )
    ) {
        return CASE_TYPES.AGENT_CASH_IN_ISSUE;
    }

    if (
        transactionType === "transfer" &&
        complaintIncludesAny(parsedComplaint, [
            "wrong transfer",
            "wrong number",
            "wrong person",
            "by mistake",
            "sent to",
            "didn't get it",
            "did not get it",
            "he didn't get it",
            "he did not get it",
            "didn't get it",
            "did not get it"
        ])
    ) {
        return CASE_TYPES.WRONG_TRANSFER;
    }

    if (
        transactionType === "payment" &&
        (
            transactionStatus === "failed" ||
            complaintIncludesAny(parsedComplaint, [
                "payment failed",
                "failed",
                "balance deducted",
                "deducted"
            ])
        )
    ) {
        return CASE_TYPES.PAYMENT_FAILED;
    }

    if (
        complaintIncludesAny(parsedComplaint, [
            "refund",
            "money back",
            "return money",
            "tk back"
        ])
    ) {
        return CASE_TYPES.REFUND_REQUEST;
    }

    return CASE_TYPES.OTHER;
};

const applyEvidenceBasedCorrection = (
    classifiedCaseType,
    evidenceResult = {}
) => {
    const verdict = normalize(
        evidenceResult.verdict
    );
    const evidenceCaseHint =
        resolveEvidenceCaseHint(
            evidenceResult
        );

    if (
        classifiedCaseType ===
        CASE_TYPES.PHISHING_OR_SOCIAL_ENGINEERING
    ) {
        return classifiedCaseType;
    }

    if (
        evidenceResult.ruleSnapshot?.ambiguousMatch &&
        normalize(
            evidenceResult.relevantTransaction?.type
        ) === "transfer"
    ) {
        return CASE_TYPES.WRONG_TRANSFER;
    }

    if (
        verdict === "insufficient_data" &&
        evidenceCaseHint === CASE_TYPES.OTHER &&
        !evidenceResult.relevantTransactionId
    ) {
        return CASE_TYPES.OTHER;
    }

    if (
        verdict === "inconsistent" &&
        evidenceCaseHint ===
        CASE_TYPES.WRONG_TRANSFER
    ) {
        return CASE_TYPES.WRONG_TRANSFER;
    }

    if (
        verdict === "consistent" &&
        evidenceCaseHint &&
        evidenceCaseHint !== CASE_TYPES.OTHER
    ) {
        return evidenceCaseHint;
    }

    return classifiedCaseType;
};

const buildClassificationReasons = (
    caseType,
    parsedComplaint = {},
    evidenceResult = {}
) => {
    const reasons = [];

    if (
        resolveEvidenceCaseHint(
            evidenceResult
        ) === caseType
    ) {
        reasons.push("evidence_case_alignment");
    }

    if (
        resolveParsedCaseHint(
            parsedComplaint
        ) === caseType
    ) {
        reasons.push("parser_case_hint");
    }

    if (
        evidenceResult.ruleSnapshot?.duplicateEvidence &&
        caseType === CASE_TYPES.DUPLICATE_PAYMENT
    ) {
        reasons.push("duplicate_pattern_detected");
    }

    if (
        evidenceResult.ruleSnapshot?.establishedRecipientPattern &&
        caseType === CASE_TYPES.WRONG_TRANSFER
    ) {
        reasons.push(
            "established_recipient_pattern"
        );
    }

    if (
        parsedComplaint.flags?.hasRisk &&
        caseType ===
        CASE_TYPES.PHISHING_OR_SOCIAL_ENGINEERING
    ) {
        reasons.push("risk_keywords_detected");
    }

    if (
        evidenceResult.ruleSnapshot?.ambiguousMatch
    ) {
        reasons.push("ambiguous_match");
    }

    if (
        !reasons.length &&
        caseType === CASE_TYPES.OTHER
    ) {
        reasons.push("fallback_other");
    }

    return reasons;
};

const calculateClassificationConfidence = (
    caseType,
    parsedComplaint = {},
    evidenceResult = {}
) => {
    let confidence =
        Number(evidenceResult.confidence) || 0.5;

    if (
        resolveEvidenceCaseHint(
            evidenceResult
        ) === caseType
    ) {
        confidence += 0.15;
    }

    if (
        resolveParsedCaseHint(
            parsedComplaint
        ) === caseType
    ) {
        confidence += 0.1;
    }

    if (
        evidenceResult.ruleSnapshot?.ambiguousMatch
    ) {
        confidence -= 0.15;
    }

    if (
        caseType === CASE_TYPES.OTHER &&
        normalize(evidenceResult.verdict) ===
        "insufficient_data"
    ) {
        confidence = Math.min(
            confidence,
            0.7
        );
    }

    return Number(
        Math.max(
            0.35,
            Math.min(confidence, 0.98)
        ).toFixed(2)
    );
};

const classifier = (
    parsedComplaint = {},
    evidenceResult = {},
    transactionHistory = [],
    fallbackTransaction = null
) => {
    const initialCaseType =
        classifyFromExplicitSignals(
            parsedComplaint,
            evidenceResult,
            fallbackTransaction,
            transactionHistory
        );

    const caseType =
        applyEvidenceBasedCorrection(
            initialCaseType,
            evidenceResult
        );

    return {
        caseType,
        confidence:
            calculateClassificationConfidence(
                caseType,
                parsedComplaint,
                evidenceResult
            ),
        reasons:
            buildClassificationReasons(
                caseType,
                parsedComplaint,
                evidenceResult
            )
    };
};

export {
    CASE_TYPES
};

export default classifier;
