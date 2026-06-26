const normalize = (value = "") => {
    return value
        .toString()
        .trim()
        .toLowerCase();
};

const clamp = (
    value,
    min,
    max
) => {
    return Math.min(
        Math.max(value, min),
        max
    );
};

const getWeightedAverage = (
    weightedValues = []
) => {
    const validValues = weightedValues.filter(
        item =>
            item &&
            typeof item.value === "number" &&
            !Number.isNaN(item.value) &&
            typeof item.weight === "number" &&
            item.weight > 0
    );

    if (!validValues.length) {
        return 0.5;
    }

    const weightedSum =
        validValues.reduce(
            (sum, item) =>
                sum + item.value * item.weight,
            0
        );

    const totalWeight =
        validValues.reduce(
            (sum, item) =>
                sum + item.weight,
            0
        );

    return totalWeight > 0
        ? weightedSum / totalWeight
        : 0.5;
};

const getConfidenceSignals = ({
    parsedComplaint = {},
    transactionMatch = {},
    evidenceResult = {},
    classificationResult = {},
    severityResult = {},
    departmentResult = {},
    reviewDecisionResult = {}
}) => {
    const caseType = normalize(
        classificationResult.caseType ||
        evidenceResult.ruleSnapshot?.resolvedCaseHint ||
        parsedComplaint.caseHint ||
        "other"
    );

    const verdict = normalize(
        evidenceResult.verdict
    );

    return {
        parserConfidence:
            Number(parsedComplaint.confidence) || 0,
        matchConfidence:
            Number(transactionMatch.confidence) || 0,
        evidenceConfidence:
            Number(evidenceResult.confidence) || 0,
        classificationConfidence:
            Number(classificationResult.confidence) || 0,
        severityConfidence:
            Number(severityResult.confidence) || 0,
        departmentConfidence:
            Number(departmentResult.confidence) || 0,
        reviewConfidence:
            Number(reviewDecisionResult.confidence) || 0,
        caseType,
        verdict,
        ambiguousMatch: Boolean(
            evidenceResult.ruleSnapshot?.ambiguousMatch
        ),
        establishedRecipientPattern:
            Boolean(
                evidenceResult.ruleSnapshot?.establishedRecipientPattern
            ),
        duplicateEvidence: Boolean(
            evidenceResult.ruleSnapshot?.duplicateEvidence
        ),
        hasCredentialRisk: Boolean(
            parsedComplaint.flags?.hasRisk ||
            parsedComplaint.flags?.hasOTP ||
            parsedComplaint.flags?.hasPIN ||
            parsedComplaint.flags?.hasPassword
        ),
        hasRelevantTransaction: Boolean(
            evidenceResult.relevantTransactionId ||
            evidenceResult.relevantTransaction
        ),
        humanReviewRequired: Boolean(
            reviewDecisionResult.humanReviewRequired
        )
    };
};

const calculateBaseConfidence = (
    signals
) => {
    return getWeightedAverage([
        {
            value: signals.parserConfidence,
            weight: 0.08
        },
        {
            value: signals.matchConfidence,
            weight: 0.12
        },
        {
            value: signals.evidenceConfidence,
            weight: 0.34
        },
        {
            value:
                signals.classificationConfidence,
            weight: 0.18
        },
        {
            value:
                signals.severityConfidence,
            weight: 0.1
        },
        {
            value:
                signals.departmentConfidence,
            weight: 0.08
        },
        {
            value: signals.reviewConfidence,
            weight: 0.1
        }
    ]);
};

const applyConfidenceAdjustments = (
    baseConfidence,
    signals
) => {
    let confidence = baseConfidence;

    if (
        signals.hasCredentialRisk &&
        signals.caseType ===
        "phishing_or_social_engineering"
    ) {
        confidence += 0.26;
    }

    if (
        signals.caseType === "payment_failed" &&
        signals.verdict === "consistent"
    ) {
        confidence += 0.06;
    }

    if (
        signals.caseType ===
            "merchant_settlement_delay" &&
        signals.verdict === "consistent"
    ) {
        confidence += 0.14;
    }

    if (
        signals.caseType ===
            "duplicate_payment" &&
        signals.duplicateEvidence
    ) {
        confidence += 0.08;
    }

    if (
        signals.caseType ===
            "agent_cash_in_issue" &&
        signals.verdict === "consistent"
    ) {
        confidence += 0.23;
    }

    if (
        signals.caseType ===
            "refund_request" &&
        signals.verdict === "consistent"
    ) {
        confidence -= 0.05;
    }

    if (
        signals.caseType === "other" &&
        signals.verdict === "insufficient_data"
    ) {
        confidence += 0.14;
    }

    if (
        signals.caseType === "wrong_transfer" &&
        signals.verdict === "consistent"
    ) {
        confidence += 0.03;
    }

    if (
        signals.caseType === "wrong_transfer" &&
        signals.verdict === "inconsistent"
    ) {
        confidence -= 0.14;
    }

    if (
        signals.caseType === "wrong_transfer" &&
        signals.verdict === "insufficient_data"
    ) {
        confidence += 0.07;
    }

    if (
        signals.ambiguousMatch
    ) {
        confidence -= 0.07;
    }

    if (
        signals.establishedRecipientPattern
    ) {
        confidence -= 0.05;
    }

    if (
        !signals.hasRelevantTransaction &&
        signals.verdict === "insufficient_data"
    ) {
        confidence -= 0.01;
    }

    if (
        signals.humanReviewRequired &&
        signals.verdict === "consistent" &&
        !signals.hasCredentialRisk &&
        signals.caseType !==
            "phishing_or_social_engineering"
    ) {
        confidence -= 0.03;
    }

    return clamp(
        confidence,
        0.45,
        0.98
    );
};

const buildConfidenceReasons = (
    finalConfidence,
    signals
) => {
    const reasons = [];

    if (signals.hasCredentialRisk) {
        reasons.push("credential_risk");
    }

    if (signals.duplicateEvidence) {
        reasons.push("duplicate_pattern_detected");
    }

    if (signals.ambiguousMatch) {
        reasons.push("ambiguous_match");
    }

    if (signals.establishedRecipientPattern) {
        reasons.push(
            "established_recipient_pattern"
        );
    }

    if (
        finalConfidence >= 0.9
    ) {
        reasons.push("high_model_agreement");
    } else if (
        finalConfidence >= 0.75
    ) {
        reasons.push("strong_signal_alignment");
    } else {
        reasons.push("moderate_signal_alignment");
    }

    return reasons;
};

const confidence = ({
    parsedComplaint = {},
    transactionMatch = {},
    evidenceResult = {},
    classificationResult = {},
    severityResult = {},
    departmentResult = {},
    reviewDecisionResult = {}
} = {}) => {
    const signals = getConfidenceSignals({
        parsedComplaint,
        transactionMatch,
        evidenceResult,
        classificationResult,
        severityResult,
        departmentResult,
        reviewDecisionResult
    });

    const baseConfidence =
        calculateBaseConfidence(
            signals
        );

    const finalConfidence =
        Number(
            applyConfidenceAdjustments(
                baseConfidence,
                signals
            ).toFixed(2)
        );

    return {
        confidence: finalConfidence,
        reasons:
            buildConfidenceReasons(
                finalConfidence,
                signals
            )
    };
};

export default confidence;
