const fs = require("fs");
const path = require("path");
const vm = require("vm");

const moduleCache = new Map();

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

const loadDefaultModule = (
    relativePath
) => {
    const absolutePath = path.join(
        __dirname,
        relativePath
    );

    if (
        moduleCache.has(absolutePath)
    ) {
        return moduleCache.get(
            absolutePath
        );
    }

    let source = fs.readFileSync(
        absolutePath,
        "utf8"
    );

    source = source.replace(
        /export\s+\{[^}]*\};?/g,
        ""
    );

    source = source.replace(
        /export\s+default\s+([A-Za-z0-9_]+);?/g,
        "module.exports = $1;"
    );

    const context = {
        module: { exports: {} },
        exports: {},
        require,
        console,
        process,
        Date,
        Set,
        Number,
        Math,
        Array,
        Object,
        String,
        Boolean,
        RegExp
    };

    vm.runInNewContext(
        source,
        context,
        { filename: absolutePath }
    );

    moduleCache.set(
        absolutePath,
        context.module.exports
    );

    return context.module.exports;
};

const complaintParser =
    loadDefaultModule(
        "complaintParser.js"
    );
const transactionMatcher =
    loadDefaultModule(
        "transactionMatcher.js"
    );
const evidenceEngine =
    loadDefaultModule(
        "evidenceEngine.js"
    );
const classifier =
    loadDefaultModule(
        "classifier.js"
    );
const severity =
    loadDefaultModule(
        "severity.js"
    );
const department =
    loadDefaultModule(
        "department.js"
    );
const reviewDecision =
    loadDefaultModule(
        "reviewDecision.js"
    );
const confidence =
    loadDefaultModule(
        "confidence.js"
    );
const reasonCodes =
    loadDefaultModule(
        "reasonCodes.js"
    );

const formatAmount = (
    amount
) => {
    const number = Number(amount);

    if (Number.isNaN(number)) {
        return "an unspecified amount";
    }

    return `${number} BDT`;
};

const detectOutputLanguage = (
    input = {},
    parsedComplaint = {}
) => {
    const explicitLanguage = normalize(
        input.language
    );

    if (
        [
            "en",
            "bn",
            "mixed"
        ].includes(explicitLanguage)
    ) {
        return explicitLanguage;
    }

    return normalize(
        parsedComplaint.language || "en"
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

const getMatchingTransactionsByAmount = (
    parsedComplaint = {},
    transactionHistory = []
) => {
    if (
        parsedComplaint.primaryAmount === null ||
        parsedComplaint.primaryAmount === undefined
    ) {
        return [];
    }

    return transactionHistory.filter(
        transaction =>
            Number(transaction.amount) ===
            Number(
                parsedComplaint.primaryAmount
            )
    );
};

const getDuplicatePartner = (
    relevantTransaction,
    transactionHistory = []
) => {
    if (!relevantTransaction) {
        return null;
    }

    const relevantTime = new Date(
        relevantTransaction.timestamp
    ).getTime();

    return transactionHistory.find(
        transaction => {
            if (
                transaction.transaction_id ===
                relevantTransaction.transaction_id
            ) {
                return false;
            }

            const candidateTime =
                new Date(
                    transaction.timestamp
                ).getTime();

            return normalize(
                transaction.type
            ) ===
                normalize(
                    relevantTransaction.type
                ) &&
                normalize(
                    transaction.counterparty
                ) ===
                normalize(
                    relevantTransaction.counterparty
                ) &&
                Number(transaction.amount) ===
                Number(
                    relevantTransaction.amount
                ) &&
                Math.abs(
                    relevantTime -
                    candidateTime
                ) <= 300000;
        }
    ) || null;
};

const getSecondsBetween = (
    firstTimestamp,
    secondTimestamp
) => {
    const first = new Date(
        firstTimestamp
    ).getTime();
    const second = new Date(
        secondTimestamp
    ).getTime();

    if (
        Number.isNaN(first) ||
        Number.isNaN(second)
    ) {
        return null;
    }

    return Math.abs(
        Math.round(
            (second - first) / 1000
        )
    );
};

const buildWrongTransferSummary = ({
    parsedComplaint,
    evidenceResult,
    transactionHistory
}) => {
    if (
        evidenceResult.ruleSnapshot?.ambiguousMatch
    ) {
        const matchingTransactions =
            getMatchingTransactionsByAmount(
                parsedComplaint,
                transactionHistory
            );

        return `Customer reports a ${formatAmount(parsedComplaint.primaryAmount)} transfer to their intended recipient was not received. ${matchingTransactions.length} transactions of ${formatAmount(parsedComplaint.primaryAmount)} exist in the relevant history, so the exact transaction cannot be confirmed without more detail.`;
    }

    const transaction =
        evidenceResult.relevantTransaction;
    const counterparty =
        transaction?.counterparty
            ? ` to ${transaction.counterparty}`
            : "";
    const recipientNote =
        complaintIncludesAny(parsedComplaint, [
            "not responding",
            "isn't responding",
            "is not responding",
            "unresponsive"
        ])
            ? " Recipient is unresponsive."
            : "";

    if (
        evidenceResult.verdict ===
        "inconsistent"
    ) {
        return `Customer claims ${formatAmount(transaction?.amount)} transfer ${transaction?.transaction_id || ""}${counterparty} was sent to the wrong recipient, but prior history suggests this counterparty is already established.${recipientNote}`.trim();
    }

    return `Customer reports sending ${formatAmount(transaction?.amount)} via ${transaction?.transaction_id || "the matched transaction"}${counterparty} to the wrong recipient.${recipientNote}`.trim();
};

const buildPaymentFailedSummary = ({
    evidenceResult
}) => {
    const transaction =
        evidenceResult.relevantTransaction;

    return `Customer attempted a ${formatAmount(transaction?.amount)} payment (${transaction?.transaction_id || "matched transaction"}) which shows failed, but reports balance was deducted. Requires payments operations investigation.`;
};

const buildRefundSummary = ({
    evidenceResult
}) => {
    const transaction =
        evidenceResult.relevantTransaction;

    return `Customer requests refund of ${formatAmount(transaction?.amount)} for ${transaction?.transaction_id || "the matched transaction"} (merchant payment) due to change of mind. Not a service failure.`;
};

const buildPhishingSummary = ({
    parsedComplaint
}) => {
    const sharedAnything =
        complaintIncludesAny(parsedComplaint, [
            "haven't shared",
            "have not shared",
            "didn't share",
            "did not share"
        ])
            ? " Customer has not yet shared credentials."
            : "";

    return `Customer reports an unsolicited contact claiming to be from the company and asking for sensitive credentials.${sharedAnything} Likely social engineering attempt.`;
};

const buildOtherSummary = () => {
    return "Customer reports a vague concern without enough detail to identify a specific transaction or failure type.";
};

const buildAgentCashInSummary = ({
    evidenceResult
}) => {
    const transaction =
        evidenceResult.relevantTransaction;

    return `Customer reports ${formatAmount(transaction?.amount)} cash-in via ${transaction?.counterparty || "the agent"} (${transaction?.transaction_id || "matched transaction"}) not reflected in balance. Transaction status is ${transaction?.status || "unclear"}.`;
};

const buildMerchantSettlementSummary = ({
    evidenceResult
}) => {
    const transaction =
        evidenceResult.relevantTransaction;

    return `Merchant reports settlement ${transaction?.transaction_id || "matched transaction"} for ${formatAmount(transaction?.amount)} is delayed beyond the expected window. Settlement status is ${transaction?.status || "unclear"}.`;
};

const buildDuplicatePaymentSummary = ({
    evidenceResult,
    transactionHistory
}) => {
    const transaction =
        evidenceResult.relevantTransaction;
    const partner =
        getDuplicatePartner(
            transaction,
            transactionHistory
        );
    const secondsBetween =
        partner
            ? getSecondsBetween(
                partner.timestamp,
                transaction.timestamp
            )
            : null;

    if (partner) {
        return `Customer reports duplicate payment. Two identical ${formatAmount(transaction?.amount)} payments to ${transaction?.counterparty || "the same biller"} were completed ${secondsBetween ?? "moments"} seconds apart (${partner.transaction_id} and ${transaction.transaction_id}). The later transaction is likely the duplicate.`;
    }

    return `Customer reports a possible duplicate payment for ${formatAmount(transaction?.amount)} on ${transaction?.transaction_id || "the matched transaction"}.`;
};

const buildAgentSummary = ({
    classificationResult,
    parsedComplaint,
    evidenceResult,
    transactionHistory
}) => {
    switch (
        classificationResult.caseType
    ) {
        case "wrong_transfer":
            return buildWrongTransferSummary({
                parsedComplaint,
                evidenceResult,
                transactionHistory
            });

        case "payment_failed":
            return buildPaymentFailedSummary({
                evidenceResult
            });

        case "refund_request":
            return buildRefundSummary({
                evidenceResult
            });

        case "duplicate_payment":
            return buildDuplicatePaymentSummary({
                evidenceResult,
                transactionHistory
            });

        case "merchant_settlement_delay":
            return buildMerchantSettlementSummary({
                evidenceResult
            });

        case "agent_cash_in_issue":
            return buildAgentCashInSummary({
                evidenceResult
            });

        case "phishing_or_social_engineering":
            return buildPhishingSummary({
                parsedComplaint
            });

        case "other":
        default:
            return buildOtherSummary();
    }
};

const buildRecommendedNextAction = ({
    classificationResult,
    evidenceResult
}) => {
    const transactionId =
        evidenceResult.relevantTransactionId ||
        evidenceResult.relevantTransaction?.transaction_id ||
        "the reported transaction";

    switch (
        classificationResult.caseType
    ) {
        case "wrong_transfer":
            if (
                evidenceResult.ruleSnapshot?.ambiguousMatch
            ) {
                return "Reply to the customer asking for the intended recipient number or another identifying detail before initiating any dispute workflow.";
            }

            if (
                evidenceResult.verdict ===
                "inconsistent"
            ) {
                return `Flag ${transactionId} for human review and verify with the customer whether this was genuinely a wrong transfer given the prior recipient history.`;
            }

            return `Verify ${transactionId} details with the customer and initiate the wrong-transfer dispute workflow per policy.`;

        case "payment_failed":
            return `Investigate ${transactionId} ledger status. If balance was deducted on a failed payment, initiate the standard reversal flow within SLA.`;

        case "refund_request":
            return "Inform the customer that refund eligibility depends on the merchant's own policy and guide them on the appropriate merchant-facing next step.";

        case "duplicate_payment":
            return `Verify the duplicate with payments_ops. If the biller confirms only one payment was received, initiate reversal of ${transactionId}.`;

        case "merchant_settlement_delay":
            return "Route to merchant_operations to verify settlement batch status and communicate a revised ETA if the batch is delayed.";

        case "agent_cash_in_issue":
            return `Investigate ${transactionId} pending cash-in status with agent operations and confirm settlement state within the standard cash-in SLA.`;

        case "phishing_or_social_engineering":
            return "Escalate to fraud_risk immediately, confirm that official teams never ask for OTP or PIN, and log the reported contact for pattern analysis.";

        case "other":
        default:
            return "Reply to the customer asking for the transaction ID, amount, approximate time, and a short description of what went wrong before proceeding.";
    }
};

const buildCustomerReplyEnglish = ({
    classificationResult,
    evidenceResult
}) => {
    const transactionId =
        evidenceResult.relevantTransactionId ||
        evidenceResult.relevantTransaction?.transaction_id;

    switch (
        classificationResult.caseType
    ) {
        case "wrong_transfer":
            if (
                evidenceResult.ruleSnapshot?.ambiguousMatch
            ) {
                return "Thank you for reaching out. We see multiple possible transactions in the provided history. Please share the intended recipient number or another identifying detail so we can locate the correct transaction. Please do not share your PIN or OTP with anyone.";
            }

            return `We have noted your concern${transactionId ? ` about transaction ${transactionId}` : ""}. Please do not share your PIN or OTP with anyone. Our dispute team will review the case and contact you through official support channels.`;

        case "payment_failed":
            return `We have noted${transactionId ? ` transaction ${transactionId}` : " the reported payment"} and our payments team will review whether any unexpected balance deduction occurred. Any eligible amount will be returned through official channels. Please do not share your PIN or OTP with anyone.`;

        case "refund_request":
            return "Thank you for reaching out. Refunds for completed merchant payments depend on the merchant's own policy. We recommend contacting the merchant directly for refund eligibility. Please do not share your PIN or OTP with anyone.";

        case "duplicate_payment":
            return `We have noted the possible duplicate payment${transactionId ? ` for transaction ${transactionId}` : ""}. Our payments team will verify with the biller and any eligible amount will be returned through official channels. Please do not share your PIN or OTP with anyone.`;

        case "merchant_settlement_delay":
            return `We have noted your concern${transactionId ? ` about settlement ${transactionId}` : ""}. Our merchant operations team will check the batch status and update you on the expected settlement time through official channels.`;

        case "agent_cash_in_issue":
            return `We have noted${transactionId ? ` transaction ${transactionId}` : " your cash-in concern"}. Our agent operations team will verify the issue and update you through official channels. Please do not share your PIN or OTP with anyone.`;

        case "phishing_or_social_engineering":
            return "Thank you for reaching out before sharing any information. We never ask for your PIN, OTP, or password under any circumstances. Please do not share these with anyone, even if they claim to be from us. Our fraud team has been notified of this incident.";

        case "other":
        default:
            return "Thank you for reaching out. To help you faster, please share the transaction ID, the amount involved, the approximate time, and what went wrong. Please do not share your PIN or OTP with anyone.";
    }
};

const buildCustomerReplyBangla = ({
    classificationResult,
    evidenceResult
}) => {
    const transactionId =
        evidenceResult.relevantTransactionId ||
        evidenceResult.relevantTransaction?.transaction_id;

    switch (
        classificationResult.caseType
    ) {
        case "agent_cash_in_issue":
            return `আপনার ${transactionId ? `লেনদেন ${transactionId}` : "ক্যাশ ইন"} বিষয়ে আমরা অবগত হয়েছি। আমাদের এজেন্ট অপারেশন্স দল এটি দ্রুত যাচাই করবে এবং অফিসিয়াল চ্যানেলে আপনাকে জানাবে। অনুগ্রহ করে কারো সাথে আপনার পিন বা ওটিপি শেয়ার করবেন না।`;

        case "phishing_or_social_engineering":
            return "আপনি তথ্য শেয়ার করার আগে আমাদের জানিয়েছেন, এজন্য ধন্যবাদ। আমরা কখনোই আপনার পিন, ওটিপি বা পাসওয়ার্ড চাই না। অনুগ্রহ করে এগুলো কারো সাথে শেয়ার করবেন না, কেউ আমাদের পরিচয় দিলেও নয়। আমাদের ফ্রড টিম বিষয়টি নোট করেছে।";

        case "wrong_transfer":
            if (
                evidenceResult.ruleSnapshot?.ambiguousMatch
            ) {
                return "ধন্যবাদ যোগাযোগ করার জন্য। সঠিক লেনদেনটি শনাক্ত করতে অনুগ্রহ করে প্রাপকের নম্বর বা আরেকটি শনাক্তকারী তথ্য দিন। অনুগ্রহ করে কারো সাথে আপনার পিন বা ওটিপি শেয়ার করবেন না।";
            }

            return `আপনার ${transactionId ? `লেনদেন ${transactionId}` : "অভিযোগ"} আমরা নোট করেছি। অনুগ্রহ করে কারো সাথে আপনার পিন বা ওটিপি শেয়ার করবেন না। আমাদের ডিসপিউট টিম বিষয়টি অফিসিয়াল চ্যানেলে রিভিউ করবে।`;

        default:
            return buildCustomerReplyEnglish({
                classificationResult,
                evidenceResult
            });
    }
};

const buildCustomerReply = ({
    outputLanguage,
    classificationResult,
    evidenceResult
}) => {
    if (outputLanguage === "bn") {
        return buildCustomerReplyBangla({
            classificationResult,
            evidenceResult
        });
    }

    return buildCustomerReplyEnglish({
        classificationResult,
        evidenceResult
    });
};

const sanitizeConfidence = (
    confidenceResult = {}
) => {
    return Number(
        clamp(
            Number(
                confidenceResult.confidence
            ) || 0.5,
            0,
            1
        ).toFixed(2)
    );
};

const investigate = async (
    input = {}
) => {
    const transactionHistory =
        Array.isArray(
            input.transaction_history
        )
            ? input.transaction_history
            : [];

    const parsedComplaint =
        complaintParser(
            input.complaint || ""
        );

    parsedComplaint.userType =
        input.user_type || "unknown";
    parsedComplaint.channel =
        input.channel || null;
    parsedComplaint.inputLanguage =
        input.language || null;

    const transactionMatch =
        transactionMatcher(
            parsedComplaint,
            transactionHistory
        );

    const evidenceResult =
        evidenceEngine(
            parsedComplaint,
            transactionMatch,
            transactionHistory
        );

    const classificationResult =
        classifier(
            parsedComplaint,
            evidenceResult,
            transactionHistory,
            transactionMatch.relevantTransaction
        );

    const severityResult =
        severity(
            parsedComplaint,
            evidenceResult,
            classificationResult
        );

    const departmentResult =
        department(
            parsedComplaint,
            evidenceResult,
            classificationResult,
            severityResult
        );

    const reviewDecisionResult =
        reviewDecision(
            parsedComplaint,
            evidenceResult,
            classificationResult,
            severityResult,
            departmentResult
        );

    const confidenceResult =
        confidence({
            parsedComplaint,
            transactionMatch,
            evidenceResult,
            classificationResult,
            severityResult,
            departmentResult,
            reviewDecisionResult
        });

    const reasonCodesResult =
        reasonCodes({
            parsedComplaint,
            transactionMatch,
            evidenceResult,
            classificationResult,
            severityResult,
            departmentResult,
            reviewDecisionResult,
            confidenceResult
        });

    const outputLanguage =
        detectOutputLanguage(
            input,
            parsedComplaint
        );

    const response = {
        ticket_id: input.ticket_id,
        relevant_transaction_id:
            evidenceResult.relevantTransactionId ??
            null,
        evidence_verdict:
            evidenceResult.verdict,
        case_type:
            classificationResult.caseType,
        severity:
            severityResult.severity,
        department:
            departmentResult.department,
        agent_summary:
            buildAgentSummary({
                classificationResult,
                parsedComplaint,
                evidenceResult,
                transactionHistory
            }),
        recommended_next_action:
            buildRecommendedNextAction({
                classificationResult,
                evidenceResult
            }),
        customer_reply:
            buildCustomerReply({
                outputLanguage,
                classificationResult,
                evidenceResult
            }),
        human_review_required:
            reviewDecisionResult.humanReviewRequired,
        confidence:
            sanitizeConfidence(
                confidenceResult
            ),
        reason_codes:
            reasonCodesResult.reasonCodes
    };

    return response;
};

module.exports = {
    investigate
};
