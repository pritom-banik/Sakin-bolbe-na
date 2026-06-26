const DEPARTMENTS = {
    CUSTOMER_SUPPORT: "customer_support",
    DISPUTE_RESOLUTION: "dispute_resolution",
    PAYMENTS_OPS: "payments_ops",
    MERCHANT_OPERATIONS:
        "merchant_operations",
    AGENT_OPERATIONS:
        "agent_operations",
    FRAUD_RISK: "fraud_risk"
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

const resolveCaseType = (
    classificationResult = {},
    evidenceResult = {},
    parsedComplaint = {}
) => {
    return normalize(
        classificationResult.caseType ||
        evidenceResult.ruleSnapshot?.resolvedCaseHint ||
        parsedComplaint.caseHint ||
        "other"
    );
};

const getRoutingSignals = (
    parsedComplaint = {},
    evidenceResult = {},
    classificationResult = {},
    severityResult = {}
) => {
    return {
        caseType: resolveCaseType(
            classificationResult,
            evidenceResult,
            parsedComplaint
        ),
        verdict: normalize(
            evidenceResult.verdict
        ),
        severity: normalize(
            severityResult.severity
        ),
        userType: normalize(
            parsedComplaint.userType
        ),
        transactionType: normalize(
            evidenceResult.relevantTransaction?.type
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
        )
    };
};

const mapCaseTypeToDepartment = (
    signals
) => {
    switch (signals.caseType) {
        case "wrong_transfer":
            return DEPARTMENTS.DISPUTE_RESOLUTION;

        case "payment_failed":
        case "duplicate_payment":
            return DEPARTMENTS.PAYMENTS_OPS;

        case "merchant_settlement_delay":
            return DEPARTMENTS.MERCHANT_OPERATIONS;

        case "agent_cash_in_issue":
            return DEPARTMENTS.AGENT_OPERATIONS;

        case "phishing_or_social_engineering":
            return DEPARTMENTS.FRAUD_RISK;

        case "refund_request":
            return signals.verdict === "inconsistent" ||
                signals.severity === "medium" ||
                signals.severity === "high" ||
                signals.severity === "critical"
                ? DEPARTMENTS.DISPUTE_RESOLUTION
                : DEPARTMENTS.CUSTOMER_SUPPORT;

        case "other":
        default:
            return DEPARTMENTS.CUSTOMER_SUPPORT;
    }
};

const applyContextualRouting = (
    baseDepartment,
    signals
) => {
    if (
        signals.hasCredentialRisk
    ) {
        return DEPARTMENTS.FRAUD_RISK;
    }

    if (
        signals.userType === "merchant" &&
        (
            signals.caseType ===
            "merchant_settlement_delay" ||
            signals.transactionType === "settlement"
        )
    ) {
        return DEPARTMENTS.MERCHANT_OPERATIONS;
    }

    if (
        signals.userType === "agent" ||
        signals.caseType ===
        "agent_cash_in_issue"
    ) {
        return DEPARTMENTS.AGENT_OPERATIONS;
    }

    if (
        signals.caseType === "wrong_transfer" &&
        (
            signals.ambiguousMatch ||
            signals.establishedRecipientPattern
        )
    ) {
        return DEPARTMENTS.DISPUTE_RESOLUTION;
    }

    if (
        signals.caseType === "duplicate_payment" &&
        signals.duplicateEvidence
    ) {
        return DEPARTMENTS.PAYMENTS_OPS;
    }

    return baseDepartment;
};

const buildDepartmentReasons = (
    department,
    signals
) => {
    const reasons = [];

    switch (department) {
        case DEPARTMENTS.DISPUTE_RESOLUTION:
            reasons.push("dispute_case");
            break;

        case DEPARTMENTS.PAYMENTS_OPS:
            reasons.push("payments_case");
            break;

        case DEPARTMENTS.MERCHANT_OPERATIONS:
            reasons.push("merchant_case");
            break;

        case DEPARTMENTS.AGENT_OPERATIONS:
            reasons.push("agent_case");
            break;

        case DEPARTMENTS.FRAUD_RISK:
            reasons.push("fraud_risk_case");
            break;

        default:
            reasons.push("general_support_case");
            break;
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

    if (signals.hasCredentialRisk) {
        reasons.push("credential_risk");
    }

    return reasons;
};

const calculateDepartmentConfidence = (
    department,
    signals,
    evidenceResult = {},
    classificationResult = {},
    severityResult = {}
) => {
    let confidence = Math.max(
        Number(evidenceResult.confidence) || 0.5,
        Number(classificationResult.confidence) || 0.5,
        Number(severityResult.confidence) || 0.5
    );

    if (
        department === DEPARTMENTS.FRAUD_RISK &&
        signals.hasCredentialRisk
    ) {
        confidence += 0.12;
    }

    if (
        department ===
            DEPARTMENTS.DISPUTE_RESOLUTION &&
        (
            signals.caseType === "wrong_transfer" ||
            signals.caseType === "refund_request"
        )
    ) {
        confidence += 0.08;
    }

    if (
        department ===
            DEPARTMENTS.PAYMENTS_OPS &&
        (
            signals.caseType === "payment_failed" ||
            signals.caseType === "duplicate_payment"
        )
    ) {
        confidence += 0.08;
    }

    if (
        department ===
            DEPARTMENTS.MERCHANT_OPERATIONS &&
        signals.userType === "merchant"
    ) {
        confidence += 0.08;
    }

    if (
        signals.ambiguousMatch
    ) {
        confidence -= 0.05;
    }

    return Number(
        Math.max(
            0.45,
            Math.min(confidence, 0.98)
        ).toFixed(2)
    );
};

const department = (
    parsedComplaint = {},
    evidenceResult = {},
    classificationResult = {},
    severityResult = {}
) => {
    const signals = getRoutingSignals(
        parsedComplaint,
        evidenceResult,
        classificationResult,
        severityResult
    );

    const baseDepartment =
        mapCaseTypeToDepartment(
            signals
        );

    const routedDepartment =
        applyContextualRouting(
            baseDepartment,
            signals
        );

    return {
        department: routedDepartment,
        confidence:
            calculateDepartmentConfidence(
                routedDepartment,
                signals,
                evidenceResult,
                classificationResult,
                severityResult
            ),
        reasons:
            buildDepartmentReasons(
                routedDepartment,
                signals
            )
    };
};

export {
    DEPARTMENTS
};

export default department;
