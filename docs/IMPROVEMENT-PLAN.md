# Improvement plan: three stages

The app now runs an assessment in three stages, each with a clear start, finish and "ready for the next stage" check:

1. **Gather** — the applicant's situation, money, care plan, needs and what matters, ending in an assessment brief.
2. **Find** — providers on a map and in a ranked list, with insight into each, ending in a shortlist.
3. **Select, prep and interview** — the family chooses who to meet, prepares, interviews, scores and decides.

Defined with the product owner on 1 November 2026 through guided questions. Built in order: package 1, then 2, then 3.

---

## Package 1 — Gather

**1.1 Three-stage journey and the Gather wizard**
- The journey bar shows Gather → Find → Select, prep & interview (replacing the four phases).
- Gather is a wizard, one topic per screen, with progress, save and resume:
  1. Situation (who, where, level, pension, DVA card)
  2. Money (budget and contribution rates, worked out)
  3. Care plan (from the support plan — 1.2)
  4. Care needs and home (questionnaire sections B1–B7)
  5. What matters (priorities, must-haves, deal-breakers — B8)
  6. About me for providers (the dossier profile)
  7. Brief (1.4)

**1.2 Support plan reader**
- Upload the support plan or Notice of Decision (PDF or photo), after ticking consent. Claude Haiku reads level, services, hours and start date.
- The family confirms each item before it's saved. The file goes only to Claude and isn't stored.
- No plan yet: enter services by hand; the plan is marked **unconfirmed** until a support plan replaces it.

**1.3 Contributors**
- **Applicant:** the coordinator marks one member as the applicant (signs in with their own passkey). The applicant gets a large-text view of their sections (What matters, About me) with spoken answers (live transcription).
- **Split the sections:** the coordinator assigns wizard steps to members; each step shows who and whether it's done.
- **Family conversation:** record a conversation; Claude turns the transcript into suggested answers with the quote each came from; accepted or edited question by question. Nothing saved without confirmation.

**1.4 Brief and readiness gate**
- **Assessment brief:** one page, printable — situation, budget and contributions, care plan, priorities, must-haves, deal-breakers, and the Claude-drafted summary. The coordinator confirms; the applicant sees it and can comment.
- **Gate:** Find opens when level, budget and pension, the care plan, and priorities and deal-breakers are complete. The locked screen lists what's missing, with links. (Brief confirmation isn't required.)

**Done when:** a family can complete Gather from a support plan upload in one sitting; Find stays locked with clear reasons until the essentials are in; the brief prints on one page.

---

## Package 2 — Find

**2.1 Map and list**
- Find opens on a map beside the ranked list. The home and each provider's outlets are placed at suburb level (OpenStreetMap). Distance is shown in km.
- Only suburbs are placed: no addresses are looked up or sent anywhere.
- Whole plan / by service stays as a switch.

**2.2 Insight for each provider**
- **What you'd pay:** quarterly cost, what the budget covers, and the applicant's own contribution, in dollars.
- **Quality and compliance:** when shortlisted, Claude searches the Aged Care Quality and Safety Commission's site for the provider's findings, sanctions and notices, with links.
- **Ask Claude about them:** a question box answered by a fresh web search (Sonnet), with sources.

**2.3 Filtered-out snapshot**
- A page summarising providers that aren't in the list, grouped by reason:
  - hidden by filters (which filter);
  - deal-breakers found (with the evidence);
  - outside the area (with distance);
  - low match ("weak" or "not enough known").
- **Bring back** puts a provider back in the list, marked as brought back, so it can be shortlisted.

**2.4 Shortlisting**
- **Target:** a target number (e.g. 5) with progress; Find is done when the target is reached.
- **Quick reasons** when shortlisting ("same workers", "price", "local"), carried into the comparison and interviews.
- **Family reactions:** thumbs up or down, with a comment, on each shortlisted provider.
- **Call notes** for providers rung before interview: who you spoke to, what they said, availability.
- **On shortlist:** shortlisting reads prices, checks public claims and checks compliance in one go (within the search budget).

**Done when:** the family can see who's local, what each would cost them, any compliance issues, ask a question and get a sourced answer, recover any filtered-out provider, and reach a shortlist target with reasons and reactions.

---

## Package 3 — Select, prep and interview

**3.1 Family vote to choose who to meet**
- Coordinator, contributors and the applicant each pick up to three from the shortlist; viewers see the results.
- Votes stay hidden until everyone has voted. The applicant's choice breaks ties.
- The chosen providers move to "to interview".

**3.2 Preparation**
- **Tailored questions per provider:**
  - built from the predefined prompt list (the interview question sections), focused on each provider's gaps: priorities with no public claim, unconfirmed claims, compliance findings, price questions;
  - plus your own questions, for one provider or for all.
- **Booking:** date, time, place or phone, attendees and who leads; add to calendar (.ics); a checklist of what to send beforehand.
- **Send the pack:** an email draft opened in your own mail app (intro and questions in the body), plus the dossier PDF to attach.
- **Family briefing:** one page for whoever attends — what to listen for, red flags, the must-asks, how to score.

**3.3 In the interview**
- **Question checklist mode** (tablet or phone): tick questions as they're covered, with a quick rating and note on each, while recording runs.
- **Live gap prompts:** Claude Haiku reads the live transcript about once a minute and marks which must-ask questions have been answered; the rest stay highlighted.
- **Phone interview mode:** speakerphone recording guidance and the same checklist.

**3.4 Decide**
- **Each member scores** separately on the criteria. Scores are combined with the applicant's counting double, and differences of 2+ points are shown.
- **Decision record:** the choice and why. Then a next-steps checklist: tell the chosen provider, review the service agreement, tell the others, agree a start date.

**Done when:** the family can go from shortlist to a vote, prepared interviews with tailored questions and bookings, a guided interview with gap prompts, combined scores and a recorded decision with next steps.

---

## Notes for building
- **Models:** Claude Haiku 5.5 for reading documents and transcripts, structuring, and gap checks; Claude Sonnet 5.5 for web searches (compliance, Ask Claude). Nothing Claude produces is saved without the family confirming it, except searches whose sources are shown.
- **State:** shared state grows with versioned migrations, as before. New per-person data (votes, scores, assignments, reactions) records the member who made it.
- **Phones:** follow the reduced phone rules (one thing per screen; scores and side-by-side tables on bigger screens) unless a feature is phone-first (checklist mode, phone interview mode).
