# Colosseum User Validation Kit

> Goal: collect real evidence of the problem, comprehension, product usefulness, objections, and willingness to return/use/pay.  
> Target before submission: 5–10 conversations and 2–5 guided product attempts.  
> Rule: do not manufacture quotes, counts, conversion, willingness-to-pay, or traction.

## 1. Who to recruit

Prioritize people who plausibly experience the problem now:

1. Solana users who have traded or held tokenized stocks / RWAs.
2. Crypto traders who use limit/trigger orders and leave positions unattended.
3. Users who manage positions across work/sleep/time-zone constraints.
4. Wallet / trading-product builders who understand delegated or bounded execution.
5. Treasury / operator users only if they can react to the broader policy-layer thesis from real experience.

Avoid counting friends who only give generic encouragement as product validation.

## 2. 10–15 minute interview structure

### A. Current behavior — ask before showing Circuit

1. What do you use today to trade or manage tokenized assets?
2. Tell me about the last time you wanted something to happen while you were offline or away from the market.
3. How do you handle price triggers, position limits, expiry, or slippage today?
4. What is the most annoying or risky part of that workflow?
5. Have you ever missed an entry/exit or left an order you no longer wanted active? What happened?
6. What would make you uncomfortable about letting software execute while you are offline?

Do not lead with Circuit's solution language yet.

### B. Show the product

Use the live production app. Explain only what is necessary:

> You choose the asset and the rule. Circuit captures the reference, turns the rule into a fixed bounded policy, and uses an execution provider while keeping an evidence trail. It does not choose the investment for you.

If the participant is willing, let them drive the interface while you observe.

### C. Product comprehension / reaction

7. In your own words, what do you think Circuit does?
8. What part is immediately useful to you, if any?
9. What part is confusing, unnecessary, or untrustworthy?
10. Which constraint matters most: capital limit, trigger, slippage, expiry, or something else?
11. Does seeing the captured reference and audit trail make you more comfortable, less comfortable, or no different? Why?
12. Would you rather use this inside a wallet/exchange you already use or as a standalone product?

### D. Commitment questions

13. Is there a real situation in the next month where you would use this? Describe it.
14. Would you connect a wallet and create a real policy if funded execution were available? Why or why not?
15. What would have to be true before you trusted it with money?
16. If this reliably solved that problem, how would you expect to pay: free, subscription, per execution, bundled in a wallet, or something else?
17. May we follow up with you for another test?

Do not interpret a hypothetical “yes” as revenue or conversion.

## 3. Guided product-attempt task

Give the participant the goal, not click-by-click instructions:

> Create a rule to spend at most 12 USDC buying ANTHROPIC only if its trigger condition reaches a level you choose, with a clear slippage limit and expiry. Stop before authorizing any transaction that moves money.

Observe:

- Can they find Markets?
- Do they understand the reference versus token market price?
- Can they explain BUY BELOW in their own words?
- Do they understand “maximum capital”?
- Do they notice slippage and expiry?
- Do they understand the compiled trigger?
- Can they explain what Circuit will and will not decide?
- Can they locate the audit/reference evidence after saving?
- Do they understand that “Prepare Jupiter deposit” is non-money-moving?
- Where do they hesitate or ask for help?

## 4. Per-participant evidence template

Create one section per participant. Use anonymous IDs unless they explicitly consent to attribution.

### Participant `P__`

- Date:
- Relevant profile:
- Prior tokenized-stock/RWA experience:
- Prior trigger/limit-order experience:
- Interview only or product attempt:
- Problem described before seeing Circuit:
- Existing workaround:
- Severity / frequency in their words:
- What they understood Circuit to do:
- Strongest positive reaction:
- Strongest objection / trust concern:
- Confusing UI/terminology:
- Would use for a real near-term situation? `YES / MAYBE / NO`
- Reason:
- Would test again? `YES / NO`
- Payment expectation, if volunteered:
- Direct quote worth preserving (with permission):
- Follow-up action:

## 5. Validation scorecard

After at least five conversations, summarize without inflating the evidence.

| Signal | Count | Notes |
|---|---:|---|
| Experienced offline/manual-execution pain | 0 | |
| Has existing workaround | 0 | |
| Could explain Circuit accurately after demo | 0 | |
| Identified a real near-term use case | 0 | |
| Completed guided draft without major help | 0 | |
| Would return for another test | 0 | |
| Raised trust/custody concern | 0 | |
| Preferred wallet/exchange integration | 0 | |
| Expressed willingness to pay | 0 | Do not count vague “maybe” |

## 6. What good evidence looks like

Strong:

- participant independently describes a recurring problem before seeing Circuit;
- participant supplies a concrete recent example;
- participant successfully creates a policy with little help;
- participant asks to use it for a real near-term scenario;
- participant agrees to return for another test;
- participant introduces another relevant user;
- participant identifies a clear integration/distribution path from their current workflow.

Weak:

- “cool idea”;
- compliments on design;
- generic claims that automation is useful;
- friends agreeing after hearing the pitch;
- hypothetical willingness to pay without a concrete use case.

## 7. Synthesis questions for the submission

After the interviews, answer only from evidence:

1. What repeated pain appeared without prompting?
2. Which user segment felt it most strongly?
3. What do users use instead today?
4. What part of Circuit created the most trust?
5. What part created the most hesitation?
6. Did users understand the reference/execution-market distinction?
7. Is standalone Circuit the right wedge, or is integration into existing wallets/trading interfaces more compelling?
8. Which feature did users request repeatedly enough to affect roadmap priority?
9. What did we change—or deliberately not change—because of the interviews?
10. What is the strongest evidence-backed GTM entry point?

## 8. Submission-safe reporting format

Example structure once real data exists:

> We spoke with **N relevant users**, including **[segments]**. **X/N** described **[specific recurring pain]** before seeing Circuit. **Y** completed a guided policy-creation attempt, and **Z** identified a concrete near-term use case. The most common objection was **[objection]**, which changed our priority from **[old assumption]** to **[new evidence-backed priority]**.

Never fill those variables until the evidence exists.
