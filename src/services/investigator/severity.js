const SEVERITY_LEVELS = {
    LOW: "low",
    MEDIUM: "medium",
    HIGH: "high",
    CRITICAL: "critical"
};

const HIGH_VALUE_THRESHOLD = 10000;
const CRITICAL_VALUE_THRESHOLD = 50000;

const normalize = (value = "") => {
    return value
        .toString()
        .trim()
        .toLowerCase();
};

const toNumber = (value) => {
    const number = Number(value);

    return Number.isNaN(number)
        ? null
        : number;
};

const getPrimaryAmount = (
    parsedComplaint = {},
    evidenceResult = {}
) => {
    const complaintAmount =
        toNumber(parsedComplaint.primaryAmount);

    if (complaintAmount !== null) {
        return complaintAmount;
    }

    return toNumber(
        evidenceResult.relevantTransaction?.amount
    );
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

const getEvidenceStatus = (
    evidenceResult = {}
) => {
    return normalize(
        evidenceResult.relevantTransaction?.status ||
        evidenceResult.ruleSnapshot?.status ||
        ""
    );
};

const getSeveritySignals = (
    parsedComplaint = {},
    evidenceResult = {},
    classificationResult = {}
) => {
    const caseType = normalize(
        classificationResult.caseType ||
        evidenceResult.ruleSnapshot?.resolvedCaseHint ||
        parsedComplaint.caseHint ||
        "other"
    );

    const verdict = normalize(
        evidenceResult.verdict
    );

    const amount = getPrimaryAmount(
        parsedComplaint,
        evidenceResult
    );

    const status = getEvidenceStatus(
        evidenceResult
    );

    const ambiguousMatch = Boolean(
        evidenceResult.ruleSnapshot?.ambiguousMatch
    );

    const establishedRecipientPattern = Boolean(
        evidenceResult.ruleSnapshot?.establishedRecipientPattern
    );

    const duplicateEvidence = Boolean(
        evidenceResult.ruleSnapshot?.duplicateEvidence
    );

    const hasCredentialRisk = Boolean(
        parsedComplaint.flags?.hasRisk ||
        parsedComplaint.flags?.hasOTP ||
        parsedComplaint.flags?.hasPIN ||
        parsedComplaint.flags?.hasPassword ||
        complaintIncludesAny(parsedComplaint, [
            "otp",
            "pin",
            "password",
            "scam",
            "fraud",
            "account blocked",
            "account suspended"
        ])
    );

    return {
        caseType,
        verdict,
        amount,
        status,
        ambiguousMatch,
        establishedRecipientPattern,
        duplicateEvidence,
        hasCredentialRisk
    };
};

const determineSeverityLevel = (
    signals
) => {
    const {
        caseType,
        verdict,
        amount,
        status,
        ambiguousMatch,
        establishedRecipientPattern,
        duplicateEvidence,
        hasCredentialRisk
    } = signals;

    if (
        caseType ===
            "phishing_or_social_engineering" ||
        hasCredentialRisk
    ) {
        return SEVERITY_LEVELS.CRITICAL;
    }

    if (
        amount !== null &&
        amount >= CRITICAL_VALUE_THRESHOLD &&
        (
            caseType === "wrong_transfer" ||
            caseType === "duplicate_payment" ||
            caseType === "payment_failed"
        )
    ) {
        return SEVERITY_LEVELS.CRITICAL;
    }

    if (
        caseType === "payment_failed"
    ) {
        return SEVERITY_LEVELS.HIGH;
    }

    if (
        caseType === "duplicate_payment"
    ) {
        return SEVERITY_LEVELS.HIGH;
    }

    if (
        caseType === "agent_cash_in_issue"
    ) {
        return SEVERITY_LEVELS.HIGH;
    }

    if (
        caseType === "wrong_transfer"
    ) {
        if (
            ambiguousMatch ||
            establishedRecipientPattern ||
            verdict === "inconsistent"
        ) {
            return SEVERITY_LEVELS.MEDIUM;
        }

        return SEVERITY_LEVELS.HIGH;
    }

    if (
        caseType ===
        "merchant_settlement_delay"
    ) {
        return SEVERITY_LEVELS.MEDIUM;
    }

    if (
        caseType === "refund_request"
    ) {
        if (
            verdict === "inconsistent" ||
            amount !== null &&
            amount >= HIGH_VALUE_THRESHOLD
        ) {
            return SEVERITY_LEVELS.MEDIUM;
        }

        return SEVERITY_LEVELS.LOW;
    }

    if (
        caseType === "other"
    ) {
        if (
            verdict === "insufficient_data" &&
            !ambiguousMatch
        ) {
            return SEVERITY_LEVELS.LOW;
        }

        if (
            duplicateEvidence ||
            status === "failed" ||
            status === "pending"
        ) {
            return SEVERITY_LEVELS.MEDIUM;
        }

        return SEVERITY_LEVELS.LOW;
    }

    if (
        amount !== null &&
        amount >= HIGH_VALUE_THRESHOLD
    ) {
        return SEVERITY_LEVELS.MEDIUM;
    }

    return SEVERITY_LEVELS.LOW;
};

const buildSeverityReasons = (
    severity,
    signals
) => {
    const reasons = [];

    if (signals.hasCredentialRisk) {
        reasons.push("credential_risk");
    }

    if (signals.ambiguousMatch) {
        reasons.push("ambiguous_match");
    }

    if (signals.establishedRecipientPattern) {
        reasons.push(
            "established_recipient_pattern"
        );
    }

    if (signals.duplicateEvidence) {
        reasons.push("duplicate_pattern_detected");
    }

    if (signals.status === "pending") {
        reasons.push("pending_transaction");
    }

    if (signals.status === "failed") {
        reasons.push("failed_transaction");
    }

    if (
        signals.amount !== null &&
        signals.amount >= HIGH_VALUE_THRESHOLD
    ) {
        reasons.push("high_value_amount");
    }

    if (
        severity === SEVERITY_LEVELS.LOW &&
        !reasons.length
    ) {
        reasons.push("routine_support_case");
    }

    return reasons;
};

const calculateSeverityConfidence = (
    severity,
    signals,
    evidenceResult = {},
    classificationResult = {}
) => {
    let confidence = Math.max(
        Number(evidenceResult.confidence) || 0.5,
        Number(classificationResult.confidence) || 0.5
    );

    if (signals.hasCredentialRisk) {
        confidence += 0.15;
    }

    if (signals.duplicateEvidence) {
        confidence += 0.1;
    }

    if (signals.establishedRecipientPattern) {
        confidence += 0.08;
    }

    if (signals.ambiguousMatch) {
        confidence -= 0.08;
    }

    if (
        severity === SEVERITY_LEVELS.CRITICAL
    ) {
        confidence += 0.08;
    }

    if (
        severity === SEVERITY_LEVELS.LOW &&
        signals.caseType === "other"
    ) {
        confidence = Math.min(
            confidence,
            0.72
        );
    }

    return Number(
        Math.max(
            0.4,
            Math.min(confidence, 0.98)
        ).toFixed(2)
    );
};

const severity = (
    parsedComplaint = {},
    evidenceResult = {},
    classificationResult = {}
) => {
    const signals = getSeveritySignals(
        parsedComplaint,
        evidenceResult,
        classificationResult
    );

    const level =
        determineSeverityLevel(
            signals
        );

    return {
        severity: level,
        confidence:
            calculateSeverityConfidence(
                level,
                signals,
                evidenceResult,
                classificationResult
            ),
        reasons:
            buildSeverityReasons(
                level,
                signals
            )
    };
};

export {
    SEVERITY_LEVELS
};

export default severity;
