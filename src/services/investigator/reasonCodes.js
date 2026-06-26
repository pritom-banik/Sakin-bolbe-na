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

const unique = (items = []) => {
    return [...new Set(
        items.filter(Boolean)
    )];
};

const getReasonSignals = ({
    parsedComplaint = {},
    transactionMatch = {},
    evidenceResult = {},
    classificationResult = {},
    severityResult = {},
    departmentResult = {},
    reviewDecisionResult = {},
    confidenceResult = {}
} = {}) => {
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
        confidence:
            Number(
                confidenceResult.confidence
            ) || 0,
        hasRelevantTransaction: Boolean(
            evidenceResult.relevantTransactionId ||
            evidenceResult.relevantTransaction
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
        humanReviewRequired: Boolean(
            reviewDecisionResult.humanReviewRequired
        ),
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
                "fake call"
            ])
        ),
        lowParserContext:
            Number(parsedComplaint.confidence) > 0 &&
            Number(parsedComplaint.confidence) < 0.5,
        lowMatchConfidence:
            Number(transactionMatch.confidence) > 0 &&
            Number(transactionMatch.confidence) < 0.5
    };
};

const getCaseSpecificReasonCodes = (
    signals
) => {
    switch (signals.caseType) {
        case "wrong_transfer":
            if (
                signals.ambiguousMatch
            ) {
                return [
                    "ambiguous_match",
                    "needs_clarification"
                ];
            }

            if (
                signals.establishedRecipientPattern ||
                signals.verdict === "inconsistent"
            ) {
                return [
                    "wrong_transfer_claim",
                    "established_recipient_pattern",
                    "evidence_inconsistent"
                ];
            }

            return [
                "wrong_transfer",
                "transaction_match",
                "dispute_initiated"
            ];

        case "payment_failed":
            return [
                "payment_failed",
                "potential_balance_deduction"
            ];

        case "refund_request":
            return [
                "refund_request",
                "merchant_policy_dependent"
            ];

        case "duplicate_payment":
            return [
                "duplicate_payment",
                "biller_verification_required"
            ];

        case "merchant_settlement_delay":
            return [
                "merchant_settlement",
                "delay",
                signals.pendingStatus
                    ? "pending"
                    : "batch_verification_required"
            ];

        case "agent_cash_in_issue":
            return [
                "agent_cash_in",
                signals.pendingStatus
                    ? "pending_transaction"
                    : "balance_not_reflected",
                "agent_ops"
            ];

        case "phishing_or_social_engineering":
            return [
                "phishing",
                "credential_protection",
                "critical_escalation"
            ];

        case "other":
        default:
            return [
                "vague_complaint",
                "needs_clarification"
            ];
    }
};

const getSupplementalReasonCodes = (
    signals
) => {
    const reasons = [];

    if (
        !signals.hasRelevantTransaction &&
        signals.verdict === "insufficient_data"
        &&
        ![
            "phishing_or_social_engineering",
            "other"
        ].includes(signals.caseType)
    ) {
        reasons.push("insufficient_data");
    }

    if (
        signals.failedStatus &&
        signals.caseType !== "payment_failed"
    ) {
        reasons.push("failed_transaction");
    }

    if (
        signals.pendingStatus &&
        ![
            "agent_cash_in_issue",
            "merchant_settlement_delay"
        ].includes(signals.caseType)
    ) {
        reasons.push("pending_transaction");
    }

    if (
        signals.humanReviewRequired &&
        signals.department === "fraud_risk" &&
        signals.caseType !==
        "phishing_or_social_engineering"
    ) {
        reasons.push("fraud_review");
    }

    if (
        signals.confidence < 0.6 &&
        signals.caseType === "other"
    ) {
        return reasons;
    }

    if (
        signals.lowParserContext &&
        signals.caseType === "other"
    ) {
        return reasons;
    }

    if (
        signals.lowMatchConfidence &&
        signals.caseType === "wrong_transfer" &&
        !signals.ambiguousMatch
    ) {
        reasons.push("low_match_confidence");
    }

    return reasons;
};

const reasonCodes = ({
    parsedComplaint = {},
    transactionMatch = {},
    evidenceResult = {},
    classificationResult = {},
    severityResult = {},
    departmentResult = {},
    reviewDecisionResult = {},
    confidenceResult = {}
} = {}) => {
    const signals = getReasonSignals({
        parsedComplaint,
        transactionMatch,
        evidenceResult,
        classificationResult,
        severityResult,
        departmentResult,
        reviewDecisionResult,
        confidenceResult
    });

    return {
        reasonCodes: unique([
            ...getCaseSpecificReasonCodes(
                signals
            ),
            ...getSupplementalReasonCodes(
                signals
            )
        ])
    };
};

export default reasonCodes;
