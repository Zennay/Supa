# SUPA M4 participant screener, information & consent pack

## Status and hard gate

This is **protocol preparation only**. Do not recruit, consent, enrol or run a participant while **PWQ-14 / AUD-003 (M3)** is open.

Before first use:
- M3 must be closed with the required genuine same-demand two-store basket evidence;
- the M4 protocol version must be locked;
- a private researcher contact channel must be filled in below;
- the approved private location for raw contact/consent/interview material must be named;
- instrumentation must pass the existing fail-closed M4 session validator.

Repository-safe outputs must remain pseudonymous. Names, email addresses, phone numbers, raw consent records, raw receipts and identifying interview notes must not be committed.

---

## 1. Eligibility screener

Use this only after the M3 gate closes.

### Inclusion criteria

A participant is eligible when all are true:
- age 18 or older;
- currently a student;
- lives independently from parents/guardians for most of the week;
- personally makes at least some meal-planning and grocery-buying decisions;
- expects to buy groceries and prepare at least some meals during the study period;
- can complete the study in the supported language;
- gives informed consent before any research session or identifiable data capture.

### Variation to preserve

Do not recruit only highly organised planners. Aim for variation across:
- strict vs flexible grocery budgets;
- planned vs ad-hoc shopping;
- low vs high cooking confidence;
- stable vs changing weekly schedules;
- solo cooking vs shared meals.

### Exclusion criteria

Do not enrol when:
- the person is under 18;
- someone else makes essentially all meal/grocery decisions for them;
- they cannot reasonably complete the study period;
- consent is not freely given or is withdrawn.

### Screener questions

1. Are you 18 or older? **Yes / No**
2. Are you currently a student? **Yes / No**
3. Do you live independently from your parents/guardians for most of the week? **Yes / No**
4. Do you personally decide at least some of what you eat and buy for groceries? **Yes / No**
5. How do you normally plan meals? **Mostly planned / mixed / mostly spontaneous**
6. How would you describe your weekly grocery budget? **Strict / somewhat flexible / no fixed budget**
7. How predictable is your weekly schedule? **Mostly predictable / mixed / often changes**
8. How confident are you cooking for yourself? **1–5**

Only the eligibility result and non-identifying study segmentation needed for sampling may be copied into the pseudonymous study record.

---

## 2. Participant information

### What is SUPA?

SUPA is a grocery-planning prototype for independently living students. It helps turn a weekly meal plan into a shopping list and compares the resulting basket while trying to reduce planning effort.

### Why are we doing this study?

The study tests whether SUPA:
- reduces planning effort;
- remains flexible when a week changes;
- makes ingredient reuse useful rather than repetitive;
- explains basket recommendations clearly enough to trust;
- provides useful value even when the cheapest-looking option is not the participant's preferred option.

The study is exploratory. It does not assume SUPA saves money for everyone.

### What will participation involve?

A participant may be asked to:
- describe their normal planning method;
- complete a weekly plan and shopping list with SUPA;
- use that plan during normal life;
- record schedule changes, plan repairs and meal outcomes;
- record or provide a privacy-safe basket outcome;
- answer short rating questions;
- take part in a brief interview about friction, usefulness and trust.

The intended study shape is a baseline plus repeated SUPA-assisted weeks where practical. Partial or negative outcomes remain valid research evidence.

### What data may be collected?

The protocol may collect:
- pseudonymous participant/study-week keys;
- time to complete planning;
- number of explicit meal decisions and list edits;
- repair attempts and repair duration;
- meal adherence outcomes;
- leftover/reuse outcomes;
- basket outcome: better / same / worse / unknown;
- explanation/trust and planning-effort ratings;
- return-intent rating;
- privacy-reviewed qualitative notes.

### What is deliberately not stored in the public repository?

Do not commit:
- participant names;
- email addresses or phone numbers;
- account identifiers;
- raw consent records;
- raw receipts containing personal data;
- raw interview recordings;
- free-text notes that can identify a participant.

Contact details and raw consent material, if needed, must be stored separately in the approved private location.

### Voluntary participation

Participation is voluntary. A participant may:
- skip a question;
- stop a session;
- withdraw from further participation.

Before beta execution starts, the researcher must define and communicate the practical withdrawal boundary for already-derived, de-identified/aggregated results.

### Risks and expectations

SUPA is a research prototype. It may:
- recommend an inconvenient or more expensive basket;
- contain unavailable or unresolved product lines;
- require manual correction;
- fail to improve planning effort.

Participants should continue to make their own purchase and food decisions. The study must not present SUPA as financial, dietary or medical advice.

### Questions or concerns

Researcher contact: **[PRIVATE CONTACT CHANNEL REQUIRED BEFORE RECRUITMENT]**

Raw research storage location: **[APPROVED PRIVATE LOCATION REQUIRED BEFORE RECRUITMENT]**

---

## 3. Consent checklist

Capture consent privately before creating a real M4 session record.

The participant confirms:

- [ ] I am 18 or older.
- [ ] I have read or heard the participant information above.
- [ ] I understand this is an exploratory prototype study and savings are not guaranteed.
- [ ] I understand participation is voluntary and I can stop participating.
- [ ] I understand which study data may be collected.
- [ ] I understand that contact/consent material is kept separate from repository-safe pseudonymous outputs.
- [ ] I understand that negative, worse and unknown outcomes may be retained as research evidence.
- [ ] I agree to participate in the SUPA private beta study.

Private consent record fields:
- consent date/time;
- protocol version;
- participant name or signed identifier, if required by the chosen consent method;
- consent outcome;
- withdrawal/contact instructions presented.

Do not copy those private fields into Git.

---

## 4. Pseudonymous enrolment handoff

Only after consent succeeds:

1. Generate a pseudonymous participant key outside the repository.
2. Keep the identity-to-key mapping in the approved private location only.
3. Create the first M4 study record using the pseudonymous key.
4. Set `m3Gate.status` to `closed` and include the real M3 evidence reference.
5. Validate the session contract before accepting evidence:

```bash
npm run m4:validate-beta-session -- evidence/m4/<session>.json --output artifacts/m4/<session>-summary.json
```

6. Commit only privacy-safe derived artifacts when the protocol allows it.

---

## 5. Pre-recruitment go/no-go checklist

Recruitment remains **NO-GO** until every item is true:

- [ ] PWQ-14 / AUD-003 is closed.
- [ ] M4 protocol version is locked.
- [ ] Participant information has a real private researcher contact.
- [ ] A private raw-data/consent storage location is approved.
- [ ] Withdrawal handling and retention are explicitly decided.
- [ ] M4 instrumentation needed by the locked protocol is implemented.
- [ ] One synthetic/internal dry run passes the validator.
- [ ] No public savings/generalisation claim is planned from the beta.

If any item is false, keep M4 execution blocked and continue only protocol/research preparation.
