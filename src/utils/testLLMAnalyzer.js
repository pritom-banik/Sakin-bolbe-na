/**
 * testLLMAnalyzer.js
 *
 * Interactive CLI test runner for analyzeWithLLM.
 *
 * Usage:
 *   node src/utils/testLLMAnalyzer.js          → interactive prompt (pick 1-10)
 *   node src/utils/testLLMAnalyzer.js 3        → run sample #3 directly
 *
 * Requires GROQ_API_KEY in .env (or environment).
 */

'use strict';

require('dotenv').config();
const readline = require('readline');
const { analyzeWithLLM } = require('./llmAnalyzer');

// ──────────────────────────────────────────────────────────────
// All 10 sample test cases from the hackathon spec
// ──────────────────────────────────────────────────────────────

const SAMPLES = [
    {
        label: 'TKT-001 — Wrong Transfer (consistent evidence)',
        payload: {
            ticket_id: 'TKT-001',
            complaint: 'I sent 5000 taka to a wrong number around 2pm today. The number was supposed to be 01712345678 but I think I typed it wrong. The person isn\'t responding to my call. Please help me get my money back.',
            language: 'en',
            channel: 'in_app_chat',
            user_type: 'customer',
            campaign_context: 'boishakh_bonanza_day_1',
            transaction_history: [
                {
                    transaction_id: 'TXN-9101',
                    timestamp: '2026-04-14T14:08:22Z',
                    type: 'transfer',
                    amount: 5000,
                    counterparty: '+8801719876543',
                    status: 'completed',
                },
                {
                    transaction_id: 'TXN-9087',
                    timestamp: '2026-04-13T18:12:00Z',
                    type: 'cash_in',
                    amount: 10000,
                    counterparty: 'AGENT-512',
                    status: 'completed',
                },
            ],
        },
    },
    {
        label: 'TKT-002 — Wrong Transfer Claim (inconsistent — established recipient)',
        payload: {
            ticket_id: 'TKT-002',
            complaint: 'I sent 2000 to the wrong person by mistake. Please reverse it.',
            language: 'en',
            channel: 'in_app_chat',
            user_type: 'customer',
            transaction_history: [
                { transaction_id: 'TXN-9202', timestamp: '2026-04-14T11:30:00Z', type: 'transfer', amount: 2000, counterparty: '+8801812345678', status: 'completed' },
                { transaction_id: 'TXN-9180', timestamp: '2026-04-10T09:15:00Z', type: 'transfer', amount: 2500, counterparty: '+8801812345678', status: 'completed' },
                { transaction_id: 'TXN-9145', timestamp: '2026-04-05T17:45:00Z', type: 'transfer', amount: 1500, counterparty: '+8801812345678', status: 'completed' },
            ],
        },
    },
    {
        label: 'TKT-003 — Failed Payment (balance deducted)',
        payload: {
            ticket_id: 'TKT-003',
            complaint: 'I tried to pay 1200 taka for my mobile recharge but the app showed failed. But my balance was deducted! Please refund my money.',
            language: 'en',
            channel: 'in_app_chat',
            user_type: 'customer',
            transaction_history: [
                { transaction_id: 'TXN-9301', timestamp: '2026-04-14T16:00:00Z', type: 'payment', amount: 1200, counterparty: 'MERCHANT-MOBILE-OP', status: 'failed' },
            ],
        },
    },
    {
        label: 'TKT-004 — Refund Request (change of mind)',
        payload: {
            ticket_id: 'TKT-004',
            complaint: 'I paid 500 to a merchant for a product but I changed my mind and don\'t want it anymore. Please refund my 500 taka.',
            language: 'en',
            channel: 'in_app_chat',
            user_type: 'customer',
            transaction_history: [
                { transaction_id: 'TXN-9401', timestamp: '2026-04-14T13:00:00Z', type: 'payment', amount: 500, counterparty: 'MERCHANT-7821', status: 'completed' },
            ],
        },
    },
    {
        label: 'TKT-005 — Phishing / Social Engineering',
        payload: {
            ticket_id: 'TKT-005',
            complaint: 'Someone called me saying they are from bKash and asked for my OTP. They said my account will be blocked if I don\'t share it. Is this real? I haven\'t shared anything yet.',
            language: 'en',
            channel: 'call_center',
            user_type: 'customer',
            transaction_history: [],
        },
    },
    {
        label: 'TKT-006 — Vague Complaint (insufficient evidence)',
        payload: {
            ticket_id: 'TKT-006',
            complaint: 'Something is wrong with my money. Please check.',
            language: 'en',
            channel: 'in_app_chat',
            user_type: 'customer',
            transaction_history: [
                { transaction_id: 'TXN-9601', timestamp: '2026-04-13T10:00:00Z', type: 'cash_in', amount: 3000, counterparty: 'AGENT-220', status: 'completed' },
                { transaction_id: 'TXN-9602', timestamp: '2026-04-12T15:30:00Z', type: 'transfer', amount: 800, counterparty: '+8801911223344', status: 'completed' },
            ],
        },
    },
    {
        label: 'TKT-007 — Agent Cash-In Issue (Bangla complaint)',
        payload: {
            ticket_id: 'TKT-007',
            complaint: 'আমি আজ সকালে এজেন্টের কাছে ২০০০ টাকা ক্যাশ ইন করেছি কিন্তু আমার ব্যালেন্সে টাকা আসেনি। এজেন্ট বলছে টাকা পাঠিয়েছে কিন্তু আমি দেখছি না।',
            language: 'bn',
            channel: 'call_center',
            user_type: 'customer',
            transaction_history: [
                { transaction_id: 'TXN-9701', timestamp: '2026-04-14T09:30:00Z', type: 'cash_in', amount: 2000, counterparty: 'AGENT-318', status: 'pending' },
            ],
        },
    },
    {
        label: 'TKT-008 — Ambiguous Transaction Match (multiple candidates)',
        payload: {
            ticket_id: 'TKT-008',
            complaint: 'I sent 1000 to my brother yesterday but he says he didn\'t get it. Please check.',
            language: 'en',
            channel: 'in_app_chat',
            user_type: 'customer',
            transaction_history: [
                { transaction_id: 'TXN-9801', timestamp: '2026-04-13T11:20:00Z', type: 'transfer', amount: 1000, counterparty: '+8801712001122', status: 'completed' },
                { transaction_id: 'TXN-9802', timestamp: '2026-04-13T19:45:00Z', type: 'transfer', amount: 1000, counterparty: '+8801812334455', status: 'completed' },
                { transaction_id: 'TXN-9803', timestamp: '2026-04-13T20:10:00Z', type: 'transfer', amount: 1000, counterparty: '+8801712001122', status: 'failed' },
            ],
        },
    },
    {
        label: 'TKT-009 — Merchant Settlement Delay',
        payload: {
            ticket_id: 'TKT-009',
            complaint: 'I am a merchant. My yesterday\'s sales of 15000 taka have not been settled to my account. Settlement usually happens by 11am next day. Please check.',
            language: 'en',
            channel: 'merchant_portal',
            user_type: 'merchant',
            transaction_history: [
                { transaction_id: 'TXN-9901', timestamp: '2026-04-13T18:00:00Z', type: 'settlement', amount: 15000, counterparty: 'MERCHANT-SELF', status: 'pending' },
            ],
        },
    },
    {
        label: 'TKT-010 — Duplicate Payment (electricity bill)',
        payload: {
            ticket_id: 'TKT-010',
            complaint: 'I paid my electricity bill 850 taka but it deducted twice from my account. Please check, I only paid once.',
            language: 'en',
            channel: 'in_app_chat',
            user_type: 'customer',
            transaction_history: [
                { transaction_id: 'TXN-10001', timestamp: '2026-04-14T08:15:30Z', type: 'payment', amount: 850, counterparty: 'BILLER-DESCO', status: 'completed' },
                { transaction_id: 'TXN-10002', timestamp: '2026-04-14T08:15:42Z', type: 'payment', amount: 850, counterparty: 'BILLER-DESCO', status: 'completed' },
            ],
        },
    },
];

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

function printMenu() {
    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║         QueueStorm Investigator — LLM Test Runner        ║');
    console.log('╠══════════════════════════════════════════════════════════╣');
    SAMPLES.forEach((s, i) => {
        console.log(`║  [${i + 1}]  ${s.label.padEnd(52)}║`);
    });
    console.log('╚══════════════════════════════════════════════════════════╝');
}

function printSeparator(title = '') {
    const line = '─'.repeat(60);
    if (title) {
        const pad = Math.floor((60 - title.length - 2) / 2);
        console.log(`\n${'─'.repeat(pad)} ${title} ${'─'.repeat(60 - pad - title.length - 2)}`);
    } else {
        console.log(`\n${line}`);
    }
}

async function runSample(index) {
    const sample = SAMPLES[index];
    console.log(`\n🔍 Running: ${sample.label}`);
    printSeparator('INPUT PAYLOAD');
    console.log(JSON.stringify(sample.payload, null, 2));

    printSeparator('CALLING analyzeWithLLM ...');
    const start = Date.now();

    const result = await analyzeWithLLM(sample.payload);

    const elapsed = ((Date.now() - start) / 1000).toFixed(2);
    printSeparator(`RESULT  (${elapsed}s)`);
    console.log(JSON.stringify(result, null, 2));
    printSeparator();
}

async function promptAndRun() {
    printMenu();

    const rl = readline.createInterface({
        input : process.stdin,
        output: process.stdout,
    });

    rl.question('\nEnter sample number (1-10): ', async (answer) => {
        rl.close();
        const num = parseInt(answer.trim(), 10);
        if (isNaN(num) || num < 1 || num > 10) {
            console.error('❌  Invalid choice. Please enter a number between 1 and 10.');
            process.exit(1);
        }
        await runSample(num - 1);
    });
}

// ──────────────────────────────────────────────────────────────
// Entry point
// ──────────────────────────────────────────────────────────────

(async () => {
    try {
        const arg = process.argv[2];

        if (arg) {
            // Direct mode: node testLLMAnalyzer.js <1-10>
            const num = parseInt(arg, 10);
            if (isNaN(num) || num < 1 || num > 10) {
                console.error('❌  Usage: node testLLMAnalyzer.js [1-10]');
                process.exit(1);
            }
            await runSample(num - 1);
        } else {
            // Interactive mode
            await promptAndRun();
        }
    } catch (err) {
        console.error('\n❌  Error:', err.message);
        process.exit(1);
    }
})();
