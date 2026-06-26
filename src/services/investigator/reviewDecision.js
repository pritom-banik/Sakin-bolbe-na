const HIGH_VALUE_REVIEW_THRESHOLD = 10000;
const CRITICAL_VALUE_REVIEW_THRESHOLD = 50000;

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

const getReviewSignals = (
    parsedComplaint = {},
    evidenceResult = {},
    classificationResult = {},
    severityResult = {},
    departmentResult = {}
) => {
    const amount =
        toNumber(parsedComplaint.primaryAmount) ??
        toNumber(
            evidenceResult.relevantTransaction?.amount
        );

    return {
        caseType: normalize(
            classificationResult.caseType ||
            evidenceResult.ruleSnapshot?.resolvedCaseHint ||
            parsedComplaint.caseHint ||
            "other"
        ),
        verdict: normalize(
            evidenceResult.verdict
        ),
        severity: normalize(
            severityResult.severity
        ),
        department: normalize(
            departmentResult.department
        ),
        amount,
        hasCredentialRisk: Boolean(
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
                "fake call",
                "account blocked"
            ])
        ),
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
        pendingStatus:
            normalize(
                evidenceResult.relevantTransaction?.status ||
                evidenceResult.ruleSnapshot?.status
            ) === "pending",
        failedStatus:
            normalize(
                evidenceResult.relevantTransaction?.status ||
                evidenceResult.ruleSnapshot?.status
            ) === "failed",
        hasRelevantTransaction: Boolean(
            evidenceResult.relevantTransactionId ||
            evidenceResult.relevantTransaction
        ),
        lowEvidenceConfidence:
            Number(evidenceResult.confidence) > 0 &&
            Number(evidenceResult.confidence) < 0.6
    };
};

const shouldRequireHumanReview = (
    signals
) => {
    if (
        signals.hasCredentialRisk ||
        signals.caseType ===
        "phishing_or_social_engineering"
    ) {
        return true;
    }

    if (
        signals.amount !== null &&
        signals.amount >=
        CRITICAL_VALUE_REVIEW_THRESHOLD
    ) {
        return true;
    }

    if (
        signals.caseType === "wrong_transfer"
    ) {
        if (
            signals.ambiguousMatch &&
            !signals.hasRelevantTransaction
        ) {
            return false;
        }

        if (
            signals.ambiguousMatch &&
            signals.verdict === "insufficient_data"
        ) {
            return false;
        }

        return true;
    }

    if (
        signals.caseType ===
        "duplicate_payment"
    ) {
        return true;
    }

    if (
        signals.caseType ===
        "agent_cash_in_issue"
    ) {
        return true;
    }

    if (
        signals.caseType ===
        "refund_request"
    ) {
        return signals.department ===
                "dispute_resolution" ||
            signals.verdict === "inconsistent" ||
            (
                signals.amount !== null &&
                signals.amount >=
                HIGH_VALUE_REVIEW_THRESHOLD
            );
    }

    if (
        signals.caseType ===
        "payment_failed"
    ) {
        return (
            signals.amount !== null &&
            signals.amount >=
            CRITICAL_VALUE_REVIEW_THRESHOLD
        ) || false;
    }

    if (
        signals.caseType ===
            "merchant_settlement_delay" &&
        signals.severity === "critical"
    ) {
        return true;
    }

    if (
        signals.verdict === "inconsistent" &&
        signals.department ===
        "dispute_resolution"
    ) {
        return true;
    }

    if (
        signals.ambiguousMatch
    ) {
        return false;
    }

    if (
        signals.pendingStatus &&
        signals.caseType ===
        "agent_cash_in_issue"
    ) {
        return true;
    }

    if (
        signals.lowEvidenceConfidence &&
        signals.severity === "critical"
    ) {
        return true;
    }

    return false;
};

const buildReviewReasons = (
    reviewRequired,
    signals
) => {
    const reasons = [];

    if (signals.hasCredentialRisk) {
        reasons.push("suspicious_case");
    }

    if (
        signals.caseType === "wrong_transfer"
    ) {
        reasons.push(
            reviewRequired
                ? "dispute_case"
                : "clarification_first"
        );
    }

    if (
        signals.caseType ===
        "duplicate_payment"
    ) {
        reasons.push(
            "payments_verification_required"
        );
    }

    if (
        signals.caseType ===
        "agent_cash_in_issue"
    ) {
        reasons.push("agent_ops_verification");
    }

    if (
        signals.establishedRecipientPattern
    ) {
        reasons.push(
            "contradictory_history_pattern"
        );
    }

    if (
        signals.ambiguousMatch
    ) {
        reasons.push("ambiguous_match");
    }

    if (
        signals.amount !== null &&
        signals.amount >=
        HIGH_VALUE_REVIEW_THRESHOLD
    ) {
        reasons.push("high_value_case");
    }

    if (
        !reviewRequired &&
        !reasons.length
    ) {
        reasons.push("automation_sufficient");
    }

    return reasons;
};

const calculateReviewConfidence = (
    reviewRequired,
    signals,
    evidenceResult = {},
    classificationResult = {},
    severityResult = {},
    departmentResult = {}
) => {
    let confidence = Math.max(
        Number(evidenceResult.confidence) || 0.5,
        Number(classificationResult.confidence) || 0.5,
        Number(severityResult.confidence) || 0.5,
        Number(departmentResult.confidence) || 0.5
    );

    if (signals.hasCredentialRisk) {
        confidence += 0.12;
    }

    if (
        signals.caseType === "wrong_transfer" &&
        reviewRequired
    ) {
        confidence += 0.08;
    }

    if (
        signals.ambiguousMatch &&
        !reviewRequired
    ) {
        confidence += 0.04;
    }

    if (
        signals.establishedRecipientPattern
    ) {
        confidence += 0.06;
    }

    return Number(
        Math.max(
            0.45,
            Math.min(confidence, 0.98)
        ).toFixed(2)
    );
};

const reviewDecision = (
    parsedComplaint = {},
    evidenceResult = {},
    classificationResult = {},
    severityResult = {},
    departmentResult = {}
) => {
    const signals = getReviewSignals(
        parsedComplaint,
        evidenceResult,
        classificationResult,
        severityResult,
        departmentResult
    );

    const humanReviewRequired =
        shouldRequireHumanReview(
            signals
        );

    return {
        humanReviewRequired,
        confidence:
            calculateReviewConfidence(
                humanReviewRequired,
                signals,
                evidenceResult,
                classificationResult,
                severityResult,
                departmentResult
            ),
        reasons:
            buildReviewReasons(
                humanReviewRequired,
                signals
            )
    };
};

export default reviewDecision;
