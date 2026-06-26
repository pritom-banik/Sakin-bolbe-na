
// Parse customer complaints and extract structured information from English, Bangla and Banglish text.
 

// Normalization

const normalizeText = (text = "") => {
    return text
        .toString()
        .toLowerCase()
        .replace(/\r/g, " ")
        .replace(/\n/g, " ")
        .replace(/\t/g, " ")
        .replace(/[“”"]/g, "")
        .replace(/[‘’']/g, "")
        .replace(/[।]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
};

// Regex

const PHONE_REGEX =
    /(?:\+?88)?01[3-9]\d{8}/g;

const AMOUNT_REGEX =
    /\b\d{2,9}(?:\.\d+)?\b/g;

const TIME_REGEX =
    /\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/g;

const MERCHANT_REGEX =
    /\bmerchant[-_ ]?[a-z0-9]+\b/gi;

const AGENT_REGEX =
    /\bagent[-_ ]?[a-z0-9]+\b/gi;

// Transaction types

const TRANSACTION_TYPES = {

    transfer: [
        "transfer",
        "send",
        "sent",
        "money send",
        "send money",
        "wrong transfer",
        "wrong number",
        "টাকা পাঠিয়েছি",
        "টাকা পাঠাইছি",
        "পাঠিয়েছি",
        "ভুল নম্বরে",
        "ভুল নাম্বারে",
        "vul number",
        "vul transfer"
    ],
    payment: [
        "payment",
        "pay",
        "paid",
        "merchant",
        "bill",
        "recharge",
        "পেমেন্ট",
        "বিল",
        "রিচার্জ",
        "merchant payment"
    ],
    refund: [
        "refund",
        "money back",
        "return money",
        "রিফান্ড",
        "ফেরত",
        "ফিরিয়ে দিন",
        "tk back"
    ],
    cash_in: [
        "cash in",
        "cashin",
        "deposit",
        "ক্যাশ ইন",
        "ডিপোজিট"
    ],
    cash_out: [
        "cash out",
        "cashout",
        "withdraw",
        "উত্তোলন",
        "ক্যাশ আউট"
    ]

};

// Complaint Categories

const CASE_HINTS = {
    wrong_transfer: [
        "wrong transfer",
        "wrong number",
        "ভুল নম্বরে",
        "ভুল নাম্বারে",
        "vul number"
    ],
    payment_failed: [
        "payment failed",
        "failed",
        "deducted",
        "balance deducted",
        "পেমেন্ট হয়নি",
        "কেটে নিয়েছে"
    ],
    refund_request: [
        "refund",
        "money back",
        "রিফান্ড",
        "ফেরত"
    ],
    duplicate_payment: [
        "duplicate",
        "charged twice",
        "double payment",
        "দুইবার",
        "দুবার"
    ],
    merchant_settlement_delay: [
        "settlement",
        "merchant settlement",
        "merchant balance"
    ],
    agent_cash_in_issue: [
        "cash in",
        "agent",
        "agent issue",
        "agent problem"
    ],
    phishing_or_social_engineering: [
        "otp",
        "pin",
        "password",
        "scam",
        "fraud",
        "fake call",
        "otp চাইছে",
        "pin চাইছে",
        "password চাইছে"
    ]
};

// Risk Keywords

const RISK_KEYWORDS = [
    "otp",
    "pin",
    "password",
    "scam",
    "fraud",
    "fake",
    "otp চাইছে",
    "pin চাইছে",
    "password চাইছে",
    "স্ক্যাম",
    "প্রতারণা",
    "প্রতারক",
    "hack",
    "hacked",
    "account blocked",
    "account suspended"
];

// Severity Hints

const SEVERITY_HINTS = {
    critical: [
        "otp",
        "pin",
        "password",
        "fraud",
        "scam"
    ],
    high: [
        "wrong transfer",
        "payment failed",
        "balance deducted",
        "cash out"
    ],
    medium: [
        "refund",
        "merchant",
        "settlement"
    ],
    low: [
        "query",
        "question",
        "information"
    ]
};

// Department Mapping Hints

const DEPARTMENT_HINTS = {
    wrong_transfer: "dispute_resolution",
    payment_failed: "payments_ops",
    duplicate_payment: "payments_ops",
    refund_request: "customer_support",
    merchant_settlement_delay:
        "merchant_operations",
    agent_cash_in_issue:
        "agent_operations",
    phishing_or_social_engineering:
        "fraud_risk",
    other:
        "customer_support"
};

// Stop Words

const STOP_WORDS = [
    "i",
    "me",
    "my",
    "the",
    "a",
    "an",
    "to",
    "is",
    "are",
    "was",
    "were",
    "ami",
    "amar",
    "amake",
    "amarer",
    "theke",
    "kore",
    "korchi",
    "korsi"
];

// Bangla / Banglish Dictionary 

const BANGLA_KEYWORDS = {

    transfer: [
        "টাকা পাঠিয়েছি",
        "টাকা পাঠাইছি",
        "পাঠিয়েছি",
        "পাঠাইছি",
        "ভুল নম্বরে",
        "ভুল নাম্বারে"
    ],

    payment: [
        "পেমেন্ট",
        "বিল",
        "রিচার্জ"
    ],

    refund: [
        "রিফান্ড",
        "ফেরত",
        "ফিরিয়ে দিন",
        "টাকা ফেরত"
    ],

    cash_in: [
        "ক্যাশ ইন",
        "ডিপোজিট"
    ],

    cash_out: [
        "ক্যাশ আউট",
        "উত্তোলন"
    ],

    phishing: [
        "ওটিপি",
        "পিন",
        "পাসওয়ার্ড",
        "স্ক্যাম",
        "প্রতারক"
    ]

};

const BANGLISH_KEYWORDS = {

    transfer: [
        "vul number",
        "vul transfer",
        "taka pathaisi",
        "wrong num"
    ],

    payment: [
        "bill pay",
        "recharge",
        "merchant payment"
    ],

    refund: [
        "refund",
        "tk back",
        "money back"
    ],

    phishing: [
        "otp dise",
        "otp chaise",
        "pin chaise",
        "password chaise",
        "fake call"
    ]

};

// Language Detection

const detectLanguage = (text) => {

    const hasBangla =
        /[\u0980-\u09FF]/.test(text);

    const hasEnglish =
        /[a-z]/i.test(text);

    if (hasBangla && hasEnglish) {
        return "mixed";
    }

    if (hasBangla) {
        return "bn";
    }

    return "en";
};

// Tokenizer

const tokenize = (text) => {

    return normalizeText(text)
        .split(" ")
        .filter(word => word.length > 1)
        .filter(word => !STOP_WORDS.includes(word));

};

// Duplicate Remover

const unique = (array = []) => {

    return [...new Set(array)];

};

// Generic Keyword Matching Helper

const containsKeyword = (text, keywords = []) => {

    return keywords.some(keyword =>
        text.includes(keyword.toLowerCase())
    );

};

// Extract Amount(s)
// Extract all monetary amounts from complaint
const extractAmounts = (text) => {

    const matches = text.match(AMOUNT_REGEX);

    if (!matches) {
        return [];
    }

    return unique(
        matches
            .map(value => Number(value))
            .filter(value => !Number.isNaN(value))
    );

};

// Extract Phone Number(s)  
// Extract all phone numbers from complaint
const extractPhoneNumbers = (text) => {

    const matches = text.match(PHONE_REGEX);

    if (!matches) {
        return [];
    }

    return unique(matches);

};

// Extract Merchant IDs
// Extract merchant IDs if available
const extractMerchantIds = (text) => {

    const matches = text.match(MERCHANT_REGEX);

    if (!matches) {
        return [];
    }

    return unique(matches);

};

// Extract Agent IDs 
// Extract agent IDs if available
const extractAgentIds = (text) => {

    const matches = text.match(AGENT_REGEX);

    if (!matches) {
        return [];
    }

    return unique(matches);

};

// Extract Time                                                    

const extractExplicitTime = (text) => {

    const matches = text.match(TIME_REGEX);

    if (!matches) {
        return null;
    }

    return matches[0];

};

// Extract Relative Time
// Detect relative time keywords

const extractRelativeTime = (text) => {

    const relativeTimeKeywords = [

        "today",
        "yesterday",
        "tonight",
        "this morning",
        "this afternoon",
        "this evening",

        "আজ",
        "আজকে",
        "গতকাল",
        "সকালে",
        "বিকালে",
        "রাতে"

    ];

    for (const keyword of relativeTimeKeywords) {

        if (text.includes(keyword)) {

            return keyword;

        }

    }

    return null;

};

// Extract Time Wrapper
// Returns explicit time first
// Otherwise returns relative time

const extractTime = (text) => {

    const explicitTime =
        extractExplicitTime(text);

    if (explicitTime) {

        return explicitTime;

    }

    return extractRelativeTime(text);

};


// Detect transaction type from complaint

const detectTransactionType = (text) => {

    const normalizedText = normalizeText(text);

    let bestType = "unknown";
    let highestScore = 0;

    for (const [type, keywords] of Object.entries(TRANSACTION_TYPES)) {

        let score = 0;

        for (const keyword of keywords) {

            if (normalizedText.includes(keyword.toLowerCase())) {
                score++;
            }

        }

        if (score > highestScore) {
            highestScore = score;
            bestType = type;
        }

    }

    return bestType;

};

// Detect probable case type

const detectCaseHint = (text) => {

    const normalizedText = normalizeText(text);

    let detectedCase = "other";
    let highestScore = 0;

    for (const [caseType, keywords] of Object.entries(CASE_HINTS)) {

        let score = 0;

        for (const keyword of keywords) {

            if (normalizedText.includes(keyword.toLowerCase())) {
                score++;
            }

        }

        if (score > highestScore) {

            highestScore = score;
            detectedCase = caseType;

        }

    }

    return detectedCase;

};


// Detect security related complaints

const detectRiskKeywords = (text) => {

    const normalizedText = normalizeText(text);

    const detectedKeywords = [];

    for (const keyword of RISK_KEYWORDS) {

        if (
            normalizedText.includes(keyword.toLowerCase())
        ) {

            detectedKeywords.push(keyword);

        }

    }

    return unique(detectedKeywords);

};

// Build parser flags

const buildFlags = (text) => {

    const normalizedText =
        normalizeText(text);

    const risks =
        detectRiskKeywords(normalizedText);

    return {

        hasRisk: risks.length > 0,

        hasOTP:
            normalizedText.includes("otp") ||
            normalizedText.includes("ওটিপি"),

        hasPIN:
            normalizedText.includes("pin") ||
            normalizedText.includes("পিন"),

        hasPassword:
            normalizedText.includes("password") ||
            normalizedText.includes("পাসওয়ার্ড"),

        hasRefund:
            normalizedText.includes("refund") ||
            normalizedText.includes("রিফান্ড"),

        hasWrongTransfer:
            detectCaseHint(normalizedText) ===
            "wrong_transfer",

        hasFailedPayment:
            detectCaseHint(normalizedText) ===
            "payment_failed",

        hasDuplicatePayment:
            detectCaseHint(normalizedText) ===
            "duplicate_payment",

        hasMerchant:

            normalizedText.includes("merchant") ||

            normalizedText.includes("মার্চেন্ট"),

        hasAgent:

            normalizedText.includes("agent") ||

            normalizedText.includes("এজেন্ট")

    };

};

// Calculate parser confidence

const calculateParserConfidence = (parsedData) => {

    let score = 0;

    if (parsedData.amounts.length)
        score += 20;

    if (parsedData.phoneNumbers.length)
        score += 20;

    if (parsedData.transactionType !== "unknown")
        score += 20;

    if (parsedData.caseHint !== "other")
        score += 20;

    if (parsedData.time)
        score += 10;

    if (parsedData.riskKeywords.length)
        score += 10;

    return Math.min(score / 100, 1);

};

const complaintParser = (complaint = "") => {

    // Normalize complaint
    const normalizedComplaint =
        normalizeText(complaint);

    // Detect language
    const language =
        detectLanguage(normalizedComplaint);

    // Tokenize complaint
    const tokens =
        tokenize(normalizedComplaint);

    // Extract entities
    const amounts =
        extractAmounts(normalizedComplaint);

    const phoneNumbers =
        extractPhoneNumbers(normalizedComplaint);

    const merchantIds =
        extractMerchantIds(normalizedComplaint);

    const agentIds =
        extractAgentIds(normalizedComplaint);

    const time =
        extractTime(normalizedComplaint);

    // Detect transaction information
    const transactionType =
        detectTransactionType(normalizedComplaint);

    const caseHint =
        detectCaseHint(normalizedComplaint);

    // Detect risks
    const riskKeywords =
        detectRiskKeywords(normalizedComplaint);

    // Build flags
    const flags =
        buildFlags(normalizedComplaint);

    // Build parser object
    const parsedComplaint = {

        originalComplaint: complaint,

        normalizedComplaint,

        language,

        tokens,

        amounts,

        primaryAmount:
            amounts.length
                ? amounts[0]
                : null,

        phoneNumbers,

        primaryPhoneNumber:
            phoneNumbers.length
                ? phoneNumbers[0]
                : null,

        merchantIds,

        primaryMerchantId:
            merchantIds.length
                ? merchantIds[0]
                : null,

        agentIds,

        primaryAgentId:
            agentIds.length
                ? agentIds[0]
                : null,

        time,

        transactionType,

        caseHint,

        riskKeywords,

        flags

    };

    // Calculate parser confidence

    parsedComplaint.confidence =
        calculateParserConfidence(
            parsedComplaint
        );

    return parsedComplaint;

};

export default complaintParser;